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

-- 🔴 RLS policy 直接呼叫這三支；沒有的話 `function auth.uid() does not exist`，
--    而它會讓【所有帶 policy 的 migration】一起失敗（2026-08-18 實測：74 支）。
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
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

## §6 收攤(**逐項驗它們真的死了,不看指令回傳**)

```bash
pkill -f "next dev -p 3011"; pkill -f "proxy.py"; pkill -f "postgrest"
pg_ctl -D /tmp/pcm-probe/pg stop -m immediate; rm -rf /tmp/pcm-probe
for pat in "next dev -p 3011" "proxy.py" "postgrest" "postgres -p 555"; do
  printf "%-22s " "$pat"; pgrep -f "$pat" >/dev/null && echo "🔴 還活著" || echo "已停"
done
git status --porcelain    # 應為空
```
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
