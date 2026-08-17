#!/usr/bin/env bash
# V-041 — 「db-max-rows 對【內嵌】是否套用」量測(規格:~/pcm-mailbox/V-041-內嵌max-rows前提量測規格.md)
#
# 🔴 效度限定(結論要跟著這幾句走,不要只搬數字):
#   · 量到的是【本機這一版 PostgREST 的行為】,不是 Supabase 上的行為。
#   · 本機 db-max-rows 是【我自己設的 100】,與正式站 Dashboard 的 1000 是【兩個不同的東西】,不互相引用。
#   · 「本機量到 X」不得寫成「線上是 X」。
set -uo pipefail

PORT_PG=54397
PORT_RS=54399
D="/tmp/v041_$$"
PGREST_VER="$(postgrest --version 2>&1 | head -1)"

cleanup() {
  [ -n "${RS_PID:-}" ] && kill "$RS_PID" 2>/dev/null
  pg_ctl -D "$D/data" stop -m fast > /dev/null 2>&1
  rm -rf "$D"
}
trap cleanup EXIT

q() { psql -X -h 127.0.0.1 -p "$PORT_PG" -U postgres -tA "$@" 2>&1; }

echo "══ 0. 環境 ══"
echo "PostgREST 版本:$PGREST_VER"
mkdir -p "$D"
initdb -U postgres -A trust "$D/data" > "$D/initdb.log" 2>&1 || { echo "🔴 initdb 失敗"; exit 2; }
LC_ALL=C pg_ctl -D "$D/data" -o "-p $PORT_PG -k $D -c listen_addresses=127.0.0.1" -l "$D/pg.log" start > /dev/null 2>&1
sleep 3
q -c "select 1" > /dev/null || { echo "🔴 叢集起不來"; exit 2; }
echo "PG 版本:$(q -c 'show server_version;')"

echo ""
echo "══ 1. 建結構 + 兩個世界 ══"
q -v ON_ERROR_STOP=1 -c "
create schema api;
create table api.parent (id text primary key);
create table api.child  (id serial primary key, parent_id text not null references api.parent(id));
insert into api.parent values ('A'),('B');
insert into api.child (parent_id) select 'A' from generate_series(1,250);
insert into api.child (parent_id) select 'B' from generate_series(1,50);
create role web_anon nologin;
grant usage on schema api to web_anon;
grant select on all tables in schema api to web_anon;
" > /dev/null || { echo "🔴 建構造失敗"; exit 2; }

echo "🔴 §2-3 構造自證(直連 SQL,不經 PostgREST)—— 必須印 A=250 / B=50:"
q -F'=' -c "select parent_id, count(*) from api.child group by 1 order by 1;" | sed 's/^/   /'
CONSTRUCT="$(q -tA -c "select string_agg(parent_id||'='||c,',' order by parent_id) from (select parent_id, count(*) c from api.child group by 1) t;")"
if [ "$CONSTRUCT" != "A=250,B=50" ]; then
  echo "🔴 構造沒成功(實際 '$CONSTRUCT')⇒ 後面每一發都作廢,停。"; exit 2
fi
echo "   ✅ 構造自證通過:$CONSTRUCT"

echo ""
echo "══ 2. 起 PostgREST(db-max-rows = 100,刻意設小)══"
cat > "$D/pgrst.conf" <<EOF
db-uri = "postgres://postgres@127.0.0.1:$PORT_PG/postgres"
db-schemas = "api"
db-anon-role = "web_anon"
db-max-rows = 100
server-port = $PORT_RS
EOF
postgrest "$D/pgrst.conf" > "$D/pgrst.log" 2>&1 &
RS_PID=$!
# 🔴 就緒判準必須是「回得出【陣列】」,不能只是「有回應」。
#    第一版寫 `curl -s -o /dev/null … && break` —— 那對 **HTTP 錯誤也回 0**
#    ⇒ PostgREST 起來了但 schema cache 還沒載完時,它回的是錯誤物件 `{code,details,hint,message}`
#      ⇒ **`jq 'length'` 得到 4**(物件的鍵數)⇒ 下游把 4 當成「列數」。
#    📎 我真的踩了:第一次跑印「頂層對照 = 4」,而 4 既不是 100 也不是 250 ⇒ 正向對照當場擋下。
#       **量具沒上電,而它回了一個看起來像數字的東西。**
READY=0
for i in $(seq 1 40); do
  if curl -s "http://127.0.0.1:$PORT_RS/parent" | jq -e 'type=="array"' > /dev/null 2>&1; then READY=1; break; fi
  sleep 1
