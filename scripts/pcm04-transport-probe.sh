#!/usr/bin/env bash
# PCM04 送到畫面那一路的【傳輸層】—— 拋棄式 PG + 真 migration + PostgREST + curl。
#
# 🔴 它在回答哪個問句:
#   問句 A(碼裡有沒有寫 PCM04)⇒ grep 就答得出來,已經答過
#   問句 B(員工撞到超額時畫面吐什麼)⇒ 由三段組成:
#     ① trigger 真的 RAISE PCM04            ⇒ `scripts/445b-order-refund-cap-verify.sh` 已證
#     ② PostgREST 把 SQLSTATE 放進 JSON 的 code  ⇒ 🔴 **本檔 ①**
#     ②b supabase-js 把它放進 error.code       ⇒ 🔴 **本檔 ④(用真的 @supabase/supabase-js)**
#     ③ error.code → 員工看到的那句話        ⇒ refund-repository/actions 的測試已證
#
# ⚠️ 射程(照實寫,不放寬):
#   · 本機 PostgREST,不是正式庫的那台;版本印在輸出裡
#   · fixture 不是正式庫 schema —— 是 migration 讀得到的最小世界(與 445b harness 同形)
#   · 🔴 **probe 用的是裸 `probe_initiate`,不是正式路徑那支 `admin_initiate_order_refund`**
#     (關卡2 nit 8)。正式那支把 INSERT 包在 `BEGIN…EXCEPTION WHEN unique_violation…END`
#     子交易裡(`20260812170000:652-679`)。我**開檔讀了**那個 handler:它只接
#     `unique_violation`,PCM04 不是 ⇒ 會 RAISE 傳出去 ⇒ **結論不變**。
#     🛑 **但那一格是【讀出來的】不是【量到的】** —— 不要把它算進本檔已證的那幾段。
#   · ④ 用的是 repo 裡真正那份 @supabase/supabase-js(版本印在輸出裡),但打的是
#     本機 PostgREST —— 正式庫前面還有 Supabase 自己的那層,**那一層未經本檔量測**
set -u
export LC_ALL=C LANG=C
REPO=/Users/sean_1/pcm-wt-db
MIG="$REPO/supabase/migrations/20260830210000_m4b_445b_order_refund_cap.sql"
D=/tmp/pcm04-transport-probe
PORT=5581; HPORT=5582
SEC="pcm04-transport-probe-throwaway-secret-at-least-32-chars"

# 🔴 `lsof` 一定要在這張清單裡(codex must-fix 2):下面的埠檢查靠它,
#    而 `lsof` 不在時那個 `&&` 直接失敗 ⇒ **埠檢查靜靜地放行** ⇒ 我們會去打別人的 PG。
for c in initdb pg_ctl psql postgrest python3 curl lsof; do
  command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL(不是紅)"; exit 2; }
done
for p in $PORT $HPORT 5583; do
  lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 埠 $p 被佔 ⇒ ENV-FAIL"; exit 2; }
done
# 🔴 本檔【不自己刪】$D —— 失敗時證據要留著。⇒ 連跑兩發要先 rm,或帶 --fresh。
#    (關卡2 nit 11:少了這句,第二發的 ENV-FAIL 會被讀成「工具壞了」。)
[ "${1:-}" = "--fresh" ] && rm -rf "$D"
[ -e "$D" ] && { echo "🔴 $D 已存在 ⇒ ENV-FAIL。連跑兩發請帶 --fresh,或 rm -rf $D"; exit 2; }

PASS=0; FAIL=0
ok()  { printf '  ✅ %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  🔴 %s\n' "$1"; FAIL=$((FAIL+1)); }
cleanup() {
  [ -f "$D/proxy.pid" ] && kill "$(cat "$D/proxy.pid")" 2>/dev/null
  [ -f "$D/prest.pid" ] && kill "$(cat "$D/prest.pid")" 2>/dev/null
  pg_ctl -D "$D/data" stop -m immediate >/dev/null 2>&1
}
trap cleanup EXIT

mkdir -p "$D"
initdb -U postgres -A trust --encoding=UTF8 --locale=C "$D/data" >/dev/null 2>&1
LC_ALL=C pg_ctl -D "$D/data" \
  -o "-p $PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" \
  -l "$D/pg.log" start > "$D/pgctl.log" 2>&1 ; PGCTL_RC=$?
