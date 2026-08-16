#!/usr/bin/env bash
# ci-self-contained: no — 需要 postgrest binary(CI runner 沒裝)且要套 178 支 migration,分鐘級
# order-list-select-probe.sh — 🔴 `#533`:給 `ADMIN_ORDER_LIST_SELECT` 補一個【第三方】
#
# ══ 1. 為什麼 ═══════════════════════════════════════════════════════════════
#
# `ADMIN_ORDER_LIST_SELECT` 原本只有一格 **TS↔TS 的 byte-equal**:常數對照一份手寫字面。
# 🔴 **真值在資料庫,而資料庫沒有出現在那一格裡。**
#    那是 08-07 正式站 8 小時事故的形狀(應用層先於 DB 上線,而守門看不到)。
# ⇒ 本 probe 把那串字面送給**真 PostgREST**、對**用 repo 全部 migration 套出來的 schema** 查。
#
# ══ 2. 🔴🔴 它擋什麼、不擋什麼(名字必須說實話)══════════════════════════════
#
# E 窗 2026-08-16 的四類實測(我複核了結論,配方沿用):
# | 突變 | 結果 | 抓得到? |
# |---|---|---|
# | 多寫一欄(`orders` 層加不存在的欄) | 400 `42703` | ✅ |
# | 🔴 **漏一欄**(拿掉 `invoice_status`) | **200** | 🔴 **抓不到** |
# | embed 表名錯 | 400 `PGRST200` | ✅ |
# | 巢狀深處欄名錯 | 400 `42703` | ✅ |
#
# 🔴 **漏寫【結構上】就抓不到** —— PostgREST 的 select 是「我要哪些欄」,**少要一欄是完全合法的請求**。
# ⇒ **本 probe 只擋「select 寫了 DB 沒有的東西」,不擋「該要而沒要」。**
#    ⚠️ **不要讓它的名字或報告宣稱它擋兩邊** —— 那會讓下一個人以為漏欄有人在守。
#    📌 漏欄要另一種守門(比對 select 的欄集合 vs mapper/型別真的讀到的欄),**不是這一支**。
#
# ══ 3. 🔴🔴 環境保真度 —— 比守門本身重要 ═══════════════════════════════════
#
# E 窗實錘:它第一版少了 `initdb -E UTF8` ⇒ 178 支裡失敗 70,**其中 59 是它自己的環境造成的**,
# 而它差一點把「守門做不出來」報成結論。
# 🔴 **schema 不忠實 ⇒ 產生的 `42703` 是假紅,而假紅比沒有守門更糟**(人會學會忽略它)。
# ⇒ 本 probe 的作法:**不要求 178 支全過**(本機實測仍有 28 支套不起來),
#   改成**逐欄斷言 select 真的用到的那些 (table, column) 全部存在** ——
#   缺了就以**不同的訊息與 exit code** 停下來,明說「這是環境不完整,不是常數錯」。
#   ⚠️ 這兩件事的差別就是「該修 code」與「該修我的 bootstrap」的差別。
set -euo pipefail
export LC_ALL=C LANG=C
D=/tmp/pgordsel; PGPORT=55563; PRPORT=3991
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ADAPTER="$REPO/packages/adapters/src/supabase/SupabaseOrderAdapter.ts"

if ! command -v postgrest >/dev/null 2>&1; then
  echo "❌ 找不到 postgrest binary。本機:brew install postgrest"
  echo "   🔴 這是缺件,不是「投影寫錯」—— 兩件事。"
  exit 1
fi

trap 'kill $PRPID 2>/dev/null || true; pg_ctl -D "$D/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$D"' EXIT INT TERM HUP
[ -d "$D/data" ] && pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1
rm -rf "$D" && mkdir -p "$D"
# 🔴 `-E UTF8 --locale=C` 不是裝飾:少了它,E 窗量到 12 個 "conversion between …" 失敗。
initdb -U postgres -A trust -E UTF8 --locale=C "$D/data" > "$D/initdb.log" 2>&1
pg_ctl -D "$D/data" -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -l "$D/pg.log" start >/dev/null
for _ in $(seq 1 30); do psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tAc "select 1" >/dev/null 2>&1 && break; sleep 1; done
pq () { psql -h 127.0.0.1 -p "$PGPORT" -U postgres "$@"; }

