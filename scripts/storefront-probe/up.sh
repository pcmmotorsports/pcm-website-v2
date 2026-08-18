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
S=/tmp/pcm-g3-probe
SEC="pcm-g3-throwaway-jwt-secret-at-least-32-chars-long"
PG=55533; PREST=3969; PROXY=3968; WEB=3020
SP="$(cd "$(dirname "$0")" && pwd)"

rm -rf $S && mkdir -p $S
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

cp "$SP/proxy.py" $S/proxy.py
nohup python3 $S/proxy.py > $S/proxy.log 2>&1 &
nohup python3 "$SP/cors-server.py" > $S/cors.log 2>&1 &
sleep 2

A=$(grep ANON= $S/jwts.txt | cut -d= -f2-); SR=$(grep SERVICE= $S/jwts.txt | cut -d= -f2-)
cd $REPO/apps/storefront
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PROXY NEXT_PUBLIC_SUPABASE_ANON_KEY="$A" \
SUPABASE_SERVICE_ROLE_KEY="$SR" NEXT_PUBLIC_SITE_URL=http://localhost:$WEB \
NEXT_PUBLIC_TAPPAY_APP_ID=00000 NEXT_PUBLIC_TAPPAY_APP_KEY=probe_app_key NEXT_PUBLIC_TAPPAY_ENV=sandbox \
nohup npx next dev -p $WEB > $S/next.log 2>&1 &
sleep 15
echo "web: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$WEB/)  <- 開這個,不要開 127.0.0.1"
