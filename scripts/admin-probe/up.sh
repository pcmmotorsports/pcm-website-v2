#!/usr/bin/env bash
# 後台(admin)拋棄式鑽機 —— 一行起完整鏈,給 Sean 肉眼驗用。
# 2026-08-19 W3 建。形狀抄 `scripts/storefront-probe/up.sh`(顧客站版),**不自己發明一套**。
# 正本 runbook = `docs/runbooks/local-admin-with-real-data-probe.md`(這支是它的可執行版)。
#
#   起  bash scripts/admin-probe/up.sh
#   收  bash scripts/admin-probe/down.sh     <- 逐項 pgrep + 逐埠 lsof 驗死,不看指令回傳
#
# 🔴🔴 **零 secret、不碰任何 `.env*`** —— 自己造一個拋棄式資料庫 + 自簽 JWT。
#    `apps/admin/.env.local` **不存在也不要建它**(施工窗的工作樹本來就沒有)。
#
# 🔴 **綁 127.0.0.1、瀏覽器開 localhost** —— 兩件事,不要合併:
#    · 綁 `-H 127.0.0.1`:`next dev` 預設綁**所有網路介面**,而 `ADMIN_DEV_BYPASS=1` 是免登入
#      ⇒ 不綁的話等於把一個免登入後台對整個區網開著(2026-08-19 G2 實測,詳
#        `docs/design/admin-design-system.md` 檔頭)。
#    · 開 `http://localhost:PORT`:Next 16 dev 只認 `localhost` 這個 Origin,
#      用 `127.0.0.1` 時 HTML/CSS 正常而 **client JS 靜靜地不見**(runbook §9)。
#    ⇒ **綁 127 是為了安全;開 localhost 是為了它能動。** 兩條理由不同,不可互相取代。
#
# 🔴🔴 **自檢的射程(先講,因為它決定你能拿這支腳本說什麼)**:
#    結尾那三格量的是 **curl 拿回來的 HTML**,也就是**伺服器渲染那一層**。
#    ⚠️ **它證不到 client JS 可用** —— runbook `:335` 逐字記著:用 `127.0.0.1` 時
#    「**HTML 正常、CSS 正常,只有 client JS 靜靜地不見**」⇒ 那正是這三格量的東西。
#    ⚠️ 而 Next 的 RSC payload 塞在 `<script>self.__next_f.push(...)` 裡
#    ⇒ **表格根本沒渲染、資料仍在 script 裡**時,單號照樣數得到、數字照樣對得上。
#    ⇒ **「畫面能不能用」只有真的開瀏覽器才算數。** (2026-08-19 W2 審查 F1;那句話原本寫成
#      「這條鏈是活的」—— 而**一個假的宣稱比少一格檢查更糟:它會讓下一個人停止查**。)
#
# 🔴 效度限制照 runbook §5,一條都不放寬。最容易忘的三條:
#    · GRANT 與 BYPASSRLS 是這支腳本自己下的 ⇒ **證不了正式站的權限設定**
#    · auth.users 是骨架、auth.uid() 是替身 ⇒ 任何依賴真 session 的判斷都不算數
#    · 這條鏈**沒有** `/auth/v1` 替身(admin 走 DEV_BYPASS)⇒ **證不了 admin 的登入閘**
#
# 🔴 migration 套不完是常態 —— **判準是「你要用的表在不在」,不是全綠**(runbook §3)。
set -euo pipefail

# 🔴 `export` 而不是只給 initdb 加前綴:postmaster 啟動時也要看到它,
#    否則 `FATAL: postmaster became multithreaded during startup`(顧客站那支實際踩過)。
export LC_ALL=C

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
# 🔴 路徑可覆寫:多窗平行時各自帶一個 `ADMIN_PROBE_DIR`(down.sh 讀同一個變數)。
#    預設值仍是固定路徑 —— 讓 up/down 這一對在【不傳任何東西】時仍配得上;
#    代價由下面那道前置閘擋住,不是靠使用者記得。
S=${ADMIN_PROBE_DIR:-/tmp/pcm-admin-probe}
SEC="pcm-admin-probe-throwaway-jwt-secret-at-least-32-chars"
PG=55534; PREST=3979; PROXY=3978; WEB=3011
SP="$(cd "$(dirname "$0")" && pwd)"

