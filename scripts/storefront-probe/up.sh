#!/usr/bin/env bash
# 顧客站(storefront)拋棄式鑽機 —— `docs/runbooks/local-admin-with-real-data-probe.md` 的顧客站版。
# 2026-08-18 G3 建;那份 runbook 本體示範的是 admin,這裡是把同一條鏈接到 apps/storefront。
#
#   起  bash scripts/storefront-probe/up.sh
#   收  bash scripts/storefront-probe/down.sh     <- 逐項 pgrep + 逐埠 lsof 驗死,不看指令回傳
#
# 🔴 開瀏覽器一律 `http://localhost:3020`,**不要 `http://127.0.0.1:3020`** ——
#    Next 16 dev 只認 `localhost` 這個 Origin,用 127 會讓 4 支 chunk 回 403,
#    而畫面上 HTML/CSS 正常、**只有 client JS 靜靜地不見**(那跟「功能沒做」長得一樣)。
#    量測與限定見 runbook §9。
#
# 🔴 效度限制照 runbook §5 / §8-f,一條都不放寬。最容易忘的兩條:
#    · GRANT 與 BYPASSRLS 是這支腳本自己下的 ⇒ **證不了正式站的權限設定**
#    · `/auth/v1` 是替身、**不驗密碼**,任何字串都登得進去 ⇒ 不要拿它驗「擋不擋得住」
#
# 🔴 27 支 migration 套不上是常態(判準是「你要用的表在不在」,不是全綠)。
#    已知受害者:`vehicle_taxonomy_public` ⇒ **車款選擇那條路這套鑽機進不去。**
# 🔴 開瀏覽器一律 http://localhost:3020,不要 127.0.0.1(見 G3-004:Origin 決定 200/403)
set -euo pipefail
# 🔴 export，不是只給 initdb 加前綴：postmaster 啟動時也要看到它，
#    否則 FATAL: postmaster became multithreaded during startup（2026-08-18 實際踩到）
export LC_ALL=C
REPO=/Users/sean_1/pcm-website-v2
# 🔴 路徑可覆寫:多窗平行時各自帶一個 `STOREFRONT_PROBE_DIR`(down.sh 讀同一個變數)。
#    預設值仍是固定路徑 —— 那是為了讓 `up.sh` / `down.sh` 這一對在【不傳任何東西】時仍然配得上;
#    而固定路徑的代價由下面那道前置閘擋住,不是靠使用者記得。
SP="$(cd "$(dirname "$0")" && pwd)"
# 🔴 路徑**與埠**住在 `env.sh`,**up 與 down 讀同一份**(2026-08-19 W3;做法照 `admin-probe`)。
#    為什麼不能兩邊各寫一份:見那支檔的檔頭 —— 而**本專案就是活生生的例子**,
#    落檔前 `up.sh` 與 `down.sh` 的常數行**已經不一樣了**(CORS 只在 down 那行)。
# shellcheck source=./env.sh
. "$SP/env.sh"
SEC="pcm-g3-throwaway-jwt-secret-at-least-32-chars-long"

# 🔴🔴 **前置閘(2026-08-19 新增)—— 本來這裡是無條件 `rm -rf $S`。**
#    形狀:A 窗正在跑 probe,B 窗跑 `up.sh` ⇒ **B 當場把 A 的 datadir 砍掉**,
#    而 A **不會收到任何訊息**,它的 postgres 變成一個沒有資料目錄的孤兒。
#    ⇒ **一個被中途拆掉的量測,長得跟一個完成的量測一模一樣。**
#    ⇒ 所以:有人在跑就【停下來並指名是誰】,不要自作主張接管。
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
  for _p in $WEB $PROXY $PREST $CORS $PG; do
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
  echo "   要收掉它  ⇒ bash scripts/storefront-probe/down.sh" >&2
  echo "   要並行跑  ⇒ 換一組路徑與埠(2026-08-19 起埠也可覆寫,見 env.sh):" >&2
  echo "       STOREFRONT_PROBE_DIR=/tmp/pcm-g3-probe-b \\" >&2
  echo "       STOREFRONT_PROBE_PG=55543 STOREFRONT_PROBE_PREST=3979 STOREFRONT_PROBE_PROXY=3978 \\" >&2
  echo "       STOREFRONT_PROBE_WEB=3030 STOREFRONT_PROBE_CORS=3997 \\" >&2
  echo "         bash scripts/storefront-probe/up.sh" >&2
  echo "       🔴 收的時候要帶【同一組】—— 不帶的話 down.sh 會拿預設埠去查," >&2
  echo "          每一格都印綠而你的鑽機還活著。owner.txt 有記你當初用的那幾個埠。" >&2
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
  echo "   看過、確定不要了 ⇒ FORCE=1 bash scripts/storefront-probe/up.sh" >&2
  [ "${FORCE:-0}" = "1" ] || exit 1
  echo "   (FORCE=1 ⇒ 照你的意思刪掉重來)" >&2