pq -q -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
CREATE ROLE service_role NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticator LOGIN NOINHERIT;
GRANT service_role TO authenticator; GRANT anon TO authenticator; GRANT authenticated TO authenticator;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS graphql_public;
SQL

echo "── 套 migration(允許部分失敗,保真度靠下面逐欄斷言)──"
OK=0; FAILED=0
for M in "$REPO"/supabase/migrations/*.sql; do
  if pq -q -v ON_ERROR_STOP=1 -f "$M" >> "$D/apply.log" 2>&1; then OK=$((OK+1)); else FAILED=$((FAILED+1)); fi
done
echo "  成功 $OK / 失敗 $FAILED"

# 🔴 把 select 拆成 (table, column) —— **從原始碼抽,不手抄**(手抄就變成第二個 TS↔TS)
python3 - "$ADAPTER" > "$D/pairs.txt" <<'PY'
import re,sys
s=open(sys.argv[1],encoding='utf-8').read()
m=re.search(r"export const ADMIN_ORDER_LIST_SELECT\s*=\s*\n?\s*'([^']*)'", s)
assert m, "抽不到 ADMIN_ORDER_LIST_SELECT —— 停,不要用手抄的字串跑"
sel=m.group(1); pairs=[]
def walk(text, table):
    i=0; buf=''
    while i < len(text):
        c=text[i]
        if c=='(':
            depth=1; j=i+1
            while j<len(text) and depth:
                if text[j]=='(': depth+=1
                elif text[j]==')': depth-=1
                j+=1
            walk(text[i+1:j-1], buf.strip().split(',')[-1].strip()); buf=''; i=j; continue
        if c==',':
            n=buf.strip()
            if n: pairs.append((table,n))
            buf=''; i+=1; continue
        buf+=c; i+=1
    n=buf.strip()
    if n: pairs.append((table,n))
walk(sel,'orders')
for t,c in pairs: print(f"{t}\t{c}")
PY
N_PAIRS=$(wc -l < "$D/pairs.txt" | tr -d ' ')
# 正向對照:抽不到就是抽不到,空清單會讓下面的迴圈恆真
[ "$N_PAIRS" -ge 20 ] || { echo "❌ 只抽到 $N_PAIRS 對 (table,column) —— 抽取器壞了,下面的斷言沒有判別力"; exit 1; }
echo "── 保真度斷言:select 真的用到的 $N_PAIRS 對 (table, column) 全部要存在 ──"
MISS=''
while IFS=$'\t' read -r T C; do
  CNT=$(pq -tAc "select count(*) from information_schema.columns where table_schema='public' and table_name='$T' and column_name='$C'")
  [ "$CNT" = "0" ] && MISS="$MISS  $T.$C"$'\n'
done < "$D/pairs.txt"
if [ -n "$MISS" ]; then
  echo "🔴 這些 (table, column) 在本機 schema 裡不存在:"
  printf '%s' "$MISS"
  echo "  ⚠️ **這是【環境不完整】,不是【常數寫錯】** —— 上面有 $FAILED 支 migration 沒套起來。"
  echo "     先查那幾支為什麼失敗(`$D/apply.log`),不要把這個當成 ADMIN_ORDER_LIST_SELECT 的缺陷。"
  exit 2   # ← 🔴 刻意用不同的 exit code:2=環境、1=常數真的錯
fi
echo "  ✅ $N_PAIRS 對全在"

# 🔴 **第二道保真度:權限**(不是裝飾 —— 我第一版漏了它,結果 401 被我自己的訊息
#    斷言成「這是常數本身的問題,不是環境」,而它其實是環境。**判別器涵蓋不到的東西,
#    不能寫進判別器的結論裡。**)
#    Supabase 平台在正式庫已經給了 service_role 這些權限,本機沒有 ⇒ 自己補。
pq -q -v ON_ERROR_STOP=1 -c "GRANT USAGE ON SCHEMA public TO service_role;" >/dev/null 2>&1
pq -q -v ON_ERROR_STOP=1 -c "GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;" >/dev/null 2>&1
echo "── 保真度斷言②:service_role 對 select 用到的每一張表都要讀得到 ──"
NOPRIV=''
while IFS=$'\t' read -r T _; do
  case "$NOPRIV" in *" $T "*) continue;; esac
  HAS=$(pq -tAc "select has_table_privilege('service_role','public.$T','SELECT')")
  [ "$HAS" = "t" ] || NOPRIV="$NOPRIV $T "
done < "$D/pairs.txt"
if [ -n "$NOPRIV" ]; then
  echo "🔴 service_role 讀不到這些表:$NOPRIV"
  echo "  ⚠️ **這是【環境不完整】,不是【常數寫錯】**"
  exit 2
fi
echo "  ✅ 權限齊備"

cat > "$D/pgrst.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PGPORT/postgres"
db-schemas = "public"
db-anon-role = "service_role"
server-port = $PRPORT
CONF
postgrest "$D/pgrst.conf" > "$D/pgrst.log" 2>&1 &
PRPID=$!
for _ in $(seq 1 20); do curl -s "http://127.0.0.1:$PRPORT/" >/dev/null 2>&1 && break; sleep 1; done
curl -s "http://127.0.0.1:$PRPORT/" >/dev/null 2>&1 || { echo "❌ PostgREST 沒起來"; tail -8 "$D/pgrst.log"; exit 1; }

SEL=$(python3 -c "
import re,sys
s=open('$ADAPTER',encoding='utf-8').read()
print(re.search(r\"export const ADMIN_ORDER_LIST_SELECT\s*=\s*\n?\s*'([^']*)'\", s).group(1))")
ENC=$(printf '%s' "$SEL" | tr -d ' ')

echo "── 正向:adapter 的投影打真 schema ──"
CODE=$(curl -s -o "$D/ok.json" -w '%{http_code}' --get --data-urlencode "select=$ENC" --data-urlencode "limit=1" \
  "http://127.0.0.1:$PRPORT/orders")
if [ "$CODE" != "200" ]; then
  echo "🔴 HTTP $CODE —— 兩道保真度斷言(欄位、權限)都過了。"
  echo "   ⚠️ **但那兩道只涵蓋它們涵蓋的東西** —— 若下面的錯是 42501/42P01 之類,"
  echo "      那仍然是環境;是 42703/PGRST200 才輪得到懷疑常數本身。"
  echo "   回應內容:"
  cat "$D/ok.json"; exit 1
fi
echo "  ✅ HTTP 200"

echo "── 負向對照①:orders 層多一個不存在的欄 ⇒ 必須 400 ──"
C1=$(curl -s -o "$D/n1.json" -w '%{http_code}' --get --data-urlencode "select=$ENC,zz_bogus_col" --data-urlencode "limit=1" \
  "http://127.0.0.1:$PRPORT/orders")
[ "$C1" = "400" ] || { echo "❌ 回 $C1(預期 400)—— 本檢查沒有判別力"; cat "$D/n1.json"; exit 1; }
echo "  ✅ HTTP 400 / $(python3 -c "import json;print(json.load(open('$D/n1.json'))['code'])")"

echo "── 負向對照②:embed 表名錯 ⇒ 必須 400 PGRST200 ──"
BAD=$(printf '%s' "$ENC" | sed 's/order_items(/zz_no_table(/')
C2=$(curl -s -o "$D/n2.json" -w '%{http_code}' --get --data-urlencode "select=$BAD" --data-urlencode "limit=1" \
  "http://127.0.0.1:$PRPORT/orders")
[ "$C2" = "400" ] || { echo "❌ 回 $C2(預期 400)"; cat "$D/n2.json"; exit 1; }
echo "  ✅ HTTP 400 / $(python3 -c "import json;print(json.load(open('$D/n2.json'))['code'])")"

echo "── ⚠️ 已知不擋:漏一欄 ──"
LESS=$(printf '%s' "$ENC" | sed 's/,invoice_status//')
C3=$(curl -s -o /dev/null -w '%{http_code}' --get --data-urlencode "select=$LESS" --data-urlencode "limit=1" \
  "http://127.0.0.1:$PRPORT/orders")
echo "  拿掉 invoice_status ⇒ HTTP $C3(200 = 如預期【抓不到】,見檔頭 §2;這一行是把限度量出來,不是通過)"

echo "✅ order-list select probe:正向 + 兩道負向對照全過(限度已在上面印出)"