# ── 前置:要用的東西在不在(缺了就明確報錯,不要跑到一半才炸)────────────────
for c in initdb pg_ctl psql postgrest python3 curl; do
  command -v "$c" >/dev/null || { echo "🔴 缺 $c —— 這條鏈起不來。postgrest 用 brew install postgrest"; exit 1; }
done
for p in $PG $PREST $PROXY $WEB; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN 2>/dev/null | grep -v WARNING | grep -q .; then
    echo "🔴 埠 $p 已經有人在聽 —— 先跑 bash scripts/admin-probe/down.sh,或那是別人的鑽機"; exit 1
  fi
done

# 🔴🔴 **前置閘(2026-08-19 新增)—— 本來這裡是無條件 `rm -rf $S`。**
#    A 窗正在跑,B 窗跑 `up.sh` ⇒ **B 當場砍掉 A 的 datadir,而 A 收不到任何訊息**,
#    它的 postgres 變成一個沒有資料目錄的孤兒。
#    ⇒ **一個被中途拆掉的量測,長得跟一個完成的量測一模一樣。**
busy=""
if [ -f "$S/pg/postmaster.pid" ]; then
  _pid=$(head -1 "$S/pg/postmaster.pid" 2>/dev/null || true)
  if [ -n "${_pid:-}" ] && kill -0 "$_pid" 2>/dev/null; then busy="postgres pid $_pid(datadir $S/pg)"; fi
fi
if [ -z "$busy" ]; then
  for _p in $WEB $PROXY $PREST $PG; do
    _o=$(lsof -nP -iTCP:$_p -sTCP:LISTEN 2>/dev/null | grep -v WARNING | awk 'NR==2 {print $2" "$1}')
    if [ -n "$_o" ]; then busy="埠 $_p 已被佔用 —— pid/command = $_o"; break; fi
  done
fi
if [ -n "$busy" ]; then
  echo "🔴 已經有一份鑽機在跑,**這支腳本不會接管它**:" >&2
  echo "   $busy" >&2
  [ -f "$S/owner.txt" ] && { echo "   來歷:" >&2; sed 's/^/     /' "$S/owner.txt" >&2; }
  echo "" >&2
  echo "   要收掉它  ⇒ bash scripts/admin-probe/down.sh" >&2
  echo "   要並行跑  ⇒ 換一組路徑與埠,例如:" >&2
  echo "       ADMIN_PROBE_DIR=/tmp/pcm-admin-probe-\$\$ bash scripts/admin-probe/up.sh" >&2
  echo "       ⚠️ 埠仍寫死在本檔($WEB/$PROXY/$PREST/$PG)⇒ 並行還要自己改埠,本次未做" >&2
  exit 1
fi

rm -rf $S && mkdir -p $S
{ echo "起於   : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "shell  : pid $$  tty $(tty 2>/dev/null || echo '?')"
  echo "datadir: $S"
  echo "埠     : web $WEB / proxy $PROXY / prest $PREST / pg $PG"
} > $S/owner.txt

# ── ① 拋棄式 Postgres ────────────────────────────────────────────────────
# 🔴 `--encoding=UTF8` 少不得:`LC_ALL=C` 會讓 initdb 建成 SQL_ASCII,
#    而 migration 裡的中文 COMMENT 會在一支**不相干的** migration 上炸
#    (`conversion between UTF8 and SQL_ASCII is not supported`)⇒ 很難聯想到 initdb。
# 🔴 `-k /tmp`:unix socket 路徑上限 103 bytes,長路徑會直接開不起來。
initdb -D $S/pg -U postgres --auth=trust --encoding=UTF8 --locale=C > $S/initdb.log 2>&1
pg_ctl -D $S/pg -o "-p $PG -k /tmp" -l $S/pg.log start > $S/pgctl.log 2>&1
sleep 2

