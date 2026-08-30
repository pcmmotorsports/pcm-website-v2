#!/usr/bin/env bash
# `#866` 的 **PCM01** 真的走得到 app 的 `error.code` 嗎 ——
# ⛔ ~~那三個碼(PCM01/02/03)~~ 🔴 **本檔只驗 PCM01**(codex 關卡2 nit 4:檔頭宣稱比實際寬)。
#    PCM02 要讓 cap 算不出來、PCM03 只在 DELETE 發生而本路徑不 DELETE ⇒ 兩者本檔都沒演。
# 拋棄式 PG + **真 migration 逐字 apply** + PostgREST + 前綴代理 + **真的 @supabase/supabase-js**。
#
# 🔴 它在回答哪一個問句:
#   問句 A(map 裡有沒有那三行)              ⇒ 單元測試已答(`manual-refund-repository.test.ts`)
#   問句 B(員工撞到軌別上限時 error.code 是什麼)⇒ 🔴 **本檔在答這一個**
#
# 🔴 而本檔要打掉的具體懷疑,是【讀出來的】那一格:
#   `admin_record_manual_refund` 把 INSERT 包在一個只有 `EXCEPTION WHEN unique_violation`
#   的子區塊裡(`20260823020000` 的最新一代,`:447` 附近)。**我開檔讀了它,判斷 PCM01 會傳出去** ——
#   而「讀出來的」與「量到的」是兩個宣稱。本檔用**同一個子區塊形狀**實際跑一遍。
#
# ⚠️ 射程(照實寫,不放寬):
#   · trigger 函式與 `CREATE TRIGGER` **逐字從 `20260824011000` 抽出來**,不是仿製
#   · 🔴 **而它委給的那支 cap 函式【是替身】**(關卡2 R2 nit 8):本檔的
#     `pcm_manual_refund_rail_cap` 吃自製的 `order_manual_payments`、**零 rail 條件**;
#     真的那支(`20260824010000`)吃 `order_payments WHERE rail IN ('bank_transfer','cash')`。
#     表也是替身。⇒ 📌 **逐字真跑的只有 guard 函式本身,而它把業務邏輯整個委給一個假的。**
#     ⇒ 🛑 **所以本檔【不是】在驗那道閘算得對不對,只在驗「它吐出來的 SQLSTATE 走不走得到 app」。**
#   · 而 RPC 是**同形狀的最小替身**(只保留「INSERT 包在 `EXCEPTION WHEN unique_violation` 子區塊裡」
#     這個承重形狀)—— **不是真的那支 RPC**,因為它的前置(員工表 / 訂單狀態機 / 通知)太深
#     ⇒ 🛑 **本檔證的是「那個子區塊形狀不會吞掉 PCM0x」,不是「真的那支 RPC 在正式庫上會怎樣」**
#   · 本機 PostgREST / PG,不是正式庫那台;版本印在輸出裡
set -u
export LC_ALL=C LANG=C
REPO=/Users/sean_1/pcm-wt-db
MIG="$REPO/supabase/migrations/20260824011000_m4b_866_manual_refund_rail_cap_enforce.sql"
D=/tmp/pcm01-transport-probe
PORT=5591; HPORT=5592; PPORT=5593
SEC="pcm01-transport-probe-throwaway-secret-at-least-32-chars"

for c in initdb pg_ctl psql postgrest python3 curl node lsof; do
  command -v "$c" >/dev/null || { echo "🔴 缺 $c ⇒ ENV-FAIL(不是紅)"; exit 2; }
done
for p in $PORT $HPORT $PPORT; do
  lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1 && { echo "🔴 埠 $p 被佔 ⇒ ENV-FAIL"; exit 2; }
