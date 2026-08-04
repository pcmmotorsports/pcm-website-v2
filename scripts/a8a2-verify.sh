#!/usr/bin/env bash
# ============================================================
# A8a2 驗證 harness:admin_cancel_order 品項部分取消(6 參數版;繼承 a8a1-verify 全格)
# ============================================================
# plan = docs/specs/2026-08-05-e10-a8a2-partial-cancel-plan.md(v3)§4/§5
# 用法:provision(54331 副本、A8c1+A8c2+A8a1+A8a2 已套)後 scripts/a8a2-verify.sh /tmp/a8c-work
# 形狀=a8a1-verify.sh 全套慣例;A8a2 apply 後 a8a1-verify 身分閘合法失效、本檔繼任。
# vector 55 格=S1,S2,S3,S4 + I1,I2,I2b,I3,I5,I6,I7,I8,I9,I10,I11,I12,I13 + R1,R2,R3,R4,R5,R6,R6b,R7,R7b,R8,
# R9,R9b,R9c,R10,R11,R12,R13 + C9a,C9b + PC1,PC2,PC3
# + PS1,PS2,PS3,PS5,PG1,PI1,PI2,PI3,PI3b,PR1,PR2,PR3,PR4,PR5,PR7,PN1(部分取消 16 格)。
# 非 vector=G1/COMPAT/PCT/CC1,CC2/CCP1-CCP6/M2 示範(部分超量 23514)/M6a,b,c 結構/
# 前置閘負向×5(N1-N5)+A8a1 還原重放/剝殼。
# 突變 M1-M5,M7-M15(繼承;EXPECT 對新承重重算)+MD1-MD7(部分取消)+M6a,b,c(結構)。
# 判別力設計 Δ 注記(繼承注記見 a8a1-verify.sh 檔頭):
# - R9b 承重移到步 5 帳本健康閘③(零品項 header=病理);M10 恰殺 R9b/R9c。
# - I6/I10 承重移到冪等不變式③關單等價;M9 恰殺。
# - PS5=增量公式專屬判別(「曾到貨全鎖」錯誤實作在此紅);PR2=因 instock 超過剩餘才拒。
# - closed 重放權威=本 op audit;PI3(A8a1 三鍵關單形 fallback=true)/PI3b(剝鍵部分形=RAISE)。
# - PN1=row 37 fail-closed 正解:真相非零+摘要缺列 ⇒ 合法增量也拒;MD6 恰殺。
# ============================================================
set -uo pipefail

WORK="${1:-/tmp/a8c-work}"
PORT="${A8A1_VERIFY_PORT:-54331}"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"
export LC_ALL=C
MIGFILE="supabase/migrations/20260805100000_m4b_e10_a8a2_partial_cancel.sql"
MIG_A8A1="supabase/migrations/20260804180000_m4b_e10_a8a1_admin_cancel_order.sql"
MD5_NEW="e3f4cbcfaf26253f510283c0dbaee178"
MD5_A8A1="39173e33698e282cf7e5b35aae73d009"
MD5_BEGIN_A8C1="f621a56231e20f7f0b2618b40ac1276d"
MD5_CONFIRM_A8C2="6423848f965176c8a0c02917b8be9f52"
CMT_MD5_NEW="6395ffc5bec2e6b4dbd1c09a6c7d5381"
GENERIC="admin_cancel_order: 取消失敗"
FN_SIG="public.admin_cancel_order(uuid,uuid,text,text,text,jsonb)"
FN_SIG5="public.admin_cancel_order(uuid,uuid,text,text,text)"
BEGIN_SIG="public.begin_charge_attempt(uuid)"
CONFIRM_SIG="public.confirm_order_payment(uuid,integer,text)"
# G1 黃金(python hashlib 獨立算,非 PG):sha256('a8a1:v1:<oid>:other:G1  golden:full')
G1_OID="00000000-0000-4000-8000-0000a8a10001"
G1_HASH="5678b4f22974b36be0f97c93c684cec8aab03ce2163315a5a6f7747d5d38b93d"
# PG1 部分黃金:sha256('a8a1:v1:<oid>:customer_request::partial:<i1>=1,<i2>=2')(亂序請求 → 同 hash)
G2_OID="00000000-0000-4000-8000-0000a8a20001"
G2_I1="00000000-0000-4000-8000-0000a8a2aaa1"
G2_I2="00000000-0000-4000-8000-0000a8a2aaa2"
G2_HASH="55d1acc10b0457ffcefdf8a60581a209641fb18bb888517cbf001d40d202453f"

PASS=0; FAIL=0
EXPECTED_TOTAL=74
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
  || { echo "🔴 admin_cancel_order 非 A8a2 六參版;先套本片;拒跑"; exit 1; }
test -f "$MIG_A8A1" || { echo "🔴 $MIG_A8A1 不存在(A8a1 還原源);拒跑"; exit 1; }
[ "$(q "SELECT md5(pg_get_functiondef('$BEGIN_SIG'::regprocedure))")" = "$MD5_BEGIN_A8C1" ] \
  || { echo "🔴 begin 非 A8c1 新版(部署鏈);拒跑"; exit 1; }
[ "$(q "SELECT md5(pg_get_functiondef('$CONFIRM_SIG'::regprocedure))")" = "$MD5_CONFIRM_A8C2" ] \
  || { echo "🔴 confirm 非 A8c2 新版(部署鏈);拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM public.orders WHERE display_id LIKE 'PCM-998%'")" = "0" ] \
  || { echo "🔴 殘留 PCM-998* fixture;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM public.staff WHERE id IN ('sean','staff_1','staff_2') AND is_active")" = "3" ] \
  || { echo "🔴 staff fixture 不符(需 sean/staff_1/staff_2 全 active);拒跑"; exit 1; }
[ "$(q "SELECT md5(pg_get_functiondef('public.pcm_assert_cancellation_has_items()'::regprocedure)) || ',' ||
        md5(pg_get_functiondef('public.pcm_cancellation_ledger_block_truncate()'::regprocedure)) || ',' ||
        md5(pg_get_functiondef('public.pcm_a4a_cancellation_summary_recompute()'::regprocedure))")" = "834f8887a9c496b6a067b36a1b064aa0,883b4cfb51a3813a77e7d4662b94d9e8,90ced9bedc22ec68cfad770466f03178" ] \
  || { echo "🔴 A7-t/A4a helper md5 不符;拒跑"; exit 1; }
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

# ── oracle:定義唯一次數(6 參 CREATE 恰 1、5 參 DROP 恰 1)──────────
[ "$(grep -c 'CREATE FUNCTION public.admin_cancel_order' "$MIGFILE")" = "1" ] \
  && [ "$(grep -c 'DROP FUNCTION public.admin_cancel_order' "$MIGFILE")" = "1" ] \
  && ok "migration 檔內 CREATE 恰 1+DROP 恰 1" || bad "定義次數異常"

# ── 前置閘負向格×4 + A8a1 還原 + 剝殼 + 重放 ──────────────────
# N3:A8a2 已套(6 參在場)⇒ 前置閘 md5 RAISE(forward-only、防重複 apply)
N3OUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"; N3RC=$?
if [ "$N3RC" -ne 0 ] && printf '%s' "$N3OUT" | grep -q '非 5 參簽名;已套過本片'; then
  ok "N3 前置閘負向:A8a2 已套 ⇒ migration RAISE 拒重跑"