done
if [ "$READY" != "1" ]; then
  echo "🔴 PostgREST 沒到【回得出陣列】的狀態,看 $D/pgrst.log"
  curl -s "http://127.0.0.1:$PORT_RS/parent" | head -c 300; echo
  tail -5 "$D/pgrst.log"; exit 2
fi
echo "   PostgREST 已就緒(port $PORT_RS,判準=回得出 JSON 陣列不是錯誤物件)"

# 🔴 每一發取數之前都再確認一次「這是陣列」,否則印出來的數字是鍵數不是列數。
arr_len() { # arr_len <path> -> 陣列長度,非陣列一律回 ERR
  local body; body="$(curl -s "http://127.0.0.1:$PORT_RS/$1")"
  printf '%s' "$body" | jq -e 'type=="array"' > /dev/null 2>&1 || { echo "ERR"; return 1; }
  printf '%s' "$body" | jq 'length'
}

# len <url> <parent id> —— 印該 parent 的 child 陣列長度;頂層或 child 不是陣列一律回 ERR
len() {
  local body; body="$(curl -s "http://127.0.0.1:$PORT_RS/$1")"
  printf '%s' "$body" | jq -e 'type=="array"' > /dev/null 2>&1 || { echo "ERR"; return 1; }
  printf '%s' "$body" | jq -e --arg p "$2" '.[] | select(.id==$p) | .child | type=="array"' > /dev/null 2>&1 || { echo "ERR"; return 1; }
  printf '%s' "$body" | jq -r --arg p "$2" '.[] | select(.id==$p) | .child | length'
}

echo ""
echo "══ 3. 第 3 發先跑:頂層正向對照(量具有沒有上電)══"
echo "   🔴 這發不過 ⇒ 前兩發全部作廢。"
TOP=$(arr_len 'child?parent_id=eq.A')
echo "   GET /child?parent_id=eq.A(不帶 Range)⇒ 長度 = $TOP  (預期 100 = max-rows 生效)"
if [ "$TOP" != "100" ]; then
  echo "🔴 量具沒上電(頂層沒有被 max-rows 夾)⇒ 前兩發作廢,停。"; exit 2
fi
echo "   ✅ 量具活的"

echo ""
echo "══ 4. 第 1 發:內嵌、不帶任何 limit ══"
A1=$(len 'parent?select=*,child(*)' A); B1=$(len 'parent?select=*,child(*)' B)
echo "   A(該紅世界,庫內 250)⇒ $A1     B(該綠世界,庫內 50)⇒ $B1"
echo "   判讀:A=250 ⇒ 內嵌【不受】max-rows 管;A=100 ⇒ 【受管】。B 必須 =50,否則本發作廢。"

echo ""
echo "══ 5. 第 2 發:內嵌 + 顯式 limit=200(族 A 的直接情境)══"
A2=$(len 'parent?select=*,child(*)&child.limit=200' A); B2=$(len 'parent?select=*,child(*)&child.limit=200' B)
echo "   A ⇒ $A2     B ⇒ $B2"
echo "   判讀:A=100 ⇒ 顯式 embed limit 被 max-rows 夾(族 A 成立);A=200 ⇒ 顯式 limit 不受管(族 A 免疫)。"

echo ""
echo "══════════════════════════════════════════════════════════"
echo "PostgREST 版本 : $PGREST_VER"
echo "db-max-rows    : 100 (本機自設;🔴 與正式站 Dashboard 的 1000 是兩個不同的東西)"
echo "構造自證       : $CONSTRUCT"
echo "第 3 發 頂層對照 : $TOP        (要 100 才算量具上電)"
echo "第 1 發 內嵌無 limit : A=$A1  B=$B1   (B 要 50)"
echo "第 2 發 內嵌 limit=200: A=$A2  B=$B2   (B 要 50)"
echo "══════════════════════════════════════════════════════════"