# 🔴 `pg_ctl start` 的 rc 不可以吞掉(codex must-fix 2)——
#    吞掉之後,若 $PORT 上【本來就有別的 postgres】,下一行的 `psql` 仍然會成功,
#    而我們會對**別人的資料庫**套 migration,最後照樣印全綠。
[ "$PGCTL_RC" -eq 0 ] || { echo "🔴 pg_ctl start rc=$PGCTL_RC ⇒ ENV-FAIL"; tail -6 "$D/pgctl.log"; tail -6 "$D/pg.log"; exit 2; }
sleep 3
psql -h 127.0.0.1 -p $PORT -U postgres -tAc "select 1" >/dev/null 2>&1 \
  || { echo "🔴 PG 起不來 ⇒ ENV-FAIL"; tail -6 "$D/pg.log"; exit 2; }

# 🔴🔴 **身分驗證:我連上的這一顆,是不是我剛剛起的那一顆?**
#    rc=0 只答「我的 pg_ctl 沒失敗」,不答「psql 連到的是它」。
#    ⇒ 問它自己的 data_directory,必須逐字等於 $D/data。
PGDATA_SEEN=$(psql -h 127.0.0.1 -p $PORT -U postgres -tAc "show data_directory" 2>/dev/null | tr -d '[[:space:]]')
PGDATA_WANT=$(cd "$D/data" && pwd -P)
PGDATA_SEEN_REAL=$(cd "$PGDATA_SEEN" 2>/dev/null && pwd -P)
if [ "$PGDATA_SEEN_REAL" != "$PGDATA_WANT" ]; then
  echo "🔴🔴 我連到的不是我起的那顆 PG ⇒ ENV-FAIL(**絕對不能對它套 migration**)"
  echo "     它說的 data_directory = [$PGDATA_SEEN]"
  echo "     我起的                = [$PGDATA_WANT]"
  exit 2
fi
printf '身分驗證 ✅ data_directory = %s\n' "$PGDATA_WANT"

for role in anon authenticated service_role; do
  psql -h 127.0.0.1 -p $PORT -U postgres -tAc "create role $role nologin" >/dev/null 2>&1
done
psql -h 127.0.0.1 -p $PORT -U postgres -tAc \
  "create role authenticator noinherit login; grant service_role to authenticator; grant anon to authenticator" >/dev/null 2>&1

# ── fixture:與 445b harness 同形(最小世界 + 兩道鄰居 trigger)────────────
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 > "$D/fx.log" 2>&1 <<'SQL'
create table public.orders (id uuid primary key default gen_random_uuid(), total bigint not null);
create table public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  refund_amount bigint not null,
  status text not null default 'processing', failed_reason text);
create table public.order_refund_manual_corrections (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.order_refunds(id),
  seq int not null, corrected_to text not null, unique (refund_id, seq));
create view public.order_refund_effective_verdict as
  select distinct on (c.refund_id) c.refund_id, c.corrected_to
    from public.order_refund_manual_corrections c order by c.refund_id, c.seq desc;
create function public.pcm_order_refundable_remaining(p_order_id uuid) returns bigint
  language sql stable as $$
  select o.total::bigint
       - coalesce((select sum(r.refund_amount) from public.order_refunds r
                    where r.order_id=o.id and r.status in ('processing','confirmed')),0)
       - coalesce((select sum(r.refund_amount) from public.order_refunds r
                     join public.order_refund_effective_verdict v on v.refund_id=r.id
                    where r.order_id=o.id and r.status='failed'
                      and r.failed_reason='manual_failed' and v.corrected_to='money_moved'),0)
    from public.orders o where o.id = p_order_id $$;
create function public.pcm_a7c_noop() returns trigger language plpgsql as $$ begin return null; end $$;
create function public.pcm_probe_a7c_insert_guard() returns trigger language plpgsql as $$
declare v text;
begin select o.id::text into v from public.orders o where o.id = NEW.order_id for share; return NEW; end $$;
create trigger order_refunds_a7c_insert_guard_bi before insert on public.order_refunds
  for each row execute function public.pcm_probe_a7c_insert_guard();
create trigger order_refunds_a7c_block_delete_bd before delete on public.order_refunds
  for each row execute function public.pcm_a7c_noop();
