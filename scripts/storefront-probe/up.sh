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
# 🔴🔴 **本鏈【不是】零 secret 的,而 runbook 檔頭那句「不需要任何 secret」對它不成立。**
#    ⚠️ **而「換去施工窗工作樹」對這一支【沒有用】** —— `REPO` 在下面是**寫死的**
#       (`REPO=/Users/sean_1/pcm-website-v2`),`next dev` 一律從**主樹**的 `apps/storefront` 起
#       ⇒ 不管你人在哪一棵樹呼叫它,**載入的都是主樹那份 `.env.local`**。
#    ⇒ 本腳本只把 Supabase 與 TapPay 那幾個變數用 inline 值蓋掉(指向拋棄式鑽機);
#      **`.env.local` 裡的其他東西,在那個 dev server 行程裡是活的。**
#    ⇒ 🔴 **所以不要對這條鏈打任何「會用到外部金鑰」的路徑** ——
#      例如 `/api/cron/*` 那幾條會建 notifier 的,打通了會**真的寄信出去(鐵則 12⑤,收不回來)**。
#    ✅ 起完之後本腳本會印一行 `next 載入的 env 檔:…` —— **那一行就是量到的答案,不要憑印象。**
#    📌 2026-08-21 實錘:一個窗照 runbook 檔頭那句「不需要任何 secret」在主樹起了 server
#       (已收掉、零請求),而**五分鐘後第二個窗正要跑本腳本**,被攔下。
#       ⇒ **一個帶條件的許可,要把條件寫在許可【裡面】,不是寫在它上面。**
#
# 🔴 效度限制照 runbook §5 / §8-f,一條都不放寬。最容易忘的兩條:
#    · GRANT 與 BYPASSRLS 是這支腳本自己下的 ⇒ **證不了正式站的權限設定**
#    · `/auth/v1` 是替身、**不驗密碼**,任何字串都登得進去 ⇒ 不要拿它驗「擋不擋得住」
#
# 🔴 27 支 migration 套不上是常態(判準是「你要用的表在不在」,不是全綠)。
#    已知受害者:`vehicle_taxonomy_public` ⇒ **車款選擇那條路這套鑽機進不去。**
# 🔴 開瀏覽器一律 http://localhost:3020,不要 127.0.0.1(見 G3-004:Origin 決定 200/403)
#
# 🔴🔴 **`FORCE=1` 那條放行路徑【至今沒有人走完】** —— 寫死在這裡,免得下一個人以為它驗過。
#    每一次不驗它的理由都一樣、而且都成立:**走下去會真的 initdb + 起 server + 刪掉一個
#    可能屬於別窗的資料目錄** ⇒ 副作用落在別人身上,不該為了驗它去砸別人。
#    ⇒ 那不是拖延,而它的結果是:**這是一個永遠不會被驗的分支。**
#    ⇒ 要驗它,唯一乾淨的做法是**在一台沒有別窗的機器上**、或先把所有別窗的鑽機都收乾淨再跑。
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
nohup python3 "$S/proxy.py" "$PREST" "$PROXY" "$SEC" "$PG" > "$S/proxy.log" 2>&1 &
# 🔴 埠用 argv 傳進去 —— 它原本**寫死在那支 py 裡面**,覆寫環境變數對它沒有用
#    (而 `down.sh` 的 `pkill -f "cors-server.py"` 也因此**抓不到自己那一個**,見下)。
nohup python3 "$SP/cors-server.py" "$CORS" > $S/cors.log 2>&1 &
sleep 2