fi

rm -rf "$S" && mkdir -p "$S"   # 🔴 引號:`${STOREFRONT_PROBE_DIR:-…}` 只擋空字串,擋不了空白/glob
# 誰起的、什麼時候起的 —— down.sh 會在拆之前把它印出來。
{ echo "起於   : $(date '+%Y-%m-%d %H:%M:%S')"
  echo "shell  : pid $$  tty $(tty 2>/dev/null || echo '?')"
  echo "datadir: $S"
  echo "埠     : web $WEB / proxy $PROXY / prest $PREST / cors $CORS / pg $PG"
} > $S/owner.txt
initdb -D $S/pg -U postgres --auth=trust --encoding=UTF8 --locale=C > $S/initdb.log 2>&1
pg_ctl -D $S/pg -o "-p $PG -k /tmp" -l $S/pg.log start > $S/pgctl.log 2>&1
sleep 2

psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT anon, authenticated, service_role TO authenticator;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(coalesce(current_setting('request.jwt.claim.sub', true),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
SQL

ok=0; fail=0
for f in $REPO/supabase/migrations/*.sql; do
  if psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >> $S/apply.log 2>&1
  then ok=$((ok+1)); else fail=$((fail+1)); echo "FAIL $f" >> $S/apply.log; fi
done
echo "migration ok=$ok fail=$fail  (判準不是全綠,是你要用的表在不在)"

psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q <<'SQL'
GRANT USAGE ON SCHEMA public TO service_role, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt() TO authenticated, anon, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON customers, customer_addresses, customer_vehicles TO authenticated;
SQL

psql -h 127.0.0.1 -p $PG -U postgres -v ON_ERROR_STOP=1 -q -f "$SP/seed.sql"
echo "seed 完成: $(psql -h 127.0.0.1 -p $PG -U postgres -t -c 'select count(*) from products' | tr -d ' ') 件商品"

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
def tok(extra):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode())
    p = b64(json.dumps(dict(iss="pcm-g3", exp=4102444800, **extra),separators=(",",":")).encode())
    return (h+b"."+p+b"."+b64(hmac.new(sec,h+b"."+p,hashlib.sha256).digest())).decode()
print("ANON="+tok({"role":"anon"}))
print("SERVICE="+tok({"role":"service_role"}))
print("AUTH="+tok({"role":"authenticated","aud":"authenticated",
                   "sub":"11111111-1111-1111-1111-111111111111"}))
# 第二個客人的 JWT(換帳號那一類題目要用;見 seed.sql 的說明)
print("AUTH2="+tok({"role":"authenticated","aud":"authenticated",
                    "sub":"22222222-2222-2222-2222-222222222222"}))
PY
grep '^AUTH=' $S/jwts.txt | cut -d= -f2- > $S/authjwt.txt
grep '^AUTH2=' $S/jwts.txt | cut -d= -f2- > $S/authjwt2.txt

cp "$SP/proxy.py" "$S/proxy.py"
# 🔴 上游埠與監聽埠用 argv 傳進去 —— 那兩個原本寫死在 proxy.py 裡(見該檔那段註解)。
nohup python3 "$S/proxy.py" "$PREST" "$PROXY" > "$S/proxy.log" 2>&1 &
# 🔴 埠用 argv 傳進去 —— 它原本**寫死在那支 py 裡面**,覆寫環境變數對它沒有用
#    (而 `down.sh` 的 `pkill -f "cors-server.py"` 也因此**抓不到自己那一個**,見下)。
nohup python3 "$SP/cors-server.py" "$CORS" > $S/cors.log 2>&1 &
sleep 2

A=$(grep ANON= $S/jwts.txt | cut -d= -f2-); SR=$(grep SERVICE= $S/jwts.txt | cut -d= -f2-)
cd $REPO/apps/storefront
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PROXY NEXT_PUBLIC_SUPABASE_ANON_KEY="$A" \
SUPABASE_SERVICE_ROLE_KEY="$SR" NEXT_PUBLIC_SITE_URL=http://localhost:$WEB \
NEXT_PUBLIC_TAPPAY_APP_ID=00000 NEXT_PUBLIC_TAPPAY_APP_KEY=probe_app_key NEXT_PUBLIC_TAPPAY_ENV=sandbox \
nohup npx next dev -p $WEB > $S/next.log 2>&1 &
sleep 15
echo "web: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$WEB/)  <- 開這個,不要開 127.0.0.1"
