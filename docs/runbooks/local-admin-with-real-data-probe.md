# 用【真後台 + 真資料】驗一個功能到底行不行(零 secret)

> **為什麼有這份**:Sean 2026-08-17 夜逐字 —— 「不用再用 artifacts, 直接來真的但是開伺服器做＋看,
> 這樣最準確」/「**我們應該所有需要用到的功能都可以用這個方式處理**」。
> ⇒ 替身(fixture / mock 畫面 / artifact)仍是測試用的靶,**但不再是「確認功能可用」的合格載體**。
>
> 🔴🔴 **在【施工窗工作樹】,本鏈不需要任何 secret、不碰任何 `.env*`** —— 它自己造一個資料庫。
> ⚠️ **而主樹 `pcm-website-v2` 有 `.env.local`,`next dev` 會自動載入它。**
>    起來的**第一段輸出就會印** `- Environments: .env.local` —— **看到那一行立刻收掉。**
>    那代表真的金鑰在那個行程的環境裡:打到會建 notifier 的路徑(例如
>    `/api/cron/anomaly-alert`)⇒ **可能真的寄一封信出去,而信是收不回來的(鐵則 12⑤)。**
>
> ```bash
> # 🔴 起任何 dev server 之前先跑這一行(判別句擋不住正在動手的人,命令可以)
> pwd; ls -1 apps/storefront/.env*
> # 看到 .env.local ⇒ 你在主樹 ⇒ **換工作樹,不要往下走**
> ```
>
> 🔴🔴 **而「換工作樹」這條解法【對 `scripts/storefront-probe/up.sh` 沒有用】** ——
>    那支腳本的 `REPO` 是**寫死的**(`up.sh:30` `REPO=/Users/sean_1/pcm-website-v2`),
>    `next dev` 一律從**主樹**的 `apps/storefront` 起 ⇒ **不管你人在哪一棵樹呼叫它,
>    載入的都是主樹那份 `.env.local`。**
>    ⇒ 它只把 Supabase / TapPay 那幾個變數用 inline 值蓋掉;**其餘的在那個行程裡是活的。**
>    ⇒ 限定與做法寫在 `up.sh` 自己的檔頭(它現在起完會印一行「next 載入的 env 檔:…」)。
>    📌 **兩條鏈的解法不一樣,而它們共用這一段警告** —— 只讀本檔就去跑 `up.sh` 會走回原地。
>
> 📌 **為什麼這兩句被合併成一句**(2026-08-21 實錘,而它一晚發生兩次):
>    原文把限定寫在**上一行**、把許可寫在**下一行**,而讀的人是**衝著「我可以做什麼」來的** ——
>    他讀到「不需要任何 secret」就往下做了。當晚一個窗照著在主樹起了 server(已收掉、零請求),
>    而**五分鐘後第二個窗正要在同一棵樹起 `scripts/storefront-probe/up.sh`**,被攔下。
>    ⇒ 🔴 **一個帶條件的許可,要把條件寫在許可【裡面】,不是寫在它上面。**
>
> 📎 首次跑通 = B 窗 2026-08-18 驗 `D2`-A(建箱候選改頂層分頁)。下面每個數字都是那次量到的。
>
> ## 🔴🔴 讀這一段再往下(多數人只讀開頭,所以最重要的兩句放這裡)
>
> **1. 開伺服器看到的東西,仍然要區分「量到的」與「看到之後推的」。畫面不會替你做那個區分。**
> 首次跑通那次我就踩了:彈窗沒開(⚠️ **而畫面上有一句錯誤訊息,不是「什麼都沒發生」**——
> 那句話後來成了本片最有力的證據,見 §7)⇒ 我推成「明細頁的截斷旗標把入口 fail-closed 了」,
> 把那句轉出去,**主視窗照它下了一個裁定** —— 而 `grep -n 'itemsTruncated' shipment-launcher.tsx`
> **零命中**,真因是我自己的種子沒有到貨資料。**畫面越像真的,這個錯越容易犯。**(全文在 §7 末)
>
> **2. §4 conf 裡那個 `db-max-rows = 2000` 是【我自己填的】,不是正式站的值。**
> 正式站 2026-08-18 也剛好量到 2000(V 窗:REST `206` / `content-range 0-1999/19777`)——
> 🔴 **兩個 2000 是兩件事,不要互相引用。** 本機那個你想填多少都行,它只影響你這台機器。

---

## §0 🔴 先讀:這條鏈能證什麼、不能證什麼

```
✅ 能證  「這個畫面在這種資料下，會畫出什麼」——【行為】，而且是真的 React + 真的 HTTP
✅ 能證  「我的查詢改動，在真的 PostgREST 上撈得到幾列」
❌ 不能證 正式站的行為。本機的 RLS / GRANT / 平台 trigger 都是【我自己補的】，見 §5
❌ 不能證 效能。本機是空庫、單機、無網路延遲
```
⚠️ **最容易誤讀的一條**:跑通之後畫面看起來跟正式站一模一樣,
**那個相似度會讓人忘記資料庫是自己捏的。** 下結論前回來讀 §5。

---

## §1 起拋棄式 Postgres(整段可貼)

```bash
S=/tmp/pcm-probe && rm -rf $S && mkdir -p $S
export LC_ALL=C
# 🔴 --encoding=UTF8 少不得：LC_ALL=C 會讓 initdb 建成 SQL_ASCII，
#    而 migration 裡的中文 COMMENT 會在 `conversion between UTF8 and SQL_ASCII is not supported` 炸掉。
#    ⚠️ 那個錯誤【出現在一支不相干的 migration 上】，很難聯想到 initdb ——
#       2026-08-18 我在這裡繞了兩圈才找到。
initdb -D $S/pg -U postgres --auth=trust --encoding=UTF8 --locale=C >/dev/null
# 🔴 -k /tmp：socket 路徑上限 103 bytes，scratchpad 那種長路徑會直接開不起來。
pg_ctl -D $S/pg -o "-p 55501 -k /tmp" -l $S/pg.log start
```

## §2 PCM bootstrap(平台有、本機沒有的東西)

```sql
CREATE ROLE service_role NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;

CREATE SCHEMA auth;
-- 🔴 `id` 一欄不夠：`public.handle_new_auth_user()` 這支 trigger 會讀 NEW.email 與
--    NEW.raw_user_meta_data ⇒ 少了會噴 `record "new" has no field "email"`。
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
-- 🔴🔴 pgcrypto **也要,而且【一定要在 extensions 這個 schema】**(2026-08-19 G5 實測補上)
--    少了它 / 或裝進 public ⇒ `extensions.gen_random_bytes(integer) 解析不到`
--    ⇒ N3a 前置閘失敗 ⇒ N3b / W1 / W2 / W3a / W3b2 / W3c3 / W4 / W7d1 **整串跟著倒**
--    ⇒ 🔴 **後果是【出貨那條路的四支 RPC 一支都不存在】**
--         (admin_create_shipment / admin_add_shipment_items /
--          admin_mark_shipment_shipped / admin_void_shipment)
--    ⚠️ **而錯誤訊息不會指向這裡** —— 你會看到「W1 前置閘失敗」「W2 前置閘失敗」一串,
--       逐支追沒有意義。**要追鏈頭:找第一個不是「relation does not exist」的錯。**
--    📌 實測(2026-08-19):修這一行之後,失敗數 26 → 23,而**出貨四支 RPC 全部出現**。
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;

-- 🔴 RLS policy 直接呼叫這三支；沒有的話 `function auth.uid() does not exist`，
--    而它會讓【所有帶 policy 的 migration】一起失敗（2026-08-18 實測：74 支）。
-- 🔴🔴 **下面這一行在 PostgREST 14 上是【壞的】,而它壞得沒有聲音 —— 修法與實測見 §8。**
--    ~~SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid~~
--    PostgREST **14 起不再設** `request.jwt.claim.sub` 這個 GUC(改設 `request.jwt.claims`,JSON)
--    ⇒ `auth.uid()` 恆為 `null` ⇒ **所有綁它的 RLS 濾成 0 列,而 HTTP 仍是 200**。
--    ⚠️ **這是版本差,不是筆誤** —— 你若在**舊版**上讀到這一行,它在那裡是對的。
--    🔴 **admin 那條路永遠看不到它** —— admin 走 `service_role` + `BYPASSRLS`,不經過 `auth.uid()`。
--    (量測:PostgREST **14.16**,W4 2026-08-18。**本檔檔名比它的射程窄。**)
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(
           current_setting('request.jwt.claim.sub', true),
           (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
         ), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
```
⚠️ **不要**在這裡 `CREATE TYPE member_tier` —— migration 自己會建,先建會撞
`type "member_tier" already exists`(2026-08-18 踩過)。

## §3 套 migration(**不要求全綠**)

```bash
cd <你的 worktree>
ok=0; fail=0
for f in supabase/migrations/*.sql; do
  if psql -h 127.0.0.1 -p 55501 -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >> /tmp/pcm-probe/apply.log 2>&1
  then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $f" >> /tmp/pcm-probe/apply.log; fi
done
echo "ok=$ok fail=$fail"
```
🔴🔴 **判準不是「全部套過」,是【你要用的那幾張表在不在】。**
2026-08-18 實測:`ok=155 fail=26`,而我要的六張表全在 ⇒ **可以往下走**。
```sql
select tablename from pg_tables where schemaname='public'
 and tablename in ('orders','order_items','order_item_quantity_summary',
                   'shipments','shipment_items','customers') order by 1;
```
⚠️ **失敗的那 26 支不是雜訊,是【你這次沒有覆蓋到的面】** —— 若你的功能碰到它們,結論不算數。
🔴 追失敗要**追鏈頭**:一支 `CREATE TABLE` 失敗會讓後面十幾支跟著失敗,
逐支看沒有意義,要找**第一個非「relation does not exist」的錯**。

### 🔴🔴 §3-a 失敗的那幾支會讓**本機的約束比正式站舊** —— 而它不會紅,只會靜靜地說謊

2026-08-19(W2)實測 `ok=175 fail=13`,而其中一支是
`20260729010000_m4b_e10_d0_display_id_expand.sql`。**後果**:

> ⚠️ **這是 2026-08-19 的快照,而下面整段推論全靠「那一支真的失敗了」。**
> 自己確認一次(這一步只要一秒):跑完 apply 之後,在你的 log 裡找 `20260729010000`。
> **它這次成功了** ⇒ 下面那段不適用你,**本機的約束是新的**。
> **它還是失敗** ⇒ 照下面讀。
> 🔴 **不要憑這一行的存在就假設它失敗了** —— 這份是 runbook,它記的是當時,不是現在。
```
本機 orders_display_id_format = CHECK (display_id ~ '^PCM-[0-9]{4}-[0-9]{4,}$')   ← 舊格式
正式站實際單號                = RCPVVJ / 5HGMC5 / 8X3N5Q（6 碼）  ＋ PCM-2026-0102（舊的也還在）
⇒ 🔴 任何與【單號字面 / 長度 / 格式】有關的結論，本機不算數
⇒ 而你會先撞到它：種測試資料時 INSERT 被 CHECK 擋下（那是好的，它至少會紅）
   🔴 危險的是【反過來】——你若寫了一個「單號長度 ≤ N」之類的判斷，
      本機測得過，而正式站的 6 碼單號走的是另一條路。**那一格不會紅。**
```

**通則(比 display_id 大)**:
> **失敗的那幾支 migration = 你本機這份 schema【停在哪個時間點】。**
> 而後面每一支成功的 migration,都是在那個舊地基上跑的。
> ⇒ 🔴 **下結論前先看一眼 FAIL 清單裡有沒有你這次要碰的那張表 / 那個約束。**
> 「我要的表都在」只證明**表在**,不證明**它是最新的形狀**。

📌 查本機某條約束的真實現況(不要憑 migration 檔推):
```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.<表名>'::regclass and contype = 'c';
```

### 🔴🔴 §3-b 有一族 migration **在空庫上永遠套不起來** —— 而**那不是環境壞掉**(2026-08-20 W4)

本 runbook 的順序是 **「先套 migration → 再種資料」**(§3 在 §4 之前,而種子資料要等 PostgREST 起來)。
而有一族 migration 的驗證段**需要庫裡先有一張真訂單**才跑得動 ——
🔴 **順序天生相反。照本檔跑的每一個人都會看到它們 FAIL。**

2026-08-20 實跑(`ok=181 fail=20`)裡,這四支是同一個原因:
```
20260820020000  m4b_e10_a8a3g_cancel_guard_sibling_dedup   ← 鏈頭
20260820021000  m4b_e10_d1_record_manual_refund
20260820022000  m4b_e10_d2_grant_manual_refund
20260820030000  m4b_e10_a8a3_cancel_gate_noncard           ← 前置閘擋在 020000 上
```