A=$(grep ANON= $S/jwts.txt | cut -d= -f2-); SR=$(grep SERVICE= $S/jwts.txt | cut -d= -f2-)
cd $REPO/apps/storefront
# 🔴🔴 **不走 `npx`**(2026-08-21 `-04` SP-1 第二輪;本機實測,不是推的)。
#   `npx` 就是 `npm exec`,而 **`npm exec` 型的行程會把【整包環境變數】印進 `pgrep -fl` 的那一行** ——
#   一般行程只印 argv、乾淨;只有這一種會連環境一起印。
#   實測(macOS 14.6.1,用假 canary 值起一輪探針):
#     pgrep -fl 'npm exec' | grep -c '[H]OME='                    ⇒ 55   ← 尺有力(正對照)
#     pgrep -fl 'npm exec' | grep -c '[T]APPAY_APP_KEY='          ⇒ 1    🔴 在漏
#     pgrep -fl 'npm exec' | grep -c '[S]ERVICE_ROLE_KEY='        ⇒ 1    🔴 在漏
#     pgrep -fl 'npm exec' | grep -c '[C]ANARY…(那個假值本身)'     ⇒ 1    🔴 明文
#     負對照(編造字串)                                            ⇒ 0
#   ⇒ 改成**直接呼叫解析後的 next binary**,繞開 npm exec 那層包裝。
#   ⚠️ **前一版的修法(把 set -a 換成單行前綴)沒有關掉這條路** —— 縮小了爆炸半徑,而管道是同一條。
#      **那一版我也「驗過」,只是驗錯了面**(我量的是 `ps -Eww` 與 `ps -ww -o command=`,
#      而洩漏發生在 `pgrep -fl` 對 `npm exec` 那一行)⇒ **量了 A、答了 B。**
#   🔴 沒有就報錯,不落回 npx —— 落回去等於把「有沒有在漏」變成一件安靜的事。
NEXT_BIN="$REPO/apps/storefront/node_modules/.bin/next"
if [ ! -x "$NEXT_BIN" ]; then
  echo "找不到可執行的 $NEXT_BIN ——【不會】落回 npx(那條路會把環境變數印進 pgrep)。先跑 pnpm install。" >&2
  exit 1
