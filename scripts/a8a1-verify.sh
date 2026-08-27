#!/usr/bin/env bash
# ============================================================
# A8a1 驗證 harness:admin_cancel_order 整單取消核心
# ============================================================
# plan = docs/specs/2026-08-04-e10-a8a1-full-cancel-plan.md(v3)§4/§5
# 🔴 繼任註記(2026-08-05 A8a2):20260805100000 apply 後函式換 6 參版 ⇒ 本檔身分閘
#   合法失效(md5 pin=A8a1 5 參版)——那不是壞掉,是部署態前進;改跑 scripts/a8a2-verify.sh
#   (全繼承 36 格+部分取消 16 格)。本檔保留=A8a1-only 部署態(同批中斷態)的驗證器。
# 用法:provision(d1t2 家族 54331 副本、A8c1+A8c2+A8a1 已套)後 scripts/a8a1-verify.sh /tmp/a8c-work
# 形狀=a8c2-verify.sh 全套慣例(身分閘/COMMENT md5 pin/前置閘負向格/剝殼格/preflight/
# 十二表零留痕/計數閘/committed 例外各自清理)。
# vector 36 格=S1,S2,S3,S4 + I1,I2,I2b,I3,I5,I6,I7,I8,I9,I10 + R1,R2,R3,R4,R5,R6,R6b,R7,R7b,R8,
# R9,R9b,R9c,R10,R11,R12,R13 + C9a,C9b + PC1,PC2,PC3;
# 非 vector=G1/CC1/CC2/M2 示範/M6a,M6b 結構/前置閘負向×4(含 N4 trigger 面)/剝殼。
# 突變 M1-M5,M7-M15(全 vector)+ M6a,M6b(結構錨)。
# 判別力設計註(關卡2 折入):
# - I2(同鍵異 code)用 customer_request→price_change(對客映射同字面)⇒ hash 與 header
#   reason_code 不變式都抓得到;hash 比對「自身」的判別力=I2b(竄改 payload_hash 欄、
#   輸入不變 ⇒ 只有 hash 比對會紅),M3 恰殺 I2b;actor 分句的判別力=I3,M15 恰殺 I3(R3 F2)。
# - 步5 已取消守門的判別力=R9b(header-only 合成態、不插 ci)+R9c(cancelled_at 非空、
#   零 header),M10 恰殺這兩格(R9 被步8 遮蔽=誠實認列,M10 下仍綠)。
# - R11(不存在單)被零品項守門遮蔽(NOT FOUND 拿掉後 v_cnt=0 照紅)=誠實認列,無專屬突變
#   (R3 F2;NOT FOUND 守門的價值=訊息語意與 fail-fast,非唯一防線)。
# - S4(已配採購 allocated>0、零到貨)=合法取消正向格:守門若被誤改成「有採購就擋」,S4 紅(R3 F6)。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/a8c-work}"
PORT="${A8A1_VERIFY_PORT:-54331}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C
MIGFILE="supabase/migrations/20260804180000_m4b_e10_a8a1_admin_cancel_order.sql"
MD5_NEW="39173e33698e282cf7e5b35aae73d009"
MD5_BEGIN_A8C1="f621a56231e20f7f0b2618b40ac1276d"
MD5_CONFIRM_A8C2="6423848f965176c8a0c02917b8be9f52"
CMT_MD5_NEW="4856da86d435ee049277e1c71aea5a2e"
GENERIC="admin_cancel_order: 取消失敗"
FN_SIG="public.admin_cancel_order(uuid,uuid,text,text,text)"
BEGIN_SIG="public.begin_charge_attempt(uuid)"
CONFIRM_SIG="public.confirm_order_payment(uuid,integer,text)"
# G1 黃金(python hashlib 獨立算,非 PG):sha256('a8a1:v1:<oid>:other:G1  golden:full')
G1_OID="00000000-0000-4000-8000-0000a8a10001"
G1_HASH="5678b4f22974b36be0f97c93c684cec8aab03ce2163315a5a6f7747d5d38b93d"

PASS=0; FAIL=0
EXPECTED_TOTAL=45
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
[ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  || { echo "🔴 admin_cancel_order 非 A8a1 版;先套本片;拒跑"; exit 1; }
[ "$(q "SELECT md5(pg_get_functiondef('$BEGIN_SIG'::regprocedure))")" = "$MD5_BEGIN_A8C1" ] \
  || { echo "🔴 begin 非 A8c1 新版(部署鏈);拒跑"; exit 1; }
[ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_CONFIRM_A8C2" ] \
  || { echo "🔴 confirm 非 A8c2 新版(部署鏈);拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id LIKE 'PCM-998%'")" = "0" ] \
  || { echo "🔴 殘留 PCM-998* fixture;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM public.staff WHERE id IN ('sean','staff_1','staff_2') AND is_active")" = "3" ] \
  || { echo "🔴 staff fixture 不符(需 sean/staff_1/staff_2 全 active);拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
        WHERE NOT t.tgisinternal AND t.tgenabled='O'
          AND (t.tgrelid, t.tgname, p.proname) IN (
            ('public.order_cancellations'::regclass,'order_cancellations_block_truncate_bt','pcm_cancellation_ledger_block_truncate'),
            ('public.order_cancellations'::regclass,'order_cancellations_items_presence_ac','pcm_assert_cancellation_has_items'),
            ('public.order_cancellation_items'::regclass,'order_cancellation_items_block_truncate_bt','pcm_cancellation_ledger_block_truncate'),
            ('public.order_cancellation_items'::regclass,'order_cancellation_items_presence_ac','pcm_assert_cancellation_has_items'),
            ('public.order_cancellation_items'::regclass,'order_cancellation_items_summary_recompute_ac','pcm_a4a_cancellation_summary_recompute'))")" = "5" ] \
  || { echo "🔴 A7-t/A4a trigger 三元組不符;拒跑"; exit 1; }
ok "身分閘十重(含三支部署鏈 pin、trigger 三元組、staff fixture、零殘留)"

CUST="$(q "SELECT user_id FROM public.customers ORDER BY user_id LIMIT 1")"
[ -n "$CUST" ] || { echo "🔴 customers 空"; exit 1; }
SUPP="$(q "SELECT id FROM public.suppliers ORDER BY id LIMIT 1")"
[ -n "$SUPP" ] || { echo "🔴 suppliers 空"; exit 1; }