**它們自己就說了為什麼**(apply log 逐字):
```
20260820020000 ⇒ ERROR: A8a3-G 世界一:本片的「兩個世界」驗證需要至少一張既有訂單來借
   (暫時改三欄、子交易回滾;不寫 auth.users、不碰金額欄)。現在 public.orders 零列 ⇒ probe 跑不了。
   🔴 **這不是 bug,是刻意 fail-closed**:probe 跑不了就等於一格恆綠,而恆綠長得像成功,
   而本片動的是【客人結帳路徑】。解法:在有訂單資料的環境 apply。**不要把這道斷言拿掉。**

20260820021000 ⇒ ERROR: D1 負測:需要至少一張既有訂單與一位啟用中的 staff 來借。現在借不到 ⇒ 負測跑不了。
   🔴 **刻意 fail-closed** —— 跑不了就是一格恆綠,而本 RPC 是那些守門唯一的位置。

20260820030000 ⇒ ERROR: A8a3 前置閘一:守門片(20260820020000)尚未 apply…先套守門片再回來。
```

> 🔴 **上面那四支是 2026-08-20 的快照,而分母已經動了。今天跑之前先自己算一次:**
> `grep -lE '需要至少一張|借不到|零列 ⇒' supabase/migrations/*.sql`
>
> **2026-08-25 實測**:這條撈到 **13 支**;而 migration 總數已從那次快照的 `181+20=201` 長到 **216**
> (數法 `ls -1 supabase/migrations/*.sql | grep -c ''`;負對照餵一個不存在的 pattern ⇒ 0)。
>
> ⚠️ **這條命令不是上面那張表的替代品** —— 它只涵蓋上面四支裡的 **2** 支。
> 它答的是「**誰自己說它需要資料**」,不是「**誰會 FAIL**」:`20260820022000` 與 `20260820030000`
> 是**鏈式失敗**(前置沒 apply ⇒ 後面跟著倒),它們自己的錯誤訊息裡沒有那句話 ⇒ 撈不到。
>
> 🔴 **所以真正該記住的是這一句,不是那條命令:**
> **看到清單以外的 FAIL,預設當它是【真的失敗】,不要當成「大概也是已知的那種」。**
> 這張表教會你「有些 FAIL 是正常的」—— 而它降低的是你的**警覺**,不是你的**正確率**。

**⇒ 三件事要記住:**

**1. 看到這四支 FAIL,不要去追、不要去改 migration。** 它們正在照設計拒絕。
   🔴 **「不要把這道斷言拿掉」是那些檔自己寫的** —— 而拋棄式環境是最容易讓人手癢拿掉它的地方
   (反正是丟掉的庫)。**拿掉一次,那個習慣會跟著你回到正式庫。**

**2. 🔴 它會讓你的結論相容於兩個世界,而你可能沒發現。**
   例:量「非卡退款登記入口按下去會不會寫進一筆」⇒ 沒寫進去。
   **那個「沒寫進去」同時相容於「閘擋住了」與「RPC 根本不存在」。**
   ⇒ 下結論前先問:**我這次要驗的東西,它的 RPC / 表 / 約束在【我這顆庫裡】真的存在嗎?**
```sql
-- 存在性(函式)：不存在會回空，不會報錯 —— 所以【正向對照少不得】
select proname, pg_get_function_arguments(oid) from pg_proc where proname = '<你要驗的函式>';
select proname from pg_proc where proname = '<一支你確定在的函式>';   -- 正向對照：尺是活的
```

**3. 要讓它們套起來,順序要倒過來**(本檔沒有把這步寫進主流程,因為多數量測不需要):
```
①先跑 §1-§3（那四支會 FAIL，照舊）
②種一張訂單 + 一位 staff。🔴 **會依序擋你四次**（2026-08-20 實際撞到的順序，逐個修才過）：
     orders.invoice            CHECK orders_invoice_whitelist    type ∈ personal|company|donate，且只准 5 個鍵
     orders.shipping_address…  CHECK orders_ship_addr_whitelist  必須【剛好】有 name+phone+line 三個鍵
     order_items.product_snap… CHECK order_items_snapshot_whitelist  必須有 title+sku+spec，spec 是 object
     order_payments.actor      **FK → staff(id)**（不是 CHECK）⇒ 要先 INSERT 一列 staff
   ⚠️ 另外：`display_id` 的格式 CHECK 可能停在舊版（見 §3-a），舊格式是 `PCM-2026-0001` 這種
③再單獨 psql -f 那四支（依序 020000 → 021000 → 022000 → 030000）
```
⚠️ **我(W4)沒有跑第 ③ 步** —— 2026-08-20 那次的三個量測不需要它。
**所以「倒過來就會成功」是【推的】,不是量到的。** 誰跑通了回來把這行改掉。

---

## §4 PostgREST + 前綴代理 + 真後台

```bash
# PostgREST
cat > /tmp/pcm-probe/prest.conf <<'CONF'
db-uri = "postgres://authenticator@127.0.0.1:55501/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-port = 3999
jwt-secret = "pcm-throwaway-jwt-secret-at-least-32-chars-long-ok"
db-max-rows = 2000
CONF
postgrest /tmp/pcm-probe/prest.conf > /tmp/pcm-probe/prest.log 2>&1 &
```

🔴 **service_role 還要兩道,否則 403 / 空結果**(平台平常幫你做,本機沒有):
```sql
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER ROLE service_role BYPASSRLS;   -- 🔴 少了它 RLS 會把結果濾成 0 列，而 HTTP 仍是 200
```
⚠️ **`200 + 0 列` 與「真的沒有資料」長得一模一樣。** 撈到空的先回來檢查這兩道。

**自簽 service_role JWT**(HS256,secret 同上;沒有 secret 外洩,那把是這台機器上臨時造的):
```python
import base64, hmac, hashlib, json
sec = b"pcm-throwaway-jwt-secret-at-least-32-chars-long-ok"
b64 = lambda d: base64.urlsafe_b64encode(d).rstrip(b"=")
h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
p = b64(json.dumps({"role":"service_role","iss":"pcm-throwaway","exp":4102444800},separators=(",",":")).encode())
print((h+b"."+p+b"."+b64(hmac.new(sec,h+b"."+p,hashlib.sha256).digest())).decode())
```

🔴 **前綴代理少不得**:supabase-js 打的是 `/rest/v1/...`,而 PostgREST 在**根**
⇒ 直連會回 `PGRST125 Invalid path specified in request URL`。
20 行 Python 反向代理(剝掉 `/rest/v1`)就夠,聽 `3998` 轉 `3999`。

**起後台**(這一行本來就在 `docs/design/admin-design-system.md` 檔頭):
```bash
cd apps/admin && ADMIN_DEV_BYPASS=1 \
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3998 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=dummy-anon \
  SUPABASE_SERVICE_ROLE_KEY="<上面那把 JWT>" \
  npx next dev -p 3011
```

## §5 ⚠️ 效度限制(**下結論前必讀**)

```
· service_role 的 GRANT 與 BYPASSRLS 是【我自己下的】⇒ 這條鏈【證不了正式站的權限設定】
· auth.users 是骨架、auth.uid() 是我寫的替身 ⇒ 任何依賴真 session 的判斷都不算數
· 26 支 migration 沒套上 ⇒ 它們建的東西不存在，碰到就不算數
· db-max-rows 是我在 conf 裡寫的 2000，不是正式站的值（正式站 2000 由 V 窗 2026-08-18 另外量到）
· 沒有 Supabase 平台的 event trigger、沒有真的 supabase_admin
```

### 🔴🔴 §5-a 上面那句「依賴真 session 的判斷不算數」——**它的實際射程是【整個寫入面】**

**原句沒有錯,它只是【窄】。** 讀的人(包括我)會把它讀成一個**主題限制**:「我只是不能測登入」。
**而它其實是一個【能力邊界】。**

**2026-08-19 W3 實測撞到的**:在真瀏覽器上打開 `/customers`、在搜尋框打字、按「搜尋」⇒
```
網址變成  http://localhost:3011/customers?r=denied
成因      keyword-search-action.ts:83 的 authorizeAdminMutation() 回 null
          （ADMIN_DEV_BYPASS=1 只繞過 proxy 那道登入閘，它【不會】造出一個真的 admin session）
```
🔴 **而它不是那一支 action 的事** —— 任何走 `authorizeAdminMutation()` 的 server action
在這條鏈上都會被擋:**改金額 / 採購登錄 / 收款登錄 / 關鍵字搜尋**,全部。

> ## ⇒ **鑽機能驗【畫面長什麼樣】,不能驗【按下去會發生什麼】。**