# ── ② PCM bootstrap(平台有、本機沒有的)──────────────────────────────────
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA auth;
-- 🔴 `id` 一欄不夠:`handle_new_auth_user()` trigger 會讀 NEW.email 與 NEW.raw_user_meta_data。
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
-- 🔴🔴 pgcrypto **一定要在 extensions 這個 schema**:少了它(或裝進 public)⇒
--    `extensions.gen_random_bytes(integer) 解析不到` ⇒ 出貨那條路的四支 RPC 一支都不會存在,
--    而錯誤訊息**不會指向這裡**(你會看到一串「前置閘失敗」)。
CREATE EXTENSION IF NOT EXISTS pgcrypto SCHEMA extensions;
-- 🔴 auth.uid() 要同時吃兩種 GUC:PostgREST 14 起不再設 `request.jwt.claim.sub`
--    (改設 `request.jwt.claims`,JSON)⇒ 只寫舊的會讓它恆為 null,而 HTTP 仍是 200。
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
SQL

# ── ③ 套 migration(不要求全綠)────────────────────────────────────────────
ok=0; fail=0
for f in "$REPO"/supabase/migrations/*.sql; do
  if psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >> $S/apply.log 2>&1
  then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $f" >> $S/apply.log; fi
done
echo "migration ok=$ok fail=$fail  (判準不是全綠,是你要用的表在不在;失敗清單 grep '^FAIL' $S/apply.log)"

# ── ④ service_role 兩道(平台平常幫你做,本機沒有)──────────────────────────
# 🔴 少了 BYPASSRLS ⇒ RLS 把結果濾成 0 列,而 **HTTP 仍是 200** ⇒
#    「200 + 0 列」與「真的沒有資料」長得一模一樣。
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
ALTER ROLE service_role BYPASSRLS;
SQL

# ── ⑤ 種子(後台要看得到東西,空庫沒有判別力)──────────────────────────────
psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$SP/seed.sql"

# ── ⑥ PostgREST + 前綴代理 ───────────────────────────────────────────────
cat > $S/prest.conf <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PG/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-port = $PREST
jwt-secret = "$SEC"
db-max-rows = 2000
CONF
nohup postgrest $S/prest.conf > $S/prest.log 2>&1 &
sleep 3

python3 - "$SEC" > $S/jwts.txt <<'PY'
import base64, hmac, hashlib, json, sys
sec = sys.argv[1].encode()
b64 = lambda d: base64.urlsafe_b64encode(d).rstrip(b"=")
def tok(role):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
    p = b64(json.dumps({"role":role,"iss":"pcm-admin-probe","exp":4102444800},separators=(",",":")).encode())
    return (h+b"."+p+b"."+b64(hmac.new(sec,h+b"."+p,hashlib.sha256).digest())).decode()
print("ANON="+tok("anon"))
print("SERVICE="+tok("service_role"))
PY

cp "$SP/proxy.py" $S/proxy.py
nohup python3 $S/proxy.py "$PREST" "$PROXY" > $S/proxy.log 2>&1 &
sleep 2

# ── ⑦ 真後台 ─────────────────────────────────────────────────────────────
A=$(grep '^ANON=' $S/jwts.txt | cut -d= -f2-); SR=$(grep '^SERVICE=' $S/jwts.txt | cut -d= -f2-)
cd "$REPO/apps/admin"
ADMIN_DEV_BYPASS=1 \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PROXY \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$A" \
SUPABASE_SERVICE_ROLE_KEY="$SR" \
nohup npx next dev -p $WEB -H 127.0.0.1 > $S/next.log 2>&1 &
sleep 18

# ── ⑧ 🔴 自檢:證明【這個環境是活的】,不是「腳本跑完了」──────────────────
# 每一格都印一個**兩個世界會不同**的值,而不是一句「OK」。
echo
echo "──────── 自檢(每一格都是量到的值,不是狀態宣稱)────────"
SQL_PRODUCTS=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc 'select count(*) from products')
SQL_ORDERS=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc 'select count(*) from orders')
REST_PRODUCTS=$(curl -s -H "Authorization: Bearer $SR" \
  "http://127.0.0.1:$PROXY/rest/v1/products?select=id" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null || echo ERR)
HTTP_ORDERS=$(curl -s -o $S/orders.html -w '%{http_code}' --max-time 60 "http://localhost:$WEB/orders")

# 🔴 **數【不同的單號】,不要 `grep -c`** —— `grep -c` 數的是**行**,而整頁 HTML 常常是一行
#    ⇒ 六張單會被數成 1。(建這支腳本時真的先寫錯了:印出 1 而實際有 5 張。)
SHOWN=$(grep -o 'PCM-[0-9]\{4\}-[0-9]\{4,\}' $S/orders.html 2>/dev/null | sort -u | wc -l | tr -d ' ')
# 預設清單**刻意隱藏未付款**(Sean 要的行為;`order-list-view.ts:67-73` SHOW_UNPAID_CARD_PARAM,
# 預設關)⇒ 應該出現的張數 = 非 unpaid 的那些。
SQL_VISIBLE=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select count(*) from orders where payment_status <> 'unpaid'")
UNPAID_ID=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select display_id from orders where payment_status = 'unpaid' order by display_id limit 1")

printf "  DB   products=%s  orders=%s(其中非未付款 %s)\n" "$SQL_PRODUCTS" "$SQL_ORDERS" "$SQL_VISIBLE"
printf "  REST products=%s   <- 與上面那個 DB 數字一致才算通\n" "$REST_PRODUCTS"
printf "  HTTP /orders=%s    畫面上不同單號=%s\n" "$HTTP_ORDERS" "$SHOWN"

FAILED=0
[ "$SQL_PRODUCTS" = "$REST_PRODUCTS" ] || { echo "  🔴 REST 與 DB 對不上 ⇒ 多半是 service_role 的 GRANT/BYPASSRLS 沒生效(200+0 列)"; FAILED=1; }
[ "$HTTP_ORDERS" = "200" ] || { echo "  🔴 後台 /orders 不是 200 ⇒ 看 $S/next.log"; FAILED=1; }
# 🔴🔴 **兩個世界要給不同答案,這一格才有判別力**:
#    ① 該出現的**都出現**(數字對得上,而不是「>0 就算過」)
#    ② 該被隱藏的**真的不在**(未付款那張)
#    ⇒ 只驗①的話,「篩選整個壞掉、全部都印出來」也會通過;只驗②的話,空白頁也會通過。
[ "$SHOWN" = "$SQL_VISIBLE" ] || { echo "  🔴 畫面上的單號數($SHOWN)與應顯示數($SQL_VISIBLE)不符 ⇒ 種子沒進去,或查詢層壞了"; FAILED=1; }
if grep -q "$UNPAID_ID" $S/orders.html 2>/dev/null; then
  echo "  🔴 未付款那張($UNPAID_ID)出現在預設清單上 ⇒ 「預設隱藏未付款」那道篩選沒生效"
  FAILED=1
else
  printf "  ✅ 未付款那張(%s)正確地不在預設清單上 <- 這一格證明篩選【真的在篩】\n" "$UNPAID_ID"
fi

echo
if [ "$FAILED" = "0" ]; then
  echo "✅ 這份 HTML 裡有正確的資料 —— 上面每一格都拿到真資料。"
  echo
  echo "   ⚠️ 而這個自檢【不證】client JS 可用 —— 它量的是 curl 拿回來的那份 HTML。"
  echo "      Next 的 RSC payload 會塞在 <script>self.__next_f.push(...) 裡 ⇒"
  echo "      **表格沒渲染、資料仍在 script 裡** 時,上面那些數字照樣對得上。"
  echo "      ⇒ 「畫面能不能用」只有【真的開瀏覽器】才算數,見下面那行網址。"
  echo
  echo "   👉 用瀏覽器開:  http://localhost:$WEB/orders"
  echo "      (🔴 一定要 localhost,不要 127.0.0.1 —— 用 127 的話 client JS 會靜靜地不見)"
  echo
  echo "   收攤:  bash scripts/admin-probe/down.sh"
else
  echo "🔴 自檢沒過 —— **不要拿這個環境下任何結論**。log 在 $S/"
  exit 1
fi
