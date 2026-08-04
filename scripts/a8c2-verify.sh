#!/usr/bin/env bash
# ============================================================
# A8c2 驗證 harness:confirm_order_payment 金流 confirm 側取消守門
# ============================================================
# plan = docs/specs/2026-08-04-e10-a8c2-confirm-cancel-guard-plan.md(v3)§5
# 用法:provision(d1t2 家族 54331 副本)後 scripts/a8c2-verify.sh /tmp/a8c-work
# 形狀=a8c1-verify.sh 全套慣例(身分閘/黃金差分/COMMENT md5 pin/前置閘負向格/剝殼格/
# preflight/九表零留痕/計數閘/committed 例外各自清理)。
# vector 21 格=P1-P7 + C1,C2,C3,C4a,C4b,C5,C6,C7,C7b,C8,C9a,C9b,C9c,PC1;
# 非 vector=P7b/C2b/E2′/L2′/前置閘負向/剝殼(M 期間跳過)。突變 M1,M2,M3,M4,M5,M6,M8。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/a8c-work}"
PORT="${A8C2_VERIFY_PORT:-54331}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C
MIGFILE="supabase/migrations/20260804150000_m4b_e10_a8c2_confirm_cancel_guard.sql"
MIGBASE="supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql"
MD5_BASE="8eeb4274cbaede45a34818657ead7537"
MD5_NEW="6423848f965176c8a0c02917b8be9f52"
MD5_BEGIN_A8C1="f621a56231e20f7f0b2618b40ac1276d"
CMT_MD5_NEW="18460324e48bb3642bbfb69260e071d4"
GENERIC="confirm_order_payment: 付款確認失敗"
CONFIRM_SIG="public.confirm_order_payment(uuid,integer,text)"