> ### ⚠️ 上面這句 **2026-08-21 起【部分不成立】** —— 寫入面打得通,配方在下(2026-08-23 b8 重跑驗過)
> 原句當時為真,留著不改;它失效的那一格與為什麼失效,寫在這裡。
> 🔴 **它過期了兩天沒人發現的代價是量到的**:線2 2026-08-23 讀到它,放棄了整個行為面的驗證、並開始考慮
> 一條它自己判斷「不該做」的繞道 —— 一句過期的「做不了」產生的不是錯誤,是【沒有發生的嘗試】。
>
> **為什麼原句只對一半**(線A 2026-08-21 打通、b8 08-23 逐條複打 `lib/session/authorize.ts`):
> ```
> ADMIN_DEV_BYPASS=1 只管兩件事:proxy.ts 的放行 + Origin 檢查的 devBypass(authorize.ts:17-18、:39)
> ⇒ 它【不】造出 session。authorizeAdminMutation 要過三關(authorize.ts:24-42),缺一即 null ⇒ ?r=denied:
>   ① verifySessionDetailed(cookie pcm_admin_sess_dev)
>   ② isAllowedOrigin(…, devBypass)          ← 只有這一關 ADMIN_DEV_BYPASS 有效
>   ③ getSessionActor() ⇒ cookie pcm_admin_actor 值必須是 staff 表的 active id(seed 有 sean / staff_1 / staff_2)
> ```
> **配方(零 secret、不碰任何 `.env*`、與正式站金鑰無關 —— 這句要讀兩次:secret 是你隨手編的)**:
> ```bash
> # 一 · 起鑽機時多帶一個隨手編的 ADMIN_SESSION_SECRET(≥32 字元;up.sh 不擋環境變數,會傳給 next dev)
> ADMIN_SESSION_SECRET='pcm-admin-probe-<代號>-throwaway-session-secret-32plus' bash scripts/admin-probe/up.sh
> # 二 · 用【同一個 secret】自己簽一張票(格式=session.ts;dev 的 envTag 是 local;材料有長度前綴)
> python3 - <<'PY'
> import hmac, hashlib, json, base64, os, time
> sec='<你的 SEC>'; env='local'
> material=f"v1:{len(sec)}:{sec}:{len(env)}:{env}".encode()
> now=int(time.time())
> pj=json.dumps({"v":1,"sid":os.urandom(16).hex(),"iat":now,"exp":now+11*3600,"auth_time":now,"amr":["bootstrap"]},separators=(',',':')).encode()
> b64=lambda b: base64.urlsafe_b64encode(b).decode().rstrip('=')
> print(b64(pj)+'.'+b64(hmac.new(material,pj,hashlib.sha256).digest()))
> PY
> # 三 · 瀏覽器 console 設兩顆 cookie(缺一都還是 denied,而畫面上的字一模一樣 —— 兩顆一起設)
> document.cookie = 'pcm_admin_sess_dev=<上面印的>; path=/; SameSite=Lax';
> document.cookie = 'pcm_admin_actor=staff_1; path=/; SameSite=Lax';
> ```
> **2026-08-23 重跑的判別發**(訂單列表的關鍵字搜尋 = 走 `authorizeAdminMutation` 的 server action):
> ```
> 不帶 cookie 送出  ⇒ 導到 /orders?r=denied                 ← 對照組,原句描述的世界
> 帶兩顆 cookie 送出 ⇒ 導到 /orders?date_from=…&date_to=…   ← 無 r=denied,動作被執行
> ```
> 兩個世界印不同的東西 ⇒ 配方是活的。來源信:`~/pcm-mailbox/A-86-☐2走查清單-失敗時他看得到嗎-20260821.md:195-230`
> (信箱不會被下一個人讀到 —— 這就是它過期兩天的原因,見下)。
>
> **⚠️ 三條效度限制一起帶走,不要只帶好消息**:
> 1. 鑽機多開了正式站沒有的 `AUDIT_UI_ENABLED=1`(#27)⇒ 稽核那格不可外推到正式站。
> 2. OD 那 95 張畫面是用 service_role 抓的(繞過 RLS)⇒「看得到」≠「員工看得到」。
> 3. `customer_addresses` / `customer_vehicles` 在鑽機上是空表 ⇒ 碰那兩張表的路徑構造不出來。
>
> **這一格為什麼會過期而沒人發現**:打通法寫進了信箱檔,而信箱檔不在任何人的閱讀路徑上;runbook 這句
> 「不能驗」沒有任何東西在看它還成不成立。**機制提案(不是「要記得寫回去」)**:把 runbook 裡每一句
> 「做不了 / 不能驗」變成【帶重測命令的限制條目】—— 條目旁附一條可跑的檢查,定期跑;哪天那條檢查
> 過了,限制句就被機器標成「過期待改」。本條的重測命令 = 上面那兩發判別發(可腳本化)。
> ⇒ 立 backlog `#857`;**而我明說它的代價**:每句限制都要有人寫重測命令,沒寫的那些照樣會靜靜過期。

⚠️ **而失敗【看得見】**(這是好消息,不是壞消息):`?r=denied` 會讓頁面印出「沒有權限」
(`#534` 的修法;W3 同日負對照驗過:**帶 `r=denied` ⇒ 出現;不帶 ⇒ 不出現**)。
⇒ **你按下去沒反應的時候,先看網址列有沒有 `?r=denied`** —— 有的話那不是功能壞了,是這條鏈的邊界。

### ✅ §5-b 而【不受影響的那半】是什麼 —— 以及怎麼自己判

**不經過 server action 的東西,結論仍然成立**:
```
✅ 仍成立  server render 出來的 DOM 長什麼樣（有沒有那個欄位、選項幾個、文字是什麼）
✅ 仍成立  純 client 的互動：<details> 開合、下拉 change 觸發的導航、CSS 類別
⚠️ 收窄了   任何「按下去會寫東西」的路徑(form action / server action / RPC 寫入)
           🔴 **這一列【不是錯的】,它在【沒照 §5-a 配方跑】的情況下仍然成立** —— 這是收窄不是推翻。
           ✅ **而照 §5-a 那三條配方跑,寫入面【打得通】**(2026-08-29 線I 實測,四個 server action 全過):
             搜尋(訂單列表)   ⇒ `/orders?date_from=…`  **無 `r=denied`**
             新增採購         ⇒ `?r=procurement_created`
             登錄到貨         ⇒ `?r=receipt_recorded`
             建箱並標出貨     ⇒ 包裹 `5J7ZB5` 已出貨(新竹物流 · 單號 PROBE-TRACK-0001)
           🔴 **對照組(同一天、同一支鑽機、只差沒帶配方)**:
             `alert`「沒有權限或登入狀態已失效,採購沒有寫入。」⇒ 兩個世界印不同的東西。
           📌 **配方在本檔 §5-a**(往上約 60 行)—— 而它【原本就在這張表前面】,
              問題不是順序,**是這張表自己沒有指回去** ⇒ 讀的人先讀到「不成立」就停了。
           ⚠️ 而線I 自己就是那個樣本:**它只做了三條配方裡的一條就下結論「探針跑不了寫入」**,
              回頭讀本檔才發現配方一直都在 ⇒ **又一次「沒有發生的嘗試」,而這次是【對的話沒被讀到】。**
```
🔴 **自己判的方法(照著做,不要憑印象)**:
1. 問「**我這一發量的東西,有沒有經過一個 `'use server'` 的函式?**」
   沒有 ⇒ 不受影響。有 ⇒ 這一發的結論作廢,除非你另外證明它沒被擋。
2. **看網址列**:動作之後出現 `?r=denied` ⇒ 那一發從頭到尾沒有執行過。
3. 🔴 **回頭核【已經下過的結論】,不要只從下一發開始注意。**
   📌 實例:W3 發現這個邊界之後,回去核自己片7 那幾發真瀏覽器量測 ——
   量的全是 DOM 存在性與 `<details>` 開合(純 client、不經 action)⇒ **那些結論不受影響**。
   **這個回頭核的動作才是重點**:量具的邊界是在你已經量過很多發【之後】才發現的,
   而那些發已經被寫進 commit body 與交件信裡了。

### 🔴🔴 §5-d 少一個 env,**那條鏈就短一截** —— 而短掉的那一截往往正是你要量的那一段

**2026-08-26 實錘(線3 `-f5`,量「票過期時使用者實際看到什麼」)。**

```
本機【預設狀態】:沒有 PCM_QUOTE_SSO_BASE
⇒ /api/sso/start 直接 500 ⇒ 跨來源那一跳【根本不會發生】
⇒ 補上 dummy 設定之後才看到完整的鏈:
   過期票 ⇒ 303 ⇒ /api/sso/start ⇒ 302 ⇒ http://quote-probe.invalid/api/sso/authorize?state=...
```

> ## **本機的預設狀態不是「正式站的縮小版」,它是【另一個世界】。**

⇒ **不是「東西比較少」,是【鏈的形狀不一樣】。** 而短掉的那一截不會報錯 ——
它只是**沒有發生**,而「沒有發生」與「發生了而沒問題」在畫面上是同一件事。

⇒ **動作**:量一條鏈之前,先問「這條鏈上每一跳需要的 env,本機有沒有?」
沒有的那幾跳 ⇒ **要嘛補 dummy 讓它跑起來,要嘛在結論裡明寫「這一段未經過」。**

---

### 🔴🔴 §5-e 這個 `playwright` 到不了 `localhost` —— 而錯誤訊息長得像被測的東西造成的

**2026-08-26 同一發量到(線3 `-f5`)。**

```
playwright 導 http://localhost:3055/orders   ⇒ net::ERR_NAME_NOT_RESOLVED
             http://127.0.0.1:3055           ⇒ 同樣解不到
⇒ 這個 playwright 後端【不在本機 / 到不了本機的迴路位址】
```

⚠️ **後果**:runbook 上「起 dev server 然後開瀏覽器看」那一半,**目前只做得到 server 層**
(用 `curl` 量狀態碼與 `location` 標頭)。**瀏覽器層的行為(表單狀態、client JS、下載)量不到。**

🔴 **而它最會騙人的地方**:第一次撞到時最自然的解釋是「它跟著 redirect 跳到外部網域了」。
```
正對照:導 /api/sso/callback(在白名單裡、不會 redirect)⇒ 【一樣的錯誤】
⇒ 與被測的東西完全無關, 而它的錯誤訊息長得像被測的東西造成的
```
⇒ **判別動作**:撞到 `ERR_NAME_NOT_RESOLVED` ⇒ **先導一個絕對不會 redirect 的路徑**。
一樣錯 ⇒ 是這個後端到不了本機,**不是你的鏈壞掉**。

⇒ ~~**要量瀏覽器層,需要一個跑在本機、到得了 `localhost` 的瀏覽器。目前沒有人有。**~~
⚠️ 這一格影響 Sean 2026-08-17 那道常設令(逐字「不用再用 artifacts,直接來真的但是開伺服器做＋看」)——
**「開伺服器」做得到,「看」當時只到 server 層。** 下結論時要分開講。

---

#### ✅ §5-e 訂正(2026-08-27 線3 重量)—— **上面那句「目前沒有人有」現在是假的**

**同一支 playwright,到得了。** 而我不是拿被測的東西去量它(那樣分不出誰壞),
是起了一支**乾淨的靶**:`python3 -m http.server`,首頁只放一行 `<h1 id=probe-marker>PROBE-REACHABLE-9f3a</h1>`。

```
量的                                    結果
shell curl → localhost:8791             HTTP 200
playwright → http://localhost:8791/     document.getElementById('probe-marker').textContent
                                        ⇒ "PROBE-REACHABLE-9f3a"     ← 我放進去的那串字
playwright → http://127.0.0.1:8791/     ⇒ 同一串字
負對照:playwright → 沒開的埠 8792      ⇒ net::ERR_CONNECTION_REFUSED
```

🔴 **兩件事要分開講,不要合成一句「playwright 好了」**:
1. **不是「有導頁」,是拿回我自己放進去的字串。** 導頁成功與拿到內容是兩個宣稱 ——
   一個被 proxy 攔截或回錯頁的 response 一樣會讓 `goto()` 成功。**靶上要有只有你會放的東西。**
2. 負對照吐的是 **`ERR_CONNECTION_REFUSED`**,而上面 2026-08-26 那格是 **`ERR_NAME_NOT_RESOLVED`**
   ⇒ **那是兩種不同的錯**:前者是「到了本機而沒人在聽」,後者是「名字解不出來」。
   ⇒ 所以 2026-08-26 那一發**不是**「沒東西在聽」造成的。成因**未確認**
     (可能是那個窗的 playwright 後端不同、可能是環境變了),**我沒有回頭複現它**。

⚠️ **而我【沒有】證明的事,寫在這裡免得被外推**:
```
證明了  playwright 到得了本機的一支【沒有 JS 的陽春 HTTP server】
沒證明  它驅動得了真的 Next 後台
        —— §9 那個坑(用 127.0.0.1 時 HTML/CSS 正常而 client JS 靜靜地不見)我這次【碰不到】,
           因為我的靶根本沒有 client JS ⇒ 兩個世界在我的量測裡長得一樣。
        ⇒ 要量真後台, §9 那條「一律用 localhost、不要用 127.0.0.1」仍然有效, 不因本節放寬。
```

#### ⏱️ 附帶(2026-08-27 `-9e` 量到):**`playwright` MCP 的「等待」不可信,要用頁內時鐘**

```
playwright MCP 的 wait 實際只等 35-60 秒就回(-9e 2026-08-27 量)
⇒ 「我等了 N 秒」那種字面在它身上【不成立】
```
🔴 **它壞掉的方式是最毒的那種**:你以為等了 3 分鐘,實際只等了 40 秒,
而**巡邏型的行為在 40 秒內看起來與「它停掉了」一模一樣**。
⇒ **做法**:①等待用**呼叫端 shell** 的睡眠(本 repo 沒有 `timeout`,可用 `perl -e 'select(undef,undef,undef,N)'`)
②時間**用頁內時鐘量**(`Date.now() - 起點`),不要用「我等了幾秒」的字面
③把那個秒數**印出來放進報告**,而不是寫「等了 3 分鐘」。
✅ 2026-08-27 那支探針(`docs/probes/2026-08-27-session-renew-form-data-survival.md`)
   用的正是 ①+②:shell `perl select 215` + 頁內時鐘讀回 **238 秒**。

---

📌 **這一節存在的理由**:上一班寫下「目前沒有人有」是誠實的,而**它變成假的時候沒有任何訊號**。
   下一個人讀到那一句會直接放棄一整條量測路徑 —— **一句正確的限制,過期之後的殺傷力比一個錯誤更大**,
   因為它不會被任何測試、任何守門、任何三綠碰到。
⇒ **判別動作**:要下「瀏覽器到不了本機」這個結論之前,**先用乾淨的靶量一次**(上面那三行,一分鐘),
   不要引用本檔的任何一句。

---

### 🔴🔴 §5-c 一棵拋棄式樹的 HEAD **就是它的世界** —— 在它上面量到的,只對那個世界為真

**2026-08-24 實錘(cf 補洞窗)**:要驗 `globals.css` 那 10 條 `#nav-rail` 選擇器接不接得起來。
```
用的樹  wt-886, HEAD = 00037db2
而補上 id='nav-rail' 的那顆是 b9475aec —— **在 00037db2 之後**
⇒ 第一發量到【10 條全部零命中】
⇒ 而正對照 aside=1(DOM 真的有渲染)⇒ **看起來完全像「那 10 條全死了」**
```
🔴 **若停在那裡,交出去的會是一個【對那棵樹為真、對現行 dev 為假】的結論。**
而它不會有任何訊號:對照組是綠的、DOM 有渲染、數字乾乾淨淨。

📌 **與「量具壞掉」的差別**:量具沒壞,**世界不對**。
   兩者在輸出上長得一樣,而處置完全不同(一個修尺、一個換樹)。

#### ✅ 開鑽機量【現行行為】之前,先跑這一行

```bash
# 主樹與你要用的那棵樹,HEAD 一不一樣
git rev-parse --short HEAD && git -C <你要用的樹> rev-parse --short HEAD
```
不一樣 ⇒ **先同步那棵樹,或把你要量的那幾支檔複製過去**,再開鑽機。
🔴 **提醒擋不住這一格** —— 同一天有人讀過「別咬到 data-testid」的警告、複述過它、然後照樣踩。
**一條可執行的命令擋得住,一句話擋不住。**

#### ⚠️ 那些拋棄式樹現在多舊(**2026-08-24 19:22 當時的狀態,不是永久事實**)

```
主樹        9f746ca7
wt-886      00037db2      ← 本節那個實例用的就是它
wt-push     b3e38e9d
pcm-site-redesign 4d774876 · pcm-vitest-alias 88845f35
pcm-w3-guards d70085c2 · pcm-w4-review2 f37ccd8f
.claude/worktrees/practical-shannon-525b68 bd8c4fa8
⇒ 當時【沒有一棵】跟主樹同步。而八棵裡只有主樹有 .env*(所以只有主樹會被 DB 閘擋)
```
🔴 **上面這張表會過期,而過期時沒有訊號。要現值就當場跑這一行**:
```bash
git rev-parse --short HEAD; git worktree list --porcelain | awk '/^worktree /{print $2}' \
  | while read -r w; do printf '%-46s %s .env=%s\n' "$w" \
      "$(git -C "$w" rev-parse --short HEAD)" "$(ls -a "$w" | grep -c '^\.env')"; done
```
📌 **寫死的清單會過期,查法不會。** 而本節寫這張表的當下,主樹的 HEAD 就已經與
上一輪量測時不同了 —— **那段間隔是十幾分鐘。**

## §6 收攤(**逐項驗它們真的死了,不看指令回傳**)

> ## 🔴🔴 而 `pgrep -f "next dev -p …"` 這把尺【會對活著的伺服器說零命中】(2026-08-19 G5 實錘)
> **`next dev` 啟動後會把自己改名成 `next-server (vX.Y.Z)`** ——
> 拿【啟動時的指令字串】去 `pgrep -f` **匹配不到它**。
> ```
> 我報過「pkill 完 ⇒ pgrep 零命中 ✅ / lsof :3001 沒人佔 ✅ ⇒ 已驗死」
> 30 分鐘後要起第二台,Next 自己說:
>   ⨯ Another next dev server is already running.  PID: 99393
> 當場複驗:ps -p 99393 ⇒ 活著;curl :3001 ⇒ 200
> 🔴 「零命中」的意思是【我的 pattern 對不上】,不是【它死了】
> ```
> ✅ **改用兩把不會說謊的**:
> ```bash
> kill <PID>                      # PID 用 Next 自己印的那個,不用指令字串猜
> ps -p <PID> -o pid=             # 空 = 真的死了
> curl -s --max-time 3 -o /dev/null -w '%{http_code}' http://localhost:<port>/   # 000 = 沒人在聽
> ```
> ⚠️ **而收攤是收【自己的】不是收乾淨** —— 同一台機器上可能有別窗的 `next-server`
> (實例:`43930` 帶 Claude Code token、`81985` 帶 OD port)⇒ **不要 `pkill -f next-server`。**
> 📎 這與 §9-c「元素在 ≠ 它活著」是同一個母題的另一半:**零命中 ≠ 不存在。**

```bash
# 🔴🔴 **2026-08-19 W6 抓到:這一段【原本】會殺掉別的視窗的程序,已改。**
#    ~~舊版:`pkill -f "proxy.py"`、`pkill -f "postgrest"`(兩個都【不帶埠、不帶路徑】)~~
#    ⇒ 同一台機器上別窗起的 `proxy.py` / `postgrest` **cmdline 一模一樣** ⇒ **一起被殺,而它收不到任何訊息。**
#    📌 這不是理論:2026-08-19 當晚 W3 與 W1 真的撞過埠(3012),而**腳本那邊同款的坑已經修掉了**
#       (`scripts/*-probe/down.sh` 改成帶埠 / 讀埠佔用者)—— **而這份 runbook 還在教人做那件事。**
#       🔴 **腳本安全了,照文件手動收攤的人仍然會誤殺。**
# ⇒ 一律「**只殺自己的**」:pattern 帶自己的**資料目錄**或自己的**埠**。
pkill -f "next dev -p 3011"
pkill -f "/tmp/pcm-probe/proxy.py"          # 帶【自己的資料目錄】—— up.sh 把它複製進去再跑
pkill -f "/tmp/pcm-probe/prest.conf"        # 帶【自己的設定檔】，不要用裸 "postgrest"
pg_ctl -D /tmp/pcm-probe/pg stop -m immediate; rm -rf /tmp/pcm-probe
# 🔴 而 `next` 那一格【不要用 pgrep】(理由見上面那段:它會改名)⇒ 問誰在聽那個埠。
printf "%-26s " "next(讀埠 3011 的佔用者)"
_own=$(lsof -nP -iTCP:3011 -sTCP:LISTEN 2>/dev/null | grep -v WARNING | awk 'NR==2 {print $2" "$1}')
if [ -n "$_own" ]; then echo "🔴 還活著 —— $_own"; else echo "已停"; fi
for pat in "/tmp/pcm-probe/proxy.py" "/tmp/pcm-probe/prest.conf"; do
  printf "%-26s " "$pat"; pgrep -f "$pat" >/dev/null && echo "🔴 還活著" || echo "已停"
done
git status --porcelain    # 應為空
```
⚠️ **而「已停」只說得了【我這幾把尺沒看到它】** —— 埠那一層才是真的判準,見 `scripts/admin-probe/down.sh`
(它把兩層都跑一次,而且**只收自己那一組**)。**能用腳本就用腳本,這一段是給沒有腳本的人的。**
🔴 **`pkill` 的回傳值不是「它死了」** —— 要 `pgrep` 逐項問一次(CLAUDE.md 那條
「輸出的標籤要由結果決定」的同族)。

---

## §7 首次跑通的實際成果(2026-08-18,`D2`-A)

種一張 **201 品項**的真單,用 playwright 開真瀏覽器量:

```
明細頁（plan 的 C 條，本片【沒改】）  DISTINCT SKU = 200 / 201   缺 SKU-0147
建箱彈窗（plan 的 A 條，本片【改的】）DISTINCT SKU = 201 / 201   缺 無
```
🔴 **同一個畫面上同時拿到正向與負向對照** —— 這是單測與 codex 都給不了的東西。

🔴🔴 **而最有力的那個數字是意外撿到的**:第一次跑時我忘了種到貨資料,
於是 201 件全部 `blockedReason='unknown'`、彈窗不開,改印一句錯誤訊息:
> 「這些訂單目前沒有任何一件出得了(**201**件的數量資料尚未就緒)。」

那個 `201` 是 `items.filter(...).length` 印出來的,而 `items` 就是我改的那支函式的回傳
⇒ **它在一句「失敗訊息」裡證明了修法成功。**
📎 教訓:**跑真的東西會給你你沒有設計去量的證據。** 這正是替身給不了的部分。

⚠️ **而它也示範了反面**:我當時看到彈窗打不開,**推論成「明細頁的截斷旗標把入口 fail-closed 了」,
並且把那個推論轉給了主視窗,主視窗照它下了一個裁定** ——
`grep -n 'itemsTruncated' shipment-launcher.tsx` ⇒ **零命中**,那個推論是假的。
🔴 **真因是我自己的種子沒有到貨資料。**
⇒ **開伺服器看到的東西仍然要區分「量到的」與「看到之後推的」。** 畫面不會替你做那個區分。

---

## §8 🔴🔴 顧客站(登入的客人)那一面 —— **§2 的 `auth.uid()` 在這條路上是壞的**

> **W4,2026-08-18 11:1x。** 起因:驗 `#636`(會員中心「? 件」的文案)。
> **§1-§4 那條鏈只涵蓋 admin,而 admin 走 `service_role` + `BYPASSRLS` ⇒ 它從頭到尾不經過 `auth.uid()`。**
> ⇒ **下面這個 bug 在 admin 路徑上【永遠不會顯形】。**

### 8-a 病:`request.jwt.claim.sub` 這個 GUC,PostgREST 14 不再設了

§2 給的替身逐字是:
```sql
CREATE FUNCTION auth.uid() ... SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
```
**我實測(PostgREST `14.16`,自建 `public.probe_guc()` 從資料庫裡把三個值一起印出來)**:
```
claims    = {"sub":"1111…","role":"authenticated","aud":"authenticated",…}   ← 有
claim_sub = null                                                              ← 🔴 沒有
auth.uid()= null                                                              ← 🔴 因此是 null
```
⇒ **所有綁 `auth.uid()` 的 RLS 政策一律濾成 0 列,而 HTTP 是 `200`。**

🔴 **為什麼它特別毒**:本檔 §4 自己寫著「**`200 + 0 列` 與『真的沒有資料』長得一模一樣**」——
那句話會把你推去查**資料**(種子對不對、`user_id` 對不對),
**而真因在一支你三十行之前才貼上去、看起來理所當然的函式裡。**

### 8-b 修法(兩個 GUC 都讀;新舊 PostgREST 都吃得下)

```sql
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(
           current_setting('request.jwt.claim.sub', true),
           (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
         ), '')::uuid $$;
```
**實測兩個方向都對(不是只驗會過的那一半)**:
```
authenticated JWT ⇒ 200，回自己的 2 張單        ← 正向
anon（不帶 JWT）  ⇒ 401 permission denied        ← 負向：RLS 沒有被我改鬆
```

### 8-c 還有兩道 §2 沒給、少了會卡住的 GRANT

```sql
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO authenticated, anon, service_role;
```
少了它 ⇒ `permission denied for schema auth`。⚠️ **這個錯【會】明講,不像 8-a 那樣靜默** —— 兩者不要混為一談。

### 8-d 顧客站還需要一段 `/auth/v1` 替身(§4 的前綴代理只轉 `/rest/v1`)

`apps/storefront/src/app/account/page.tsx` 逐字 `await supabase.auth.getUser()`,無 user 就 `redirect('/login')`
⇒ 代理要多接三條:`GET /auth/v1/user` 回 user JSON、`POST /auth/v1/token`(與 `/signup`)回 session JSON、
`POST /auth/v1/logout` 回 204。
🔴 **然後【走網站自己的 `/login` 表單登入】,不要自己塞 cookie** ——
`@supabase/ssr` 的 cookie 名與分段編碼由它自己決定(預設 `sb-${hostname.split('.')[0]}-auth-token`),
**手工偽造那個 cookie 是在複製一份會漂的實作細節**;讓它自己寫,順便真的驗到了登入流程。

### 8-e 兩個會讓你以為是權限問題、而其實不是的坑

1. **`NEXT_PUBLIC_SUPABASE_ANON_KEY` 不能填 `dummy-anon`** —— PostgREST 回 `Expected 3 parts in JWT; got 1`。
   要用同一把 secret 自簽一個 `{"role":"anon"}` 的 JWT。
2. 🔴 **`listSummariesByCustomer` 有 `.neq('payment_status','unpaid')`**,而 `orders.payment_status` 的**欄位預設就是 `unpaid`**
   ⇒ **照預設種出來的單,在會員中心一張都不會出現。**
   ⚠️ **我在這裡第二次掉進 `200 + 0 列`**:剛修完 `auth.uid()`,手上有個現成的嫌犯,就先懷疑 RLS。
   📎 **便宜的判別法(下次先做這個)**:**拿 `curl` 打同一個 URL**。
   curl 回得出來 ⇒ 不是 RLS/JWT,是**查詢條件或資料**。一次請求就把兩族分開。

### 8-f 這條鏈能證什麼(沿用 §0 的口徑,不放寬)

```
✅ 能證  「登入的客人，在這種資料下，畫面會畫出什麼」
❌ 不能證 正式站的 auth 行為 —— /auth/v1 整段是我寫的替身，不是 GoTrue
❌ 不能證 密碼、session 過期、refresh、OAuth ——【替身一律回成功】
```
🔴 **最後那條要特別記**:替身**不驗密碼**,任何字串都登得進去。
⇒ **不要拿這條鏈去驗任何「擋不擋得住」的題目**,它在那些題目上恆綠。

### 🔴🔴 8-g `up.sh` 起完了、而 `web: 000` —— **dev server 根本沒起來,不是還沒暖機**

> **來源:2026-08-27 `-ed` 線實際撞到並走出來的路。** 在那之前,路由表只寫了「什麼沒用」,沒寫「什麼有用」。

#### 症狀(它與「還沒起來」長得一模一樣)

`bash scripts/storefront-probe/up.sh` 一路綠、最後印:
```
web: 000  <- 開這個,不要開 127.0.0.1
```
`000` = curl 連不上。多等一分鐘、重打幾次,**都還是 000**。
🔴 **而畫面上沒有任何一個字說它失敗了** —— 那一行本來就長這樣,只是數字不同。

#### 病灶:`REPO` 寫死主樹 ⇒ `next dev` 一定載入主樹的 `.env.local`

```bash
grep -n '^REPO=' scripts/storefront-probe/up.sh      # 行號會漂,當場查
grep -n 'web: ' scripts/storefront-probe/up.sh       # 印 000 的那一行
```
`REPO` 是**寫死的絕對路徑**(不是從腳本位置推的)⇒ **不管你人在哪一棵樹呼叫它,
`next dev` 都從主樹的 `apps/storefront` 起** ⇒ 它一定會讀到主樹那份 `.env.local`。
而那份檔裡有指向**正式庫**的變數 ⇒ `dev-db-guard-gate` 把 `next dev` **當場停掉**:

```
🔴 這個工作樹的環境變數指向【不是本機】的資料庫,next dev 已停止。
   命中的變數(全部列出):
     PAYMENT_CONFIRMER_DB_URL — 值含正式庫 ref …
```
**這段話印在 `$STOREFRONT_PROBE_DIR/next.log` 裡,不在你的畫面上。**
⇒ 看到 `000` 的第一個動作是:
```bash
. scripts/storefront-probe/env.sh && tail -20 "$STOREFRONT_PROBE_DIR/next.log"
```

#### 🔴 **那道閘擋得對。不要繞。**

錯誤訊息**自己寫著**一條放行路徑:`PCM_ALLOW_PROD_DB_DEV=1 npx next dev`。
**不要走。** 走下去 = 起一台**同時握有正式庫憑證**的 dev server。
📌 形狀值得記:**一道閘同時扮演「擋你的人」與「給你鑰匙的人」** ——
而鑰匙就寫在它拒絕你的那句話裡,寫給的正是**最想繞過它的那個人**。
⚠️ 2026-08-27 有**兩個窗**各自撞到、各自沒走 —— **那是兩次自制力,不是機制。**

同理:**不要動 `.env*`**(移開 / 改名 / 註解掉都算)。那是共用工作樹,別的窗正在用它。

#### ✅ 正解:**把 web 那一層搬出去跑,不是換 `up.sh` 的樹**

`up.sh` 前面那幾層(Postgres / PostgREST / 代理)**沒有問題,照跑**。
有問題的只有最後一層 `next dev`。所以:**讓 `up.sh` 起前面幾層,`next dev` 自己在別的樹起。**

```bash
cd /Users/sean_1/pcm-website-v2

# ① 前面幾層照跑(它最後那句 web: 000 是預期的,不用管)
bash scripts/storefront-probe/up.sh

# ② 開一棵【沒有 .env*】的乾淨工作樹(放 scratchpad,用完就刪)
WT="$(mktemp -d)/wt-probe"
git worktree add --detach "$WT" HEAD
# 🔴 尺要量【那道閘真的會讀的地方】—— 它讀的是 `apps/storefront`(next.config 傳 CONFIG_DIR 進去),
#    只量 worktree 根目錄會漏掉 `apps/storefront/.env.local` —— 而主樹那支就住在那裡。
#    ⚠️ 而它還會看 `process.env` ⇒ **你自己 export 過的變數不在這把尺裡**,尺量得到的只有檔。
#    🔴 而【不要數個數,要看名字】(2026-08-27 線4 抓到,主視窗複量):
#       ~~原句「grep -c 期望 0 —— 不是 0 就換一棵」~~ 作廢 —— 它【恆常不是 0】:
#       `apps/storefront/.env.example` 是版控裡的範本(`git ls-files` 命中 1),
#       **每一棵 worktree 都有它**,而 **Next 不載入 `.env.example`** ⇒ 無害。
#       ⇒ 那個判準會叫每一個人「換一棵」,而換不掉 —— **一個恆紅的判準,判別力與恆綠的一樣是零,
#         而恆紅那種會先耗掉三個人的時間。**(主樹當場量:那行印 `4`,乾淨 worktree 印 `1`。)
ls -a "$WT" "$WT/apps/storefront" | grep '^\.env' | sort -u
#    期望【只有 .env.example 一行】。看到 .env / .env.local / .env.development* 任何一支 ⇒ 換一棵,別將就。
#    ⚠️ 印出【名字】而不是個數:`0` 與 `1` 分不出「乾淨」與「有一支 .env.local」,而名字分得出來。

# ③ 裝相依(pnpm workspace 大多是連結,實測數十秒等級)
( cd "$WT" && pnpm install --frozen-lockfile --prefer-offline )
#
# 🔴🔴 **這一步【不可跳】,而它被跳過的方式不是「忘了」,是【沒讀到就先動手】。**
#    2026-08-29 線D 撞到,而它是這一節目前唯一有實測失敗簽章的一格。
#    ⚠️ **成因寫出來,因為它會重演**:那個人讀 §8-g 時只讀了**前半**(病灶那段),
#    看到「把 web 那層搬出去跑」就去起 `next dev` 了 —— **而步驟 ③ 在他讀的那個視窗之外。**
#    📌 **一份說明的前半段如果自己就讀得通,後半段就會被跳過。**
#
#    **跳過它會撞到三個【長得完全不一樣】的錯,而三個都不會提到 node_modules**:
#    ① `npx next dev`      ⇒ `Error: Cannot find module 'next/constants'`
#       (npx 抓了一份 cache 裡的 Next,而它解析不到這棵樹)
#    ② 改用**主樹**的 next binary ⇒ **Ready 了,而首頁 500**
#       ⇒ `Could not find the Next.js package (next/package.json)`
#       🔴 這一種最會騙人:`✓ Ready in 455ms` 印出來了,看起來只是頁面壞掉
#    ③ `ln -s` 主樹的 `node_modules` 進去 ⇒ **Turbopack 直接拒絕**
#       ⇒ `Symlink [project]/apps/storefront/node_modules is invalid, it points out of the filesystem root`
#    ⇒ **看到上面任何一個 ⇒ 回來跑這一步,不要往下修。**
#
#    ⚠️ 而線D 當時跑的是 `--frozen-lockfile --ignore-scripts`(不是本行的 `--prefer-offline`),
#    **兩者都成功起站**。🔴 而 `--ignore-scripts` 會不會讓某些套件裝不完整 —— **他沒有查**,
#    ⇒ **以本行為準**(`--prefer-offline`);`--ignore-scripts` 只是「當時也能跑」,不是建議值。

# ④ 在那棵樹起 next dev,指向鑽機的 PostgREST 代理;埠【換一個】,不要用 up.sh 那個
. scripts/storefront-probe/env.sh
S="$STOREFRONT_PROBE_DIR"
A=$(grep ANON= "$S/jwts.txt" | cut -d= -f2-); SR=$(grep SERVICE= "$S/jwts.txt" | cut -d= -f2-)
cd "$WT/apps/storefront"
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$STOREFRONT_PROBE_PROXY \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$A" SUPABASE_SERVICE_ROLE_KEY="$SR" \
NEXT_PUBLIC_SITE_URL=http://localhost:3021 \
NEXT_PUBLIC_TAPPAY_APP_ID=00000 NEXT_PUBLIC_TAPPAY_APP_KEY=probe_app_key NEXT_PUBLIC_TAPPAY_ENV=sandbox \
nohup "$WT/apps/storefront/node_modules/.bin/next" dev -p 3021 -H 127.0.0.1 > /tmp/probe-next.log 2>&1 &

# ⑤ 等它真的答話 —— 🔴 **要有上限**:本節在講的那個失敗模式(閘把 next 停掉)
#    會讓沒有上限的 until 變成**無聲無限迴圈** —— 而那與「還在編譯」長得一模一樣。
for _i in $(seq 1 30); do curl -s -o /dev/null http://localhost:3021/ && break; sleep 2; done
curl -s -o /dev/null -w 'web: %{http_code}\n' http://localhost:3021/ || echo 'web: 000(連不上)'
grep -E 'Environments|Ready|Error|不是本機' /tmp/probe-next.log | head -5
#    逾時(60 秒還是 000)⇒ 別再等,開 log:tail -20 /tmp/probe-next.log
```
🔴 **開瀏覽器一律 `http://localhost:3021`,不要 `127.0.0.1`**(理由見 §9)。
🔴 **TapPay 三個變數刻意給假值** —— 這條路不需要真金鑰,而給了就等於再把它帶進一個行程。

#### 收攤(兩邊都要,而它們是分開的)

```bash
# 🔴 步驟④最後一行 cd 進了 $WT/apps/storefront ⇒ **收攤第一件事是回 repo root**,
#    否則下面那行相對路徑會 No such file,而 git worktree 也會在一個即將被刪的目錄裡跑。
cd /Users/sean_1/pcm-website-v2
# 🔴 換了終端機貼這段時 $WT 是空的 ⇒ `git worktree remove --force ""`。先自證它有值。
: "${WT:?先跑 git worktree list 找到那棵樹的路徑、指派給 WT 再貼}"

pkill -f "next dev -p 3021" ; sleep 2
# 🔵 **跑之前先量一次**(2026-08-31 加;先例 `regenerate-database-types.md` 那格「正向對照」):
#    pgrep -f "next dev -p 3021" | wc -l   # 這時【應該 ≥1】—— 若這裡就是 0, 下面那個 0 不算數
#    🔴 理由不是「更嚴謹」:一個「期望 0」的檢查在【指令打錯 / 工具不存在 / 範圍錯】時**也印 0**,
#       而那三種正是收攤時最容易發生的。
pgrep -f "next dev -p 3021" | wc -l                       # 期望 0
# 🔴 `pgrep` 不夠:父程序被帶走而 worker 還活著時它會印 0(down.sh 自己的註解就寫著這件事)
#    ⇒ 再驗一次【埠】,與 §6 / down.sh 同口徑。
lsof -nP -iTCP:3021 -sTCP:LISTEN | wc -l                  # 期望 0

bash scripts/storefront-probe/down.sh                     # 前面幾層(它不知道 3021 那個)
git worktree remove --force "$WT" ; git worktree list | grep -c wt-probe   # 期望 0
```
⚠️ **`down.sh` 不知道你在別的埠起了一個 `next`** —— 它逐埠驗死的是**它自己那組埠**,
你那個 3021 **不在它的分母裡**。⇒ 那一行 `pkill` 少不得。

#### ⚠️ 這條路的效度限制(比 §8-f 又短一截)

```
❌ 車款選擇整條路走不進去 —— 我【量到】的是瀏覽器 console 逐字印:
     [fetchVehicleTaxonomy] … Could not find the table 'public.vehicle_taxonomy_public'
                              in the schema cache
   ⚠️ **成因未確認**:`up.sh` 檔頭把它列為「migration 套不上」的已知受害者,
      而 code-reviewer 實查那支 migration 對空庫是走 RAISE NOTICE 跳過、不是失敗
      ⇒ 兩種說法我沒有分辨開。**能確定的只有「這條路走不進去」,不是為什麼。**
❌ 這棵樹的 HEAD 就是它的世界(§5-c 同樣適用)
❌ 沒有真 TapPay 金鑰 ⇒ 結帳第④步顯示「付款模組暫時無法使用」(設計如此)
✅ 能證:商品頁 / 目錄 / 篩選 / 換規格 / 加購物車這一段的畫面與行為
```

---

## §9 🔴🔴 開瀏覽器一律用 `http://localhost:<port>`,**不要用 `http://127.0.0.1:<port>`**

> **來源:G3 2026-08-18 實測,主視窗裁定落檔(`~/pcm-mailbox/G3-004-解掉W2那個沒有結論的403-20260818.md`)。
> 🔴 落檔的是 G1,而 G1【沒有自己重量】** —— 下面的數字與限定是 G3 量的、逐字轉載,不是我的量測。

**這不是提醒,是一次已經發生的事故**:前一班有一個窗為此卡了一整輪沒有結論的購物車。

**症狀:同一支 chunk、同一台 server、同一分鐘,只換 `Origin` header**

```
裸 curl                                    200
Origin: http://127.0.0.1:3020              403   <- 就是它
Origin: http://localhost:3020（打 127 那台） 200
```

🔴 **用 `127.0.0.1` 的話:HTML 正常、CSS 正常,只有 client JS 靜靜地不見。**
⇒ **那個畫面跟「這功能本來就沒做」長得一模一樣。**
⇒ 而你會開始讀 code 找那個沒做的功能 —— **在一個沒有壞的東西上找 bug**,那是這個坑最貴的部分。

**限定(G3 自己標的,逐字;不要只抄結論)**

```
· 我量到的是【行為】（Origin 這個 header 決定 200/403）;
  機制名稱（是不是 allowedDevOrigins）我沒查官方文件，標【未確認】
· 只在 apps/storefront 的 Next 16.3.0 dev 上量過，【沒量 admin】
```

⚠️ **所以本節能給你的是一條【便宜的排除法】,不是一個機制解釋**:
畫面缺 JS 而 HTML/CSS 正常 ⇒ **先換成 `localhost` 再看一次**,那一步比讀 code 便宜一個量級。
換了還在 ⇒ 那才輪到懷疑功能本身。

### 9-a 起 Postgres 時 `LC_ALL=C` **要 export,不能只給 `initdb` 加前綴**

> 同一來源(G3 2026-08-18,把 §1 腳本化時撞到)。**G1 未複驗,標【讀來的】。**

只寫 `LC_ALL=C initdb …` 的話,`initdb` 本身會過,而 **postmaster 起來就死**:

```
FATAL: postmaster became multithreaded during startup
```

🔴 **那個錯訊息完全不會讓你想到 locale** —— 它讀起來像 Postgres 自己壞了。
⇒ 改成 `export LC_ALL=C`(讓後續每一個行程都吃到),不要只給單一命令加前綴。


### 9-b **admin 這一面也成立**,而且我補上了 §9 標「未確認」的兩件

> **G2,2026-08-18 下午,獨立撞到同一個坑**(我不知道 §9 已經在,繞了**六輪**才找到 ——
> 一直以為病在我自己的 client 元件裡)。**兩次測量互為獨立佐證。**
> ⚠️ 但**別把兩份數字混講**:G3 量的是 storefront 埠 3020,我量的是 **admin 埠 3011**。

§9 自己標了兩個未確認,這裡各補一個:

**① 「沒量 admin」⇒ 量了。** 同一台 dev server、同一頁、同一分鐘,只換主機名:
```
量法  playwright 掛 page.on('response') 收 403 的【網址】

http://127.0.0.1:3011/orders   403 六筆
http://localhost:3011/orders   403 零筆
```
六筆逐字**全列**(不列的話「六筆全是 client bundle」這個全稱句沒人覆核得了):
```
/_next/static/chunks/apps_admin_src_1w05cfn._.js
/_next/static/chunks/0zmr_next_14rzkp-._.js
/_next/static/chunks/09ls_%40tabler_icons-react_dist_esm_1j3gn2s._.js
/_next/static/chunks/1ton_%40base-ui_react_11f11mw._.js
/_next/static/chunks/1hn7_tailwind-merge_dist_bundle-mjs_mjs_04a_myf._.js
/_next/static/chunks/node_modules__pnpm_1a1s6-3._.js
```
⇒ **六個全部是 `/_next/static/chunks/*.js`,沒有一個是資料請求。**

**② 「機制名稱未確認」⇒ dev server 自己印了**(`admin.log` 逐字):
> `⚠ Blocked cross-origin request to Next.js dev resource /_next/hmr from "127.0.0.1".`
> `To allow this host in development, add it to "allowedDevOrigins" in next.config.js`

⚠️ **這仍然不是「我查了官方文件」** —— 是 dev server 自報。我引用它、沒驗它。
比 §9 的「未確認」強一格,但**不到「官方文件證實」**。

### 9-c 🔴 那個坑真正的形狀:**「元素在」不等於「它活著」**

§9 講的是「client JS 靜靜地不見」。再往下一層,**你會看到 `<input>`、看到按鈕,而它們沒有掛上任何行為**
—— 這兩件事在 DOM 上長得**一模一樣**,截圖也一樣。

**判別法(照抄就好;兩個世界會印不同的東西)**:
```js
// 🔴 印【兩個數字】，不要只印一個 true/false —— `.some()` 在【零個節點】時也回 false
//    ⇒ 「頁面根本沒有 input/button」與「有但沒被接手」會給出同一個答案（codex R4 抓到）。
const els = [...document.querySelectorAll('input,button')];
({ 掃到: els.length, 被接手: els.filter(el => Object.keys(el).some(k => k.startsWith('__reactFiber'))).length })
// 掃到 0            ⇒ 這支探針【沒有量到東西】，換個選擇器，不要當成 false
// 掃到 N / 被接手 0 ⇒ 整頁是死的 HTML
// 掃到 N / 被接手 N ⇒ React 接手了（有 hydrate）
```
我兩個世界各量一次:`127.0.0.1` ⇒ **false**、`localhost` ⇒ **true**。

🔴 **不要用「按鈕在不在」問** —— 它在兩個世界是同一句話。
🔴 **也不要用「我那顆元件出現了沒」問** —— 它缺席有一堆別的解(沒觸發條件、我的 effect 自己壞了、
   runtime 錯誤)。**那不是 hydrate 的量具,那是我的功能的量具。**
   我第一版就是拿它當證據,推不出結論 —— 上面那支探針是第二輪才補的。

**這條因果鏈證到哪裡(範圍限定)**
```
證到了  ① 403 的六個網址全部是 client bundle（逐個列在上面）
        ② 探針掃過的節點集合（該頁全部的 <input> 與 <button>）裡，
           127.0.0.1 世界【零個】帶 __reactFiber，localhost 世界【有】
沒證到  · Next 內部是哪一段程式擋的（那句話是 dev server 自己印的）
        · 「整頁每一個 client 元件都死了」——探針只掃 input/button 兩種標籤
          ⇒ 保守講法：**掃到的節點沒有一個被 React 接手**，
             而那已足以判定「用這個網址驗互動不算數」
```

---

📎 同族教訓:memory `feedback_absence-read-as-verified`(什麼都沒有被讀成檢查過了)、
`feedback_assertion-measures-the-wrong-thing`(我量的不是我以為的那個東西)。
---

### 9-d 🔴 後台 console 每隔一陣子噴 `401 /api/session/renew` —— **那是這條鏈的必然,不是缺陷**

> **來源:2026-08-29。線I 在後台 console 看到並標「未查」,線D 查完。兩個窗接力,沒有人下錯結論。**

#### 症狀

後台開著,`console` 每隔一陣子出現一條 `401 (Unauthorized) /api/session/renew`。
⚠️ 它與「session 真的續不了、員工做到一半被登出」**長得一模一樣** —— 而後者正是
Sean 的後台北極星(員工能獨立跑完一天)最直接的反面 ⇒ 所以它看起來很嚴重。

#### 🔴 判別法(先做這個,再決定要不要查下去)

**看 `401` 之後有沒有【成功的那一發】。**

```
· 每一次都 401，而 body 都是 {"outcome":"not-active"}  ⇒ 本鏈的必然，見下
· 401 之後緊接著一個 200                                ⇒ token 輪替，正常
· 出現 {"outcome":"chain-expired"}，或 401 之後接不上任何 200 ⇒ 【那才要查】
```
量法(在後台任一頁的 console)：
```js
for (let i=0;i<3;i++){ const r=await fetch('/api/session/renew',{method:'POST'});
  console.log(r.status, await r.text()); await new Promise(x=>setTimeout(x,800)); }
```
⚠️ `GET` 那條會回 `405`(它只收 `POST`)—— 別把 405 讀成壞掉。

#### 成因(碼在哪,當場可核)

```
apps/admin/src/app/api/session/renew/route.ts:79   devBypass 只放行【origin 檢查】那一格
apps/admin/src/app/api/session/renew/route.ts:91   payload = verifySession(cookie)
apps/admin/src/app/api/session/renew/route.ts:98   if (!payload) return json('not-active', 401)
```
⇒ **`ADMIN_DEV_BYPASS=1` 讓你【不用登入就進得去後台】,而它【不發票】。**
⇒ 續期那條路拿不到票 ⇒ 每一次都 `not-active`。

#### ✅ 而正式站走不到這一格(所以那個後果不成立)

該檔自己的註解逐字:「**實務上走不太到這裡:proxy 的登入閘會先把它 303 掉。留著它是因為
『今天走不到』與『這裡有處理』是兩件事**」。
⇒ 正式站:沒登入 ⇒ proxy 先 303;有登入 ⇒ 有票 ⇒ `payload` 存在 ⇒ 不會 401。

#### ⚠️ 而【不要用 `document.cookie` 去驗那張票在不在】

那張票是 `httpOnly`(名字見 `lib/session/session.ts:181`,prod 還帶 `__Host-` 前綴)
⇒ **`document.cookie` 永遠讀不到它** ⇒ 「沒有」與「有而我看不到」在那把尺上是**同一個輸出**。

🔴 **而這一格 2026-08-29 真的騙過一次,連【正對照】都沒擋住**:
當時我寫了一個測試 cookie 進去、讀得回來 ⇒ 正對照綠 ⇒ 那把尺看起來是活的。
📌 **正對照只證明【這把尺在某個對象上會叫】,不證明【它看得到我要找的那個對象】。**
⇒ **正對照要用【與目標同類】的東西** —— 要驗 httpOnly 的票,正對照也得是一個 httpOnly cookie。
✅ **真正該用的證據是伺服器自己的判決**(`outcome` 那個字串)——
   那個判斷在 server 端做,**不受我看不看得到影響**。

## §10 🔴🔴 要證「某個入口有沒有被閘擋住」⇒ **負向對照是【拿掉閘】,不是【換個輸入】**

> 來源:2026-08-18 G6。題目是「一個**沒有登入**的請求,打不打得到 admin 的 server action
> `selectActorAction`(它自己零授權閘)」。**差一點就把它報成一個線上資安洞給 Sean。**

### 10-a 做法(四行表,整段可貼的部分在下面)
同一發請求,跑**兩個世界**,唯一的差別是**閘在不在**:

| | 無 bypass(= 線上的行為) | `ADMIN_DEV_BYPASS=1` |
|---|---|---|
| `GET /` | **303** → `/api/sso/start?next=%2F` | `200` |
| `POST /`(帶 `Next-Action` 標頭) | **303** → `/api/sso/start?next=%2F` | **`404`** |

```bash
# 世界 A（閘在）：不要設 ADMIN_DEV_BYPASS
cd apps/admin && npx next dev -p 3051 &
# 世界 B（閘不在）：ADMIN_DEV_BYPASS=1 npx next dev -p 3051 &

curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" http://localhost:3051/
curl -s -o /dev/null -w "%{http_code} → %{redirect_url}\n" -X POST \
  -H "Next-Action: 00deadbeef" -H "Content-Type: multipart/form-data; boundary=x" \
  --data-binary $'--x\r\nContent-Disposition: form-data; name="actorId"\r\n\r\nsomebody\r\n--x--\r\n' \
  http://localhost:3051/
```
🔴 **前置要先驗**:`grep -c '^ADMIN_DEV_BYPASS' .env.local apps/admin/.env.local` ⇒ 兩個都要是 `0`,
否則「世界 A」是被環境偷偷 bypass 掉的,而它印出來跟真的一模一樣。(只數鍵名、不印值。)

### 10-b 🔴 為什麼那個 `404` 才是這次量測的靈魂
`303` 單獨看**只證明「有東西回了 303」**。它證不出**「沒有閘的時候,那發 POST 真的到得了 action 解析層」**
—— 也許它根本被別的東西擋在更前面、根本不是閘的功勞。
**世界 B 的 `404` 就是那道證明**:假的 `Next-Action` id 找不到 ⇒ 請求**確實**走到了 Next 解析 action 那一層。
⇒ 兩格合起來才成立:**有閘 ⇒ 連解析都到不了;沒閘 ⇒ 到得了。**

> 📌 **可搬走的判準**:要證「X 擋住了 Y」,負向對照要**拿掉 X**,不是**換一個 Y**。
> 換輸入只會告訴你「這個輸入也被擋」;**拿掉閘才告訴你「擋它的是這個閘」。**

### 10-c ⚠️ 順帶兩個會讓人誤判的座標
```
· Next 16 把 middleware 改名叫 proxy.ts ⇒ apps/admin 底下 find -name 'middleware.*' 是【零命中】
  🔴 用舊檔名去證明「沒有閘」= 一個框架改名把「查無」變成資安誤報
  ⇒ 機制的存在性用【行為】證（兩個世界各打一發），不是用檔名
  座標：apps/admin/src/proxy.ts（檔內第 5 行自己註明「Next 16 約定:proxy.ts(舊 middleware.ts)」）
· server action 的 POST 落在【頁面路徑】上（此例是 '/'），所以 proxy 的 matcher 蓋得到它
  ⚠️ 但**頁面/layout 裡的登入檢查蓋不到 server action** —— action 不經過 layout 渲染
  ⇒ 「layout 有擋」不能當成 action 有擋，兩者要分開量
```

### 10-d 收攤(兩層都驗,照 §6 同一條規矩)
```
拆之前先量它：ps -o rss=,pcpu= -p $(pgrep -f "next dev -p 3051" | head -1)
pkill -f "next dev -p 3051"
程序：pgrep -f "next dev -p 3051" | wc -l                      ⇒ 0
埠　：lsof -nP -iTCP:3051 -sTCP:LISTEN                          ⇒ 無輸出(已釋放)
🔴 程序死 ≠ 埠釋放，兩層都要驗。
```

---

## §11 🔴 種子資料會撞上的三道**寫在 schema 裡、而錯誤訊息不會告訴你**的東西

> **來源**:W3 2026-08-19 建 `scripts/admin-probe/seed.sql` 時逐一踩過;
> **本節由未踩過的人(W2)重寫措辭並逐條對 migration 覆核** ——
> 踩到的人寫出來的坑,措辭會偏向「我當時卡在哪」,而下一個人需要的是「**我會怎麼撞上**」。
> **每一條都附 `檔案:行號`,你可以自己開來打我。**

### ⑪-1 🔴 你設的那個欄會被 trigger 無條件蓋掉,**而錯誤訊息指向一個你根本沒設的欄**

```
supabase/migrations/20260725120000_rf2a0_orders_freeze_shipping_rule.sql:79
  NEW.shipping_method_at_checkout := NEW.shipping_method;      ← BEFORE INSERT，無條件
:104  CREATE TRIGGER orders_freeze_shipping_snapshot_bi
```
⇒ 你在種子裡**自己填** `shipping_method_at_checkout`,**它會被丟掉**,改成 `shipping_method` 的值。
⇒ 而 `shipping_method` 本身有**白名單**(`20260630120000:144` ⇒ `'home'` / `'store'` …)。
🔴 **所以你會看到一個關於 `shipping_method_at_checkout` 的錯誤,而你根本沒設錯它** ——
**你設錯的是 `shipping_method`,trigger 把錯的值搬過去了。**
📌 **形狀**:**錯誤訊息會把你指到錯的地方。** 看到這類訊息時,先問「**這個欄是誰寫進去的**」。
⚠️ 該檔 `:77` 自己記著這道 trigger 的已知限制(匯入歷史訂單時會覆蓋真實快照)。

### ⑪-2 種子必須**整包在一個交易裡**

repo 內有 `DEFERRABLE INITIALLY DEFERRED` 的跨表約束
(`20260725130100:268`、`:273`、`20260730140000:217`)——
它們**到 COMMIT 才檢查**,而 `psql` **預設每一句自己 autocommit**
⇒ 一句一句餵會**在中途就被打回**,即使整包餵完是一致的。
⇒ **做法**:`psql -1 -f seed.sql`(或檔內自己 `BEGIN; … COMMIT;`),不要逐句貼。

### ⑪-3 `order_items` **沒有 `product_id`**,而 `product_snapshot` 是 **exact key set**

```
order_items 實際欄位(20260604120000_m3_s2a_orders_order_items.sql)：
  id / order_id / variant_id / variant_sku / product_snapshot / quantity / unit_price / line_total
```
⚠️ **有 `variant_id`、沒有 `product_id`** —— 憑印象寫 `product_id` 會直接炸。
而 `product_snapshot` 的 CHECK(`:158-166`)是**逐字這樣**:
```
?& array['title','sku','spec']                          必備三鍵
(product_snapshot - array['title','sku','spec']) = '{}'  🔴 移除三鍵後必須是空物件 ⇒ 多一個鍵就違反
title/sku 須 string、spec 須 object 且每個值皆 string
NOT ((product_snapshot->'spec') ?| array['price_store','price_by_tier','cost'])
```
🔴 **它是白名單不是黑名單** —— **多帶任何一個鍵都會被拒**,不是「只要不帶價格就好」。
📌 **為什麼這麼嚴**:那是鐵則 12 的縱深(經銷價零滲入)。
⚠️ 而該檔自己標了射程:blacklist **只擋已知那 3 個欄名**,**改名的鍵靠 RPC 主路徑擋**
(`backlog #213` 誠實揭示)⇒ **不要把這道 CHECK 讀成「價格絕對進不來」。**

### 📌 這三條的共同形狀
**它們都寫在 schema 裡,而你是在【種資料】的時候撞上的** ——
你手上那份 `INSERT` 看起來完全合理,**而合不合理是別的檔決定的**。
⇒ **種子寫不進去的時候,先讀建表 migration 的 CHECK 與 trigger,不要先改 INSERT。**

---

## §12 🔴🔴 這支鑽機只重現了正式站【兩層防線裡的一層】 —— 欄位級權限題**問不出來**

> 2026-08-23 線2 在起 probe **之前先讀腳本**撞到,主視窗當場複驗。
> 🔴 **它沒有壞。它是【偏寬】的,而偏寬的答案讀起來跟真的一樣。**

### 12-a 決定性的是【順序】,不是那一行本身

```
scripts/storefront-probe/up.sh
  :139-143  for f in $REPO/supabase/migrations/*.sql; do psql … -f "$f"; done
            ⇒ 先套所有 migrations(裡面含正式站那套 REVOKE + 欄位級 GRANT)
  :153      GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
            ⇒ **在那之後**下整表 SELECT ⇒ 把前面那些抹平
```

被抹平的規模(2026-08-23 當場實數,附負對照):
```
grep -ln "GRANT SELECT[[:space:]]*(" supabase/migrations/*.sql | wc -l          ⇒ 14
grep -lE "REVOKE.*FROM.*(anon|authenticated)" supabase/migrations/*.sql | wc -l ⇒ 99
負對照 grep -ln "GRANT ZZZNOTREAL" supabase/migrations/*.sql | wc -l            ⇒ 0
```

```
正式站防線 = RLS(列) + GRANT/REVOKE(表與欄)   ← 兩層
本鑽機     = RLS(列)  only                      ← 一層
```

### 12-b ⇒ 哪些問題問得出來、哪些會回假答案

```
❌ 「客人看不看得到某個【欄位】」        ⇒ 回傳裡出現該欄, 是 :153 那行的**迴音**, 不是洩漏
❌ forbidden-token 這類欄位級負測        ⇒ 在鑽機上**恆紅** ⇒ 零判別力
✅ 「A 的 session 讀不讀得到 B 的【列】」 ⇒ 可以問。policy 來自 migrations、**未被覆蓋**
✅ 「下架 / 停用這類 qual 造成的降級」     ⇒ 可以問。同上
```

🔴 **這一格的形狀值得記住**:一個假紅,而它**乾淨、可重跑、有分母**。
照著它走的下一步是「去跟老闆說這條路走不通、請他推翻自己的拍板」——
**而真相是鑽機自己開的門。**
📌 與 §10 是同一個母題的兩面:§10 說「要證閘擋住了,負向對照是【拿掉閘】」;
這裡是**你以為在量那道閘,而量到的是鑽機自己補上去的門**。

### 12-c ⚠️ 檔頭那句話寫對了,而它不夠

`up.sh:27` 逐字已經寫著「**GRANT 與 BYPASSRLS 是這支腳本自己下的 ⇒ 證不了正式站的權限設定**」。
🔴 **那句是對的,而兩個窗都讀過它、仍差點打出那一發** —— 因為它說的是「證不了」,
**沒有說「所以哪幾種問題會拿到一個看起來像答案的東西」**。
⇒ 這一節補的就是那半句。(同族 `feedback_an-honest-limits-list-is-read-as-a-complete-one`。)

### 12-d 📌 要修它是另一件事,**不要順手改**

`:153` 那行**為什麼在那裡沒有人查過**(可能有表沒寫 GRANT、拿掉會讓 probe 起不來),
而 `up.sh` 是**六個窗共用的工具** ⇒ 改壞了會安靜地影響別人。
⇒ 已另立 backlog 條目,**不擠在任何一條施工線上做**。
⇒ 在它被修好之前:**欄位級權限題一律走正式庫 `pg_catalog` 唯讀量測**
(🔴 不要用 `information_schema` —— 它對零權限帳號系統性回 0,見 memory `MEMORY-supabase.md`)。

### 12-e 🔴 同一個症狀有**三種病**,而其中兩種在 `information_schema` 上長得一模一樣

2026-08-23 線A 拿 12-a 的發現去驗**自己**那顆拋棄式庫(不是假設它沒事), 當場量到:

```
                                    線A 的拋棄式庫(55544)   正式站(唯讀)
欄位級授權(column_privileges)              350                937
表級授權                                     27                117
public 表數                                  47                 50
量法 select count(*) from information_schema.column_privileges
     where grantee in ('anon','authenticated')
```
🔴 **表數只差 3,授權差了一半以上** ⇒ 差距**不是**「表沒灌到」造成的。

**三種形狀,成因不同、處置不同:**
```
① 路徑選錯    掃 .next 而不是 .next/cache/fetch-cache   ⇒ 分母對、產物類別錯
② 工具補了門  storefront-probe up.sh:153 的 blanket GRANT ⇒ 環境【被工具改過】
③ 門從來沒建  線A 那顆:22 支 migration 沒套 + 灌資料只灌列、沒重放 GRANT/REVOKE
                                                        ⇒ 環境【比正式站少一層】
```
🔴 **②③ 在 `information_schema` 上完全分不出來** —— 都回得出漂亮的數字、都不報錯。
⇒ **「有欄位級授權」不是安全訊號**:線A 那顆有 350 條,而它仍然不是對的那 350 條。
⇒ **判別只能對照正式站的數量級**,不能看「有沒有」。

### 12-f ⚠️ 而 OD 那 95 個畫面是用 `service_role` 跑的(繞過 RLS)

⇒ **它顯示「看得到」不代表員工看得到。** 拿那批畫面當「權限沒問題」的證據 ⇒ 無效。
✅ 那批畫面能證的:版面 / 欄位長相 / 有幾列 / 狀態機 / 文案。
❌ 不能證的:誰看得到哪一欄 / anon 打得到什麼 / RLS+GRANT 兩層合起來擋不擋得住。

---

## §13 🔴🔴 後台鑽機**任何寫入都做不到** —— 而錯誤訊息把人指向錯的方向(2026-08-30 修)

### 症狀
後台任一 mutation(送採購 / 加備註 / 登錄收款 / 儲存發票…)⇒
畫面 **「沒有權限或登入狀態已失效,…沒有寫入。」**,DB **0 筆**。

### 🔴 成因**不是** `auth.uid()` —— 而那正是最容易猜錯的方向
派工單傳到我手上時寫的是「`ADMIN_DEV_BYPASS` 沒有真 session ⇒ `auth.uid()` 是替身」。
**那半是錯的**,而本檔自己早就寫著為什麼:
`§2:110` 逐字「**admin 那條路永遠看不到它** —— admin 走 `service_role` + `BYPASSRLS`,不經過 `auth.uid()`」;
`§8:635` 再說一次。⇒ 📌 **`auth.uid()` 是顧客站那一面的病;admin 這一面從頭到尾不呼叫它。**

**真正的成因**(`apps/admin/src/lib/session/authorize.ts:31` `authorizeAdminMutation`,三道閘):
```
① verifySessionDetailed(cookie)  ← 沒有 cookie ⇒ reason:'absent' ⇒ 第一道就回 null
② Origin fail-closed             ← ADMIN_DEV_BYPASS=1 只放寬【這一道】
③ getSessionActor() 具名身分
```
⇒ 🔴 **`ADMIN_DEV_BYPASS` 從來就不是「免登入」,它只是「免 Origin 檢查」。**
⇒ 📌 **所以那句錯誤訊息【字面上是對的】** ——「登入狀態已失效」是實話,只是它沒說「因為這台鑽機根本沒有登入流程」。
**證據(修前實量)**:`document.cookie` 只有顧客站鑽機留下的 `sb-127-auth-token`,
**零個 `pcm_admin_sess_dev`、零個 `pcm_admin_actor`**;dev log 連續 `POST /api/session/renew 401`
—— **那支路由一直在叫,而沒有人聽出它在說「我沒有票」。**

### 修法(2026-08-30 起 `up.sh` 自己做,你只要貼一行)
`up.sh` 跑完會印一行 `document.cookie='pcm_admin_sess_dev=…; path=/'`,
貼進瀏覽器 console 就有真 session。同一行也存在 `$ADMIN_PROBE_DIR/session-cookie.txt`。

票的形狀**不是發明的**,逐格對著 `apps/admin/src/lib/session/session.ts` 抄
(cookie 名 `:181` / 值的組法 `:418-424` / 金鑰材料 `v1:<len>:<secret>:<len>:<envTag>` `:304-307` /
envTag=`local` `:263-274` / b64url 無 padding `lib/base64url.ts:6-10` / `v:2` 的 `sub` 必填 `:97-103`)。
配套兩件:`env.sh` 給 `ADMIN_SESSION_SECRET`(≥32 字元,`session.ts:178`);
`seed.sql` 插一列 `probe_staff`。
⚠️ **`staff` 表本來就有列**(migration 種的:`sean` / `staff_1` / …)⇒ 那一列**不是為了讓閘過**,
是為了**歸屬**:用 `sean` 的話,鑽機產生的稽核紀錄看起來會像**老闆本人**做的。

### 驗收(兩個世界,都是實量)
| | 修前 | 修後 |
|---|---|---|
| 畫面 | 「沒有權限或登入狀態已失效,備註沒有寫入。」 | 那句**消失**,URL 變 `?r=note_added` |
| `select count(*) from order_notes` | **0** | **1** |
| 那一筆的 `author` | — | **`probe_staff`** |
🔴 **`author` 那一格是最強的證據**:它證明身分是從**票的 `sub`** 解出來的,
不是從那顆自選 picker cookie —— 而我**沒有設**過 picker cookie。

### 🛑 這條路【證不了】什麼(不要拿鑽機當它們的證據)
- **真登入流程**(SSO callback / 報價單那一側)—— **完全沒有走到**,票是手簽的。
- **「非管理者會被擋下」** —— 種子那列是 `is_manager=true`;要驗擋下,把它改成 `false` **再跑一次**,
  那是另一個世界,不是同一發。
- **票 15 分鐘到期**(`ADMIN_SESSION_MAX_AGE_SEC`,Sean `Q-B5b-2=乙` 拍的)⇒ 過期就重跑 `up.sh`。
  app 有靜默續期,而**它要先有一張有效票才續得動**。
- 我實跑驗過的是**「新增備註」這一條**;其餘 mutation **共用同一道 `authorizeAdminMutation`**
  ⇒ 那是**讀碼得到的**,不是我一條條量到的。**這兩件事不要混。**

### 🔴 收攤要帶【同一組 env】—— 不帶的話它會每一格印綠,而你的鑽機還活著
起的時候帶了自訂埠 ⇒ **收的時候一定要帶同一組**:
```bash
ADMIN_PROBE_DIR=/tmp/pcm-admin-probe-<你的> ADMIN_PROBE_PG=… ADMIN_PROBE_PREST=… \
ADMIN_PROBE_PROXY=… ADMIN_PROBE_WEB=… bash scripts/admin-probe/down.sh
```
不帶 ⇒ `down.sh` 拿**預設**那組去查 ⇒ 那組本來就沒東西 ⇒ **每一格都印「已釋放」**,
而你那台還在跑。⇒ 📌 **「收乾淨了」與「我去看了別人的空位」印同一句話。**
忘了當初帶什麼 ⇒ `$ADMIN_PROBE_DIR/owner.txt` 有記(`down.sh:39` 也會把它查的四個埠印出來,對不上就是帶錯)。

🔴🔴 **而它不只是「沒收到」,在多窗夜裡它會【收到別人的】** —— 2026-08-30 當場量的:
預設 web 埠 **3011 有人佔用**(不是我的;我的在 3050),而預設資料目錄 `/tmp/pcm-admin-probe` 不存在。
⇒ 那一刻若我裸跑 `down.sh`,它會拿預設埠去殺 —— **殺的是別人的鑽機**。
⚠️ **所以這一段【不是】實跑驗出來的**:我**刻意沒有跑**那一發,因為跑下去的代價落在別人身上
(同 `up.sh` 檔頭那條 `FORCE=1` 的自陳:「那不是拖延,而它的結果是:**這是一個永遠不會被驗的分支**」)。
⇒ 上面的推論來自 `down.sh` 自己的碼與當下的埠占用實測,**不是一發完整的重現**。

### ⚠️ 貼 cookie 那一步:**有人成功、有人失敗,而【為什麼】沒有人查出來**
兩筆互相矛盾的觀察,**兩筆都留著**(2026-08-30):
```
`-30`(線ship)：在瀏覽器 console 打 document.cookie='…' ⇒ 讀回空字串，連試兩次都不成功
                改用 Playwright 的 context().addCookies() ⇒ 成功
`-08`（本節作者）：同一台鑽機、同一個 origin（http://localhost:3050）
                用 Playwright 的 page.evaluate 執行 document.cookie='…' ⇒ **成功**
                當場複驗：塞一顆 canary ⇒ 立刻讀得回來（cookie 字串 1214 → 1239 字元）
                而那張票隨後真的通過了三道閘（DB 寫進去、author=probe_staff）
```
🛑 **所以【不要】把它寫成「那條路不通」** —— 它在至少一種情況下是通的。
🛑 **也不要補一個成因** —— `-30` 明說它**沒有查為什麼**,我這邊也沒有重現它的失敗。
   兩邊差在哪(devtools console vs `page.evaluate`?開的是哪一頁?有沒有先導航?)**沒有人量過**。
✅ **可執行的建議**:
```
① 先用 document.cookie，當場讀回來驗（`document.cookie.includes('pcm_admin_sess_dev')`）
   —— 🔴 **設完一定要讀回來**：它失敗的時候【不會報錯】，只是那顆 cookie 不在
② 讀不回來 ⇒ 換 Playwright context().addCookies()，那條 `-30` 走通過
```
📌 **這一段的價值不是答案,是【它明寫沒有答案】** —— 下一個人撞到時,
   會知道這不是他手殘,而是一個已知、未解、有替代路的東西。

### 🔴🔴 實錘:**寫下那條警告的人,一小時後從另一條路走進同一個坑**(2026-08-30)
上面「收攤要帶同一組 env」那一段是 `-08` 18:5x 寫的,連「預設埠 3011 現在有別人在用」都寫了。
**19:0x 同一個人跑 `down.sh`,把 3011 上【別人的】鑽機停掉了。**

**它是怎麼發生的(不是忘記,是另一條路)**:
```zsh
E="ADMIN_PROBE_DIR=… ADMIN_PROBE_PG=… …"
env $E bash scripts/admin-probe/down.sh     # ← 這一行
```
🔴 **zsh 不對未加引號的變數斷詞**(CLAUDE.md 早就寫著這一條)⇒ `env` 收到**一個巨大的參數**
當作 `ADMIN_PROBE_DIR` ⇒ **四個覆寫全部失效** ⇒ 落回預設埠 ⇒ 收掉 3011。
**徵兆當時就印出來了**:log 裡 `datadir /tmp/pcm-admin-probe-eb ADMIN_PROBE_PG=55571 …`
(整串當成一個路徑),而磁碟上真的多了一個那個名字的空目錄。**而人不會逐字讀自己剛下的指令的回音。**

📌 **兩個判別句,兩個都不是「下次小心」**:
- **我以為我帶了埠,而我沒有查我到底帶進去沒有** ⇒ ✅ **起完 / 收完一定回頭驗一次**
  (`head -4 $ADMIN_PROBE_DIR/owner.txt` 對埠;`ps eww -p <next dev pid>` 看 env 真的在不在)
- **那段警告當時就印出來了,它印完照樣往下跑** ⇒ ✅ 已改成 **fail-closed**(見下)

✅ **機制(2026-08-30 落地,`-48` 批准)**:`down.sh` 在**找不到 `owner.txt`** 時**停下不收**、`exit 2`,
並印「怎麼往下走」三選一;真的要收 ⇒ `ADMIN_PROBE_FORCE_DOWN=1`(訊息會寫明它可能殺到誰)。
**兩發自檢都跑過**:①空目錄 ⇒ **rc=2 且印「停下,不收」** ②有 `owner.txt` 的真鑽機 ⇒ **rc=0、四個埠都釋放**。
🔴 **第二發不能省** —— 少了它,「閘擋住了」與「閘壞掉誰都收不了」印同一個結果。

### ✅ 那個「有人成功有人失敗」的 cookie 之謎:**解開了,是 `HttpOnly`**(2026-08-30 `-08` 量到)
上一段記著兩筆互相矛盾的觀察(`-30` 設不進去、`-08` 設得進去),並明寫「沒有人查出為什麼」。
**現在查出來了,而且是決定性的一發**:
```
同一個名字、值只有 1 個字元  document.cookie='pcm_admin_sess_dev=1'   ⇒ 設不進去
換一個名字、同樣 1 個字元    document.cookie='pcm_admin_sess_devX=1'  ⇒ 設得進去
⇒ 不是長度、不是內容、不是瀏覽器擋 cookie ——【就是那個名字】
```
**成因**:`apps/admin/src/lib/session/session.ts:235` `httpOnly: true`
⇒ 伺服器發出的那顆 `pcm_admin_sess_dev` 是 **HttpOnly**
⇒ **JS 既讀不到它、也【覆寫不了】它**;而 `document.cookie` **連列都不會列出來**
⇒ 📌 **所以它看起來像「這顆 cookie 就是設不進去」,而真相是「已經有一顆你看不見的在那裡」。**

**這也解釋了為什麼兩個人結果相反**:
```
還沒有伺服器發過票時（第一次貼）⇒ 沒有 HttpOnly 那顆 ⇒ JS 設得進去 ✅（-08 那次）
伺服器已經發過票之後            ⇒ 有一顆看不見的擋著 ⇒ JS 怎麼設都不進去 ❌（-30 那次）
```
⇒ 🔴 **兩個人都沒有做錯,他們只是站在【同一條時間線的兩端】。**

✅ **可執行**:
```
① 設完一定要讀回來驗（它失敗時不報錯）
② 讀不回來 ⇒ 先看是不是【已經有一顆 HttpOnly 的在那裡】：
   那時通常你【本來就已經有 session 了】—— 直接試那個動作，不必再貼
③ 真的要換一張票 ⇒ Playwright 的 context().addCookies()（它繞得過 HttpOnly）
```

### ✅ `/auth/v1/admin/users` 兩支替身(2026-08-30 加;`#12` 的前置)
admin 的**客戶管理**會打 `client.auth.admin.*` —— 而本鑽機原本**刻意沒有** `/auth/v1` 替身
⇒ 查客人與建客人**兩條都回** `AuthApiError: Invalid path specified in request URL`。
現在 `scripts/admin-probe/proxy.py` 補了**只有兩支**(admin 真的會打的那兩支,當場量的:
`getUserById` 4 處 / `createUser` 1 處;負對照現造方法名 ⇒ 0)。
🔴 **`auth.users` 骨架也一起加了兩欄 + 一個 UNIQUE,而理由不是「補完整」**:
`raw_app_meta_data` —— `manual-customer.ts:297` 拿它判「這個既有帳號是不是我們自己建的」
(codex R2 擊破過:**未驗 `app_metadata` ⇒ 搶註者會被當成既有客人**)⇒ **少這一欄,那道檢查在鑽機上恆過**;
`email UNIQUE` —— 建客人的**冪等靠它**(同一個佔位信箱重送 ⇒ 撞唯一鍵 ⇒ 那不是失敗)。
**三個世界自檢**(起站後跑):不存在的 uuid ⇒ **404** · 真的存在的 ⇒ **200** 且帶 `app_metadata` · 亂字串 ⇒ **400**。
⚠️ **仍然證不了**:真登入流程(票是手貼的)。

---

## §14 🔴🔴 顧客站鑽機上**搜尋整條是壞的**,而它的症狀讀起來像「功能沒做完」(2026-09-03 線 `-front`)

> ✅✅ **2026-09-04 線【身分】實跑複驗:本節描述的狀況【今天不成立】。** 板列 `⟦f3-PROBESEARCH⟧` 已轉 `done`。
> ```
> 全新鑽機(自帶埠, 跑完已 down):
>   apply.log ⇒ 20260903050000_…_search_product_ids 【不在 FAIL 清單裡】, 它的事後閘印「通過」
>   問庫      ⇒ storefront_search_product_ids = 1 · 🟢 正對照 search_catalog_by_vehicle = 2 · 🔴 負對照 = 0
>   /api/search(網址先 URL-encode)⇒ 排氣管 200/1 筆 · 碳纖維 200/3 筆 · 🔴 負對照 zzqprbxx9999 200/0 筆
> ```
> 🛑 **而這【不是】「我們修好了」** —— 沒有人改過 `up.sh`(當場 grep 那個 RPC 名 ⇒ **0**)。
> ⇒ 📌 **它是自己好的,而那表示我們不知道它為什麼曾經壞 ⇒ 也就不知道它會不會再壞。**
> 🔵 **所以本節【不刪】** —— 下一個在鑽機上看到搜尋壞掉的人,要撞到的是這一整段(含下面的症狀原文),
> 而不是一片空白讓他以為那是新的病。**以下原文保留,當作「它壞的時候長這樣」。**
> ⚠️ **而複驗當天有一格我自己先錯了,寫在這裡因為下一個人會踩**:
> 我第一發 `curl` 沒有把中文查詢 URL-encode ⇒ 回 **400**,而我差點把它讀成「伺服器壞了」。
> 🔴 **更早一發更糟**:web 層根本沒起來(`curl` 回 **000**),而我的解析腳本對三個不同的字
> 印出**一模一樣的數字** ⇒ 📌 **那個「三個輸入同一個讀數」才是我發現尺壞了的訊號,不是我更仔細。**
> 🔵 成因:我用**主樹的絕對路徑**叫 `up.sh` ⇒ `REPO` 推成主樹 ⇒ 載入主樹的 `.env.local` ⇒ 被那道閘停掉。
> ⇒ ✅ **從沒有 `.env*` 的 worktree 用【那棵樹自己的】腳本路徑叫它**,web 才會起來。

**你會看到的**(打任何字進搜尋疊層):

```
畫面:  「搜尋暫時無法使用 / 請稍後再試一次,或用 LINE 直接問我們」
network: GET /api/search?q=… ⇒ 503  {"error":"search_failed"}
next.log:
  [searchProducts] searchByKeyword failed: TypeError: Cannot read properties of undefined (reading 'rest')
    at SupabaseProductAdapter.trySearchIdsWithBrand (…/SupabaseProductAdapter.ts:715)
    at searchProducts (src/lib/search.ts) → GET (src/app/api/search/route.ts)
```

🔴 **這【不是】你的碼壞了,也不是搜尋做壞了。**
成因:那條路呼叫 RPC **`storefront_search_product_ids`**(`20260903050000_m4b_storefront_search_product_ids.sql`),
而**鑽機的庫沒有它** —— `up.sh` 自己印過那句:「**其餘 fail 的 migration 沒有被修**」。
⇒ 📌 **正式站有那支 RPC**(2026-09-03 實測 `/api/search` 全部 200)⇒ **這是鑽機與正式站的差,不是缺陷。**

**⇒ 所以在鑽機上你【驗不了】**:搜尋結果、品牌/分類那兩區的真資料、`/search` 結果頁。
✅ **驗得了的**(不經那支 RPC):`搜尋中…` 那個等待態、空查詢的熱門搜尋、疊層開關與 focus。
🔵 **要看那兩區長什麼樣**:在 console 把 `window.fetch` 對 `/api/search` 攔掉、回一份 fixture。
🛑 **而那證的是【畫面畫得對】,不是【資料路徑會動】** —— 交件時這個射程要跟著走。

---

## §15 🔴🔴 一台**舊鑽機**與一台新的**在畫面上長得一模一樣**(2026-09-03 線 `-front` 收掉一台)

**實例**:`/tmp/pcm-g3-probe`(埠 3020)起於 **2026-09-02 16:54**、`HEAD 9c06a72a`,
而它的主人那個窗早已收工(**shell pid 32177 實查已不存在**,心跳表零 `g3` 命中)。
⇒ 🔴 **它沒有壞。它好好地服務著兩天前的碼。**
⇒ 🎯 **誰打開 `localhost:3020` 去驗一個剛改好的東西,都會看到舊畫面而不知道** ——
   而他的下一步是「回去修一個已經修好的東西」。

**⇒ 動作(給下一個要用鑽機的人)**

```
🔴 用之前先讀 owner.txt 的 HEAD, 而且【比對它與今天的 dev】:
    cat /tmp/<你的 probe dir>/owner.txt        # 看 HEAD 那一行
    git rev-parse --short origin/dev           # 今天的 dev
  ⇒ 不同 ⇒ 那台鑽機驗不了你今天的碼, 不要用它
🟢 而 up.sh 起自己那台時會印「✅ 起站樹與主樹 HEAD 相同(<sha>)」—— 那一格【有比過】
  ⇒ 📌 而【接手別人那台】沒有那一格 ⇒ 這一節就是補那個缺口
```

**收掉別人那台之前**:🔴 **`owner.txt` 是那台鑽機唯一的紀錄,`down.sh` 會連 datadir 一起刪。**
⇒ **先把它整份抄進你的回報**,再收。用**那台自己的那組埠**跑 `down.sh`
(不帶同一組 ⇒ 它會拿預設埠去查、**每一格都印綠而那台還活著**)。

---

## §16 ⚠️ `up.sh` 建議的並行埠 `3030` 今天是**撞的**(2026-09-03)

`up.sh` 在「已經有一份鑽機在跑」時印的並行範例逐字建議 `STOREFRONT_PROBE_WEB=3030`,
而 **`-mail` 的鑽機今天就用 3030**(`/tmp/pcm-mail-probe/owner.txt` 起於 05:28)。
⇒ 🔴 **照著那個建議做的人,會撞上別人的鑽機。**
🛑 **本節只記錄,沒有改 `up.sh`** —— 改建議埠是行為改動,要先報主視窗。
✅ **自己挑一組沒人用的**,並且**收的時候帶同一組**:

```
STOREFRONT_PROBE_DIR=/tmp/pcm-<你的窗名>-probe \
STOREFRONT_PROBE_PG=555xx STOREFRONT_PROBE_PREST=39xx STOREFRONT_PROBE_PROXY=39xx \
STOREFRONT_PROBE_WEB=30xx STOREFRONT_PROBE_CORS=39xx \
  bash scripts/storefront-probe/up.sh
```