TWELVE="orders order_items payment_charge_attempts order_cancellations order_cancellation_items order_item_quantity_summary payment_double_charge_anomalies staff customers admin_audit_log order_item_procurement order_item_procurement_receipts"
snap12() {
  local t n
  for t in $TWELVE; do
    n="$(q "SELECT count(*) FROM public.$t")"
    case "$n" in ''|*[!0-9]*) echo "🔴 snap12:$t 非數值($n)" >&2; exit 1;; esac
    printf '%s=%s ' "$t" "$n"
  done
}
BASE12="$(snap12)" || { echo "🔴 snap12 基線失敗"; exit 1; }

# ── oracle:定義唯一次數 ──────────────────────────────────
[ "$(grep -c 'CREATE OR REPLACE FUNCTION public.admin_cancel_order' "$MIGFILE")" = "1" ] \
  && ok "migration 檔內 admin_cancel_order 定義恰 1 次" || bad "定義次數異常"

# ── 前置閘負向格×3 + 剝殼 + 重放 ──────────────────────────
# N3:函式已存在 ⇒ 前置閘 RAISE(forward-only、防重複 apply)
N3OUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"; N3RC=$?
if [ "$N3RC" -ne 0 ] && printf '%s' "$N3OUT" | grep -q '已存在 1 個 overload'; then
  ok "N3 前置閘負向:函式已存在 ⇒ migration RAISE 拒跑"
else bad "N3 rc=$N3RC"; fi
q "SELECT pg_get_functiondef('$BEGIN_SIG'::regprocedure)" > "$WORK/a8a1-begin-cur.txt"
q "SELECT pg_get_functiondef('$CONFIRM_SIG'::regprocedure)" > "$WORK/a8a1-confirm-cur.txt"
q "DROP FUNCTION $FN_SIG" >/dev/null
# N1:begin 漂移
python3 - "$WORK/a8a1-begin-cur.txt" "$WORK/a8a1-begin-drift.sql" <<'PYNEG'
import sys
s=open(sys.argv[1]).read()
a="BEGIN\n"
assert s.count(a)>=1
open(sys.argv[2],'w').write(s.replace(a,"BEGIN\n  -- md5gate-negative probe\n",1))
PYNEG
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-begin-drift.sql" >/dev/null 2>&1
N1OUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"; N1RC=$?
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-begin-cur.txt" >/dev/null 2>&1
if [ "$N1RC" -ne 0 ] && printf '%s' "$N1OUT" | grep -q '非 A8c1 新版' \
   && [ "$(q "SELECT md5(pg_get_functiondef('$BEGIN_SIG'::regprocedure))")" = "$MD5_BEGIN_A8C1" ]; then
  ok "N1 前置閘負向:begin 漂移 ⇒ RAISE、還原後 md5 復位"