done
[ "${1:-}" = "--fresh" ] && rm -rf "$D"
[ -e "$D" ] && { echo "🔴 $D 已存在 ⇒ ENV-FAIL。連跑兩發請帶 --fresh"; exit 2; }

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
[ "$PGCTL_RC" -eq 0 ] || { echo "🔴 pg_ctl start rc=$PGCTL_RC ⇒ ENV-FAIL"; tail -5 "$D/pg.log"; exit 2; }
sleep 3
# 🔴 身分驗證:rc=0 只答「我的 pg_ctl 沒失敗」,不答「psql 連到的是它」。
SEEN=$(psql -h 127.0.0.1 -p $PORT -U postgres -tAc "show data_directory" 2>/dev/null | tr -d '[[:space:]]')
WANT=$(cd "$D/data" && pwd -P); SEEN_REAL=$(cd "$SEEN" 2>/dev/null && pwd -P)
[ "$SEEN_REAL" = "$WANT" ] || { echo "🔴🔴 我連到的不是我起的那顆 PG ⇒ ENV-FAIL(絕不對它套 migration)"; exit 2; }
printf '身分驗證 ✅ %s\n' "$WANT"

for role in anon authenticated service_role; do
  psql -h 127.0.0.1 -p $PORT -U postgres -tAc "create role $role nologin" >/dev/null 2>&1
done
psql -h 127.0.0.1 -p $PORT -U postgres -tAc \
  "create role authenticator noinherit login; grant service_role to authenticator; grant anon to authenticator" >/dev/null 2>&1

# ── fixture:migration 讀得到的最小世界 ────────────────────────────────
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 > "$D/fx.log" 2>&1 <<'SQL'
create table public.orders (id uuid primary key default gen_random_uuid(), total bigint not null);
create table public.order_manual_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  rail text not null,
  refund_amount integer not null check (refund_amount > 0),
  request_id uuid not null,
  voided_at timestamptz,
  unique (order_id, request_id));
-- 軌別上限:現金/匯款收了多少 - 已退多少(未作廢)。最小形狀,夠讓 trigger 跑。
create table public.order_manual_payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  amount bigint not null);
-- 🔴 訂單總額那一層(步5 用)——【刻意比軌別那層寬】:它不管錢是用什麼方式收的。
create function public.probe_order_refundable_remaining(p_order_id uuid) returns bigint
  language sql stable as $$
  select o.total
       - coalesce((select sum(r.refund_amount) from public.order_manual_refunds r
                    where r.order_id = o.id and r.voided_at is null), 0)
    from public.orders o where o.id = p_order_id $$;
create function public.pcm_manual_refund_rail_cap(p_order_id uuid) returns bigint
  language sql stable as $$
  select coalesce((select sum(p.amount) from public.order_manual_payments p where p.order_id = p_order_id), 0)
       - coalesce((select sum(r.refund_amount) from public.order_manual_refunds r
                    where r.order_id = p_order_id and r.voided_at is null), 0) $$;
SQL
grep -qi "^ERROR" "$D/fx.log" && { echo "🔴 fixture 建不起來 ⇒ ENV-FAIL"; sed -n 1,4p "$D/fx.log"; exit 2; }

# ── 真 trigger:函式與 CREATE TRIGGER 逐字從 migration 抽 ──────────────
python3 - "$MIG" > "$D/trg.sql" <<'PY'
import io,re,sys
s=io.open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'CREATE FUNCTION public\.pcm_manual_refund_rail_cap_guard\(\).*?\$fn\$;', s, re.S)
t=re.search(r'CREATE TRIGGER trg_pcm_manual_refund_rail_cap.*?;', s, re.S)
assert m and t, '抽不到 ⇒ 本發作廢'
sys.stdout.write(m.group(0)+'\n'+t.group(0)+'\n')
PY
[ -s "$D/trg.sql" ] || { echo "🔴 抽不到 trigger ⇒ ENV-FAIL"; exit 2; }
# 🔴🔴 **這一道原本恆綠**(關卡2 R2 must-fix 5):`psql -f` 的錯誤前綴是
#    `psql:<檔>:<行>: ERROR:` ⇒ `grep -qi "^ERROR"` **永遠不命中**
#    (heredoc 那兩處沒有前綴,所以那兩處的 `^ERROR` 是好的 —— **同一個寫法,兩種行為**)。
#    ⇒ trigger 裝不上時它會印「逐字裝上 ✅」,然後 railOver 變 bad
#    ⇒ 📌 **一個 harness 故障會被報成「你讀出來的判斷被推翻了」** —— 最貴的誤報形狀。
#    ✅ 改成收 rc(`ON_ERROR_STOP=1` ⇒ 失敗回 3),不靠字面。
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$D/trg.sql" > "$D/trg.log" 2>&1 ; TRG_RC=$?
[ "$TRG_RC" -eq 0 ] || { echo "🔴 真 trigger 裝不上(psql rc=$TRG_RC)⇒ ENV-FAIL"; sed -n 1,4p "$D/trg.log"; exit 2; }
echo "真 trigger 逐字裝上 ✅"