PASS=0; FAIL=0
EXPECTED_TOTAL=32
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q() { psql "$URL" -qtAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘 ─────────────────────────────────────────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 缺 marker;拒跑"; exit 1; }
test -f "$MIGFILE" || { echo "🔴 $MIGFILE 不存在;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 datadir=$DATADIR;拒跑"; exit 1;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 db 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;拒跑"; exit 1; }
[ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  || { echo "🔴 confirm 非 A8c2 新版;先套本片;拒跑"; exit 1; }
[ "$(q "SELECT md5(pg_get_functiondef('public.begin_charge_attempt(uuid)'::regprocedure))")" = "$MD5_BEGIN_A8C1" ] \
  || { echo "🔴 begin 非 A8c1 新版(部署鏈);拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id LIKE 'PCM-998%'")" = "0" ] \
  || { echo "🔴 殘留 PCM-998* fixture;拒跑"; exit 1; }
ok "身分閘七重(含 confirm=A8c2、begin=A8c1 部署鏈、零殘留)"

CUST="$(q "SELECT user_id FROM public.customers ORDER BY user_id LIMIT 1")"
[ -n "$CUST" ] || { echo "🔴 customers 空"; exit 1; }

NINE="orders order_items payment_charge_attempts order_cancellations order_cancellation_items order_item_quantity_summary payment_double_charge_anomalies staff customers"
snap9() {
  local t n
  for t in $NINE; do
    n="$(q "SELECT count(*) FROM public.$t")"
    case "$n" in ''|*[!0-9]*) echo "🔴 snap9:$t 非數值($n)" >&2; exit 1;; esac
    printf '%s=%s ' "$t" "$n"
  done
}
BASE9="$(snap9)" || { echo "🔴 snap9 基線失敗"; exit 1; }

# ── §5.3 差分 oracle ────────────────────────────────────
[ "$(grep -c 'CREATE OR REPLACE FUNCTION public.confirm_order_payment' "$MIGFILE")" = "1" ] \
  && ok "migration 檔內 confirm 定義恰 1 次" || bad "定義次數異常"
awk '/^CREATE OR REPLACE FUNCTION public.confirm_order_payment\(/,/^\$fn\$;$/' "$MIGBASE" > "$WORK/confirm-base.sql"
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/confirm-base.sql" >/dev/null 2>&1 || { bad "回基底失敗"; exit 1; }
[ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_BASE" ] \
  && ok "基線=基底(md5)" || { bad "基線非基底"; exit 1; }
q "SELECT pg_get_functiondef('$CONFIRM_SIG'::regprocedure)" > "$WORK/cf-A.txt"
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" >/dev/null 2>&1 \
  && ok "migration 重放成功(含前置閘兩支)" || { bad "重放失敗"; exit 1; }
q "SELECT pg_get_functiondef('$CONFIRM_SIG'::regprocedure)" > "$WORK/cf-B.txt"
[ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "重放後 md5=新版封條" || bad "md5 不符"
diff -u "$WORK/cf-A.txt" "$WORK/cf-B.txt" | tail -n +3 > "$WORK/cf-actual.diff"
cat > "$WORK/cf-golden.diff" <<'GOLDEN'
@@ -9,13 +9,19 @@
   v_n           integer;
   v_generic_msg constant text := 'confirm_order_payment: 付款確認失敗';  -- 🔴 PF-E:業務拒絕單一通用訊息、不洩內部狀態
 BEGIN
+  -- 🔴 A8c2 隔離閘(fail-closed;A8c1 同款、A2b1 教訓):非 READ COMMITTED 下 FOR UPDATE 等鎖
+  --    醒來後快照仍舊、部分取消不動 orders 列 ⇒ EXISTS 看不到已 commit 取消。
+  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
+    RAISE EXCEPTION 'confirm_order_payment: isolation guard' USING ERRCODE = 'P8C01';
+  END IF;
+
   -- ── 輸入驗:rec_trade_id 非空(server 自供參數、非訂單內部狀態 → 可具體)──
   IF p_rec_trade_id IS NULL OR pg_catalog.btrim(p_rec_trade_id) = '' THEN
     RAISE EXCEPTION 'confirm_order_payment: 交易識別碼缺失';
   END IF;
 
   -- ── PF-B:FOR UPDATE 鎖臨界區 ──
-  SELECT id, total, payment_status, tappay_rec_trade_id
+  SELECT id, total, payment_status, tappay_rec_trade_id, cancelled_at
     INTO v_order
     FROM public.orders
    WHERE id = p_order_id
@@ -26,6 +32,14 @@
     RAISE EXCEPTION '%', v_generic_msg;
   END IF;
 
+  -- 🔴 A8c2 取消守門(master plan row 35;R8 守門先於取消):存在任何取消紀錄 ⇒ 拒確認。
+  --    位置=paid 冪等樹之前:已取消且已 paid 的同 rec 同額重放不得回 idempotent 成功。
+  --    真相=orders.cancelled_at + order_cancellations 本表(A1 契約);通用訊息=PF-E。
+  IF v_order.cancelled_at IS NOT NULL
+     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
+    RAISE EXCEPTION '%', v_generic_msg;
+  END IF;
+
   -- ── PF-D(3):paid 且 rec_trade_id+amount 雙等 → no-op 冪等成功(真 RETURN、不 UPDATE、不刷時間戳)──
   IF v_order.payment_status = 'paid'::public.payment_status THEN
     IF v_order.tappay_rec_trade_id IS NOT DISTINCT FROM p_rec_trade_id
GOLDEN
if diff -q "$WORK/cf-actual.diff" "$WORK/cf-golden.diff" >/dev/null; then
  ok "庫內物件差分=黃金 diff(byte-exact)"
else
  bad "差分與黃金不符:"; diff "$WORK/cf-golden.diff" "$WORK/cf-actual.diff" | head -15
fi
[ "$(q "SELECT md5(obj_description('$CONFIRM_SIG'::regprocedure,'pg_proc'))")" = "$CMT_MD5_NEW" ] \
  && ok "COMMENT=新字面(md5 pin)" || bad "COMMENT md5 不符"

# ── 前置閘負向格(confirm 漂移 ⇒ migration RAISE)──────────────
q "SELECT pg_get_functiondef('$CONFIRM_SIG'::regprocedure)" > "$WORK/cf-cur.txt"
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/confirm-base.sql" >/dev/null 2>&1
q "SELECT pg_get_functiondef('$CONFIRM_SIG'::regprocedure)" > "$WORK/cf-basecur.txt"
python3 - "$WORK/cf-basecur.txt" "$WORK/cf-drift.sql" <<'PYNEG'
import sys
s=open(sys.argv[1]).read()
a="BEGIN\n"
assert s.count(a)>=1
open(sys.argv[2],'w').write(s.replace(a,"BEGIN\n  -- md5gate-negative probe\n",1))
PYNEG
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/cf-drift.sql" >/dev/null 2>&1
NEGOUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"; NEGRC=$?
if [ "$NEGRC" -ne 0 ] && printf '%s' "$NEGOUT" | grep -q 'confirm_order_payment 現定義非基底'; then
  ok "前置閘負向格:confirm 漂移 ⇒ migration RAISE 拒跑"
else bad "前置閘負向格 rc=$NEGRC"; fi
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/confirm-base.sql" >/dev/null 2>&1
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" >/dev/null 2>&1
[ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "負向格還原(confirm=新版)" || bad "負向格還原失敗"

# ── 剝殼模擬格 ───────────────────────────────────────
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/confirm-base.sql" >/dev/null 2>&1
grep -vE "^BEGIN;$|^COMMIT;$" "$MIGFILE" > "$WORK/a8c2-stripped.sql"
STRIPOUT="$( (echo "BEGIN;"; cat "$WORK/a8c2-stripped.sql"; echo "ROLLBACK;") | psql "$URL" -v ON_ERROR_STOP=1 -qtAX 2>&1)"
STRIPRC=$?
MD5AFTER="$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")"
[ "$STRIPRC" -eq 0 ] && [ "$MD5AFTER" = "$MD5_BASE" ] \
  && ok "剝殼模擬:單交易通過、ROLLBACK 零留痕" \
  || { bad "剝殼模擬 rc=$STRIPRC md5=$MD5AFTER — $(printf '%s' "$STRIPOUT" | grep -m1 ERROR | cut -c1-120)"; }
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" >/dev/null 2>&1
[ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "剝殼格還原" || bad "剝殼格還原失敗"

# ── fixtures/helpers ─────────────────────────────────
echo 0 > "$WORK/.a8c2cnt"
next_disp() {
  local n; n="$(cat "$WORK/.a8c2cnt")"; n=$((n+1)); echo "$n" > "$WORK/.a8c2cnt"
  printf 'PCM-9989-%04d' "$n"
}
FIX_ORDER="INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
VALUES (:'disp', :'cust', jsonb_build_object('name','a8c2','phone','0900000000','line','x'),
  'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid())
RETURNING id"

cell_intx() {
  local label="$1" body="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -v cust="$CUST" -qtAX <<SQL 2>&1
BEGIN;
$body
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ] && printf '%s' "$out" | grep -q 'CELLOK'; then return 0
  else CELL_ERR="$(printf '%s' "$out" | grep -m1 -E 'ERROR|CELLFAIL' | cut -c1-160)"; return 1; fi
}

# 期望通用 RAISE:呼 confirm(:'a8c2.oid' 由格內 set_config)
EXPECT_RAISE="DO \$c\$
DECLARE v jsonb;
BEGIN
  BEGIN
    v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, current_setting('a8c2.rec'));
    RAISE EXCEPTION 'CELLFAIL 未 RAISE(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'confirm_order_payment: 付款確認失敗' THEN RAISE NOTICE 'CELLOK';
    ELSE RAISE; END IF;
  END;
END \$c\$;"

wait_blocked_by() {
  local i=0
  while [ $i -lt $((10*$3)) ]; do
    local n
    n="$(q "SELECT count(*) FROM pg_stat_activity w JOIN LATERAL unnest(pg_blocking_pids(w.pid)) b(bp) ON true
            JOIN pg_stat_activity h ON h.pid=b.bp
            WHERE w.application_name='$1' AND h.application_name='$2'")"
    [ "$n" -ge 1 ] 2>/dev/null && return 0
    sleep 0.1; i=$((i+1))
  done
  return 1
}

CLEANUP_FAIL=0
cleanup_disp() {
  local d out
  for d in "$@"; do
    out="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX <<SQL 2>&1
DO \$x\$
DECLARE v_o uuid;
BEGIN
  SELECT id INTO v_o FROM public.orders WHERE display_id='$d';
  IF v_o IS NULL THEN RETURN; END IF;
  DELETE FROM public.order_cancellation_items WHERE order_id=v_o;
  DELETE FROM public.order_cancellations WHERE order_id=v_o;
  DELETE FROM public.payment_double_charge_anomalies WHERE old_order_id=v_o;
  DELETE FROM public.payment_charge_attempts WHERE order_id=v_o;
  DELETE FROM public.order_item_quantity_summary s USING public.order_items i WHERE s.order_item_id=i.id AND i.order_id=v_o;
  DELETE FROM public.order_items WHERE order_id=v_o;
  DELETE FROM public.orders WHERE id=v_o;
END \$x\$;
SQL
)"
    if [ $? -ne 0 ]; then CLEANUP_FAIL=1; echo "  🔴 cleanup($d):$(printf '%s' "$out" | grep -m1 ERROR | cut -c1-120)"; fi
    [ "$(q "SELECT count(*) FROM public.orders WHERE display_id='$d'")" = "0" ] \
      || { CLEANUP_FAIL=1; echo "  🔴 cleanup($d):order 仍在"; }
  done
}

mkord_committed() {
  psql "$URL" -v ON_ERROR_STOP=1 -qtAX <<SQL
INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
VALUES ('$1', '$CUST', jsonb_build_object('name','a8c2','phone','0900000000','line','x'),
  'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid())
RETURNING id;
SQL
}

# ── vector 21 格 ─────────────────────────────────────
cell_P() {  # $1=1..6(P7 走獨立 cell_P7)
  local s="$1" frag=""
  case "$s" in
    1) frag="DO \$c\$ DECLARE v jsonb; o record; BEGIN
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, 'RECP1' || current_setting('a8c2.disp'));
  SELECT payment_status::text AS ps, tappay_rec_trade_id, paid_at, payment_method INTO o
    FROM public.orders WHERE id=current_setting('a8c2.oid')::uuid;
  IF (v->>'confirmed')::boolean AND NOT (v->>'idempotent')::boolean
     AND o.ps='paid' AND o.tappay_rec_trade_id='RECP1' || current_setting('a8c2.disp')
     AND o.paid_at IS NOT NULL AND o.payment_method='tappay'
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL % %', v, o; END IF; END \$c\$;" ;;
    2) frag="DO \$c\$ DECLARE v jsonb; c1 tid; c2 tid; BEGIN
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, 'RECP2' || current_setting('a8c2.disp'));
  SELECT ctid INTO c1 FROM public.orders WHERE id=current_setting('a8c2.oid')::uuid;
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, 'RECP2' || current_setting('a8c2.disp'));
  SELECT ctid INTO c2 FROM public.orders WHERE id=current_setting('a8c2.oid')::uuid;
  IF (v->>'confirmed')::boolean AND (v->>'idempotent')::boolean AND c1 = c2
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL %(重放不得產生新 tuple 版本 c1=% c2=%)', v, c1, c2; END IF; END \$c\$;" ;;
    3) frag="DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, 'RECP3' || current_setting('a8c2.disp'));
  BEGIN
    v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, 'RECP3X' || current_setting('a8c2.disp'));
    RAISE EXCEPTION 'CELLFAIL 異 rec 未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'confirm_order_payment: 付款確認失敗' THEN RAISE NOTICE 'CELLOK'; ELSE RAISE; END IF;
  END; END \$c\$;" ;;
    4) frag="UPDATE public.orders SET payment_status='refunded' WHERE id=:'o_id';