create trigger order_refunds_a7c_immutable_guard_bu before update on public.order_refunds
  for each row execute function public.pcm_a7c_noop();
SQL
grep -qi "^ERROR" "$D/fx.log" && { echo "🔴 fixture 建不起來 ⇒ ENV-FAIL"; sed -n 1,4p "$D/fx.log"; exit 2; }

# ── 真 migration 逐字套用(不重打)──────────────────────────────────────
psql -h 127.0.0.1 -p $PORT -U postgres -q -f "$MIG" > "$D/mig.log" 2>&1
MIGERR=$(grep -c "ERROR:" "$D/mig.log" 2>/dev/null || true)
[ "${MIGERR:-0}" = "0" ] || { echo "🔴 migration apply 有 $MIGERR 個 ERROR ⇒ ENV-FAIL"; sed -n 1,6p "$D/mig.log"; exit 2; }

# ── 三支 RPC:超額 / 正常 / P0001 正對照 ───────────────────────────────
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 > "$D/rpc.log" 2>&1 <<'SQL'
create function public.probe_initiate(p_order_id uuid, p_amount bigint)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid;
begin
  insert into public.order_refunds(order_id, refund_amount) values (p_order_id, p_amount) returning id into v;
  return jsonb_build_object('result','INITIATED','refund_id',v);
end $$;
create function public.probe_raise_p0001() returns jsonb language plpgsql as $$
begin raise exception 'probe 正對照' using errcode = 'P0001'; end $$;
grant execute on function public.probe_initiate(uuid,bigint) to service_role;
grant execute on function public.probe_raise_p0001() to service_role;
grant usage on schema public to service_role;
SQL
grep -qi "^ERROR" "$D/rpc.log" && { echo "🔴 RPC 建不起來 ⇒ ENV-FAIL"; sed -n 1,4p "$D/rpc.log"; exit 2; }

OID=$(psql -h 127.0.0.1 -p $PORT -U postgres -tAc \
  "insert into public.orders(total) values (1000) returning id" | head -1 | tr -d '[[:space:]]')
[ -n "$OID" ] || { echo "🔴 建不出訂單 ⇒ ENV-FAIL"; exit 2; }

# ── PostgREST ────────────────────────────────────────────────────────────
cat > "$D/prest.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-port = $HPORT
jwt-secret = "$SEC"
CONF
nohup postgrest "$D/prest.conf" > "$D/prest.log" 2>&1 &
echo $! > "$D/prest.pid"
python3 - "$SEC" > "$D/jwt.txt" <<'PY'
import base64,hashlib,hmac,json,sys
def b(x): return base64.urlsafe_b64encode(x).rstrip(b'=')
sec=sys.argv[1].encode()
h=b(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
p=b(json.dumps({"role":"service_role","exp":4102444800},separators=(',',':')).encode())
print((h+b'.'+p+b'.'+b(hmac.new(sec,h+b'.'+p,hashlib.sha256).digest())).decode())
PY
JWT=$(head -1 "$D/jwt.txt")
# 🔴 就緒判準【不是】「埠開了」—— 埠開著而 schema cache 還沒載時,PostgREST 回
#    503/PGRST002,而那與「閘沒擋」在我的 case 分支裡走同一條紅。實測第一發真的中過。
#    ⇒ 就緒 = **一發真的 RPC 回 200**。這把尺問的是它會不會工作,不是它在不在。
READY=no
for i in $(seq 1 60); do
  PROBE=$(curl -s -w '<<HTTP:%{http_code}>>' -X POST "http://127.0.0.1:$HPORT/rpc/probe_raise_p0001" \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{}' 2>/dev/null | tr -d '\n')
  case "$PROBE" in *'"P0001"'*) READY=yes; break ;; esac
  perl -e 'select undef,undef,undef,0.25'
done
[ "$READY" = yes ] || { echo "🔴 PostgREST 60 次仍未就緒 ⇒ ENV-FAIL"; tail -6 "$D/prest.log"; exit 2; }

printf 'PostgREST %s · PG %s\n' \
  "$(postgrest --version 2>&1 | head -1)" \
  "$(psql -h 127.0.0.1 -p $PORT -U postgres -tAc 'show server_version')"

call() {  # $1=rpc  $2=body  → 印 HTTP 碼 + 回應 body(一行)
  curl -s -w '\n<<HTTP:%{http_code}>>' -X POST "http://127.0.0.1:$HPORT/rpc/$1" \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d "$2" | tr -d '\n'
}
jcode() { printf '%s' "$1" | python3 -c "
import json,re,sys
raw=sys.stdin.read()
m=re.match(r'^(.*)<<HTTP:(\d+)>>$', raw, re.S)
body, http = (m.group(1), m.group(2)) if m else (raw, '?')
# 🔴 「body 不是 JSON」與「JSON 裡沒有 code 欄」不可以印同一個字(關卡2 nit 9)——
#    否則負對照在「2xx 而 body 壞掉」的世界仍會印綠。
try:
    parsed = json.loads(body)
except Exception:
    print(f'{http}|BADJSON'); raise SystemExit
if not isinstance(parsed, (dict, list)):
    print(f'{http}|NOTOBJ'); raise SystemExit
code = parsed.get('code') if isinstance(parsed, dict) else None
print(f'{http}|{code}')
"; }

echo "── ① 超額:訂單 1000,送 1001 ⇒ 期望 HTTP 非 2xx 且 code=PCM04 ──"
R=$(call probe_initiate "{\"p_order_id\":\"$OID\",\"p_amount\":1001}")
RES=$(jcode "$R")
printf '     實得 HTTP|code = %s\n' "$RES"
case "$RES" in
  2*) bad "超額竟然成功(HTTP 2xx)⇒ 閘沒擋 ⇒ 本發全部不算數" ;;
  *"|PCM04") ok "PostgREST 把自訂 SQLSTATE 原樣放進 JSON 的 code ⇒ 傳輸層通了" ;;
  *) bad "期望 code=PCM04,實得 [$RES] ⇒ 🔴 **它到不了 error.code** ⇒ 映射片的假設被推翻" ;;