# ── RPC 替身:只保留「INSERT 包在 EXCEPTION WHEN unique_violation 子區塊」這個形狀 ──
psql -h 127.0.0.1 -p $PORT -U postgres -q -v ON_ERROR_STOP=1 > "$D/rpc.log" 2>&1 <<'SQL'
-- 🔴🔴 **第二版(codex 關卡2 MF2 / MF3)。第一版少了兩段,而那兩段【各自推翻我一個結論】:**
--   MF2:真 RPC 在 INSERT **之前**有一道【訂單總額】可退餘額檢查(`20260823020000:435-442`,
--       `IF p_refund_amount > v_remaining THEN RAISE`,普通 RAISE ⇒ P0001)。
--       ⇒ 我第一版餵 9999 ⇒ **在真路徑上它會先被那道擋成 P0001,根本到不了 trigger**
--       ⇒ 📌 **那一發量到的 PCM01 是【替身自己造出來的】,不是員工走得到的那條路。**
--   ✅ 而 PCM01 **仍然可達** —— 因為 `#866` 管的是【現金/匯款】那一軌,比訂單總額窄:
--       訂單 1000(現金收 300 + 卡片 700)⇒ 訂單餘額 1000、軌別餘裕 300
--       ⇒ 退 500:過得了步5(500 ≤ 1000),而 500 > 300 ⇒ **trigger 吐 PCM01**。
--       ⇒ 🔴 **這才是真員工撞得到的那一格:訂單還有錢可退,而【現金那一軌】沒有。**
--   MF3:真 RPC 在 INSERT 之前有一段**冪等 SELECT**(`:393-403`)⇒ 循序重送走那一格回 idempotent,
--       **不會碰到 unique_violation handler**(該 handler 自標「backstop,不是主要路徑」)。
--       ⇒ 我第一版的 `dup` 走的是 handler ⇒ 它證的是【替身的 handler 活著】,不是真路徑。
create function public.probe_record(p_order_id uuid, p_amount integer, p_request uuid)
  returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v uuid; v_remaining bigint; v_existing record;
begin
  -- 🔴🔴 **順序:冪等 SELECT 在【前】、可退餘額檢查在【後】**(關卡2 R2 must-fix 6 —— 我第一版放反了)。
  --    而那個順序是**承重的**,不是風格:`20260823020000:389-391` 逐字寫著
  --    「冪等若排在額度守門【之後】,**完全相同的重試會被誤擋**:total 500、第一發退 500 ⇒ 剩餘 0
  --      ⇒ 相同重試撞『超過可退餘額 0』⇒ **一個誤導的訊息:它說錢不夠,而其實是同一次請求。**」
  --    ⇒ 📌 我第一版的 `dup` 之所以綠,只是因為餘額還很寬 —— **它綠得沒有道理。**
  -- 步4.5 冪等 SELECT:循序重送走這裡,不碰下面的 handler
  select r.id, r.refund_amount into v_existing
    from public.order_manual_refunds r
   where r.order_id = p_order_id and r.request_id = p_request;
  if found then
    if v_existing.refund_amount is not distinct from p_amount then
      return jsonb_build_object('recorded', true, 'idempotent', true, 'refund_id', v_existing.id);
    end if;
    raise exception 'probe_record: 同一個 request_id 帶了不同的內容';
  end if;
  -- 步5 訂單總額可退餘額(比軌別上限【寬】)—— 普通 RAISE ⇒ P0001
  v_remaining := public.probe_order_refundable_remaining(p_order_id);
  if p_amount > v_remaining then
    raise exception 'probe_record: 退款金額 % 超過可退餘額 %', p_amount, v_remaining;
  end if;
  begin
    insert into public.order_manual_refunds(order_id, rail, refund_amount, request_id)
    values (p_order_id, 'cash', p_amount, p_request) returning id into v;
  exception when unique_violation then
    -- backstop:只有並行撞鍵才走得到
    return jsonb_build_object('recorded', true, 'idempotent', true, 'refund_id', null);
  end;
  return jsonb_build_object('recorded', true, 'idempotent', false, 'refund_id', v);