SELECT set_config('a8c2.rec', 'RECP4' || :'disp', true);
$EXPECT_RAISE" ;;
    5) frag="DO \$c\$ DECLARE v jsonb; BEGIN
  BEGIN
    v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 99, 'RECP5' || current_setting('a8c2.disp'));
    RAISE EXCEPTION 'CELLFAIL 額不符未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'confirm_order_payment: 付款確認失敗' THEN RAISE; END IF;
  END;
  BEGIN
    v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, NULL, 'RECP5N' || current_setting('a8c2.disp'));
    RAISE EXCEPTION 'CELLFAIL NULL 額未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'confirm_order_payment: 付款確認失敗' THEN RAISE NOTICE 'CELLOK'; ELSE RAISE; END IF;
  END; END \$c\$;" ;;
    6) frag="DO \$c\$ DECLARE v jsonb; BEGIN
  BEGIN
    v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, NULL);
    RAISE EXCEPTION 'CELLFAIL NULL rec 未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'confirm_order_payment: 交易識別碼缺失' THEN RAISE; END IF;
  END;
  BEGIN
    v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, '   ');
    RAISE EXCEPTION 'CELLFAIL 空白 rec 未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'confirm_order_payment: 交易識別碼缺失' THEN RAISE NOTICE 'CELLOK'; ELSE RAISE; END IF;
  END; END \$c\$;" ;;
  esac
  local D="$(next_disp)"
  cell_intx "P$s" "