else bad "N3 rc=$N3RC"; fi
# A8a1 還原(基底態=前置閘成立;還原源=A8a1 migration 的函式段)
awk '/^CREATE OR REPLACE FUNCTION public.admin_cancel_order\(/,/^\$fn\$;$/' "$MIG_A8A1" > "$WORK/a8a1-fn.sql"
q "DROP FUNCTION $FN_SIG" >/dev/null
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-fn.sql" >/dev/null 2>&1
[ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG5'::regprocedure))")" = "$MD5_A8A1" ] \
  && ok "A8a1 還原:5 參基底 md5 復位(前置閘成立態)" || { bad "A8a1 還原失敗"; exit 1; }
q "SELECT pg_get_functiondef('$BEGIN_SIG'::regprocedure)" > "$WORK/a8a1-begin-cur.txt"
q "SELECT pg_get_functiondef('$CONFIRM_SIG'::regprocedure)" > "$WORK/a8a1-confirm-cur.txt"
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
# N5:A8a1 md5 閘負向(關卡2:同批順序唯一強制點要有負向格)
q "SELECT pg_get_functiondef('$FN_SIG5'::regprocedure)" > "$WORK/a8a2-a8a1-cur.txt"
python3 - "$WORK/a8a2-a8a1-cur.txt" "$WORK/a8a2-a8a1-drift.sql" <<'PYNEG'
import sys
s=open(sys.argv[1]).read()
a="BEGIN\n"
assert s.count(a)>=1
open(sys.argv[2],'w').write(s.replace(a,"BEGIN\n  -- md5gate-negative probe\n",1))
PYNEG
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a2-a8a1-drift.sql" >/dev/null 2>&1
N5OUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"; N5RC=$?
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-fn.sql" >/dev/null 2>&1
if [ "$N5RC" -ne 0 ] && printf '%s' "$N5OUT" | grep -q '非 A8a1 版' \
   && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG5'::regprocedure))")" = "$MD5_A8A1" ]; then
  ok "N5 前置閘負向:A8a1 md5 漂移 ⇒ RAISE(同批順序強制點)、還原復位"
else bad "N5 rc=$N5RC"; fi
# N4:A7-t/A4a trigger 面負向(codex R2:閘要有負向格,否則整段閘被刪=靜默假綠)
q "ALTER TABLE public.order_cancellation_items DISABLE TRIGGER order_cancellation_items_summary_recompute_ac" >/dev/null
N4OUT="$(psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" 2>&1)"; N4RC=$?
q "ALTER TABLE public.order_cancellation_items ENABLE TRIGGER order_cancellation_items_summary_recompute_ac" >/dev/null
if [ "$N4RC" -ne 0 ] && printf '%s' "$N4OUT" | grep -q 'trigger 三元組' \
   && [ "$(q "SELECT tgenabled FROM pg_trigger WHERE tgrelid='public.order_cancellation_items'::regclass AND tgname='order_cancellation_items_summary_recompute_ac'")" = "O" ]; then
  ok "N4 前置閘負向:trigger disabled ⇒ 第四組閘 RAISE、還原後 enabled 復位"
else bad "N4 rc=$N4RC"; fi
# 剝殼模擬(A8a1 基底態=前置閘成立;ROLLBACK 後 5 參版仍在)
grep -vE "^BEGIN;$|^COMMIT;$" "$MIGFILE" > "$WORK/a8a2-stripped.sql"
STRIPOUT="$( (echo "BEGIN;"; cat "$WORK/a8a2-stripped.sql"; echo "ROLLBACK;") | psql "$URL" -v ON_ERROR_STOP=1 -qtAX 2>&1)"
STRIPRC=$?
STRIPMD5="$(q "SELECT md5(pg_get_functiondef('$FN_SIG5'::regprocedure))")"
[ "$STRIPRC" -eq 0 ] && [ "$STRIPMD5" = "$MD5_A8A1" ] \
  && ok "剝殼模擬:單交易通過(斷言區全跑)、ROLLBACK 後 A8a1 基底復位" \
  || bad "剝殼模擬 rc=$STRIPRC md5=$STRIPMD5 — $(printf '%s' "$STRIPOUT" | grep -m1 ERROR | cut -c1-120)"
# 重放(綠路徑)+ md5 封條
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$MIGFILE" >/dev/null 2>&1 \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "migration 重放成功(前置閘五組綠)+ md5=封條" || { bad "重放失敗或 md5 不符"; exit 1; }
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
SELECT set_config('a8a1.detail', '<NULL>', true);
SELECT set_config('a8a1.items', '<NULL>', true);"; }
# 裸單 fixture(R13 零品項)
_fix_bare() { echo "
SELECT set_config('a8a1.disp', :'disp', true);
$FIX_ORDER \\gset o_
SELECT set_config('a8a1.oid', (:'o_id')::text, true);
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
SELECT set_config('a8a1.actor', 'sean', true);
SELECT set_config('a8a1.code', 'customer_request', true);
SELECT set_config('a8a1.detail', '<NULL>', true);
SELECT set_config('a8a1.items', '<NULL>', true);"; }

CALL_EXPR="public.admin_cancel_order(current_setting('a8a1.oid')::uuid, NULLIF(current_setting('a8a1.key'),'')::uuid,
    current_setting('a8a1.actor'), current_setting('a8a1.code'), NULLIF(current_setting('a8a1.detail'),'<NULL>'),
    NULLIF(current_setting('a8a1.items'),'<NULL>')::jsonb)"

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
                                       'cancellation_id', (v->>'cancellation_id')::uuid,
                                       'closed', true);
  SELECT count(*) INTO n_s FROM public.order_item_quantity_summary s
    JOIN public.order_items oi ON oi.id=s.order_item_id
   WHERE oi.order_id=current_setting('a8a1.oid')::uuid AND s.cancelled_quantity=oi.quantity;
  IF (v->>'cancelled')::boolean AND NOT (v->>'idempotent')::boolean AND (v->>'closed')::boolean
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
UPDATE public.orders SET cancelled_at=NULL, cancelled_reason=NULL WHERE id=:'o_id';
$EXPECT_RAISE"; }