end $$;
grant execute on function public.probe_order_refundable_remaining(uuid) to service_role;
grant usage on schema public to service_role;
grant execute on function public.probe_record(uuid,integer,uuid) to service_role;
SQL
grep -qi "^ERROR" "$D/rpc.log" && { echo "🔴 RPC 替身建不起來 ⇒ ENV-FAIL"; sed -n 1,4p "$D/rpc.log"; exit 2; }

OID=$(psql -h 127.0.0.1 -p $PORT -U postgres -tAc "insert into public.orders(total) values (1000) returning id" | head -1 | tr -d '[[:space:]]')
# 🔴 檢查要在【用它之前】(關卡2 R2 nit 13):我第一版先拿 $OID 去 INSERT 才檢查,
#    而那一發的錯誤被 `2>/dev/null` 吃掉 ⇒ 空字串會靜靜地跑過去一行。
[ -n "$OID" ] || { echo "🔴 建不出訂單 ⇒ ENV-FAIL"; exit 2; }
psql -h 127.0.0.1 -p $PORT -U postgres -q -c "insert into public.order_manual_payments(order_id, amount) values ('$OID', 300)" >/dev/null 2>&1

# ── PostgREST + 前綴代理 ───────────────────────────────────────────────
cat > "$D/prest.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PORT/postgres"
db-schemas = "public"
db-anon-role = "anon"
server-port = $HPORT
jwt-secret = "$SEC"
CONF
nohup postgrest "$D/prest.conf" > "$D/prest.log" 2>&1 & echo $! > "$D/prest.pid"
python3 - "$SEC" > "$D/jwt.txt" <<'PY'
import base64,hashlib,hmac,json,sys
def b(x): return base64.urlsafe_b64encode(x).rstrip(b'=')
sec=sys.argv[1].encode()
h=b(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
p=b(json.dumps({"role":"service_role","exp":4102444800},separators=(',',':')).encode())
print((h+b'.'+p+b'.'+b(hmac.new(sec,h+b'.'+p,hashlib.sha256).digest())).decode())
PY
JWT=$(head -1 "$D/jwt.txt")
nohup python3 "$REPO/scripts/admin-probe/proxy.py" "$HPORT" "$PPORT" > "$D/proxy.log" 2>&1 & echo $! > "$D/proxy.pid"
# 🔴 就緒判準 = 一發真的 RPC 回得出東西,不是「埠開了」
READY=no
for i in $(seq 1 60); do
  R=$(curl -s -X POST "http://127.0.0.1:$PPORT/rest/v1/rpc/probe_record" \
    -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
    -d "{\"p_order_id\":\"$OID\",\"p_amount\":1,\"p_request\":\"00000000-0000-4000-8000-000000000001\"}" 2>/dev/null | tr -d '\n')
  case "$R" in *recorded*) READY=yes; break ;; esac
  perl -e 'select undef,undef,undef,0.25'
done
[ "$READY" = yes ] || { echo "🔴 60 次仍未就緒 ⇒ ENV-FAIL"; tail -5 "$D/prest.log"; tail -5 "$D/proxy.log"; exit 2; }
printf 'PostgREST %s · PG %s\n' "$(postgrest --version 2>&1|head -1)" "$(psql -h 127.0.0.1 -p $PORT -U postgres -tAc 'show server_version')"