\\set disp $D
SELECT set_config('a8c2.disp', :'disp', true);
$FIX_ORDER \\gset o_
SELECT set_config('a8c2.oid', (:'o_id')::text, true);
$frag
"
}

# P7(獨立實作;cell_P 只承 1-6)
cell_P7() {
  local D="$(next_disp)" D2="$(next_disp)"
  cell_intx P7 "
\\set disp $D
SELECT set_config('a8c2.disp', :'disp', true);
$FIX_ORDER \\gset o_
SELECT set_config('a8c2.oid', (:'o_id')::text, true);
DO \$p\$ DECLARE v jsonb; BEGIN
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, 'RECP7' || current_setting('a8c2.disp'));
END \$p\$;
\\set disp $D2
$FIX_ORDER \\gset t_
DO \$c\$ DECLARE v jsonb; BEGIN
  BEGIN
    v := public.confirm_order_payment((SELECT id FROM public.orders WHERE display_id='$D2'), 100, 'RECP7' || current_setting('a8c2.disp'));
    RAISE EXCEPTION 'CELLFAIL 跨單 rec 重用未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'confirm_order_payment: 付款確認失敗' THEN RAISE NOTICE 'CELLOK'; ELSE RAISE; END IF;
  END; END \$c\$;
"
}

_fix_and_oid="SELECT set_config('a8c2.disp', :'disp', true);
$FIX_ORDER \\gset o_
SELECT set_config('a8c2.oid', (:'o_id')::text, true);
SELECT set_config('a8c2.rec', 'RECG' || :'disp', true);"