esac

echo "── ② 正對照:P0001 必須原樣到達(證明這把尺分得出不同的碼)──"
R2RAW=$(call probe_raise_p0001 '{}')
R2=$(jcode "$R2RAW")
printf '     實得 HTTP|code = %s\n' "$R2"
case "$R2" in
  *"|P0001") ok "P0001 也原樣到達 ⇒ 尺不是【看到什麼都印 PCM04】" ;;
  *) bad "P0001 期望原樣到達,實得 [$R2]" ;;
esac

echo "── ③ 負對照:沒超額(送 500)必須成功、且【完全沒有 code 欄】──"
# 🔴 這一行原本把 call 直接塞進 jcode 的 $( ) 裡, 內層的 \" 被吃掉 ⇒ body 送成壞 JSON
#    ⇒ PostgREST 回 PGRST102(body 解析失敗)⇒ RPC 根本沒跑, 而它長得像「負對照紅了」。
#    📌 **負對照抓到的第一個東西是我自己的 bug** —— 而少了它, 我會以為那三發都在量 RPC。
R3RAW=$(call probe_initiate "{\"p_order_id\":\"$OID\",\"p_amount\":500}")
R3=$(jcode "$R3RAW")
printf '     實得 HTTP|code = %s\n' "$R3"
case "$R3" in
  2*"|None") ok "正常路徑 2xx 且無 error ⇒ 這把尺不是【對任何東西都吐 PCM04】" ;;
  *) bad "正常路徑期望 2xx 且無 code,實得 [$R3]" ;;
esac