# ── 用【真的】 supabase-js 打 ──────────────────────────────────────────
cat > "$D/sb.mjs" <<'JS'
const [url, key, orderId, pkg] = process.argv.slice(2);
const { createClient } = await import(pkg);
const sb = createClient(url, key, { auth: { persistSession: false } });
const call = async (amount, req) => {
  const { error } = await sb.rpc('probe_record', { p_order_id: orderId, p_amount: amount, p_request: req });
  return error ? { code: String(error.code), msg: String(error.message ?? '').slice(0, 40) } : 'NO_ERROR';
};
const out = {};
// 🔴 訂單 total 1000、現金收 300。⚠️ 而上面的**就緒判準那一發已經真的登記了 1 元**
//    ⇒ 走到這裡時軌別餘裕是 **299** 不是 300(關卡2 R2 nit 14)。四格結論不受影響,
//    但「那個數字是多少」要寫當下的值,不是設計時的值。
// 退 500:過得了【訂單總額】那一層(500 ≤ 1000),而超過【現金那一軌】(500 > 300) ⇒ PCM01
out.railOver = await call(500, '00000000-0000-4000-8000-000000000011');
// 🔵 正對照一:退 2000 ⇒ 連【訂單總額】那一層都過不了 ⇒ P0001(不是 PCM01)
//    ⇒ 它證明步5 那一層【真的在擋】—— 少了它,上面那格的 PCM01 可能只是因為步5 沒接上
out.orderOver = await call(2000, '00000000-0000-4000-8000-000000000013');
out.okpath   = await call(100,  '00000000-0000-4000-8000-000000000012'); // 兩層都過
out.dup      = await call(100,  '00000000-0000-4000-8000-000000000012'); // 循序重送 ⇒ 走冪等格
console.log(JSON.stringify(out));
JS
SBPKG=$(cd "$REPO" && node -e "console.log(require.resolve('@supabase/supabase-js'))" 2>/dev/null)
SBVER=$(cd "$REPO" && node -e "console.log(require('@supabase/supabase-js/package.json').version)" 2>/dev/null)
printf '@supabase/supabase-js %s\n' "${SBVER:-未解析}"
SB=$(cd "$REPO" && node "$D/sb.mjs" "http://127.0.0.1:$PPORT" "$JWT" "$OID" "$SBPKG" 2>"$D/sb.err" | tr -d '\n')
[ -n "$SB" ] || { bad "supabase-js 跑不起來 ⇒ 本發【作廢, 不是綠】:$(head -2 "$D/sb.err")"; printf '\n══ PASS=%d FAIL=%d ══\n' "$PASS" "$FAIL"; exit 1; }
printf '實得 %s\n' "$SB"

case "$SB" in *'"railOver":{"code":"PCM01"'*)
  ok "🔴 過得了【訂單總額】那一層、而超過【現金那一軌】⇒ PCM01 到達 supabase-js 的 error.code" ;;
  *) bad "期望 railOver.code=PCM01 ⇒ 讀出來的那個判斷【被推翻了】" ;;
esac
case "$SB" in *'"orderOver":{"code":"P0001"'*)
  ok "🔵 正對照一:超過【訂單總額】⇒ P0001(不是 PCM01)⇒ 步5 那一層真的在擋,兩層分得開" ;;
  *) bad "正對照一:超過訂單總額竟不是 P0001 ⇒ 步5 沒接上 ⇒ 上面那格的 PCM01 不算數" ;;
esac
case "$SB" in *'"okpath":"NO_ERROR"'*)
  ok "負對照:兩層都過的正常路徑 error 是 null ⇒ 不是【對任何呼叫都吐錯】" ;;
  *) bad "負對照:正常路徑竟有 error" ;;
esac
case "$SB" in *'"dup":"NO_ERROR"'*)
  ok "🔵 正對照二:循序重送走【冪等格】而不是 handler ⇒ 與真 RPC 同形狀(handler 是 backstop)" ;;
  *) bad "循序重送沒有走冪等格 ⇒ 這個替身與真 RPC 的形狀對不上" ;;
esac

EXPECT_PASS=4
printf '\n══ PASS=%d FAIL=%d(期望 PASS=%d)══\n' "$PASS" "$FAIL" "$EXPECT_PASS"
[ "$PASS" -ne "$EXPECT_PASS" ] && printf '🔴 少跑了:期望 %d 格 ✅ 實得 %d ⇒ **這一發不算數**\n' "$EXPECT_PASS" "$PASS"
[ "$FAIL" -eq 0 ] && [ "$PASS" -eq "$EXPECT_PASS" ]