else bad "N1 rc=$N1RC"; fi
# N2:confirm 漂移
python3 - "$WORK/a8a1-confirm-cur.txt" "$WORK/a8a1-confirm-drift.sql" <<'PYNEG'
import sys
s=open(sys.argv[1]).read()
a="BEGIN\n"
assert s.count(a)>=1
open(sys.argv[2],'w').write(s.replace(a,"BEGIN\n  -- md5gate-negative probe\n",1))
PYNEG
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-confirm-drift.sql" >/dev/null 2>&1
N2OUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"; N2RC=$?
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-confirm-cur.txt" >/dev/null 2>&1
if [ "$N2RC" -ne 0 ] && printf '%s' "$N2OUT" | grep -q '非 A8c2 新版' \
   && [ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_CONFIRM_A8C2" ]; then
  ok "N2 前置閘負向:confirm 漂移 ⇒ RAISE、還原後 md5 復位"
else bad "N2 rc=$N2RC"; fi
# N4:A7-t/A4a trigger 面負向(codex R2:閘要有負向格,否則整段閘被刪=靜默假綠)
q "ALTER TABLE public.order_cancellation_items DISABLE TRIGGER order_cancellation_items_summary_recompute_ac" >/dev/null
N4OUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"; N4RC=$?
q "ALTER TABLE public.order_cancellation_items ENABLE TRIGGER order_cancellation_items_summary_recompute_ac" >/dev/null
if [ "$N4RC" -ne 0 ] && printf '%s' "$N4OUT" | grep -q 'trigger 三元組' \
   && [ "$(q "SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.order_cancellation_items'::regclass AND tgname='order_cancellation_items_summary_recompute_ac'")" = "O" ]; then
  ok "N4 前置閘負向:trigger disabled ⇒ 第四組閘 RAISE、還原後 enabled 復位"
else bad "N4 rc=$N4RC"; fi
# 剝殼模擬(函式此刻不存在=前置閘成立)
grep -vE "^BEGIN;$|^COMMIT;$" "$MIGFILE" > "$WORK/a8a1-stripped.sql"
STRIPOUT="$( (echo "BEGIN;"; cat "$WORK/a8a1-stripped.sql"; echo "ROLLBACK;") | psql "$URL" -v ON_ERROR_STOP=1 -qtAX 2>&1)"
STRIPRC=$?
NFNC="$(q "SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_cancel_order'")"
[ "$STRIPRC" -eq 0 ] && [ "$NFNC" = "0" ] \
  && ok "剝殼模擬:單交易通過(斷言區全跑)、ROLLBACK 零留痕" \
  || bad "剝殼模擬 rc=$STRIPRC n=$NFNC — $(printf '%s' "$STRIPOUT" | grep -m1 ERROR | cut -c1-120)"
# 重放(綠路徑)+ md5 封條
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" >/dev/null 2>&1 \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "migration 重放成功(前置閘四組綠)+ md5=封條" || { bad "重放失敗或 md5 不符"; exit 1; }
[ "$(q "SELECT md5(obj_description('$FN_SIG'::regprocedure,'pg_proc'))")" = "$CMT_MD5_NEW" ] \
  && ok "COMMENT=新字面(md5 pin)" || bad "COMMENT md5 不符"

# ── fixtures/helpers ─────────────────────────────────
echo 0 > "$WORK/.a8a1cnt"
next_disp() {
  local n; n="$(cat "$WORK/.a8a1cnt")"; n=$((n+1)); echo "$n" > "$WORK/.a8a1cnt"
  printf 'PCM-9988-%04d' "$n"
}
FIX_ORDER="INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
VALUES (:'disp', :'cust', jsonb_build_object('name','a8a1','phone','0900000000','line','x'),
  'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid())
RETURNING id"
# 標準 fixture:訂單 + 兩品項(qty 2、3)+ 預設參數(sean/customer_request/NULL/新鍵)
_fix() { echo "
SELECT set_config('a8a1.disp', :'disp', true);
$FIX_ORDER \\gset o_
SELECT set_config('a8a1.oid', (:'o_id')::text, true);
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES (:'o_id', 'A8A1A-' || :'disp', jsonb_build_object('title','a8a1','sku','A','spec',jsonb_build_object()), 2, 0, 0)
RETURNING id \\gset i1_
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES (:'o_id', 'A8A1B-' || :'disp', jsonb_build_object('title','a8a1','sku','B','spec',jsonb_build_object()), 3, 0, 0)
RETURNING id \\gset i2_
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
SELECT set_config('a8a1.actor', 'sean', true);
SELECT set_config('a8a1.code', 'customer_request', true);
SELECT set_config('a8a1.detail', '<NULL>', true);"; }
# 裸單 fixture(R13 零品項)
_fix_bare() { echo "
SELECT set_config('a8a1.disp', :'disp', true);
$FIX_ORDER \\gset o_
SELECT set_config('a8a1.oid', (:'o_id')::text, true);
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
SELECT set_config('a8a1.actor', 'sean', true);
SELECT set_config('a8a1.code', 'customer_request', true);
SELECT set_config('a8a1.detail', '<NULL>', true);"; }

CALL_EXPR="public.admin_cancel_order(current_setting('a8a1.oid')::uuid, NULLIF(current_setting('a8a1.key'),'')::uuid,
    current_setting('a8a1.actor'), current_setting('a8a1.code'), NULLIF(current_setting('a8a1.detail'),'<NULL>'))"

# 期望 RAISE:期望訊息由 a8a1.expmsg 提供(預設=通用)
EXPECT_RAISE="DO \$c\$
DECLARE v jsonb;
BEGIN
  BEGIN
    v := $CALL_EXPR;
    RAISE EXCEPTION 'CELLFAIL 未 RAISE(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = current_setting('a8a1.expmsg') THEN RAISE NOTICE 'CELLOK';
    ELSE RAISE; END IF;
  END;
END \$c\$;"

cell_intx() {
  local label="$1" body="$2" out
  out="$(psql "$URL" -v ON_ERROR_STOP=1 -v cust="$CUST" -v supp="$SUPP" -qtAX <<SQL 2>&1
BEGIN;
SELECT set_config('a8a1.expmsg', '$GENERIC', true);
SELECT set_config('a8a1.cust', '$CUST', true);
$body
ROLLBACK;
SQL
)"
  if [ $? -eq 0 ] && printf '%s' "$out" | grep -q 'CELLOK'; then return 0
  else CELL_ERR="[$label] $(printf '%s' "$out" | grep -m1 -E 'ERROR|CELLFAIL' | cut -c1-160)"; return 1; fi
}

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
  DELETE FROM public.admin_audit_log WHERE target = 'order:' || v_o::text;
  DELETE FROM public.order_cancellation_items WHERE order_id=v_o;
  DELETE FROM public.order_cancellations WHERE order_id=v_o;
  DELETE FROM public.payment_double_charge_anomalies WHERE old_order_id=v_o;
  DELETE FROM public.payment_charge_attempts WHERE order_id=v_o;
  DELETE FROM public.order_item_procurement_receipts r USING public.order_item_procurement p, public.order_items i
   WHERE r.procurement_id=p.id AND p.order_item_id=i.id AND i.order_id=v_o;
  DELETE FROM public.order_item_procurement p USING public.order_items i WHERE p.order_item_id=i.id AND i.order_id=v_o;
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
VALUES ('$1', '$CUST', jsonb_build_object('name','a8a1','phone','0900000000','line','x'),
  'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid())
RETURNING id;
SQL
}

# ── vector 34 格 ─────────────────────────────────────
cell_S1() { local D="$(next_disp)"; cell_intx S1 "
\\set disp $D
$(_fix)
DO \$c\$ DECLARE v jsonb; o record; v_hid text; n_h int; n_i int; n_a int; n_s int; BEGIN
  v := $CALL_EXPR;
  SELECT cancelled_at, cancelled_reason INTO o FROM public.orders WHERE id=current_setting('a8a1.oid')::uuid;
  SELECT id::text INTO v_hid FROM public.order_cancellations
   WHERE order_id=current_setting('a8a1.oid')::uuid AND actor='sean'
     AND reason_code='customer_request' AND reason_detail IS NULL
     AND idempotency_key=current_setting('a8a1.key')::uuid;
  n_h := (SELECT count(*) FROM public.order_cancellations WHERE order_id=current_setting('a8a1.oid')::uuid);
  SELECT count(*) INTO n_i FROM public.order_cancellation_items ci
    JOIN public.order_items oi ON oi.id=ci.order_item_id
   WHERE ci.order_id=current_setting('a8a1.oid')::uuid AND ci.cancelled_quantity=oi.quantity;
  SELECT count(*) INTO n_a FROM public.admin_audit_log g
   WHERE g.target='order:'||current_setting('a8a1.oid') AND g.action='order.cancel'
     AND g.request_id=current_setting('a8a1.key') AND g.reason='customer_request'
     AND g.source_app='admin'
     AND g.before = jsonb_build_object('payment_status','unpaid','cancelled_at',NULL)
     AND g.after  = jsonb_build_object('payment_status','unpaid','cancelled_at', o.cancelled_at,
                                       'cancellation_id', (v->>'cancellation_id')::uuid);
  SELECT count(*) INTO n_s FROM public.order_item_quantity_summary s
    JOIN public.order_items oi ON oi.id=s.order_item_id
   WHERE oi.order_id=current_setting('a8a1.oid')::uuid AND s.cancelled_quantity=oi.quantity;
  IF (v->>'cancelled')::boolean AND NOT (v->>'idempotent')::boolean
     AND v_hid IS NOT NULL AND v->>'cancellation_id' = v_hid
     AND o.cancelled_at IS NOT NULL AND o.cancelled_reason='依您要求取消'
     AND n_h=1 AND n_i=2 AND n_a=1 AND n_s=2
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL v=% o=% hid=% h=% i=% a=% s=%', v, o, v_hid, n_h, n_i, n_a, n_s; END IF;
END \$c\$;"; }

cell_S2() { local D="$(next_disp)"; cell_intx S2 "
\\set disp $D
$(_fix)
SELECT set_config('a8a1.code', 'other', true);
SELECT set_config('a8a1.detail', ' AA  BB ', true);
DO \$c\$ DECLARE v jsonb; o record; n_h int; BEGIN
  v := $CALL_EXPR;
  SELECT cancelled_reason INTO o FROM public.orders WHERE id=current_setting('a8a1.oid')::uuid;
  SELECT count(*) INTO n_h FROM public.order_cancellations
   WHERE order_id=current_setting('a8a1.oid')::uuid AND reason_code='other' AND reason_detail='AA  BB';
  IF (v->>'cancelled')::boolean AND o.cancelled_reason='AA  BB' AND n_h=1
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL v=% reason=[%] h=%', v, o.cancelled_reason, n_h; END IF;
END \$c\$;"; }

cell_S3() {
  local D1="$(next_disp)" D2="$(next_disp)" D3="$(next_disp)" D4="$(next_disp)" D5="$(next_disp)" D6="$(next_disp)"
  cell_intx S3 "
CREATE TEMP TABLE _s3(disp text, code text, expect text) ON COMMIT DROP;
INSERT INTO _s3 VALUES
  ('$D1','customer_request','依您要求取消'),
  ('$D2','out_of_stock','商品供貨中斷,已為您取消'),
  ('$D3','long_leadtime','交期無法配合,已為您取消'),
  ('$D4','price_change','依您要求取消'),
  ('$D5','duplicate_order','重複訂單,已為您取消'),
  ('$D6','internal_error','依您要求取消');
DO \$c\$ DECLARE r record; v jsonb; v_oid uuid; v_got text; BEGIN
  FOR r IN SELECT * FROM _s3 ORDER BY disp LOOP
    INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
      subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
    VALUES (r.disp, current_setting('a8a1.cust')::uuid, jsonb_build_object('name','a8a1','phone','0900000000','line','x'),
      'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid())
    RETURNING id INTO v_oid;
    INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
    VALUES (v_oid, 'A8A1S3-'||r.disp, jsonb_build_object('title','a8a1','sku','A','spec',jsonb_build_object()), 1, 0, 0);
    v := public.admin_cancel_order(v_oid, gen_random_uuid(), 'sean', r.code, NULL);
    SELECT cancelled_reason INTO v_got FROM public.orders WHERE id=v_oid;
    IF v_got IS DISTINCT FROM r.expect THEN
      RAISE EXCEPTION 'CELLFAIL code=% got=[%] want=[%]', r.code, v_got, r.expect;
    END IF;
  END LOOP;
  RAISE NOTICE 'CELLOK';
END \$c\$;" ; }

cell_S4() { local D="$(next_disp)"; cell_intx S4 "
\\set disp $D
$(_fix)
INSERT INTO public.order_item_procurement (id, order_item_id, allocated_quantity, supplier_id)
VALUES (gen_random_uuid(), :'i1_id', 2, :'supp');
DO \$c\$ DECLARE v jsonb; BEGIN
  v := $CALL_EXPR;
  IF (v->>'cancelled')::boolean THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL %', v; END IF;
END \$c\$;"; }

cell_I1() { local D="$(next_disp)"; cell_intx I1 "
\\set disp $D
$(_fix)
DO \$c\$ DECLARE v1 jsonb; v2 jsonb; n_h int; n_i int; n_a int; BEGIN
  v1 := $CALL_EXPR;
  v2 := $CALL_EXPR;
  SELECT count(*) INTO n_h FROM public.order_cancellations WHERE order_id=current_setting('a8a1.oid')::uuid;
  SELECT count(*) INTO n_i FROM public.order_cancellation_items WHERE order_id=current_setting('a8a1.oid')::uuid;
  SELECT count(*) INTO n_a FROM public.admin_audit_log WHERE target='order:'||current_setting('a8a1.oid');
  IF (v2->>'idempotent')::boolean AND v2->>'cancellation_id' = v1->>'cancellation_id'
     AND n_h=1 AND n_i=2 AND n_a=1
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL v1=% v2=% h=% i=% a=%', v1, v2, n_h, n_i, n_a; END IF;
END \$c\$;"; }

cell_I2() { local D="$(next_disp)"; cell_intx I2 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
SELECT set_config('a8a1.code', 'price_change', true);
$EXPECT_RAISE"; }

cell_I2b() { local D="$(next_disp)"; cell_intx I2b "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
UPDATE public.order_cancellations SET payload_hash = encode(sha256('tampered'::bytea),'hex')
 WHERE order_id=:'o_id';
$EXPECT_RAISE"; }

cell_I3() { local D="$(next_disp)"; cell_intx I3 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
SELECT set_config('a8a1.actor', 'staff_1', true);
$EXPECT_RAISE"; }

cell_I5() { local D="$(next_disp)"; cell_intx I5 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
UPDATE public.orders SET payment_status='paid' WHERE id=:'o_id';
$EXPECT_RAISE"; }

cell_I6() { local D="$(next_disp)"; cell_intx I6 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
DELETE FROM public.order_cancellation_items WHERE order_item_id=:'i1_id';
$EXPECT_RAISE"; }

cell_I7() { local D="$(next_disp)"; cell_intx I7 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
INSERT INTO public.payment_charge_attempts (id, order_id, customer_user_id, status, fallback_token_hash)
VALUES (gen_random_uuid(), :'o_id', :'cust', 'pending', encode(sha256((:'disp' || 'i7')::bytea),'hex'));
$EXPECT_RAISE"; }

cell_I8() { local D="$(next_disp)"; cell_intx I8 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
UPDATE public.order_cancellations SET reason_code='price_change' WHERE order_id=:'o_id';
$EXPECT_RAISE"; }

cell_I9() { local D="$(next_disp)"; cell_intx I9 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
DELETE FROM public.admin_audit_log WHERE request_id = current_setting('a8a1.key');
$EXPECT_RAISE"; }

cell_I10() { local D="$(next_disp)"; cell_intx I10 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
UPDATE public.orders SET cancelled_at=NULL WHERE id=:'o_id';
$EXPECT_RAISE"; }

cell_R() {  # $1=cell 名;$2=前置 SQL(可空);$3=覆寫 settings SQL(可空)
  local D="$(next_disp)"
  cell_intx "$1" "
\\set disp $D
$(_fix)
$2
$3
$EXPECT_RAISE"
}

cell_R2() { local D="$(next_disp)"; cell_intx R2 "
\\set disp $D
$(_fix)
DO \$c\$ DECLARE v jsonb; BEGIN
  BEGIN
    v := public.admin_cancel_order(current_setting('a8a1.oid')::uuid, gen_random_uuid(), 'sean', 'other', NULL);
    RAISE EXCEPTION 'CELLFAIL NULL detail 未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'admin_cancel_order: other 需填取消說明' THEN RAISE; END IF;
  END;
  BEGIN
    v := public.admin_cancel_order(current_setting('a8a1.oid')::uuid, gen_random_uuid(), 'sean', 'other', '　');
    RAISE EXCEPTION 'CELLFAIL U+3000 未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'admin_cancel_order: other 需填取消說明' THEN RAISE NOTICE 'CELLOK'; ELSE RAISE; END IF;
  END;
END \$c\$;"; }

cell_R9() { local D="$(next_disp)"; cell_intx R9 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
$EXPECT_RAISE"; }

cell_R9b() { local D="$(next_disp)"; cell_intx R9b "
\\set disp $D
$(_fix)
INSERT INTO public.order_cancellations (order_id, actor, idempotency_key, reason_code, payload_hash)
VALUES (:'o_id', 'sean', gen_random_uuid(), 'customer_request', encode(sha256(('r9b'||:'disp')::bytea),'hex'));
$EXPECT_RAISE"; }

cell_R9c() { local D="$(next_disp)"; cell_intx R9c "
\\set disp $D
$(_fix)
UPDATE public.orders SET cancelled_at=now(), cancelled_reason='依您要求取消' WHERE id=:'o_id';
$EXPECT_RAISE"; }

cell_R11() { cell_intx R11 "
SELECT set_config('a8a1.oid', '00000000-0000-4000-8000-00000000dead', true);
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
SELECT set_config('a8a1.actor', 'sean', true);
SELECT set_config('a8a1.code', 'customer_request', true);
SELECT set_config('a8a1.detail', '<NULL>', true);
$EXPECT_RAISE"; }

cell_R13() { local D="$(next_disp)"; cell_intx R13 "
\\set disp $D
$(_fix_bare)
$EXPECT_RAISE"; }

cell_C9() {  # $1=a|b
  local lvl="REPEATABLE READ"
  [ "$1" = "b" ] && lvl="SERIALIZABLE"
  local out state
  out="$(psql "$URL" -qtAX -c "\set VERBOSITY verbose" \
        -c "BEGIN TRANSACTION ISOLATION LEVEL $lvl;" \
        -c "SELECT public.admin_cancel_order('00000000-0000-4000-8000-00000000dead', gen_random_uuid(), 'sean', 'customer_request', NULL);" \
        -c "ROLLBACK;" 2>&1)"
  state="$(printf '%s' "$out" | sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' | head -1)"
  if [ "$state" = "P8C01" ]; then return 0
  else CELL_ERR="C9$1 期望 P8C01 實得 [$state]"; return 1; fi
}

_pc_check="DO \$c\$ DECLARE v jsonb; n_h int; BEGIN
  BEGIN
    v := $CALL_EXPR;
    RAISE EXCEPTION 'CELLFAIL 未 RAISE(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> current_setting('a8a1.expmsg') THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n_h FROM public.order_cancellations WHERE order_id=current_setting('a8a1.oid')::uuid;
  IF n_h = 0 THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL 產物未全回滾 h=%', n_h; END IF;
END \$c\$;"

cell_PC1() { local D="$(next_disp)"; cell_intx PC1 "
\\set disp $D
$(_fix)
CREATE FUNCTION public._a8a1_pc1_suppress() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN RETURN NULL; END \$t\$;
CREATE TRIGGER _a8a1_pc1_suppress BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public._a8a1_pc1_suppress();
$_pc_check"; }

cell_PC2() { local D="$(next_disp)"; cell_intx PC2 "
\\set disp $D
$(_fix)
SELECT set_config('a8a1.i2', (:'i2_id')::text, true);
CREATE FUNCTION public._a8a1_pc2_suppress() RETURNS trigger LANGUAGE plpgsql AS \$t\$
BEGIN
  IF NEW.order_item_id = current_setting('a8a1.i2')::uuid THEN RETURN NULL; END IF;
  RETURN NEW;
END \$t\$;
CREATE TRIGGER _a8a1_pc2_suppress BEFORE INSERT ON public.order_cancellation_items FOR EACH ROW EXECUTE FUNCTION public._a8a1_pc2_suppress();
$_pc_check"; }

cell_PC3() { local D="$(next_disp)"; cell_intx PC3 "
\\set disp $D
$(_fix)
CREATE FUNCTION public._a8a1_pc3_suppress() RETURNS trigger LANGUAGE plpgsql AS \$t\$ BEGIN RETURN NULL; END \$t\$;
CREATE TRIGGER _a8a1_pc3_suppress BEFORE INSERT ON public.admin_audit_log FOR EACH ROW EXECUTE FUNCTION public._a8a1_pc3_suppress();
$_pc_check"; }

ATT_FIX() {  # $1=status $2=rec(空=NULL)
  local rec="NULL"; [ -n "$2" ] && rec="'$2'"
  echo "INSERT INTO public.payment_charge_attempts (id, order_id, customer_user_id, status, fallback_token_hash, rec_trade_id)
VALUES (gen_random_uuid(), :'o_id', :'cust', '$1', encode(sha256((:'disp')::bytea),'hex'), $rec);"
}

run_vector() {
  [ "$(q "SELECT count(*) FROM public.order_cancellations")" = "0" ] \
    || { echo "🔴 run_vector preflight:cancellations 殘留;硬停"; exit 1; }
  local v=""
  cell_S1 && v="${v}1" || v="${v}0"
  cell_S2 && v="${v}1" || v="${v}0"
  cell_S3 && v="${v}1" || v="${v}0"
  cell_S4 && v="${v}1" || v="${v}0"
  cell_I1 && v="${v}1" || v="${v}0"
  cell_I2 && v="${v}1" || v="${v}0"
  cell_I2b && v="${v}1" || v="${v}0"
  cell_I3 && v="${v}1" || v="${v}0"
  cell_I5 && v="${v}1" || v="${v}0"
  cell_I6 && v="${v}1" || v="${v}0"
  cell_I7 && v="${v}1" || v="${v}0"
  cell_I8 && v="${v}1" || v="${v}0"
  cell_I9 && v="${v}1" || v="${v}0"
  cell_I10 && v="${v}1" || v="${v}0"
  cell_R R1 "" "SELECT set_config('a8a1.code', 'oops', true); SELECT set_config('a8a1.expmsg', 'admin_cancel_order: 未知取消原因碼', true);" && v="${v}1" || v="${v}0"
  cell_R2 && v="${v}1" || v="${v}0"
  cell_R R3 "" "SELECT set_config('a8a1.detail', 'x', true); SELECT set_config('a8a1.expmsg', 'admin_cancel_order: 非 other 不得填說明', true);" && v="${v}1" || v="${v}0"
  cell_R R4 "UPDATE public.staff SET is_active=false WHERE id='staff_2';" "SELECT set_config('a8a1.actor', 'staff_2', true);" && v="${v}1" || v="${v}0"
  cell_R R5 "" "SELECT set_config('a8a1.actor', 'ghost_nobody', true);" && v="${v}1" || v="${v}0"
  cell_R R6 "UPDATE public.orders SET payment_status='paid' WHERE id=:'o_id';" "" && v="${v}1" || v="${v}0"
  cell_R R6b "UPDATE public.orders SET payment_status='refunded' WHERE id=:'o_id';" "" && v="${v}1" || v="${v}0"
  cell_R R7 "$(ATT_FIX pending "")" "" && v="${v}1" || v="${v}0"
  cell_R R7b "$(ATT_FIX charged RECA8A1X)" "" && v="${v}1" || v="${v}0"
  cell_R R8 "$(ATT_FIX released "")" "" && v="${v}1" || v="${v}0"
  cell_R9 && v="${v}1" || v="${v}0"
  cell_R9b && v="${v}1" || v="${v}0"
  cell_R9c && v="${v}1" || v="${v}0"
  cell_R R10 "INSERT INTO public.order_item_procurement (id, order_item_id, allocated_quantity, supplier_id)
VALUES (gen_random_uuid(), :'i1_id', 2, :'supp') RETURNING id \\gset p_
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
VALUES (:'p_id', 1, now(), 'sean');" "" && v="${v}1" || v="${v}0"
  cell_R11 && v="${v}1" || v="${v}0"
  cell_R R12 "" "SELECT set_config('a8a1.key', '', true); SELECT set_config('a8a1.expmsg', 'admin_cancel_order: 冪等鍵缺失', true);" && v="${v}1" || v="${v}0"
  cell_R13 && v="${v}1" || v="${v}0"
  cell_C9 a && v="${v}1" || v="${v}0"
  cell_C9 b && v="${v}1" || v="${v}0"
  cell_PC1 && v="${v}1" || v="${v}0"
  cell_PC2 && v="${v}1" || v="${v}0"
  cell_PC3 && v="${v}1" || v="${v}0"
  printf '%s' "$v"
}

echo "== 基線 36 格 vector(S×4 I×10 R×17 C9×2 PC×3)=="
BASE_VEC="$(run_vector)"
if [ "$BASE_VEC" = "111111111111111111111111111111111111" ]; then ok "基線 vector 全綠($BASE_VEC)"
else bad "基線 vector=$BASE_VEC(最後錯誤:${CELL_ERR:-})"; fi

# ── G1 黃金 hash(python 獨立算的常數 vs RPC 入庫值)──────────
D_G1="$(next_disp)"
cell_intx G1 "
\\set disp $D_G1
SELECT set_config('a8a1.disp', :'disp', true);
INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
VALUES ('$G1_OID', :'disp', :'cust', jsonb_build_object('name','a8a1','phone','0900000000','line','x'),
  'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid());
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES ('$G1_OID', 'A8A1G1-' || :'disp', jsonb_build_object('title','a8a1','sku','A','spec',jsonb_build_object()), 1, 0, 0);
DO \$c\$ DECLARE v jsonb; v_hash text; v_reason text; BEGIN
  v := public.admin_cancel_order('$G1_OID', gen_random_uuid(), 'sean', 'other', ' G1  golden ');
  SELECT payload_hash INTO v_hash FROM public.order_cancellations WHERE order_id='$G1_OID';
  SELECT cancelled_reason INTO v_reason FROM public.orders WHERE id='$G1_OID';
  IF v_hash = '$G1_HASH' AND v_reason = 'G1  golden'
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL hash=[%] reason=[%]', v_hash, v_reason; END IF;
END \$c\$;" \
  && ok "G1 黃金 hash:入庫值=python 獨立常數、other 對客=detail 逐字(btrim 原文)" \
  || bad "G1 — ${CELL_ERR:-}"

# ── CC1/CC2:與 begin_charge_attempt 的真 RPC 交叉(committed;barrier)──
D_CC1="$(next_disp)"; O_CC1="$(mkord_committed "$D_CC1")"
q "INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
   VALUES ('$O_CC1', 'A8A1CC1-$D_CC1', jsonb_build_object('title','a8a1','sku','A','spec',jsonb_build_object()), 1, 0, 0)" >/dev/null
APPA="a8a1_cc1a_$RANDOM$$"; APPB="a8a1_cc1b_$RANDOM$$"
psql "$URL?application_name=$APPA" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/cc1-a.out" 2>&1 &
BEGIN;
SELECT public.admin_cancel_order('$O_CC1', gen_random_uuid(), 'sean', 'customer_request', NULL);
SELECT pg_sleep(3);
COMMIT;
SQL
PA=$!
sleep 0.5
psql "$URL?application_name=$APPB" -v ON_ERROR_STOP=1 -tAX \
  -c "SELECT public.begin_charge_attempt('$O_CC1')" > "$WORK/cc1-b.out" 2>&1 &
PB=$!
CC1BARR=1
wait_blocked_by "$APPB" "$APPA" 3 && CC1BARR=0
wait $PB; RCB=$?
wait $PA
NATT="$(q "SELECT count(*) FROM public.payment_charge_attempts WHERE order_id='$O_CC1'")"
[ "$CC1BARR" -eq 0 ] && [ "$RCB" -ne 0 ] && grep -q 'begin_charge_attempt: 付款處理失敗' "$WORK/cc1-b.out" && [ "$NATT" = "0" ] \
  && ok "CC1 真 RPC:cancel 先持鎖、begin 醒來拒(A8c1 守門)、零 attempt" \
  || bad "CC1 barrier=$CC1BARR rcb=$RCB att=$NATT"
cleanup_disp "$D_CC1"

D_CC2="$(next_disp)"; O_CC2="$(mkord_committed "$D_CC2")"
q "INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
   VALUES ('$O_CC2', 'A8A1CC2-$D_CC2', jsonb_build_object('title','a8a1','sku','A','spec',jsonb_build_object()), 1, 0, 0)" >/dev/null
APPA2="a8a1_cc2a_$RANDOM$$"; APPB2="a8a1_cc2b_$RANDOM$$"
psql "$URL?application_name=$APPA2" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/cc2-a.out" 2>&1 &
BEGIN;
SELECT public.begin_charge_attempt('$O_CC2');
SELECT pg_sleep(3);
COMMIT;
SQL
PA2=$!
sleep 0.5
psql "$URL?application_name=$APPB2" -v ON_ERROR_STOP=1 -tAX \
  -c "SELECT public.admin_cancel_order('$O_CC2', gen_random_uuid(), 'sean', 'customer_request', NULL)" > "$WORK/cc2-b.out" 2>&1 &
PB2=$!
CC2BARR=1
wait_blocked_by "$APPB2" "$APPA2" 3 && CC2BARR=0
wait $PB2; RCB2=$?
wait $PA2
NHDR="$(q "SELECT count(*) FROM public.order_cancellations WHERE order_id='$O_CC2'")"
NCAN="$(q "SELECT count(*) FROM public.orders WHERE id='$O_CC2' AND cancelled_at IS NOT NULL")"
NPEND="$(q "SELECT count(*) FROM public.payment_charge_attempts WHERE order_id='$O_CC2' AND status='pending'")"
[ "$CC2BARR" -eq 0 ] && [ "$RCB2" -ne 0 ] && grep -q "$GENERIC" "$WORK/cc2-b.out" && [ "$NHDR" = "0" ] && [ "$NCAN" = "0" ] && [ "$NPEND" = "1" ] \
  && ok "CC2 真 RPC:begin 先取得 pending、cancel 醒來 R7 拒、單未取消" \
  || bad "CC2 barrier=$CC2BARR rcb=$RCB2 hdr=$NHDR can=$NCAN pend=$NPEND"
cleanup_disp "$D_CC2"

# ── 突變矩陣 ─────────────────────────────────────────
echo "== 突變矩陣 ×36 格 =="
q "SELECT pg_get_functiondef('$FN_SIG'::regprocedure)" > "$WORK/a8a1-base-def.txt"
restore_base() { psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-base-def.txt" >/dev/null 2>&1; }
trap restore_base EXIT

gen_mutant() {
  python3 - "$1" "$WORK/a8a1-base-def.txt" "$WORK/a8a1-mutant.sql" <<'PYEOF'
import sys
n, src_p, out_p = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(src_p).read()
def sub(anchor, repl):
    if src.count(anchor) != 1:
        sys.exit(f"anchor 非唯一({src.count(anchor)}):{anchor[:60]}")
    return src.replace(anchor, repl)
ALLOWED = """  IF v_order.payment_status <> 'unpaid'::public.payment_status
     OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a
                 WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
ITEMGUARD = """  SELECT count(*) INTO v_bad FROM public.order_items oi
   WHERE oi.order_id = p_order_id
     AND (EXISTS (SELECT 1 FROM public.order_item_procurement p
                   JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                  WHERE p.order_item_id = oi.id AND r.quantity > 0)
          OR EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                      WHERE ci.order_item_id = oi.id));
  IF v_bad <> 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
HASHCHK = """    IF v_existing.payload_hash IS DISTINCT FROM v_hash
       OR v_existing.actor IS DISTINCT FROM p_actor THEN"""
ISO = """  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_cancel_order: isolation guard' USING ERRCODE = 'P8C01';
  END IF;"""
CUSTWRITE = """  UPDATE public.orders
     SET cancelled_at = pg_catalog.now(),
         cancelled_reason = v_reason_txt,
         updated_at = pg_catalog.now()
   WHERE id = p_order_id;
  -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
AUDIT = """  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.cancel', 'order:' || p_order_id::text, p_idempotency_key,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', NULL),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', pg_catalog.now(), 'cancellation_id', v_cid),
          p_reason_code, 'admin');
  -- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
INVARIANT = """    IF v_order.cancelled_at IS NULL
       OR v_order.cancelled_reason IS DISTINCT FROM v_reason_txt
       OR v_order.payment_status <> 'unpaid'::public.payment_status
       OR v_existing.reason_code IS DISTINCT FROM p_reason_code
       OR v_existing.reason_detail IS DISTINCT FROM (CASE WHEN p_reason_code = 'other' THEN v_detail ELSE NULL END)
       OR v_bad <> 0
       OR EXISTS (SELECT 1 FROM public.payment_charge_attempts pa
                   WHERE pa.order_id = p_order_id AND pa.status <> 'failed')
       OR NOT EXISTS (SELECT 1 FROM public.admin_audit_log g
                       WHERE g.request_id = p_idempotency_key::text
                         AND g.action = 'order.cancel'
                         AND g.target = 'order:' || p_order_id::text) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;"""
STEP5 = """  IF v_order.cancelled_at IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_cancellations c WHERE c.order_id = p_order_id) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
ZEROITEM = """  IF v_cnt = 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
ITEMCNT = """  -- items 筆數守:BEFORE trigger 抑制單列 ⇒ 部分取消冒充整單;必=v_cnt 全額
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> v_cnt THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
AUDITCNT = """  -- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
ORDGUARD = """  -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
if n == '1':    out = sub(ALLOWED, "  -- M1 mutant")
elif n == '2':  out = sub(ITEMGUARD, "  -- M2 mutant")
elif n == '3':  out = sub(HASHCHK, "    IF v_existing.actor IS DISTINCT FROM p_actor THEN")
elif n == '4':  out = sub("WHERE s.id = p_actor AND s.is_active", "WHERE s.id = p_actor")
elif n == '5':  out = sub(ISO, "  -- M5 mutant")
elif n == '6a': out = sub("ORDER BY oi.id\n   FOR NO KEY UPDATE;", "FOR NO KEY UPDATE;")
elif n == '6b': out = sub("WHERE oi.order_id = p_order_id\n   ORDER BY oi.id;", "WHERE oi.order_id = p_order_id;")
elif n == '7':  out = sub(CUSTWRITE, "  -- M7 mutant")
elif n == '8':  out = sub(AUDIT, "  -- M8 mutant")
elif n == '9':  out = sub(INVARIANT, "  -- M9 mutant")
elif n == '10': out = sub(STEP5, "  -- M10 mutant")
elif n == '11': out = sub(ZEROITEM, "  -- M11 mutant")
elif n == '12': out = sub(ITEMCNT, "  -- M12 mutant")
elif n == '13': out = sub(AUDITCNT, "  -- M13 mutant")
elif n == '14': out = sub(ORDGUARD, "  -- M14 mutant")
elif n == '15': out = sub(HASHCHK, "    IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN")
else: sys.exit("unknown mutant")
open(out_p, 'w').write(out)
PYEOF
}

#             S×4  I×10       R×17              C9 PC×3
EXPECT[1]="1111 1111111111 11111000001111111 11 111"
EXPECT[2]="1111 1111111111 11111111111110111 11 111"
EXPECT[3]="1111 1101111111 11111111111111111 11 111"
EXPECT[4]="1111 1111111111 11101111111111111 11 111"
EXPECT[5]="1111 1111111111 11111111111111111 00 111"
EXPECT[7]="0001 0111111111 11111111111111111 11 011"
EXPECT[8]="0111 0111111111 11111111111111111 11 110"
EXPECT[9]="1111 1111000000 11111111111111111 11 111"
EXPECT[10]="1111 1111111111 11111111111001111 11 111"
EXPECT[11]="1111 1111111111 11111111111111110 11 111"
EXPECT[12]="1111 1111111111 11111111111111111 11 101"
EXPECT[13]="1111 1111111111 11111111111111111 11 110"
EXPECT[14]="1111 1111111111 11111111111111111 11 011"
EXPECT[15]="1111 1110111111 11111111111111111 11 111"

for M in 1 2 3 4 5 7 8 9 10 11 12 13 14 15; do
  if ! ERR="$(gen_mutant "$M" 2>&1)"; then bad "M$M anchor preflight — $ERR"; continue; fi
  psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1 || { bad "M$M 套用失敗"; continue; }
  MMD5="$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")"
  [ "$MMD5" != "$MD5_NEW" ] || { bad "M$M md5 未變"; restore_base; continue; }
  VEC="$(run_vector)"
  EXP="$(printf '%s' "${EXPECT[$M]}" | tr -d ' ')"
  if [ "$VEC" = "$EXP" ]; then ok "M$M vector 逐格吻合($VEC)"
  else bad "M$M vector=$VEC 期望=$EXP(最後:${CELL_ERR:-})"; fi
  restore_base
  [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
    && ok "M$M 還原後 md5=基準" || bad "M$M 還原失敗"
done

# ── M2 示範格:第二道網實證(23514 + 釘約束名 + 全回滾)──────────
gen_mutant 2 && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1
D_M2="$(next_disp)"
cell_intx M2demo "
\\set disp $D_M2
$(_fix)
INSERT INTO public.order_item_procurement (id, order_item_id, allocated_quantity, supplier_id)
VALUES (gen_random_uuid(), :'i1_id', 2, :'supp') RETURNING id \\gset p_
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
VALUES (:'p_id', 1, now(), 'sean');
DO \$c\$ DECLARE v jsonb; v_state text; v_con text; n int; BEGIN
  BEGIN
    v := $CALL_EXPR;
    RAISE EXCEPTION 'CELLFAIL M2 未紅(%)', v;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
    IF v_state <> '23514' OR v_con IS DISTINCT FROM 'oiqs_instock_cancelled_le_quantity' THEN
      RAISE EXCEPTION 'CELLFAIL state=[%] con=[%]', v_state, coalesce(v_con,'<NULL>');
    END IF;
  END;
  SELECT (SELECT count(*) FROM public.order_cancellations WHERE order_id=current_setting('a8a1.oid')::uuid)
       + (SELECT count(*) FROM public.order_cancellation_items WHERE order_id=current_setting('a8a1.oid')::uuid)
       + (SELECT count(*) FROM public.orders WHERE id=current_setting('a8a1.oid')::uuid AND cancelled_at IS NOT NULL)
       + (SELECT count(*) FROM public.admin_audit_log WHERE target='order:'||current_setting('a8a1.oid'))
    INTO n;
  IF n = 0 THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL 殘產物 n=%', n; END IF;
END \$c\$;" \
  && ok "M2 示範:守門拿掉後紅在 23514+oiqs_instock_cancelled_le_quantity、header/items/orders/audit 全回滾(第二道網實證)" \
  || bad "M2 示範 — ${CELL_ERR:-}"
restore_base

# ── M6a/M6b:排序結構錨(行為無判別力誠實認列;承重=結構層)──────
STRUCT_PROBE_A="SELECT CASE WHEN position(E'ORDER BY oi.id\n   FOR NO KEY UPDATE;' in pg_get_functiondef('$FN_SIG'::regprocedure)) = 0 THEN 'STRUCT_RED' ELSE 'STRUCT_GREEN' END"
STRUCT_PROBE_B="SELECT CASE WHEN position('ORDER BY oi.id;' in pg_get_functiondef('$FN_SIG'::regprocedure)) = 0 THEN 'STRUCT_RED' ELSE 'STRUCT_GREEN' END"
[ "$(q "$STRUCT_PROBE_A")" = "STRUCT_GREEN" ] && [ "$(q "$STRUCT_PROBE_B")" = "STRUCT_GREEN" ] \
  || bad "M6 前提:基準結構錨非綠"
gen_mutant 6a && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1
[ "$(q "$STRUCT_PROBE_A")" = "STRUCT_RED" ] && restore_base \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "M6a 鎖 SELECT 拔 ORDER BY ⇒ 結構錨紅、還原復位" || { bad "M6a"; restore_base; }
gen_mutant 6b && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1
[ "$(q "$STRUCT_PROBE_B")" = "STRUCT_RED" ] && restore_base \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "M6b INSERT SELECT 拔 ORDER BY ⇒ 結構錨紅、還原復位" || { bad "M6b"; restore_base; }
trap - EXIT

END12="$(snap12)" || { echo "🔴 snap12 終判失敗"; FAIL=$((FAIL+1)); END12="SNAP12-FAILED"; }
if [ "$BASE12" = "$END12" ] && [ "$CLEANUP_FAIL" -eq 0 ]; then ok "十二表零留痕(含 cleanup 零吞錯)"
else bad "留痕或 cleanup(CLEANUP_FAIL=$CLEANUP_FAIL):"; echo "  基線 $BASE12"; echo "  結束 $END12"; fi

echo "== 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECTED_TOTAL)=="
[ "$FAIL" -eq 0 ] || exit 1
[ "$PASS" -eq "$EXPECTED_TOTAL" ] || { echo "🔴 計數閘:PASS=$PASS ≠ $EXPECTED_TOTAL"; exit 1; }
exit 0