cell_C1() { local D="$(next_disp)"; cell_intx C1 "
\\set disp $D
$_fix_and_oid
UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id=:'o_id';
$EXPECT_RAISE"; }

_c2_common() { echo "
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES (:'o_id', 'A8C2-' || :'disp', jsonb_build_object('title','a8c2','sku','A8C2','spec',jsonb_build_object()), 2, 0, 0)
RETURNING id \\gset i_
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES (:'o_id', 'sean', gen_random_uuid(), 'customer_request', encode(sha256((:'disp')::bytea),'hex'))
RETURNING id \\gset h_"; }

cell_C2() { local D="$(next_disp)"; cell_intx C2 "
\\set disp $D
$_fix_and_oid
$(_c2_common)
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES (:'h_id', :'o_id', :'i_id', 1);
$EXPECT_RAISE"; }

cell_C2b() { local D="$(next_disp)"; cell_intx C2b "
\\set disp $D
$_fix_and_oid
$(_c2_common)
$EXPECT_RAISE"; }

cell_C3() { local D="$(next_disp)"; cell_intx C3 "
\\set disp $D
$_fix_and_oid
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, current_setting('a8c2.rec'));
  IF (v->>'confirmed')::boolean THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF;
END \$c\$;"; }

cell_C4() {  # $1=a|b
  local mode="$1" D O RC extra="" APPC="a8c2_c4c_$RANDOM$$" APPB="a8c2_c4b_$RANDOM$$"
  D="$(next_disp)"; O="$(mkord_committed "$D")"
  q "INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
     VALUES ('$O', 'A8C2C4-$D', jsonb_build_object('title','a8c2','sku','A8C2','spec',jsonb_build_object()), 2, 0, 0)" >/dev/null
  [ "$mode" = "a" ] && extra="UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id='$O';"
  psql "$URL?application_name=$APPC" -v ON_ERROR_STOP=1 -qtAX <<SQL >/dev/null 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O' FOR UPDATE;
$extra
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES ('$O', 'sean', gen_random_uuid(), 'customer_request', encode(sha256(('c4$mode-$D')::bytea),'hex'));
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT c.id, '$O', i.id, 1 FROM public.order_cancellations c, public.order_items i
 WHERE c.order_id='$O' AND i.order_id='$O' LIMIT 1;
SELECT pg_sleep(3);
COMMIT;
SQL
  local APID=$!
  sleep 0.5
  psql "$URL?application_name=$APPB" -v ON_ERROR_STOP=1 -tAX \
    -c "SELECT public.confirm_order_payment('$O', 100, 'RECC4$mode$D')" > "$WORK/c4$mode.out" 2>&1 &
  local BPID=$!
  local BARRIER=1
  wait_blocked_by "$APPB" "$APPC" 3 && BARRIER=0
  wait $BPID; RC=$?
  wait $APID
  local PS RES=1
  PS="$(q "SELECT payment_status FROM public.orders WHERE id='$O'")"
  if [ "$BARRIER" -eq 0 ] && [ "$RC" -ne 0 ] && grep -q "$GENERIC" "$WORK/c4$mode.out" && [ "$PS" = "unpaid" ]; then RES=0
  else CELL_ERR="C4$mode barrier=$BARRIER rc=$RC ps=$PS"; fi
  cleanup_disp "$D"
  return $RES
}

cell_C5() {
  local D O APPB="a8c2_c5b_$RANDOM$$" APPC="a8c2_c5c_$RANDOM$$"
  D="$(next_disp)"; O="$(mkord_committed "$D")"
  psql "$URL?application_name=$APPB" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/c5a.out" 2>&1 &
BEGIN;
SELECT public.confirm_order_payment('$O', 100, 'RECC5$D');
SELECT pg_sleep(3);
COMMIT;
SQL
  local XPID=$!
  sleep 0.5
  psql "$URL?application_name=$APPC" -v ON_ERROR_STOP=1 -tAX <<SQL > "$WORK/c5b.out" 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O' FOR UPDATE;
SELECT CASE WHEN (SELECT payment_status FROM public.orders WHERE id='$O') <> 'unpaid'
       THEN 'ALLOWEDSET_REJECT' ELSE 'ALLOWEDSET_PASS' END;
ROLLBACK;
SQL
  local YPID=$!
  local BARRIER=1
  wait_blocked_by "$APPC" "$APPB" 3 && BARRIER=0
  wait $YPID; wait $XPID
  local C5DL RES=1
  C5DL="$(grep -c 'deadlock detected' "$WORK/c5a.out" "$WORK/c5b.out" | awk -F: '{t+=$2} END{print t}')"
  if [ "$BARRIER" -eq 0 ] && [ "$C5DL" = "0" ] && grep -q 'confirmed.*true' "$WORK/c5a.out" && grep -q 'ALLOWEDSET_REJECT' "$WORK/c5b.out"; then RES=0
  else CELL_ERR="C5 barrier=$BARRIER dl=$C5DL"; fi
  cleanup_disp "$D"
  return $RES
}

cell_C6() { local D="$(next_disp)" D2="$(next_disp)"; cell_intx C6 "
\\set disp $D
SELECT set_config('a8c2.disp', :'disp', true);
$FIX_ORDER \\gset x_
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES (:'x_id', 'A8C2C6-' || :'disp', jsonb_build_object('title','a8c2','sku','A8C2','spec',jsonb_build_object()), 1, 0, 0)
RETURNING id \\gset xi_
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES (:'x_id', 'sean', gen_random_uuid(), 'customer_request', encode(sha256((:'disp' || '6')::bytea),'hex'))
RETURNING id \\gset xh_
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES (:'xh_id', :'x_id', :'xi_id', 1);
\\set disp $D2
SELECT set_config('a8c2.disp', :'disp', true);
$FIX_ORDER \\gset o_
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.confirm_order_payment((SELECT id FROM public.orders WHERE display_id='$D2'), 100, 'RECC6$D2');
  IF (v->>'confirmed')::boolean THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL 他單取消誤傷 %', v; END IF;
END \$c\$;"; }

cell_C7() { local D="$(next_disp)"; cell_intx C7 "
\\set disp $D
$_fix_and_oid
DO \$p\$ DECLARE v jsonb; BEGIN
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, current_setting('a8c2.rec'));
END \$p\$;
UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id=:'o_id';
$EXPECT_RAISE"; }

cell_C7b() { local D="$(next_disp)"; cell_intx C7b "
\\set disp $D
$_fix_and_oid
DO \$p\$ DECLARE v jsonb; BEGIN
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, current_setting('a8c2.rec'));
END \$p\$;
$(_c2_common)
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
VALUES (:'h_id', :'o_id', :'i_id', 1);
$EXPECT_RAISE"; }

cell_C8() { local D="$(next_disp)"; cell_intx C8 "
\\set disp $D
$_fix_and_oid
SAVEPOINT sp_cancel;
UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id=:'o_id';
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES (:'o_id', 'sean', gen_random_uuid(), 'customer_request', encode(sha256((:'disp' || '8')::bytea),'hex'));
ROLLBACK TO SAVEPOINT sp_cancel;
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.confirm_order_payment(current_setting('a8c2.oid')::uuid, 100, current_setting('a8c2.rec'));
  IF (v->>'confirmed')::boolean THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL 回滾取消不應擋 %', v; END IF;
END \$c\$;"; }

cell_C9() {  # $1=a|b|c
  local lvl="REPEATABLE READ" rec="'RECC9'"
  [ "$1" = "b" ] && lvl="SERIALIZABLE"
  [ "$1" = "c" ] && rec="NULL"
  local out state
  out="$(psql "$URL" -qtAX -c "\set VERBOSITY verbose" \
        -c "BEGIN TRANSACTION ISOLATION LEVEL $lvl;" \
        -c "SELECT public.confirm_order_payment('00000000-0000-4000-8000-0000000000a2', 100, $rec);" \
        -c "ROLLBACK;" 2>&1)"
  state="$(printf '%s' "$out" | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1)"
  if [ "$state" = "P8C01" ]; then return 0
  else CELL_ERR="C9$1 期望 P8C01 實得 [$state]"; return 1; fi
}

cell_PC1() { local D="$(next_disp)"; cell_intx PC1 "
\\set disp $D
$_fix_and_oid
CREATE FUNCTION public._a8c2_pc1_suppress() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN RETURN NULL; END \$t\$;
CREATE TRIGGER _a8c2_pc1_suppress BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public._a8c2_pc1_suppress();
$EXPECT_RAISE"; }

run_vector() {
  [ "$(q "SELECT count(*) FROM public.order_cancellations")" = "0" ] \
    || { echo "🔴 run_vector preflight:cancellations 殘留;硬停"; exit 1; }
  local v=""
  for s in 1 2 3 4 5 6; do cell_P "$s" && v="${v}1" || v="${v}0"; done
  cell_P7 && v="${v}1" || v="${v}0"
  cell_C1 && v="${v}1" || v="${v}0"
  cell_C2 && v="${v}1" || v="${v}0"
  cell_C3 && v="${v}1" || v="${v}0"
  cell_C4 a && v="${v}1" || v="${v}0"
  cell_C4 b && v="${v}1" || v="${v}0"
  cell_C5 && v="${v}1" || v="${v}0"
  cell_C6 && v="${v}1" || v="${v}0"
  cell_C7 && v="${v}1" || v="${v}0"
  cell_C7b && v="${v}1" || v="${v}0"
  cell_C8 && v="${v}1" || v="${v}0"
  cell_C9 a && v="${v}1" || v="${v}0"
  cell_C9 b && v="${v}1" || v="${v}0"
  cell_C9 c && v="${v}1" || v="${v}0"
  cell_PC1 && v="${v}1" || v="${v}0"
  printf '%s' "$v"
}

echo "== 基線 21 格 vector(P1-P7 + C×14)=="
BASE_VEC="$(run_vector)"
if [ "$BASE_VEC" = "111111111111111111111" ]; then ok "基線 vector 全綠($BASE_VEC)"
else bad "基線 vector=$BASE_VEC(最後錯誤:${CELL_ERR:-})"; fi
cell_C2b && ok "C2b header-only(合成態)→ RAISE" || bad "C2b — ${CELL_ERR:-}"

# ── P7b:UNIQUE backstop 併發判別格 ─────────────────────────
D_A="$(next_disp)"; D_B="$(next_disp)"
O_A="$(mkord_committed "$D_A")"; O_B="$(mkord_committed "$D_B")"
RECX="RECP7B$RANDOM"
APPA="a8c2_p7ba_$RANDOM$$"; APPB7="a8c2_p7bb_$RANDOM$$"
psql "$URL?application_name=$APPA" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/p7b-a.out" 2>&1 &
BEGIN;
SELECT public.confirm_order_payment('$O_A', 100, '$RECX');
SELECT pg_sleep(3);
COMMIT;
SQL
PA=$!
sleep 0.5
psql "$URL?application_name=$APPB7" -v ON_ERROR_STOP=1 -tAX \
  -c "SELECT public.confirm_order_payment('$O_B', 100, '$RECX')" > "$WORK/p7b-b.out" 2>&1 &
PB=$!
P7BARR=1
wait_blocked_by "$APPB7" "$APPA" 3 && P7BARR=0
wait $PB; RCB=$?
wait $PA; RCA=$?
NREC="$(q "SELECT count(*) FROM public.orders WHERE tappay_rec_trade_id='$RECX'")"
[ "$P7BARR" -eq 0 ] && [ "$RCA" -eq 0 ] && [ "$RCB" -ne 0 ] && grep -q "$GENERIC" "$WORK/p7b-b.out" && [ "$NREC" = "1" ] \
  && ok "P7b UNIQUE backstop:B 於 A 未 commit 時被 unique 等待擋住(barrier 證真 backstop)、恰一成功" \
  || bad "P7b barrier=$P7BARR rca=$RCA rcb=$RCB nrec=$NREC"
cleanup_disp "$D_A" "$D_B"

# ── E2′:relation 級 ACCESS SHARE 新面 ─────────────────────
D_E2="$(next_disp)"; O_E2="$(mkord_committed "$D_E2")"
APPH="a8c2_e2h_$RANDOM$$"; APPW="a8c2_e2w_$RANDOM$$"
psql "$URL?application_name=$APPH" -qtAX <<SQL >/dev/null 2>&1 &
BEGIN; LOCK TABLE public.order_cancellations IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(4); ROLLBACK;
SQL
HP=$!
sleep 0.5
psql "$URL?application_name=$APPW" -qtAX -c "\set VERBOSITY verbose" -c "SET lock_timeout='2s'" \
  -c "SELECT public.confirm_order_payment('$O_E2', 100, 'RECE2$D_E2')" > "$WORK/e2.out" 2>&1 &
WP=$!
E2BARR=1
wait_blocked_by "$APPW" "$APPH" 2 && E2BARR=0
wait $WP
E2STATE="$(sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' "$WORK/e2.out" | head -1)"
E2PS="$(q "SELECT payment_status FROM public.orders WHERE id='$O_E2'")"
wait $HP
[ "$E2BARR" -eq 0 ] && [ "$E2STATE" = "55P03" ] && [ "$E2PS" = "unpaid" ] \
  && ok "E2′ relation 面:barrier 證擋它的=cancellations AE holder、55P03、未翻 paid" \
  || bad "E2′ barrier=$E2BARR state=$E2STATE ps=$E2PS"
cleanup_disp "$D_E2"

# ── L2′:cancel ROLLBACK 方向的併發序列化 ─────────────────────
D_L2="$(next_disp)"; O_L2="$(mkord_committed "$D_L2")"
APPC="a8c2_l2c_$RANDOM$$"; APPB="a8c2_l2b_$RANDOM$$"
psql "$URL?application_name=$APPC" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/l2-a.out" 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O_L2' FOR UPDATE;
UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id='$O_L2';
SELECT pg_sleep(3);
ROLLBACK;
SQL
PA=$!
sleep 0.5
psql "$URL?application_name=$APPB" -v ON_ERROR_STOP=1 -tAX \
  -c "SELECT public.confirm_order_payment('$O_L2', 100, 'RECL2$D_L2')" > "$WORK/l2-b.out" 2>&1 &
PB=$!
L2BARR=1
wait_blocked_by "$APPB" "$APPC" 3 && L2BARR=0
wait $PB; RCB=$?
wait $PA
L2DL="$(grep -c 'deadlock detected' "$WORK/l2-a.out" "$WORK/l2-b.out" | awk -F: '{t+=$2} END{print t}')"
[ "$L2BARR" -eq 0 ] && [ "$RCB" -eq 0 ] && [ "$L2DL" = "0" ] && grep -q 'confirmed.*true' "$WORK/l2-b.out" \
  && ok "L2′ cancel ROLLBACK 方向:阻塞後 confirm 成功、零 40P01" \
  || bad "L2′ barrier=$L2BARR rc=$RCB dl=$L2DL"
cleanup_disp "$D_L2"

# ── 突變矩陣 M1,M2,M3,M4,M5,M6,M8 × 21 格 ──────────────────
echo "== 突變矩陣 ×21 格 =="
q "SELECT pg_get_functiondef('$CONFIRM_SIG'::regprocedure)" > "$WORK/cf-base-def.txt"
restore_base() { psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/cf-base-def.txt" >/dev/null 2>&1; }
trap restore_base EXIT

gen_mutant() {
  python3 - "$1" "$WORK/cf-base-def.txt" "$WORK/cf-mutant.sql" <<'PYEOF'
import sys
n, src_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_p).read()
def sub(anchor, repl):
    if src.count(anchor) != 1:
        sys.exit(f"anchor 非唯一({src.count(anchor)}):{anchor[:60]}")
    return src.replace(anchor, repl)
GUARD = """  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
ISO = """  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'confirm_order_payment: isolation guard' USING ERRCODE = 'P8C01';
  END IF;"""
PFC = """  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
if n == '1':   out = sub(GUARD, "  -- M1 mutant")
elif n == '2': out = sub("   WHERE id = p_order_id\n   FOR UPDATE;", "   WHERE id = p_order_id;")
elif n == '3': out = sub(GUARD, GUARD.replace("""v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id)""",
                                              "v_order.cancelled_at IS NOT NULL"))
elif n == '4': out = sub(GUARD, GUARD.replace("""v_order.cancelled_at IS NOT NULL
     OR EXISTS""", "EXISTS"))
elif n == '5': out = sub(ISO, "  -- M5 mutant")
elif n == '6': out = sub(" WHERE c.order_id = p_order_id", "")
elif n == '8': out = sub(PFC, "  -- M8 mutant")
else: sys.exit("unknown mutant")
open(out_p, 'w').write(out)
PYEOF
}

EXPECT[1]="1111111 0010011001 1111"
EXPECT[2]="1111111 1110011111 1111"
EXPECT[3]="1111111 1011011101 1111"
EXPECT[4]="1111111 0111111011 1111"
EXPECT[5]="1111111 1111111111 0001"
EXPECT[6]="1111111 1111110111 1111"
EXPECT[8]="1111111 1111111111 1110"

for M in 1 2 3 4 5 6 8; do
  if ! ERR="$(gen_mutant "$M" 2>&1)"; then bad "M$M anchor preflight — $ERR"; continue; fi
  psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/cf-mutant.sql" >/dev/null 2>&1 || { bad "M$M 套用失敗"; continue; }
  MMD5="$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")"
  [ "$MMD5" != "$MD5_NEW" ] || { bad "M$M md5 未變"; restore_base; continue; }
  VEC="$(run_vector)"
  EXP="$(printf '%s' "${EXPECT[$M]}" | tr -d ' ')"
  if [ "$VEC" = "$EXP" ]; then ok "M$M vector 逐格吻合($VEC)"
  else bad "M$M vector=$VEC 期望=$EXP(最後:${CELL_ERR:-})"; fi
  restore_base
  [ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_NEW" ] \
    && ok "M$M 還原後 md5=基準" || bad "M$M 還原失敗"
done

# M5 附加示範(計分格;plan §5.2 v3、含 blocker barrier)
gen_mutant 5 && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/cf-mutant.sql" >/dev/null 2>&1
D_M5="$(next_disp)"; O_M5="$(mkord_committed "$D_M5")"
q "INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
   VALUES ('$O_M5', 'A8C2M5-$D_M5', jsonb_build_object('title','a8c2','sku','A8C2','spec',jsonb_build_object()), 1, 0, 0)" >/dev/null
APPM5C="a8c2_m5c_$RANDOM$$"
psql "$URL?application_name=$APPM5C" -v ON_ERROR_STOP=1 -qtAX <<SQL >/dev/null 2>&1 &
BEGIN;
SELECT id FROM public.orders WHERE id='$O_M5' FOR UPDATE;
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES ('$O_M5', 'sean', gen_random_uuid(), 'customer_request', encode(sha256('a8c2m5'::bytea),'hex'));
INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
SELECT c.id, '$O_M5', i.id, 1 FROM public.order_cancellations c, public.order_items i
 WHERE c.order_id='$O_M5' AND i.order_id='$O_M5' LIMIT 1;
SELECT pg_sleep(2);
COMMIT;
SQL
PM5=$!
sleep 0.5
APPM5="a8c2_m5r_$RANDOM$$"
psql "$URL?application_name=$APPM5" -qtAX -c "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;" \
  -c "SELECT 1 FROM public.customers LIMIT 1;" \
  -c "SELECT public.confirm_order_payment('$O_M5', 100, 'RECM5$D_M5');" -c "COMMIT;" > "$WORK/m5.out" 2>&1 &
PR5=$!
M5BARR=1
wait_blocked_by "$APPM5" "$APPM5C" 3 && M5BARR=0
wait $PR5
wait $PM5
if [ "$M5BARR" -eq 0 ] && grep -q 'confirmed.*true' "$WORK/m5.out"; then
  ok "M5 示範:barrier 證 confirm 先被 cancel 擋、醒後 RR 舊快照漏看部分取消 ⇒ confirmed(計分格)"
else bad "M5 示範 barrier=$M5BARR($(head -1 "$WORK/m5.out" | cut -c1-80))"; fi
restore_base
cleanup_disp "$D_M5"
trap - EXIT

END9="$(snap9)" || { echo "🔴 snap9 終判失敗"; FAIL=$((FAIL+1)); END9="SNAP9-FAILED"; }
if [ "$BASE9" = "$END9" ] && [ "$CLEANUP_FAIL" -eq 0 ]; then ok "九表零留痕(含 cleanup 零吞錯)"
else bad "留痕或 cleanup(CLEANUP_FAIL=$CLEANUP_FAIL):"; echo "  基線 $BASE9"; echo "  結束 $END9"; fi

echo "== 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECTED_TOTAL)=="
[ "$FAIL" -eq 0 ] || exit 1
[ "$PASS" -eq "$EXPECTED_TOTAL" ] || { echo "🔴 計數閘:PASS=$PASS ≠ $EXPECTED_TOTAL"; exit 1; }
exit 0
