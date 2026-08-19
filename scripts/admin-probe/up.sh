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
SP="$(cd "$(dirname "$0")" && pwd)"
# 🔴 埠與路徑住在 `env.sh`,**up 與 down 讀同一份**(W6 `W6-043` n2;為什麼不能兩邊各寫一份,
#    見那支檔的檔頭 —— 簡短版:各寫一份 ⇒ 收的時候拿預設埠去查 ⇒ 兩層都印「已釋放」而它還活著)。
# shellcheck source=./env.sh
. "$SP/env.sh"
SEC="pcm-admin-probe-throwaway-jwt-secret-at-least-32-chars"

# ── 前置:要用的東西在不在(缺了就明確報錯,不要跑到一半才炸)────────────────
for c in initdb pg_ctl psql postgrest python3 curl; do
  command -v "$c" >/dev/null || { echo "🔴 缺 $c —— 這條鏈起不來。postgrest 用 brew install postgrest"; exit 1; }
done
# 🔴🔴 **這裡原本還有一個【一模一樣的】埠迴圈,已於 2026-08-19 刪掉(W6 `W6-043` M1)。**
#    它先跑、命中就 `exit 1` ⇒ **下面那道帶來歷、帶指引的 busy 閘,在它為之而寫的情境下【到不了】**
#    ⇒ `owner.txt` 的來歷、並行跑法、「要收掉它 ⇒ down.sh」那三行**一次都沒印出來過**。
#    🔴 而它的形狀正是本 repo 記過的那個:**保護確實還在,但擋下它的是【更早那道閘】**
#      ⇒「我驗過前置閘」與「前置閘生效」在這裡印出同一個結果。
#    ⚠️ 刪掉之後**沒有損失 fail-fast**(W6 替我核過順序,我複驗):
#      工具檢查 → **busy 閘** → `$S` 存在閘 → `rm -rf "$S"`
#      ⇒ busy 閘仍然排在任何破壞性動作之前,只是換成會講話的那一道。
# 🔴🔴 **前置閘(2026-08-19 新增)—— 本來這裡是無條件 `rm -rf $S`。**
#    A 窗正在跑,B 窗跑 `up.sh` ⇒ **B 當場砍掉 A 的 datadir,而 A 收不到任何訊息**,
#    它的 postgres 變成一個沒有資料目錄的孤兒。
#    ⇒ **一個被中途拆掉的量測,長得跟一個完成的量測一模一樣。**
busy=""
if [ -f "$S/pg/postmaster.pid" ]; then
  _pid=$(head -1 "$S/pg/postmaster.pid" 2>/dev/null || true)
  # 🟡 PID 重用會誤判 busy(fail-closed,煩但不危險)——
  #    `postmaster.pid` **第 2 行就是 datadir 路徑**,比對它就去掉這個誤紅。
  _dd=$(sed -n '2p' "$S/pg/postmaster.pid" 2>/dev/null || true)
  if [ -n "${_pid:-}" ] && kill -0 "$_pid" 2>/dev/null && [ "${_dd:-}" = "$S/pg" ]; then
    busy="postgres pid $_pid(datadir $S/pg)"
  fi
fi
if [ -z "$busy" ]; then
  for _p in $WEB $PROXY $PREST $PG; do
    # 🔴 `|| true` 少不得:本檔是 `set -euo pipefail`,而**埠是空的時候 `lsof` 回 1**
    #    ⇒ 沒有它,這一行會在「第一個空著的埠」就把整支腳本【靜默】殺掉(exit 1、零輸出)。
    #    📌 2026-08-19 實測踩到:M1 那一格看起來通過(證據沒被刪),
    #       **而它是因為腳本死在這裡、根本沒走到下面那道閘** —— 對的結果、錯的原因。
    _o=$(lsof -nP -iTCP:$_p -sTCP:LISTEN 2>/dev/null | grep -v WARNING | awk 'NR==2 {print $2" "$1}' || true)
    if [ -n "$_o" ]; then busy="埠 $_p 已被佔用 —— pid/command = $_o"; break; fi
  done
fi
if [ -n "$busy" ]; then
  echo "🔴 已經有一份鑽機在跑,**這支腳本不會接管它**:" >&2
  echo "   $busy" >&2
  [ -f "$S/owner.txt" ] && { echo "   來歷:" >&2; sed 's/^/     /' "$S/owner.txt" >&2; }
  echo "" >&2
  echo "   要收掉它  ⇒ bash scripts/admin-probe/down.sh" >&2
  echo "   要並行跑  ⇒ 換一組路徑與埠(2026-08-19 起埠也可覆寫,見 env.sh):" >&2
  echo "       ADMIN_PROBE_DIR=/tmp/pcm-admin-probe-b \\" >&2
  echo "       ADMIN_PROBE_PG=55544 ADMIN_PROBE_PREST=3989 ADMIN_PROBE_PROXY=3988 ADMIN_PROBE_WEB=3021 \\" >&2
  echo "         bash scripts/admin-probe/up.sh" >&2
  echo "       🔴 收的時候要帶【同一組】—— 不帶的話 down.sh 會拿預設埠去查," >&2
  echo "          兩層都印「已釋放」而你的鑽機還活著。owner.txt 有記你當初用的那四個埠。" >&2
  exit 1
fi