cell_I11() { local D="$(next_disp)"; cell_intx I11 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
UPDATE public.orders SET cancelled_reason='殘值X' WHERE id=:'o_id';
$EXPECT_RAISE"; }

cell_I12() { local D="$(next_disp)"; cell_intx I12 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
DELETE FROM public.order_cancellation_items
 WHERE cancellation_id = (SELECT id FROM public.order_cancellations
                           WHERE order_id=:'o_id' AND idempotency_key=current_setting('a8a1.key')::uuid);
$EXPECT_RAISE"; }

# ── Δ 部分取消 P 家族(plan §4.1 v2c)─────────────────────
_setitems() { echo "SELECT set_config('a8a1.items', $1, true);"; }

cell_PS1() { local D="$(next_disp)"; cell_intx PS1 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
DO \$c\$ DECLARE v jsonb; o record; n_h int; n_i int; n_a int; n_s int; BEGIN
  v := $CALL_EXPR;
  SELECT cancelled_at, cancelled_reason INTO o FROM public.orders WHERE id=current_setting('a8a1.oid')::uuid;
  SELECT count(*) INTO n_h FROM public.order_cancellations WHERE order_id=current_setting('a8a1.oid')::uuid;
  SELECT count(*) INTO n_i FROM public.order_cancellation_items ci
   WHERE ci.order_id=current_setting('a8a1.oid')::uuid AND ci.cancelled_quantity=1;
  SELECT count(*) INTO n_a FROM public.admin_audit_log g
   WHERE g.request_id=current_setting('a8a1.key') AND (g.after->>'closed')::boolean = false;
  n_s := (SELECT count(*) FROM public.order_item_quantity_summary s
           JOIN public.order_items oi ON oi.id=s.order_item_id
          WHERE oi.order_id=current_setting('a8a1.oid')::uuid AND s.cancelled_quantity=1);
  IF (v->>'cancelled')::boolean AND NOT (v->>'closed')::boolean
     AND o.cancelled_at IS NULL AND o.cancelled_reason IS NULL
     AND n_h=1 AND n_i=1 AND n_a=1 AND n_s=1
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL v=% o=% h=% i=% a=% s=%', v, o, n_h, n_i, n_a, n_s; END IF;
END \$c\$;"; }

cell_PS2() { local D="$(next_disp)"; cell_intx PS2 "
\\set disp $D
$(_fix)
SELECT set_config('a8a1.k1', current_setting('a8a1.key'), true);
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
SELECT set_config('a8a1.items1', current_setting('a8a1.items'), true);
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; IF (v->>'closed')::boolean THEN RAISE EXCEPTION 'CELLFAIL 首刀不應關單'; END IF; END \$p\$;
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
SELECT set_config('a8a1.code', 'duplicate_order', true);
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1), jsonb_build_object('order_item_id', (:'i2_id')::text, 'quantity', 3))::text")
DO \$c\$ DECLARE v jsonb; o record; BEGIN
  v := $CALL_EXPR;
  SELECT cancelled_at, cancelled_reason INTO o FROM public.orders WHERE id=current_setting('a8a1.oid')::uuid;
  IF NOT (v->>'closed')::boolean OR o.cancelled_at IS NULL OR o.cancelled_reason <> '重複訂單,已為您取消' THEN
    RAISE EXCEPTION 'CELLFAIL 關單刀 v=% o=%', v, o;
  END IF;
END \$c\$;
SELECT set_config('a8a1.key', current_setting('a8a1.k1'), true);
SELECT set_config('a8a1.code', 'customer_request', true);
SELECT set_config('a8a1.items', current_setting('a8a1.items1'), true);
DO \$r\$ DECLARE v jsonb; BEGIN
  v := $CALL_EXPR;
  IF (v->>'idempotent')::boolean AND NOT (v->>'closed')::boolean
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL 首刀重放 closed 應=false(audit 權威)v=%', v; END IF;
END \$r\$;"; }

cell_PS3() { local D="$(next_disp)"; cell_intx PS3 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
SELECT set_config('a8a1.code', 'out_of_stock', true);
SELECT set_config('a8a1.items', '<NULL>', true);
DO \$c\$ DECLARE v jsonb; o record; n int; BEGIN
  v := $CALL_EXPR;
  SELECT cancelled_at, cancelled_reason INTO o FROM public.orders WHERE id=current_setting('a8a1.oid')::uuid;
  n := (SELECT count(*) FROM public.order_cancellation_items ci WHERE ci.cancellation_id=(v->>'cancellation_id')::uuid);
  IF NOT (v->>'closed')::boolean OR o.cancelled_at IS NULL OR o.cancelled_reason <> '商品供貨中斷,已為您取消'
     OR n <> 2 THEN
    RAISE EXCEPTION 'CELLFAIL 收尾 v=% o=% n=%', v, o, n;
  END IF;
  RAISE NOTICE 'CELLOK';
END \$c\$;"; }

cell_PS5() { local D="$(next_disp)"; cell_intx PS5 "
\\set disp $D
SELECT set_config('a8a1.disp', :'disp', true);
$FIX_ORDER \\gset o_
SELECT set_config('a8a1.oid', (:'o_id')::text, true);
INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES (:'o_id', 'A8A2PS5-' || :'disp', jsonb_build_object('title','a8a2','sku','A','spec',jsonb_build_object()), 5, 0, 0)
RETURNING id \\gset i1_
INSERT INTO public.order_item_procurement (id, order_item_id, allocated_quantity, supplier_id)
VALUES (gen_random_uuid(), :'i1_id', 2, :'supp') RETURNING id \\gset p_
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
VALUES (:'p_id', 2, now(), 'sean');
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
SELECT set_config('a8a1.actor','sean',true); SELECT set_config('a8a1.code','customer_request',true);
SELECT set_config('a8a1.detail','<NULL>',true);
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 3))::text")
DO \$c\$ DECLARE v jsonb; BEGIN
  v := $CALL_EXPR;
  IF NOT (v->>'cancelled')::boolean OR (v->>'closed')::boolean THEN
    RAISE EXCEPTION 'CELLFAIL 切 3 應成且未關單 %', v;
  END IF;
END \$c\$;
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
$EXPECT_RAISE"; }

cell_PG1() { local D="$(next_disp)"; cell_intx PG1 "
\\set disp $D
SELECT set_config('a8a1.disp', :'disp', true);
INSERT INTO public.orders (id, display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
  subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
VALUES ('$G2_OID', :'disp', :'cust', jsonb_build_object('name','a8a2','phone','0900000000','line','x'),
  'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid());
INSERT INTO public.order_items (id, order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
VALUES ('$G2_I1', '$G2_OID', 'A8A2G2A-' || :'disp', jsonb_build_object('title','a8a2','sku','A','spec',jsonb_build_object()), 1, 0, 0),
       ('$G2_I2', '$G2_OID', 'A8A2G2B-' || :'disp', jsonb_build_object('title','a8a2','sku','B','spec',jsonb_build_object()), 2, 0, 0);
DO \$c\$ DECLARE v jsonb; v_hash text; BEGIN
  -- 請求刻意亂序(i2 在前)⇒ canonical 排序後 hash=python 常數
  v := public.admin_cancel_order('$G2_OID', gen_random_uuid(), 'sean', 'customer_request', NULL,
        jsonb_build_array(jsonb_build_object('order_item_id', '$G2_I2', 'quantity', 2),
                          jsonb_build_object('order_item_id', '$G2_I1', 'quantity', 1)));
  SELECT payload_hash INTO v_hash FROM public.order_cancellations WHERE order_id='$G2_OID';
  IF v_hash <> '$G2_HASH' THEN RAISE EXCEPTION 'CELLFAIL hash=[%]', v_hash; END IF;
END \$c\$;
DO \$u\$ DECLARE v jsonb; BEGIN
  -- 大寫 uuid 變體+同鍵 ⇒ canonical 正規化後同 hash ⇒ idempotent:true(關卡2 折入)
  v := public.admin_cancel_order('$G2_OID',
        (SELECT idempotency_key FROM public.order_cancellations WHERE order_id='$G2_OID'),
        'sean', 'customer_request', NULL,
        jsonb_build_array(jsonb_build_object('order_item_id', upper('$G2_I2'), 'quantity', 2),
                          jsonb_build_object('order_item_id', upper('$G2_I1'), 'quantity', 1)));
  IF (v->>'idempotent')::boolean THEN RAISE NOTICE 'CELLOK';
  ELSE RAISE EXCEPTION 'CELLFAIL 大寫變體未收斂同 hash %', v; END IF;
END \$u\$;"; }

cell_PI1() { local D="$(next_disp)"; cell_intx PI1 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
DO \$c\$ DECLARE v1 jsonb; v2 jsonb; n_h int; n_i int; BEGIN
  v1 := $CALL_EXPR;
  v2 := $CALL_EXPR;
  SELECT count(*) INTO n_h FROM public.order_cancellations WHERE order_id=current_setting('a8a1.oid')::uuid;
  SELECT count(*) INTO n_i FROM public.order_cancellation_items WHERE order_id=current_setting('a8a1.oid')::uuid;
  IF (v2->>'idempotent')::boolean AND NOT (v2->>'closed')::boolean
     AND v2->>'cancellation_id' = v1->>'cancellation_id' AND n_h=1 AND n_i=1
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL v1=% v2=% h=% i=%', v1, v2, n_h, n_i; END IF;
END \$c\$;"; }

cell_PI2() { local D="$(next_disp)"; cell_intx PI2 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i2_id')::text, 'quantity', 1))::text")
$EXPECT_RAISE"; }

cell_PI3() { local D="$(next_disp)"; cell_intx PI3 "
\\set disp $D
$(_fix)
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
UPDATE public.admin_audit_log SET after = after - 'closed'
 WHERE request_id = current_setting('a8a1.key');
DO \$c\$ DECLARE v jsonb; BEGIN
  v := $CALL_EXPR;
  IF (v->>'idempotent')::boolean AND (v->>'closed')::boolean
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL A8a1 形 fallback v=%', v; END IF;
END \$c\$;"; }

cell_PI3b() { local D="$(next_disp)"; cell_intx PI3b "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
UPDATE public.admin_audit_log SET after = after - 'closed'
 WHERE request_id = current_setting('a8a1.key');
$EXPECT_RAISE"; }

cell_PR1() { local D="$(next_disp)"; cell_intx PR1 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 3))::text")
$EXPECT_RAISE"; }

cell_PR2() { local D="$(next_disp)"; cell_intx PR2 "
\\set disp $D
$(_fix)
INSERT INTO public.order_item_procurement (id, order_item_id, allocated_quantity, supplier_id)
VALUES (gen_random_uuid(), :'i1_id', 2, :'supp') RETURNING id \\gset p_
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
VALUES (:'p_id', 2, now(), 'sean');
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
$EXPECT_RAISE"; }

cell_PR3() { local D="$(next_disp)"; cell_intx PR3 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', '00000000-0000-4000-8000-00000000beef', 'quantity', 1))::text")
$EXPECT_RAISE"; }

cell_PR4() { local D="$(next_disp)"; cell_intx PR4 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1), jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
SELECT set_config('a8a1.expmsg', 'admin_cancel_order: 品項重複', true);
$EXPECT_RAISE"; }

cell_PR5() { local D="$(next_disp)"; cell_intx PR5 "
\\set disp $D
$(_fix)
DO \$c\$ DECLARE
  v jsonb;
  i1 text := (SELECT id::text FROM public.order_items WHERE order_id=current_setting('a8a1.oid')::uuid ORDER BY id LIMIT 1);
  probes jsonb;
  p record;
BEGIN
  probes := jsonb_build_array(
    jsonb_build_object('it', 'null'::jsonb,  'msg', 'admin_cancel_order: 品項清單需為非空陣列'),
    jsonb_build_object('it', '5'::jsonb,     'msg', 'admin_cancel_order: 品項清單需為非空陣列'),
    jsonb_build_object('it', '{}'::jsonb,    'msg', 'admin_cancel_order: 品項清單需為非空陣列'),
    jsonb_build_object('it', '[]'::jsonb,    'msg', 'admin_cancel_order: 品項清單需為非空陣列'),
    jsonb_build_object('it', '[1]'::jsonb,   'msg', 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity'),
    jsonb_build_object('it', jsonb_build_array(jsonb_build_object('order_item_id', i1)), 'msg', 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity'),
    jsonb_build_object('it', jsonb_build_array(jsonb_build_object('order_item_id', i1, 'quantity', 1, 'extra', 2)), 'msg', 'admin_cancel_order: 品項元素需恰含 order_item_id 與 quantity'),
    jsonb_build_object('it', '[{\"order_item_id\":\"not-a-uuid\",\"quantity\":1}]'::jsonb, 'msg', 'admin_cancel_order: 品項識別碼格式錯誤'),
    jsonb_build_object('it', jsonb_build_array(jsonb_build_object('order_item_id', i1, 'quantity', '1')), 'msg', 'admin_cancel_order: 品項數量需為正整數'),
    jsonb_build_object('it', jsonb_build_array(jsonb_build_object('order_item_id', i1, 'quantity', true)), 'msg', 'admin_cancel_order: 品項數量需為正整數'),
    jsonb_build_object('it', ('[{\"order_item_id\":\"' || i1 || '\",\"quantity\":null}]')::jsonb, 'msg', 'admin_cancel_order: 品項數量需為正整數'),
    jsonb_build_object('it', ('[{\"order_item_id\":\"' || i1 || '\",\"quantity\":1.0}]')::jsonb, 'msg', 'admin_cancel_order: 品項數量需為正整數'),
    jsonb_build_object('it', ('[{\"order_item_id\":\"' || i1 || '\",\"quantity\":-1}]')::jsonb, 'msg', 'admin_cancel_order: 品項數量需為正整數'),
    jsonb_build_object('it', jsonb_build_array(jsonb_build_object('order_item_id', i1, 'quantity', 0)), 'msg', 'admin_cancel_order: 品項數量超出範圍'));
  FOR p IN SELECT (e->'it') AS it, (e->>'msg') AS msg FROM jsonb_array_elements(probes) x(e) LOOP
    BEGIN
      v := public.admin_cancel_order(current_setting('a8a1.oid')::uuid, gen_random_uuid(),
             'sean', 'customer_request', NULL, p.it);
      RAISE EXCEPTION 'CELLFAIL 未拒 items=% got=%', p.it, v;
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM <> p.msg THEN
        RAISE EXCEPTION 'CELLFAIL items=% msg=[%] want=[%]', p.it, SQLERRM, p.msg;
      END IF;
    END;
  END LOOP;
  RAISE NOTICE 'CELLOK';
END \$c\$;"; }

cell_PR7() { local D="$(next_disp)"; cell_intx PR7 "
\\set disp $D
$(_fix)
DO \$c\$ DECLARE v jsonb; i1 text := (SELECT id::text FROM public.order_items WHERE order_id=current_setting('a8a1.oid')::uuid ORDER BY id LIMIT 1); BEGIN
  BEGIN
    v := public.admin_cancel_order(current_setting('a8a1.oid')::uuid, gen_random_uuid(), 'sean', 'customer_request', NULL,
          jsonb_build_array(jsonb_build_object('order_item_id', i1, 'quantity', 2147483647)));
    RAISE EXCEPTION 'CELLFAIL int 上界未被守門拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'admin_cancel_order: 取消失敗' THEN RAISE; END IF;
  END;
  BEGIN
    v := public.admin_cancel_order(current_setting('a8a1.oid')::uuid, gen_random_uuid(), 'sean', 'customer_request', NULL,
          jsonb_build_array(jsonb_build_object('order_item_id', i1, 'quantity', 2147483648::bigint)));
    RAISE EXCEPTION 'CELLFAIL 超 int 未拒(%)', v;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'admin_cancel_order: 品項數量超出範圍' THEN RAISE NOTICE 'CELLOK'; ELSE RAISE; END IF;
  END;
END \$c\$;"; }

cell_PN1() { local D="$(next_disp)"; cell_intx PN1 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1))::text")
DO \$p\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$p\$;
DELETE FROM public.order_item_quantity_summary WHERE order_item_id = :'i1_id';
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i2_id')::text, 'quantity', 1))::text")
$EXPECT_RAISE"; }

cell_I13() { local D="$(next_disp)"; cell_intx I13 "
\\set disp $D
$(_fix)
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1), jsonb_build_object('order_item_id', (:'i2_id')::text, 'quantity', 1))::text")
DO \$a\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR; END \$a\$;
SELECT set_config('a8a1.keyA', current_setting('a8a1.key'), true);
SELECT set_config('a8a1.key', gen_random_uuid()::text, true);
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 1), jsonb_build_object('order_item_id', (:'i2_id')::text, 'quantity', 2))::text")
DO \$b\$ DECLARE v jsonb; BEGIN v := $CALL_EXPR;
  IF NOT (v->>'closed')::boolean THEN RAISE EXCEPTION 'CELLFAIL B 應關單 %', v; END IF; END \$b\$;
DELETE FROM public.order_cancellation_items
 WHERE order_item_id = :'i1_id'
   AND cancellation_id = (SELECT id FROM public.order_cancellations
                           WHERE order_id=:'o_id' AND idempotency_key=current_setting('a8a1.keyA')::uuid);
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
SELECT set_config('a8a1.items', '<NULL>', true);
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
  cell_I11 && v="${v}1" || v="${v}0"
  cell_I12 && v="${v}1" || v="${v}0"
  cell_I13 && v="${v}1" || v="${v}0"
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
  cell_PS1 && v="${v}1" || v="${v}0"
  cell_PS2 && v="${v}1" || v="${v}0"
  cell_PS3 && v="${v}1" || v="${v}0"
  cell_PS5 && v="${v}1" || v="${v}0"
  cell_PG1 && v="${v}1" || v="${v}0"
  cell_PI1 && v="${v}1" || v="${v}0"
  cell_PI2 && v="${v}1" || v="${v}0"
  cell_PI3 && v="${v}1" || v="${v}0"
  cell_PI3b && v="${v}1" || v="${v}0"
  cell_PR1 && v="${v}1" || v="${v}0"
  cell_PR2 && v="${v}1" || v="${v}0"
  cell_PR3 && v="${v}1" || v="${v}0"
  cell_PR4 && v="${v}1" || v="${v}0"
  cell_PR5 && v="${v}1" || v="${v}0"
  cell_PR7 && v="${v}1" || v="${v}0"
  cell_PN1 && v="${v}1" || v="${v}0"
  printf '%s' "$v"
}

echo "== 基線 55 格 vector(S×4 I×13 R×17 C9×2 PC×3 P×16)=="
BASE_VEC="$(run_vector)"
if [ "$BASE_VEC" = "1111111111111111111111111111111111111111111111111111111" ]; then ok "基線 vector 全綠($BASE_VEC)"
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

# ── COMPAT:5 參 positional/named 相容 + pronargs 斷言 ─────────
D_CP="$(next_disp)"; D_CP2="$(next_disp)"
cell_intx COMPAT "
\\set disp $D_CP
$(_fix)
DO \$c\$ DECLARE v jsonb; v_oid2 uuid; v_i2 uuid; BEGIN
  v := public.admin_cancel_order(current_setting('a8a1.oid')::uuid, gen_random_uuid(), 'sean', 'customer_request', NULL);
  IF NOT (v->>'closed')::boolean THEN RAISE EXCEPTION 'CELLFAIL positional 5 參 %', v; END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
    subtotal, shipping_fee, total, shipping_method, invoice, cart_session_id)
  VALUES ('$D_CP2', current_setting('a8a1.cust')::uuid,
    jsonb_build_object('name','a8a2','phone','0900000000','line','x'),
    'general'::public.member_tier, 100, 0, 100, 'store', jsonb_build_object('type','personal'), gen_random_uuid())
  RETURNING id INTO v_oid2;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_oid2, 'A8A2CP-' || current_setting('a8a1.disp'), jsonb_build_object('title','a8a2','sku','A','spec',jsonb_build_object()), 1, 0, 0)
  RETURNING id INTO v_i2;
  v := public.admin_cancel_order(p_order_id => v_oid2, p_idempotency_key => gen_random_uuid(),
        p_actor => 'sean', p_reason_code => 'customer_request', p_reason_detail => NULL);
  IF NOT (v->>'closed')::boolean THEN RAISE EXCEPTION 'CELLFAIL named 5 參 %', v; END IF;
  RAISE NOTICE 'CELLOK';
END \$c\$;" \
  && [ "$(q "SELECT pronargs::text || '/' || pronargdefaults::text FROM pg_proc WHERE oid='$FN_SIG'::regprocedure")" = "6/1" ] \
  && ok "COMPAT:5 參 positional+named 實呼綠+pronargs=6/pronargdefaults=1" \
  || bad "COMPAT — ${CELL_ERR:-}"

# ── SR1:service_role 實呼(SECDEF 行為面;結構 prosecdef assert 之外的活體證明)──
D_SR="$(next_disp)"
cell_intx SR1 "
\\set disp $D_SR
$(_fix)
SET LOCAL ROLE service_role;
DO \$c\$ DECLARE v jsonb; BEGIN
  v := public.admin_cancel_order(current_setting('a8a1.oid')::uuid, gen_random_uuid(), 'sean', 'customer_request', NULL,
        jsonb_build_array(jsonb_build_object('order_item_id',
          (SELECT id::text FROM public.order_items WHERE order_id=current_setting('a8a1.oid')::uuid ORDER BY id LIMIT 1),
          'quantity', 1)));
  IF (v->>'cancelled')::boolean AND NOT (v->>'closed')::boolean AND current_user = 'service_role'
  THEN RAISE NOTICE 'CELLOK'; ELSE RAISE EXCEPTION 'CELLFAIL v=% user=%', v, current_user; END IF;
END \$c\$;
RESET ROLE;" \
  && ok "SR1 service_role 實呼:SECDEF 生效、部分取消成功(非 owner 路徑活體證明)" \
  || bad "SR1 — ${CELL_ERR:-}"

# ── PCT:函式級 lock_timeout=5s 實證(items 鎖被佔 ⇒ 55P03、非永久等)──
D_PT="$(next_disp)"; O_PT="$(mkord_committed "$D_PT")"
q "INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
   VALUES ('$O_PT', 'A8A2PT-$D_PT', jsonb_build_object('title','a8a2','sku','A','spec',jsonb_build_object()), 2, 0, 0)" >/dev/null
I_PT="$(q "SELECT id FROM public.order_items WHERE order_id='$O_PT'")"
APPH="a8a2_pth_$RANDOM$$"; APPW="a8a2_ptw_$RANDOM$$"
psql "$URL?application_name=$APPH" -qtAX <<SQL >/dev/null 2>&1 &
BEGIN; SELECT id FROM public.order_items WHERE order_id='$O_PT' FOR UPDATE; SELECT pg_sleep(8); ROLLBACK;
SQL
HP=$!
sleep 0.5
psql "$URL?application_name=$APPW" -qtAX -c "\set VERBOSITY verbose" \
  -c "SELECT public.admin_cancel_order('$O_PT', gen_random_uuid(), 'sean', 'customer_request', NULL,
        jsonb_build_array(jsonb_build_object('order_item_id', '$I_PT', 'quantity', 1)))" > "$WORK/pct.out" 2>&1 &
WP=$!
PCTBARR=1
wait_blocked_by "$APPW" "$APPH" 3 && PCTBARR=0
wait $WP
PCTSTATE="$(sed -n 's/^ERROR:[[:space:]]*\([0-9A-Z]\{5\}\).*/\1/p' "$WORK/pct.out" | head -1)"
NH_PT="$(q "SELECT count(*) FROM public.order_cancellations WHERE order_id='$O_PT'")"
wait $HP
[ "$PCTBARR" -eq 0 ] && [ "$PCTSTATE" = "55P03" ] && [ "$NH_PT" = "0" ] \
  && ok "PCT lock_timeout:items 鎖被佔 ⇒ 5s 後 55P03 fail-closed、零產物(proconfig 實證)" \
  || bad "PCT barrier=$PCTBARR state=$PCTSTATE h=$NH_PT"
cleanup_disp "$D_PT"

# ── CCP1-6:部分取消併發 barrier 族 ───────────────────────
ccp_pair() {  # $1=label $2=A-side SQL(hold tx) $3=B-side cmd $4=B expect rc(0|1) $5=B grep pattern(空=略)
  local lbl="$1" asql="$2" bcmd="$3" brc="$4" bpat="$5"
  local APPA="a8a2_${lbl}a_$RANDOM$$" APPB="a8a2_${lbl}b_$RANDOM$$"
  psql "$URL?application_name=$APPA" -v ON_ERROR_STOP=1 -qtAX <<SQL > "$WORK/${lbl}-a.out" 2>&1 &
BEGIN;
$asql
SELECT pg_sleep(3);
COMMIT;
SQL
  CCPA=$!
  sleep 0.5
  psql "$URL?application_name=$APPB" -v ON_ERROR_STOP=1 -tAX -c "$bcmd" > "$WORK/${lbl}-b.out" 2>&1 &
  CCPB=$!
  CCPBARR=1
  wait_blocked_by "$APPB" "$APPA" 3 && CCPBARR=0
  wait $CCPB; CCPRC=$?
  wait $CCPA; CCPARC=$?
  [ "$CCPBARR" -eq 0 ] && [ "$CCPARC" -eq 0 ] || { CELL_ERR="$lbl barrier=$CCPBARR arc=$CCPARC"; return 1; }
  if [ "$brc" = "0" ]; then [ "$CCPRC" -eq 0 ] || { CELL_ERR="$lbl brc=$CCPRC"; return 1; }
  else [ "$CCPRC" -ne 0 ] || { CELL_ERR="$lbl B 未被拒"; return 1; }; fi
  if [ -n "$bpat" ]; then grep -q "$bpat" "$WORK/${lbl}-b.out" || { CELL_ERR="$lbl B 輸出無 [$bpat]"; return 1; }; fi
  return 0
}
mkord2() {  # 建單+兩品項(2,3);echo "oid i1 i2"
  local D="$1" O I1 I2
  O="$(mkord_committed "$D")"
  I1="$(q "INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
     VALUES ('$O', 'A8A2X1-$D', jsonb_build_object('title','a8a2','sku','A','spec',jsonb_build_object()), 2, 0, 0) RETURNING id")"
  I2="$(q "INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
     VALUES ('$O', 'A8A2X2-$D', jsonb_build_object('title','a8a2','sku','B','spec',jsonb_build_object()), 3, 0, 0) RETURNING id")"
  echo "$O $I1 $I2"
}
pj() { echo "jsonb_build_array(jsonb_build_object('order_item_id', '$1', 'quantity', $2))"; }

# CCP1:部分×部分同品項(qty2、雙方各要 2)⇒ 恰一成一敗、Σci=2、恰 1 header
D_C1="$(next_disp)"; read O1 I1A I1B <<< "$(mkord2 "$D_C1")"
if ccp_pair ccp1 "SELECT public.admin_cancel_order('$O1', gen_random_uuid(), 'sean', 'customer_request', NULL, $(pj "$I1A" 2));" \
    "SELECT public.admin_cancel_order('$O1', gen_random_uuid(), 'sean', 'customer_request', NULL, $(pj "$I1A" 2))" 1 "$GENERIC" \
   && [ "$(q "SELECT coalesce(sum(cancelled_quantity),0) FROM public.order_cancellation_items ci JOIN public.order_items oi ON oi.id=ci.order_item_id WHERE oi.id='$I1A'")" = "2" ] \
   && [ "$(q "SELECT count(*) FROM public.order_cancellations WHERE order_id='$O1'")" = "1" ]; then
  ok "CCP1 部分×部分同品項:恰一成一敗、Σci=2、單 header"
else bad "CCP1 — ${CELL_ERR:-帳面不符}"; fi
cleanup_disp "$D_C1"

# CCP2a:部分先 → 整單收尾 = 2 headers 且關單
D_C2="$(next_disp)"; read O2 I2A I2B <<< "$(mkord2 "$D_C2")"
if ccp_pair ccp2a "SELECT public.admin_cancel_order('$O2', gen_random_uuid(), 'sean', 'customer_request', NULL, $(pj "$I2A" 1));" \
    "SELECT public.admin_cancel_order('$O2', gen_random_uuid(), 'sean', 'customer_request', NULL)" 0 "" \
   && [ "$(q "SELECT count(*) FROM public.order_cancellations WHERE order_id='$O2'")" = "2" ] \
   && [ "$(q "SELECT count(*) FROM public.orders WHERE id='$O2' AND cancelled_at IS NOT NULL")" = "1" ]; then
  ok "CCP2a 部分先→整單:2 headers+關單"
else bad "CCP2a — ${CELL_ERR:-帳面不符}"; fi
cleanup_disp "$D_C2"

# CCP2b:整單先 → 部分 = 1 header 且部分被拒
D_C3="$(next_disp)"; read O3 I3A I3B <<< "$(mkord2 "$D_C3")"
if ccp_pair ccp2b "SELECT public.admin_cancel_order('$O3', gen_random_uuid(), 'sean', 'customer_request', NULL);" \
    "SELECT public.admin_cancel_order('$O3', gen_random_uuid(), 'sean', 'customer_request', NULL, $(pj "$I3A" 1))" 1 "$GENERIC" \
   && [ "$(q "SELECT count(*) FROM public.order_cancellations WHERE order_id='$O3'")" = "1" ]; then
  ok "CCP2b 整單先→部分:1 header+部分拒"
else bad "CCP2b — ${CELL_ERR:-帳面不符}"; fi
cleanup_disp "$D_C3"

# CCP3:部分 cancel 先持鎖 → begin 醒來拒(A8c1 守門)、零 attempt
D_C4="$(next_disp)"; read O4 I4A I4B <<< "$(mkord2 "$D_C4")"
if ccp_pair ccp3 "SELECT public.admin_cancel_order('$O4', gen_random_uuid(), 'sean', 'customer_request', NULL, $(pj "$I4A" 1));" \
    "SELECT public.begin_charge_attempt('$O4')" 1 "begin_charge_attempt: 付款處理失敗" \
   && [ "$(q "SELECT count(*) FROM public.payment_charge_attempts WHERE order_id='$O4'")" = "0" ]; then
  ok "CCP3 部分先→begin 拒、零 attempt"
else bad "CCP3 — ${CELL_ERR:-帳面不符}"; fi
cleanup_disp "$D_C4"

# CCP4:begin 先取得 pending → 部分 cancel 醒來允許集合拒
D_C5="$(next_disp)"; read O5 I5A I5B <<< "$(mkord2 "$D_C5")"
if ccp_pair ccp4 "SELECT public.begin_charge_attempt('$O5');" \
    "SELECT public.admin_cancel_order('$O5', gen_random_uuid(), 'sean', 'customer_request', NULL, $(pj "$I5A" 1))" 1 "$GENERIC" \
   && [ "$(q "SELECT count(*) FROM public.order_cancellations WHERE order_id='$O5'")" = "0" ] \
   && [ "$(q "SELECT count(*) FROM public.payment_charge_attempts WHERE order_id='$O5' AND status='pending'")" = "1" ]; then
  ok "CCP4 begin 先→部分拒、pending 保留"
else bad "CCP4 — ${CELL_ERR:-帳面不符}"; fi
cleanup_disp "$D_C5"

# CCP5:部分 cancel 先持鎖 → confirm 醒來取消守門拒、未翻 paid
D_C6="$(next_disp)"; read O6 I6A I6B <<< "$(mkord2 "$D_C6")"
if ccp_pair ccp5 "SELECT public.admin_cancel_order('$O6', gen_random_uuid(), 'sean', 'customer_request', NULL, $(pj "$I6A" 1));" \
    "SELECT public.confirm_order_payment('$O6', 100, 'RECCCP5$D_C6')" 1 "confirm_order_payment: 付款確認失敗" \
   && [ "$(q "SELECT payment_status FROM public.orders WHERE id='$O6'")" = "unpaid" ]; then
  ok "CCP5 部分先→confirm 拒、未翻 paid"
else bad "CCP5 — ${CELL_ERR:-帳面不符}"; fi
cleanup_disp "$D_C6"

# CCP6:confirm 先翻 paid → 部分 cancel 醒來允許集合拒
D_C7="$(next_disp)"; read O7 I7A I7B <<< "$(mkord2 "$D_C7")"
if ccp_pair ccp6 "SELECT public.confirm_order_payment('$O7', 100, 'RECCCP6$D_C7');" \
    "SELECT public.admin_cancel_order('$O7', gen_random_uuid(), 'sean', 'customer_request', NULL, $(pj "$I7A" 1))" 1 "$GENERIC" \
   && [ "$(q "SELECT count(*) FROM public.order_cancellations WHERE order_id='$O7'")" = "0" ] \
   && [ "$(q "SELECT payment_status FROM public.orders WHERE id='$O7'")" = "paid" ]; then
  ok "CCP6 confirm 先→部分拒、paid 保留"
else bad "CCP6 — ${CELL_ERR:-帳面不符}"; fi
cleanup_disp "$D_C7"

# ── 突變矩陣 ─────────────────────────────────────────
echo "== 突變矩陣 ×55 格 =="
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
M2FULLINSTOCK = """    IF EXISTS (SELECT 1 FROM public.order_items oi
                WHERE oi.order_id = p_order_id
                  AND coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                                  JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                                 WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;"""
M7CLOSE = """  IF v_closed THEN
    UPDATE public.orders
       SET cancelled_at = pg_catalog.now(),
           cancelled_reason = v_reason_txt,
           updated_at = pg_catalog.now()
     WHERE id = p_order_id;
    -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
    GET DIAGNOSTICS v_bad = ROW_COUNT;
    IF v_bad <> 1 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;
  END IF;"""
M9CLOSEEQ = """    IF (v_order.cancelled_at IS NOT NULL) <> (NOT EXISTS (
          SELECT 1 FROM public.order_items oi
           WHERE oi.order_id = p_order_id
             AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                            WHERE ci.order_item_id = oi.id), 0) < oi.quantity::bigint)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;"""
MD7HEALTH = """  IF v_order.cancelled_reason IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.order_items oi
                 WHERE oi.order_id = p_order_id
                   AND coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                                  WHERE ci.order_item_id = oi.id), 0) > oi.quantity::bigint)
     OR EXISTS (SELECT 1 FROM public.order_cancellations c
                 WHERE c.order_id = p_order_id
                   AND NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                    WHERE ci.cancellation_id = c.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
M10STEP5 = """  IF v_order.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;
""" + MD7HEALTH
M12ITEMCNT = """  -- items 筆數守:BEFORE trigger 抑制單列 ⇒ 部分取消冒充請求集;必=預期筆數
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> v_expect THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
M13AUDITCNT = """  -- audit 筆數守:trigger 抑制 ⇒ 零稽核的成功取消;必恰 1
  GET DIAGNOSTICS v_bad = ROW_COUNT;
  IF v_bad <> 1 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
M14ORDGUARD = """    -- row_count 守(PF-C 同款):trigger 抑制/FORCE RLS ⇒ 對客欄靜默漏寫=產物集不一致,必炸全回滾
    GET DIAGNOSTICS v_bad = ROW_COUNT;
    IF v_bad <> 1 THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;"""
MD1PARTGUARD = """    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
      JOIN public.order_items oi ON oi.id = (el->>'order_item_id')::uuid
      WHERE (el->>'quantity')::bigint > oi.quantity::bigint
            - coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                          JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                         WHERE p.order_item_id = oi.id AND r.quantity > 0), 0)
            - coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;"""
MD2INSTOCKTERM = """            - coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                          JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                         WHERE p.order_item_id = oi.id AND r.quantity > 0), 0)"""
MD3CLOSED = """  v_closed := NOT EXISTS (
    SELECT 1 FROM public.order_items oi
     WHERE oi.order_id = p_order_id
       AND oi.quantity::bigint > coalesce((SELECT sum(ci.cancelled_quantity)::bigint
                                             FROM public.order_cancellation_items ci
                                            WHERE ci.order_item_id = oi.id), 0));"""
MD4CANON = """',' ORDER BY ((el->>'order_item_id')::uuid)::text)"""
MD5BELONG = """    IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                WHERE NOT EXISTS (SELECT 1 FROM public.order_items oi
                                   WHERE oi.id = (el->>'order_item_id')::uuid AND oi.order_id = p_order_id)) THEN
      RAISE EXCEPTION '%', v_generic_msg;
    END IF;"""
MD6SUMGATE = """  IF EXISTS (
    SELECT 1 FROM public.order_items oi
    WHERE oi.order_id = p_order_id
      AND (coalesce((SELECT sum(r.quantity)::bigint FROM public.order_item_procurement p
                       JOIN public.order_item_procurement_receipts r ON r.procurement_id = p.id
                      WHERE p.order_item_id = oi.id AND r.quantity > 0), 0) > 0
           OR coalesce((SELECT sum(ci.cancelled_quantity)::bigint FROM public.order_cancellation_items ci
                         WHERE ci.order_item_id = oi.id), 0) > 0)
      AND NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = oi.id)) THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
