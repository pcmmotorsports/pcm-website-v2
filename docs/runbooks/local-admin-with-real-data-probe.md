# 用【真後台 + 真資料】驗一個功能到底行不行(零 secret)

> **為什麼有這份**:Sean 2026-08-17 夜逐字 —— 「不用再用 artifacts, 直接來真的但是開伺服器做＋看,
> 這樣最準確」/「**我們應該所有需要用到的功能都可以用這個方式處理**」。
> ⇒ 替身(fixture / mock 畫面 / artifact)仍是測試用的靶,**但不再是「確認功能可用」的合格載體**。
>
> 🔴 **而施工窗的工作樹【沒有 `.env.local`】**(`test -e` 逐樹量過:只有主樹 `pcm-website-v2` 有)。
> 本檔的整條鏈**不需要任何 secret、不碰任何 `.env*`** —— 它自己造一個資料庫。
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

⚠️ **而失敗【看得見】**(這是好消息,不是壞消息):`?r=denied` 會讓頁面印出「沒有權限」
(`#534` 的修法;W3 同日負對照驗過:**帶 `r=denied` ⇒ 出現;不帶 ⇒ 不出現**)。
⇒ **你按下去沒反應的時候,先看網址列有沒有 `?r=denied`** —— 有的話那不是功能壞了,是這條鏈的邊界。

### ✅ §5-b 而【不受影響的那半】是什麼 —— 以及怎麼自己判

**不經過 server action 的東西,結論仍然成立**:
```
✅ 仍成立  server render 出來的 DOM 長什麼樣（有沒有那個欄位、選項幾個、文字是什麼）
✅ 仍成立  純 client 的互動：<details> 開合、下拉 change 觸發的導航、CSS 類別
❌ 不成立  任何「按下去會寫東西」的路徑（form action / server action / RPC 寫入）
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