echo "── ④ 🔴 真 supabase-js:JSON 的 code 有沒有變成 error.code ──"
cat > "$D/sbjs.mjs" <<'JS'
// 🔴 絕對路徑 import —— 腳本住在 /tmp, 那裡沒有 node_modules ⇒ 裸名 import 會 ERR_MODULE_NOT_FOUND,
//    而那個紅長得像「supabase-js 不接受這個回應」。⇒ 由呼叫端把 repo 裡那份的路徑餵進來。
const [url, key, orderId, pkg] = process.argv.slice(2);
const { createClient } = await import(pkg);
const sb = createClient(url, key, { auth: { persistSession: false } });
const out = {};
for (const [name, fn, args] of [
  ['over',   'probe_initiate',   { p_order_id: orderId, p_amount: 1001 }],
  ['p0001',  'probe_raise_p0001', {}],
  ['okpath', 'probe_initiate',   { p_order_id: orderId, p_amount: 1 }],
]) {
  const { error } = await sb.rpc(fn, args);
  out[name] = error ? String(error.code) : 'NO_ERROR';
}
console.log(JSON.stringify(out));
JS
# 🔴 supabase-js 打的是 `/rest/v1/...`, PostgREST 在**根** ⇒ 直連回 PGRST125。
#    重用既有那支代理(`scripts/admin-probe/proxy.py`), 不另寫一份會漂移的。
#    ⚠️ 我第一發就是直連 ⇒ **三格【全部】PGRST125, 含負對照** ——
#       📌 而那個「全錯」正是它不是映射問題的證據:一個真的映射壞掉不會連正常路徑一起壞。
PPORT=5583
nohup python3 "$REPO/scripts/admin-probe/proxy.py" "$HPORT" "$PPORT" > "$D/proxy.log" 2>&1 &
echo $! > "$D/proxy.pid"
PREADY=no
for i in $(seq 1 40); do
  PP=$(curl -s -X POST "http://127.0.0.1:$PPORT/rest/v1/rpc/probe_raise_p0001" \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{}' 2>/dev/null | tr -d '\n')
  case "$PP" in *'"P0001"'*) PREADY=yes; break ;; esac
  perl -e 'select undef,undef,undef,0.25'
done
[ "$PREADY" = yes ] || { echo "🔴 代理未就緒 ⇒ ENV-FAIL"; tail -5 "$D/proxy.log"; exit 2; }

SBPKG=$(cd "$REPO" && node -e "console.log(require.resolve('@supabase/supabase-js'))" 2>/dev/null)
SBVER=$(cd "$REPO" && node -e "console.log(require('@supabase/supabase-js/package.json').version)" 2>/dev/null)
printf '     @supabase/supabase-js %s\n' "${SBVER:-未解析出版本}"
if [ -z "$SBPKG" ]; then
  SB=""
  echo "resolve 不到 @supabase/supabase-js" > "$D/sbjs.err"
else
  SB=$(cd "$REPO" && node "$D/sbjs.mjs" "http://127.0.0.1:$PPORT" "$JWT" "$OID" "$SBPKG" 2>"$D/sbjs.err" | tr -d '\n')
fi
if [ -z "$SB" ]; then
  bad "supabase-js 跑不起來 ⇒ 這一格【作廢, 不是綠】:$(head -2 "$D/sbjs.err")"
else
  printf '     實得 %s\n' "$SB"
  case "$SB" in
    *'"over":"PCM04"'*) ok "supabase-js 的 error.code = PCM04 ⇒ 🔴 **整條傳輸鏈通到 app 了**" ;;
    *) bad "期望 error.code=PCM04,實得 $SB ⇒ 映射片的假設被推翻" ;;
  esac
  case "$SB" in
    *'"p0001":"P0001"'*) ok "正對照:P0001 也原樣到 error.code ⇒ 不是【什麼都印 PCM04】" ;;
    *) bad "正對照 P0001 沒原樣到達:$SB" ;;
  esac
  case "$SB" in
    *'"okpath":"NO_ERROR"'*) ok "負對照:正常路徑 error 是 null ⇒ 不是【對任何呼叫都吐錯】" ;;
    *) bad "負對照:正常路徑竟有 error:$SB" ;;
  esac
fi

EXPECT_PASS=6
printf '\n══ PASS=%d FAIL=%d(期望 PASS=%d)══\n' "$PASS" "$FAIL" "$EXPECT_PASS"
# 🔴 只斷言 FAIL=0 不夠(關卡2 nit 10):某個 case 被編掉或 ④ 整塊被繞開時,
#    它會印 PASS=3 FAIL=0 而 rc=0 —— 正是鐵則 11「我餵幾條 vs 它跑幾支」那一格。
if [ "$PASS" -ne "$EXPECT_PASS" ]; then
  printf '🔴 斷言少跑了:期望 %d 格 ✅,實得 %d ⇒ **這一發不算數**\n' "$EXPECT_PASS" "$PASS"
fi
[ "$FAIL" -eq 0 ] && [ "$PASS" -eq "$EXPECT_PASS" ]