# 🔴🔴 **M1(W6 抓,2026-08-19):前置閘只擋「還活著」,而 `$S` 存在【不等於】有東西活著。**
#    `down.sh` 判紅時會「⏸ 保留供你查」——**而那份證據會被下一次 `up.sh` 靜默刪掉,一個字都不提**
#    ⇒ **「保留供你查」的保存期,只到下一次有人跑 `up.sh` 為止。**
#    ⇒ 兩個各自正確的改動互相抵銷 ⇒ 這裡也要問一次。
#    📌 `down.sh` 已經在做一模一樣的事(拆之前先印 `owner.txt`),而**刪得更徹底的是這一支**。
if [ -e "$S" ]; then
  echo "🔴 $S 已經存在 —— **這支腳本不會靜默刪掉它**。" >&2
  [ -f "$S/owner.txt" ] && { echo "   來歷:" >&2; sed 's/^/     /' "$S/owner.txt" >&2; }
  echo "   它可能是:① 上一次 down.sh 判紅、**刻意保留下來給你查**的證據" >&2
  echo "             ② 有人跑完沒收攤" >&2
  echo "   看過、確定不要了 ⇒ FORCE=1 bash scripts/admin-probe/up.sh" >&2
  [ "${FORCE:-0}" = "1" ] || exit 1
  echo "   (FORCE=1 ⇒ 照你的意思刪掉重來)" >&2
fi

rm -rf "$S" && mkdir -p "$S"   # 🔴 引號:`${ADMIN_PROBE_DIR:-…}` 只擋空字串,擋不了空白/glob(W6 n3)
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
# 🔴🔴 **這把尺 2026-08-19 換過(W6 `W6-043` M2)—— 舊的量的是【比產品窄的】那個集合。**
#    產品真正下的述詞(`SupabaseOrderAdapter.ts:830-831`):
#        query.or('payment_channel.neq.tappay,payment_status.neq.unpaid')
#    ⇒ 真正被藏起來的是 **`payment_channel = 'tappay'` 且 `payment_status = 'unpaid'`**,
#      **不是所有未付款**。
#    ~~舊寫法 `where payment_status <> 'unpaid'`~~ 在舊種子上答案相同 ——
#    而相同的原因是**一個沒有人寫下來的預設值**:種子沒寫 `payment_channel` ⇒ 全部吃 `DEFAULT 'tappay'`。
#    ⇒ 兩個後果,方向相反:
#      · **假紅**:種子哪天加一列 `bank_transfer` 的未付款單(= 後台要支援的電話單/匯款單),
#        畫面**會顯示它**(對的),而舊尺把它算成不該顯示 ⇒ 自檢紅、訊息卻叫你去查種子。
#      · **假綠(更貴)**:舊尺**分不出**「真述詞」與「退化成只看 payment_status」——
#        兩者在舊種子上輸出一模一樣,而這一格印的是「證明篩選【真的在篩】」。
#    ⇒ 現在種子第 7 列是 `bank_transfer` × `unpaid`(見 `seed.sql`),**它是唯一分得開的那一列**。
SQL_VISIBLE=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select count(*) from orders where not (payment_channel = 'tappay' and payment_status = 'unpaid')")
# 🔴 這一格要抓的是**刷卡未付款**那張(= 真的會被藏起來的那一種),不是「隨便一張未付款」。
#    改完之後它與 `bank_transfer × unpaid` 那張**不是同一列** —— 訊息文字也跟著改,見下方。
UNPAID_ID=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select display_id from orders where payment_channel = 'tappay' and payment_status = 'unpaid' order by display_id limit 1")
# 🔴🔴 **新增的一格:`bank_transfer × unpaid` 那張【必須出現】。**
#    沒有它,「退化成只看 payment_status」仍然會通過 —— 因為那條退化只會【多藏】、不會少藏,
#    而上面的張數比對在種子剛好對稱時抓不到。**這一格才是把兩把尺分開的那一發。**
BANK_UNPAID_ID=$(psql -h 127.0.0.1 -p $PG -U postgres -tAc "select display_id from orders where payment_channel <> 'tappay' and payment_status = 'unpaid' order by display_id limit 1")

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
  echo "  🔴 刷卡未付款那張($UNPAID_ID)出現在預設清單上 ⇒ 「預設隱藏刷卡未付款」那道篩選沒生效"
  FAILED=1
else
  printf "  ✅ 刷卡未付款那張(%s)正確地不在預設清單上\n" "$UNPAID_ID"
fi
# 🔴🔴 **這一格與上一格【方向相反】,兩格都在才有判別力**(W6 `W6-043` M2):
#    上一格問「該藏的藏了沒」,這一格問「**不該藏的有沒有被誤藏**」。
#    只有它會在「述詞退化成只看 payment_status」時變紅 —— 那條退化只會多藏、不會少藏。
if [ -z "$BANK_UNPAID_ID" ]; then
  echo "  🔴 種子裡沒有『非刷卡 × 未付款』那一列 ⇒ **這一格沒有判別力**,不要當它通過了"
  FAILED=1
elif grep -q "$BANK_UNPAID_ID" $S/orders.html 2>/dev/null; then
  printf "  ✅ 匯款未付款那張(%s)有出現 <- 這一格證明篩的是【刷卡且未付款】,不是【所有未付款】\n" "$BANK_UNPAID_ID"
else
  echo "  🔴 匯款未付款那張($BANK_UNPAID_ID)被藏起來了 ⇒ 述詞多半退化成只看 payment_status"
  FAILED=1
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