ALLOWED = """  IF v_order.payment_status <> 'unpaid'::public.payment_status
     OR EXISTS (SELECT 1 FROM public.payment_charge_attempts a
                 WHERE a.order_id = p_order_id AND a.status <> 'failed') THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
HASHCHK = """    IF v_existing.payload_hash IS DISTINCT FROM v_hash
       OR v_existing.actor IS DISTINCT FROM p_actor THEN"""
ISO = """  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'admin_cancel_order: isolation guard' USING ERRCODE = 'P8C01';
  END IF;"""
ZEROITEM = """  IF v_cnt = 0 THEN
    RAISE EXCEPTION '%', v_generic_msg;
  END IF;"""
M8AUDIT = """  INSERT INTO public.admin_audit_log (actor, action, target, request_id, before, after, reason, source_app)
  VALUES (p_actor, 'order.cancel', 'order:' || p_order_id::text, p_idempotency_key,
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status, 'cancelled_at', NULL),
          pg_catalog.jsonb_build_object('payment_status', v_order.payment_status,
            'cancelled_at', CASE WHEN v_closed THEN pg_catalog.now() ELSE NULL END,
            'cancellation_id', v_cid, 'closed', v_closed),
          p_reason_code, 'admin');
""" + M13AUDITCNT
if n == '1':    out = sub(ALLOWED, "  -- M1 mutant")
elif n == '2':  out = sub(M2FULLINSTOCK, "    -- M2 mutant")
elif n == '3':  out = sub(HASHCHK, "    IF v_existing.actor IS DISTINCT FROM p_actor THEN")
elif n == '4':  out = sub("WHERE s.id = p_actor AND s.is_active", "WHERE s.id = p_actor")
elif n == '5':  out = sub(ISO, "  -- M5 mutant")
elif n == '6a': out = sub("ORDER BY oi.id\n   FOR NO KEY UPDATE;", "FOR NO KEY UPDATE;")
elif n == '6b': out = sub("     ORDER BY oi.id;", ";")
elif n == '6c': out = sub("     ORDER BY ((el->>'order_item_id')::uuid)::text;", ";")
elif n == '7':  out = sub(M7CLOSE, "  -- M7 mutant")
elif n == '8':  out = sub(M8AUDIT, "  -- M8 mutant")
elif n == '9':  out = sub(M9CLOSEEQ, "    -- M9 mutant")
elif n == '10': out = sub(M10STEP5, "  -- M10 mutant")
elif n == '11': out = sub(ZEROITEM, "  -- M11 mutant")
elif n == '12': out = sub(M12ITEMCNT, "  -- M12 mutant")
elif n == '13': out = sub(M13AUDITCNT, "  -- M13 mutant")
elif n == '14': out = sub(M14ORDGUARD, "    -- M14 mutant")
elif n == '15':
    out = sub(HASHCHK, "    IF v_existing.payload_hash IS DISTINCT FROM v_hash THEN")
    src = out
    out = sub("OR v_audit.actor IS DISTINCT FROM p_actor\n       ", "")
elif n == '16': out = sub("IF v_order.cancelled_reason IS DISTINCT FROM (", "IF false AND v_order.cancelled_reason IS DISTINCT FROM (")
elif n == '17': out = sub("""      IF (SELECT count(*) FROM public.order_cancellation_items ci WHERE ci.cancellation_id = v_existing.id)
         <> pg_catalog.jsonb_array_length(p_items)
         OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(p_items) e(el)
                     WHERE NOT EXISTS (SELECT 1 FROM public.order_cancellation_items ci
                                        WHERE ci.cancellation_id = v_existing.id
                                          AND ci.order_item_id = (el->>'order_item_id')::uuid
                                          AND ci.cancelled_quantity = (el->>'quantity')::integer)) THEN
        RAISE EXCEPTION '%', v_generic_msg;
      END IF;""", "      NULL;  -- M17 mutant")
elif n == 'd1': out = sub(MD1PARTGUARD, "    -- MD1 mutant")
elif n == 'd2': out = sub(MD2INSTOCKTERM, "            - 0")
elif n == 'd3': out = sub(MD3CLOSED, "  v_closed := false;")
elif n == 'd4': out = sub(MD4CANON, "',')")
elif n == 'd5': out = sub(MD5BELONG, "    -- MD5 mutant")
elif n == 'd6': out = sub(MD6SUMGATE, "  -- MD6 mutant")
elif n == 'd7': out = sub(MD7HEALTH, "  -- MD7 mutant")
else: sys.exit("unknown mutant")
open(out_p, 'w').write(out)
PYEOF
}

#              S×4  I×13          R×17              C9 PC×3 P×16(PS1,PS2,PS3,PS5,PG1,PI1,PI2,PI3,PI3b,PR1,PR2,PR3,PR4,PR5,PR7,PN1)
EXPECT[1]="1111 1111111111111 11111000001111111 11 111 1111111111111111"
EXPECT[2]="1111 1111111111111 11111111111110111 11 111 1111111111111111"
EXPECT[3]="1111 1101111111111 11111111111111111 11 111 1111111111111111"
EXPECT[4]="1111 1111111111111 11101111111111111 11 111 1111111111111111"
EXPECT[5]="1111 1111111111111 11111111111111111 00 111 1111111111111111"
EXPECT[7]="0001 0111111111111 11111111111111111 11 011 1001011011111111"
EXPECT[8]="0111 0111111111111 11111111111111111 11 110 0011001011111111"
EXPECT[9]="1111 1111111111110 11111111111111111 11 111 1111111111111111"
EXPECT[10]="1111 1111111111111 11111111111001111 11 111 1111111111111111"
EXPECT[12]="1111 1111111111111 11111111111111111 11 101 1111111111111111"
EXPECT[13]="1111 1111111111111 11111111111111111 11 110 1111111111111111"
EXPECT[14]="1111 1111111111111 11111111111111111 11 011 1111111111111111"
EXPECT[15]="1111 1110111111111 11111111111111111 11 111 1111111111111111"
EXPECT[16]="1111 1111111111111 11111111111111111 11 111 1110111110011101"
EXPECT[17]="1111 1111111111111 11111111111111111 11 111 1110111111011111"
EXPECT[18]="0001 0111111111110 11111111111111111 11 011 1001011011111111"
EXPECT[19]="1111 1111111111111 11111111111111111 11 111 1111011111111111"
EXPECT[20]="1111 1111111111111 11111111111111111 11 111 1111111111101111"
EXPECT[21]="1111 1111111111111 11111111111111111 11 111 1111111111111110"
EXPECT[22]="1111 1111111111111 11111111111011111 11 111 1111111111111111"
EXPECT[23]="1111 1111111111011 11111111111111111 11 111 1111111111111111"
EXPECT[24]="1111 1111111111101 11111111111111111 11 111 1111111111111111"

# M11(零品項守門)撤除突變:被「整單 v_expect=0」與「部分屬本單」雙重遮蔽,R13 在 M11 下
# 照紅=零判別力(負測構造不出=no-op 判別教訓);守門保留=fail-fast 縱深、誠實認列。
# M9(冪等③關單等價式)復活(codex R2 打回撤除):單 header 情境下被交叉核對/closing 計數
# 遮蔽(I10/I11 在 M9 下照紅=誠實認列),但多 header 竄改(I13:A 部分+B 關單、刪 A 明細、
# 重放 B)= ③ 唯一防線 ⇒ M9 恰殺 I13。
mut_of() { case "$1" in 16) echo d1;; 17) echo d2;; 18) echo d3;; 19) echo d4;; 20) echo d5;; 21) echo d6;; 22) echo d7;; 23) echo 16;; 24) echo 17;; *) echo "$1";; esac; }
mut_label() { case "$1" in 16|17|18|19|20|21|22) echo "MD$(( $1 - 15 ))";; 23) echo M16;; 24) echo M17;; *) echo "M$1";; esac; }
for M in 1 2 3 4 5 7 8 9 10 12 13 14 15 16 17 18 19 20 21 22 23 24; do
  MN="$(mut_of "$M")"; ML="$(mut_label "$M")"
  if ! ERR="$(gen_mutant "$MN" 2>&1)"; then bad "$ML anchor preflight — $ERR"; continue; fi
  psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1 || { bad "$ML 套用失敗"; continue; }
  MMD5="$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")"
  [ "$MMD5" != "$MD5_NEW" ] || { bad "$ML md5 未變"; restore_base; continue; }
  VEC="$(run_vector)"
  EXP="$(printf '%s' "${EXPECT[$M]}" | tr -d ' ')"
  if [ "$VEC" = "$EXP" ]; then ok "$ML vector 逐格吻合($VEC)"
  else bad "$ML vector=$VEC 期望=$EXP(最後:${CELL_ERR:-})"; fi
  restore_base
  [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
    && ok "$ML 還原後 md5=基準" || bad "$ML 還原失敗"
done

# ── MD1 示範格:第二道網實證(部分超量 → 23514 + 釘約束名 + 全回滾)──────
gen_mutant d1 && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1
D_M2="$(next_disp)"
cell_intx MD1demo "
\\set disp $D_M2
$(_fix)
INSERT INTO public.order_item_procurement (id, order_item_id, allocated_quantity, supplier_id)
VALUES (gen_random_uuid(), :'i1_id', 2, :'supp') RETURNING id \\gset p_
INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
VALUES (:'p_id', 1, now(), 'sean');
$(_setitems "jsonb_build_array(jsonb_build_object('order_item_id', (:'i1_id')::text, 'quantity', 2))::text")
DO \$c\$ DECLARE v jsonb; v_state text; v_con text; n int; BEGIN
  BEGIN
    v := $CALL_EXPR;
    RAISE EXCEPTION 'CELLFAIL MD1 未紅(%)', v;
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
  && ok "MD1 示範:部分守門拿掉後紅在 23514+oiqs_instock_cancelled_le_quantity、全回滾(第二道網實證)" \
  || bad "MD1 示範 — ${CELL_ERR:-}"
restore_base

# ── M6a/M6b:排序結構錨(行為無判別力誠實認列;承重=結構層)──────
STRUCT_PROBE_A="SELECT CASE WHEN position(E'ORDER BY oi.id\n   FOR NO KEY UPDATE;' in pg_get_functiondef('$FN_SIG'::regprocedure)) = 0 THEN 'STRUCT_RED' ELSE 'STRUCT_GREEN' END"
STRUCT_PROBE_B="SELECT CASE WHEN position('ORDER BY oi.id;' in pg_get_functiondef('$FN_SIG'::regprocedure)) = 0 THEN 'STRUCT_RED' ELSE 'STRUCT_GREEN' END"
STRUCT_PROBE_C="SELECT CASE WHEN position('ORDER BY ((el->>''order_item_id'')::uuid)::text;' in pg_get_functiondef('$FN_SIG'::regprocedure)) = 0 THEN 'STRUCT_RED' ELSE 'STRUCT_GREEN' END"
[ "$(q "$STRUCT_PROBE_A")" = "STRUCT_GREEN" ] && [ "$(q "$STRUCT_PROBE_B")" = "STRUCT_GREEN" ] \
  && [ "$(q "$STRUCT_PROBE_C")" = "STRUCT_GREEN" ] \
  || bad "M6 前提:基準結構錨非綠"
gen_mutant 6a && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1
[ "$(q "$STRUCT_PROBE_A")" = "STRUCT_RED" ] && restore_base \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "M6a 鎖 SELECT 拔 ORDER BY ⇒ 結構錨紅、還原復位" || { bad "M6a"; restore_base; }
gen_mutant 6b && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1
[ "$(q "$STRUCT_PROBE_B")" = "STRUCT_RED" ] && restore_base \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "M6b 收尾 INSERT 拔 ORDER BY ⇒ 結構錨紅、還原復位" || { bad "M6b"; restore_base; }
gen_mutant 6c && psql "$URL" -v ON_ERROR_STOP=1 -qtAX -f "$WORK/a8a1-mutant.sql" >/dev/null 2>&1
[ "$(q "$STRUCT_PROBE_C")" = "STRUCT_RED" ] && restore_base \
  && [ "$(q "SELECT md5(pg_get_functiondef('$FN_SIG'::regprocedure))")" = "$MD5_NEW" ] \
  && ok "M6c 部分 INSERT 拔 ORDER BY ⇒ 結構錨紅、還原復位" || { bad "M6c"; restore_base; }
trap - EXIT

END12="$(snap12)" || { echo "🔴 snap12 終判失敗"; FAIL=$((FAIL+1)); END12="SNAP12-FAILED"; }
if [ "$BASE12" = "$END12" ] && [ "$CLEANUP_FAIL" -eq 0 ]; then ok "十二表零留痕(含 cleanup 零吞錯)"
else bad "留痕或 cleanup(CLEANUP_FAIL=$CLEANUP_FAIL):"; echo "  基線 $BASE12"; echo "  結束 $END12"; fi

echo "== 結果:PASS=$PASS FAIL=$FAIL(期望 PASS=$EXPECTED_TOTAL)=="
[ "$FAIL" -eq 0 ] || exit 1
[ "$PASS" -eq "$EXPECTED_TOTAL" ] || { echo "🔴 計數閘:PASS=$PASS ≠ $EXPECTED_TOTAL"; exit 1; }
exit 0