fi
# ─────────────────────────────────────────────────────────────────────────────
# 🔴 TapPay 金鑰:從【repo 外的一個檔】讀,不從參數、不從訊息、不從 .env*
#
# 為什麼是檔不是參數:參數會進 shell history、進 ps 的命令列、進交接訊息、進 transcript。
# 檔案路徑可以在任何地方被講出來而不洩漏任何東西 —— **講路徑是安全的,講值不是。**
#
# 這支腳本對這個檔只做三件事:讀它、用它、印出「讀到沒 + 長度」。
# 🔴 **永遠不印值、不印前綴後綴** —— 前四碼也是值的一部分。
# ⚠️ 這個檔在 repo 之外 ⇒ 不會被 git 追蹤、不會進 commit、不會被我們的 grep 掃到。
# ─────────────────────────────────────────────────────────────────────────────
TAPPAY_ENV_FILE="${TAPPAY_ENV_FILE:-$HOME/pcm-secrets/tappay-sandbox.env}"
# 🔴 `-04` SP-1(2026-08-21):原本這裡是 `set -a; . "$TAPPAY_ENV_FILE"; set +a`
#    ⇒ 匯出到【整個 up.sh 的 shell】,之後每一個子行程都繼承它,而它只有一個消費者。
#    改成:讀進**普通 shell 變數**(不 export),只在 `next dev` 那一行以前綴帶進【那一個行程】。
#
# ⚠️ 這【不是】把它藏起來,而射程要講清楚(本機當場量的,2026-08-21 macOS 14.6.1):
#    · 環境變數:`ps -Eww -p <pid>` 在本機**讀不到任何一個** —— 連自己剛起的行程也讀不到
#      (正對照:同一發抓得到 `sleep` / `next` 字樣 ⇒ 在看對的 pid;負對照:編造字串 0)。
#    · 命令列:`ps -ww -A -o command=` **讀得到**。而 `VAR=val cmd` 這種前綴**不會**進 cmd 的 argv
#      —— 實測:up.sh 用這個形式傳 `SUPABASE_SERVICE_ROLE_KEY`,而
#        `ps -ww -A -o command= | grep -c '[S]UPABASE_SERVICE_ROLE_KEY='` ⇒ **0**
#        (正對照 `[n]ext dev` ⇒ 5;🔴 負對照沒用 `[]` 時回 2 —— **grep 會抓到自己**,那一版的數字全是假的)。
#    🔴 **不同 shell 看得到的範圍不同** ⇒ 下一個人在別的 shell 裡跑同一發 canary,可能得到不一樣的答案。
#       **要斷言「沒有在漏」,先讓你的 ps 對一個【你自己種的 canary】表演一次命中**;
#       表演不出來 ⇒ 你的結論只能寫「我看不到」,不能寫「沒有在漏」。
if [ -f "$TAPPAY_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$TAPPAY_ENV_FILE"
  TP_APP_ID="${NEXT_PUBLIC_TAPPAY_APP_ID:-}"; TP_APP_KEY="${NEXT_PUBLIC_TAPPAY_APP_KEY:-}"; TP_ENV="${NEXT_PUBLIC_TAPPAY_ENV:-sandbox}"
  unset NEXT_PUBLIC_TAPPAY_APP_ID NEXT_PUBLIC_TAPPAY_APP_KEY NEXT_PUBLIC_TAPPAY_ENV
  # 🔴 `-04` SP-3:原本這行印 APP_ID 的【全值】,而上面那句寫著「永遠不印值」⇒ 那句話是假的。
  #    改成只印「有沒有」與長度 —— 兩個世界仍然分得開,而一個字元的值都沒有離開這台機器。
  echo "tappay: 讀到 $TAPPAY_ENV_FILE  APP_ID 長度=${#TP_APP_ID}  APP_KEY 長度=${#TP_APP_KEY}  ENV 長度=${#TP_ENV}"
else
  TP_APP_ID=""; TP_APP_KEY=""; TP_ENV=""
  echo "tappay: 找不到 $TAPPAY_ENV_FILE ⇒ 用假金鑰,結帳第④步會顯示「付款模組暫時無法使用」(那是預期的,不是壞掉)"
fi

# TapPay:預設 00000 = 【故意無效】(Number('00000')=0 ⇒ readClientEnv 回 null ⇒ ready='error'
#   ⇒ 卡欄不掛、SDK 一次都不載,結帳第④步顯示「付款模組暫時無法使用」。這是探針的設計不是產品缺陷。
#   要驗第④⑤步:先 export 真的 sandbox 金鑰再跑本腳本(下面三個都吃外部值)。
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:$PROXY NEXT_PUBLIC_SUPABASE_ANON_KEY="$A" \
SUPABASE_SERVICE_ROLE_KEY="$SR" NEXT_PUBLIC_SITE_URL=http://localhost:$WEB \
NEXT_PUBLIC_TAPPAY_APP_ID="${TP_APP_ID:-00000}" \
NEXT_PUBLIC_TAPPAY_APP_KEY="${TP_APP_KEY:-probe_app_key}" \
NEXT_PUBLIC_TAPPAY_ENV="${TP_ENV:-sandbox}" \
nohup "$NEXT_BIN" dev -p $WEB -H 127.0.0.1 > $S/next.log 2>&1 &
sleep 15
# 🔴 把「Next 載入了哪些 env 檔」印出來 —— **這是機制,不是提醒。**
#    Next 自己會在啟動第一段印 `- Environments: .env.local`,而那行埋在 next.log 裡沒有人會去開。
#    ⇒ 撈上來放在使用者一定看得到的位置。查無時明說查無,不要靜靜地不印(那與「沒載入」長得一樣)。
echo "next 載入的 env 檔:$(grep -m1 'Environments:' $S/next.log 2>/dev/null || echo '(next.log 裡沒有 Environments 這一行 —— 未確認,不等於沒載入)')"
echo "  ⚠️ 上面若出現 .env.local ⇒ 真金鑰在這個 dev server 的環境裡 ⇒ **不要打任何 /api/cron/* 之類會建 notifier 的路徑**"
echo "web: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:$WEB/)  <- 開這個,不要開 127.0.0.1"
