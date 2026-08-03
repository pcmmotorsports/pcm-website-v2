#!/usr/bin/env bash
# ============================================================
# A4a 回滾程序演練(master plan :373-377 的 DoD 硬前置)
# ============================================================
# runbook = docs/runbooks/a4a-summary-rollback.md;本腳本逐步照 runbook 實跑,
# 步驟編號一一對應 —— 演練綠 = runbook 可執行的證據。
# 用法:先 d1t2-rehearsal.sh provision <workdir> 且 A4a migration 已套,
#       再 scripts/a4a-rollback-rehearsal.sh <workdir>
# 兩個變體(關卡1 R3-F1:災難分支沒被演練過 = 演練只在沒事的日子成立):
#   S2 健康資料:對帳 0 分歧 → 直行六步 → forward 重建。
#   S3 drift 資料:先竄改摘要 → 對帳分流(差異留檔、以真相為準)→ 六步 → forward 修復。
# 收尾:fixture 與快照表全清、四 trigger 五函式在位、漂移 oracle 綠(還原世界)。
set -uo pipefail

WORK="${1:-/tmp/a4a-work}"
URL="postgresql://postgres@127.0.0.1:54329/postgres"
A1MIG="supabase/migrations/20260730150000_m4b_e10_a1_order_item_summary_columns.sql"
A4AMIG="supabase/migrations/20260803140000_m4b_e10_a4a_quantity_summary_recompute.sql"
PASS=0; FAIL=0
EXPECTED_TOTAL=19

ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
q() { psql "$URL" -tAX -c "$1" 2>&1; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# ── 身分閘(照 a2b1-verify)──────────────────────────────────
test -f "$WORK/.d1t2-harness" || { echo "🔴 $WORK 缺 ownership marker;拒跑"; exit 1; }
test -f "$A1MIG" && test -f "$A4AMIG" || { echo "🔴 migration 檔缺;拒跑"; exit 1; }
DATADIR="$(q "SHOW data_directory")"
case "$DATADIR" in "$WORK"/*) : ;; *) echo "🔴 data_directory=$DATADIR 不在 $WORK;拒跑"; exit 1 ;; esac
[ "$(q "SELECT current_database()")" = "postgres" ] || { echo "🔴 database 名不符;拒跑"; exit 1; }
[ "$(q "SHOW default_transaction_isolation")" = "read committed" ] || { echo "🔴 非 RC;拒跑"; exit 1; }
[ "$(q "SHOW lc_messages")" = "C" ] || { echo "🔴 lc_messages 非 C;拒跑"; exit 1; }
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname='order_item_procurement_summary_recompute_zc' AND NOT tgisinternal")" = "1" ] \
  || { echo "🔴 A4a 尚未套進本庫(zc trigger 不在);先 psql -f $A4AMIG"; exit 1; }

TRIG4="('order_item_procurement_received_quantity_guard_bt','order_item_procurement_summary_recompute_zc','order_item_procurement_receipts_received_sync_ac','order_cancellation_items_summary_recompute_ac')"
FN5="('pcm_a4a_received_quantity_guard','pcm_a4a_procurement_summary_recompute','pcm_a4a_receipts_received_sync','pcm_a4a_cancellation_summary_recompute','pcm_a4a_recompute_order_item_summary')"

cleanup_all() {
  # 🔀 codex K2-8:④/⑥ 後中斷會留下半回滾 schema ⇒ trap 先自修復(冪等:缺什麼補什麼)
  if [ "$(q "SELECT count(*) FROM pg_class WHERE relname='order_item_quantity_summary'")" != "1" ]; then
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$A1MIG" >/dev/null 2>&1 || echo "🔴 cleanup:A1 重放失敗 —— 摘要表仍缺" >&2
  fi
  if [ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname IN $TRIG4 AND NOT tgisinternal")" != "4" ]; then
    psql "$URL" -tAX -c "DROP TRIGGER IF EXISTS order_item_procurement_received_quantity_guard_bt ON public.order_item_procurement" \
      -c "DROP TRIGGER IF EXISTS order_item_procurement_summary_recompute_zc ON public.order_item_procurement" \
      -c "DROP TRIGGER IF EXISTS order_item_procurement_receipts_received_sync_ac ON public.order_item_procurement_receipts" \
      -c "DROP TRIGGER IF EXISTS order_cancellation_items_summary_recompute_ac ON public.order_cancellation_items" \
      -c "DROP FUNCTION IF EXISTS public.pcm_a4a_received_quantity_guard()" \
      -c "DROP FUNCTION IF EXISTS public.pcm_a4a_procurement_summary_recompute()" \
      -c "DROP FUNCTION IF EXISTS public.pcm_a4a_receipts_received_sync()" \
      -c "DROP FUNCTION IF EXISTS public.pcm_a4a_cancellation_summary_recompute()" \
      -c "DROP FUNCTION IF EXISTS public.pcm_a4a_recompute_order_item_summary(uuid)" >/dev/null 2>&1
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$A4AMIG" >/dev/null 2>&1 || echo "🔴 cleanup:A4a 重放失敗 —— trigger 仍缺" >&2
  fi
  # 🔀 codex K2-R2-1 + R3 nit:註解還原無條件、失敗必告警;摘要表 STALE 標記一併復原
  #    (②④⑤ 已 commit、⑥ 前中斷 ⇒ trigger 被 trap 重建但 STALE 註解殘留 = 矛盾世界)。
  if [ -n "${PROC_COMMENT0:-}" ]; then
    psql "$URL" -v ON_ERROR_STOP=1 -qtAX -c "COMMENT ON TABLE public.order_item_procurement IS \$a4acmt\$${PROC_COMMENT0}\$a4acmt\$" >/dev/null 2>&1 \
      || echo "🔴 cleanup:採購表註解還原失敗 —— S1b 註解污染殘留" >&2
  fi
  if [ -n "${SUMM_COMMENT0:-}" ] && [ "$(q "SELECT count(*) FROM pg_class WHERE relname='order_item_quantity_summary'")" = "1" ]; then
    psql "$URL" -v ON_ERROR_STOP=1 -qtAX -c "COMMENT ON TABLE public.order_item_quantity_summary IS \$a4asum\$${SUMM_COMMENT0}\$a4asum\$" >/dev/null 2>&1 \
      || echo "🔴 cleanup:摘要表註解還原失敗 —— STALE 標記可能殘留" >&2
  fi
  psql "$URL" -tAX >/dev/null 2>&1 <<'SQL' || echo "🔴 cleanup:fixture 清理失敗(殘留)" >&2
BEGIN;
DELETE FROM public.order_item_procurement_receipts WHERE procurement_id IN
  (SELECT p.id FROM public.order_item_procurement p JOIN public.order_items i ON i.id=p.order_item_id WHERE i.variant_sku LIKE 'A4AR-%');
DELETE FROM public.order_item_procurement WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A4AR-%');
DELETE FROM public.order_cancellation_items WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A4AR-%');
DELETE FROM public.order_cancellations WHERE order_id IN
  (SELECT id FROM public.orders WHERE display_id='PCM-9996-0001');
COMMIT;
SQL
  psql "$URL" -tAX -c "DELETE FROM public.orders WHERE display_id='PCM-9996-0001'" >/dev/null 2>&1 || true
  psql "$URL" -tAX -c "DROP TABLE IF EXISTS public.a4a_rollback_snapshot, public.a4a_rollback_divergence, public.a4a_rollback_received_drift" >/dev/null 2>&1 || true
}
trap 'exit 130' INT TERM
trap cleanup_all EXIT

# ── 漂移 oracle(獨立推導;R3-F3 —— 與 helper 的 JOIN 形狀不同)──
oracle_red_count() {
  q "SELECT (SELECT count(*) FROM public.order_item_procurement p
              WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity)
                    FROM public.order_item_procurement_receipts r WHERE r.procurement_id = p.id),0))
          + (SELECT count(*) FROM public.order_item_quantity_summary s
              WHERE s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=s.order_item_id),0)
                 OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=s.order_item_id),0)
                 OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                       WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=s.order_item_id)),0))
          + (SELECT count(*) FROM (SELECT p.order_item_id FROM public.order_item_procurement p
                                   UNION SELECT c.order_item_id FROM public.order_cancellation_items c) x
              WHERE NOT EXISTS (SELECT 1 FROM public.order_item_quantity_summary s WHERE s.order_item_id = x.order_item_id))"
}

# runbook ②④⑤ 單一交易(變體共用;②的 divergence 已由呼叫端先建才進本函式 —— 不,②也在裡面)
run_steps_2_4_5() {
  psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
BEGIN;
CREATE TABLE public.a4a_rollback_snapshot AS
  SELECT s.*, pg_catalog.now() AS snapshotted_at FROM public.order_item_quantity_summary s;
-- 🔀 codex K2-R2-2:divergence 以「活動 ∪ 摘要」全集驅動 —— 缺列(有活動無摘要)也是災難形狀;
--    received_quantity drift 另立第二張留檔表。
CREATE TABLE public.a4a_rollback_divergence AS
  SELECT u.order_item_id,
         s.ordered_quantity AS snap_ordered, s.instock_quantity AS snap_instock, s.cancelled_quantity AS snap_cancelled,
         COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0) AS truth_ordered,
         COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0) AS truth_instock,
         COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0) AS truth_cancelled
    FROM (SELECT p.order_item_id FROM public.order_item_procurement p
          UNION SELECT c.order_item_id FROM public.order_cancellation_items c
          UNION SELECT s2.order_item_id FROM public.order_item_quantity_summary s2) u
    LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = u.order_item_id
   WHERE s.order_item_id IS NULL
      OR s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0)
      OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0)
      OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0);
CREATE TABLE public.a4a_rollback_received_drift AS
  SELECT p.id AS procurement_id, p.order_item_id, p.received_quantity AS snap_received,
         COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0) AS truth_received
    FROM public.order_item_procurement p
   WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0);
DROP TRIGGER order_item_procurement_received_quantity_guard_bt ON public.order_item_procurement;
DROP TRIGGER order_item_procurement_summary_recompute_zc       ON public.order_item_procurement;
DROP TRIGGER order_item_procurement_receipts_received_sync_ac  ON public.order_item_procurement_receipts;
DROP TRIGGER order_cancellation_items_summary_recompute_ac     ON public.order_cancellation_items;
DROP FUNCTION public.pcm_a4a_received_quantity_guard();
DROP FUNCTION public.pcm_a4a_procurement_summary_recompute();
DROP FUNCTION public.pcm_a4a_receipts_received_sync();
DROP FUNCTION public.pcm_a4a_cancellation_summary_recompute();
DROP FUNCTION public.pcm_a4a_recompute_order_item_summary(uuid);
COMMENT ON TABLE public.order_item_quantity_summary IS
  '🛑 STALE:A4a 已回滾撤除,本表值凍結於撤除時點、不得信任(顯示層請視為不可用)。重建 = 重放 A4a migration(backfill 會由真相重算)。';
DO $s5$
DECLARE v_bad integer;
BEGIN
  -- ⑤:此刻的三形狀分歧(值/缺列/received drift)必須 ⊆ ② 已留檔集合(= ①停寫成立、④期間零新寫入)
  SELECT count(*) INTO v_bad
    FROM (SELECT p.order_item_id FROM public.order_item_procurement p
          UNION SELECT c.order_item_id FROM public.order_cancellation_items c
          UNION SELECT s2.order_item_id FROM public.order_item_quantity_summary s2) u
    LEFT JOIN public.order_item_quantity_summary s ON s.order_item_id = u.order_item_id
   WHERE (s.order_item_id IS NULL
       OR s.ordered_quantity   IS DISTINCT FROM COALESCE((SELECT sum(p.allocated_quantity) FROM public.order_item_procurement p WHERE p.order_item_id=u.order_item_id),0)
       OR s.instock_quantity   IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r
                    WHERE r.procurement_id IN (SELECT p2.id FROM public.order_item_procurement p2 WHERE p2.order_item_id=u.order_item_id)),0)
       OR s.cancelled_quantity IS DISTINCT FROM COALESCE((SELECT sum(c.cancelled_quantity) FROM public.order_cancellation_items c WHERE c.order_item_id=u.order_item_id),0))
     AND NOT EXISTS (SELECT 1 FROM public.a4a_rollback_divergence d WHERE d.order_item_id = u.order_item_id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'A4A_S5_FAIL:% 列摘要分歧不在②留檔集合內(④期間有新寫入?)', v_bad;
  END IF;
  SELECT count(*) INTO v_bad
    FROM public.order_item_procurement p
   WHERE p.received_quantity IS DISTINCT FROM COALESCE((SELECT sum(r.quantity) FROM public.order_item_procurement_receipts r WHERE r.procurement_id=p.id),0)
     AND NOT EXISTS (SELECT 1 FROM public.a4a_rollback_received_drift d WHERE d.procurement_id = p.id);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'A4A_S5_FAIL:% 列 received drift 不在②留檔集合內', v_bad;
  END IF;
  RAISE NOTICE 'A4A_S5_OK';
END $s5$;
COMMIT;
SQL
}

# runbook ⑥ + forward 重建
# 🔴 A1 migration :170 會 COMMENT ON order_item_procurement —— 重放時把 S1b 後來的註解修訂
#    蓋回 A1 版(2026-08-03 家族序跑 s1b 抓到的實錘污染)⇒ forward 後必須還原快照的註解。
run_step_6_and_forward() {
  local o rc=0
  o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX -c "BEGIN" \
        -c "DROP TABLE public.order_item_quantity_summary" \
        -c "ALTER TABLE public.order_items DROP CONSTRAINT order_items_id_quantity_key" \
        -c "COMMIT" 2>&1)" || rc=1
  [ $rc -eq 0 ] \
    && [ "$(q "SELECT count(*) FROM pg_class WHERE relname='order_item_quantity_summary'")" = "0" ] \
    && [ "$(q "SELECT count(*) FROM pg_constraint WHERE conname='order_items_id_quantity_key'")" = "0" ] \
    && ok "[⑥] A1 全回滾:表與 UNIQUE 皆撤(依賴已清零才走到這步)" \
    || bad "[⑥] A1 全回滾失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"

  o="$(psql "$URL" -v ON_ERROR_STOP=1 -q -f "$A1MIG" 2>&1)"
  printf '%s' "$o" | grep -q 'A1 結構驗收全數通過' \
    && ok "[fwd] A1 migration 重放綠" || bad "[fwd] A1 重放失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
  o="$(psql "$URL" -v ON_ERROR_STOP=1 -q -f "$A4AMIG" 2>&1)"
  psql "$URL" -v ON_ERROR_STOP=1 -qtAX -c "COMMENT ON TABLE public.order_item_procurement IS \$a4acmt\$${PROC_COMMENT0}\$a4acmt\$" >/dev/null 2>&1
  printf '%s' "$o" | grep -q 'A4a 結構驗收全數通過' \
    && [ "$(q "SELECT obj_description('public.order_item_procurement'::regclass)")" = "$PROC_COMMENT0" ] \
    && ok "[fwd] A4a migration 重放綠 + 採購表註解還原(A1 重放的 S1b 註解蓋寫已補償)" \
    || bad "[fwd] A4a 重放或註解還原失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"
}

echo "== A4a 回滾演練(workdir=$WORK)=="
ORDERS_N0="$(q "SELECT count(*) FROM public.orders")"
SUMM_N0="$(q "SELECT count(*) FROM public.order_item_quantity_summary")"
PROC_COMMENT0="$(q "SELECT obj_description('public.order_item_procurement'::regclass)")"
SUMM_COMMENT0="$(q "SELECT obj_description('public.order_item_quantity_summary'::regclass)")"
[ -n "$PROC_COMMENT0" ] && [ -n "$SUMM_COMMENT0" ] || { echo "🔴 表註解基準取不到;拒跑"; exit 1; }

# ── S1 fixture(committed:真實活動資料 —— 摘要表非空才叫「已有真實資料時的回滾」)──
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<'SQL' 2>&1
DO $fx$
DECLARE v_cust uuid; v_order uuid; v_i5 uuid; v_proc uuid; v_sup uuid; v_staff text; v_canc uuid;
BEGIN
  SELECT user_id INTO v_cust FROM public.customers ORDER BY user_id LIMIT 1;
  SELECT id INTO v_sup FROM public.suppliers ORDER BY id LIMIT 1;
  SELECT id INTO v_staff FROM public.staff ORDER BY id LIMIT 1;
  IF v_cust IS NULL OR v_sup IS NULL OR v_staff IS NULL THEN
    RAISE EXCEPTION 'fixture 失敗:customers/suppliers/staff 有空表';
  END IF;
  IF EXISTS (SELECT 1 FROM public.orders WHERE display_id='PCM-9996-0001') THEN
    RAISE EXCEPTION 'fixture 失敗:PCM-9996-0001 已存在';
  END IF;
  INSERT INTO public.orders (display_id, customer_user_id, shipping_address_snapshot, tier_at_checkout,
                             subtotal, shipping_fee, total, shipping_method, invoice)
  VALUES ('PCM-9996-0001', v_cust,
          jsonb_build_object('name','A4a 演練','phone','0900000000','line','測試地址'),
          'general'::public.member_tier, 0, 0, 0, 'store', jsonb_build_object('type','personal'))
  RETURNING id INTO v_order;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A4AR-P5', '{"title":"a4ar p5","sku":"A4AR-P5","spec":{}}'::jsonb, 5, 0, 0)
  RETURNING id INTO v_i5;
  INSERT INTO public.order_items (order_id, variant_sku, product_snapshot, quantity, unit_price, line_total)
  VALUES (v_order, 'A4AR-P3', '{"title":"a4ar p3","sku":"A4AR-P3","spec":{}}'::jsonb, 3, 0, 0);
  INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
  VALUES (v_i5, v_sup, 3) RETURNING id INTO v_proc;
  INSERT INTO public.order_item_procurement_receipts (procurement_id, quantity, received_at, received_by)
  VALUES (v_proc, 2, pg_catalog.now(), 'a4a_rehearsal');
  INSERT INTO public.order_cancellations (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order, 'customer_request', gen_random_uuid(), encode(sha256('a4a-rehearsal'::bytea),'hex'), v_staff)
  RETURNING id INTO v_canc;
  INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
  VALUES (v_canc, v_order, v_i5, 1);
END $fx$;
SQL
)"
[ $? -eq 0 ] && ok "[S1] fixture 已建(P5:alloc3/receipt2/cancel1、P3 零活動)" \
  || bad "[S1] fixture 建立失敗 — $(printf '%s' "$o" | grep -m1 ERROR | cut -c1-160)"

ITEM5="$(q "SELECT id FROM public.order_items WHERE variant_sku='A4AR-P5'")"
ROW="$(q "SELECT s.ordered_quantity||','||s.instock_quantity||','||s.cancelled_quantity||','||p.received_quantity
            FROM public.order_item_quantity_summary s
            JOIN public.order_item_procurement p ON p.order_item_id = s.order_item_id
           WHERE s.order_item_id = '$ITEM5'")"
[ "$ROW" = "3,2,1,2" ] \
  && [ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname IN $TRIG4 AND NOT tgisinternal")" = "4" ] \
  && ok "[S1] 基準:摘要 (3,2,1) + received=2 + runbook ③(a) 前置四 trigger 在位 = 4" \
  || bad "[S1] 基準不符:$ROW(應 3,2,1,2)或前置 trigger 數 ≠ 4"

# ── S2 變體 (a) 健康資料 ─────────────────────────────────────
echo "== S2 健康變體 =="
# ③c 反例:trigger 在位時 DROP 表 → 下一筆來源 DML 42P01(BEGIN…ROLLBACK 零留痕)
o="$(psql "$URL" -v ON_ERROR_STOP=1 -tAX <<SQL 2>&1
BEGIN;
DROP TABLE public.order_item_quantity_summary;
DO \$c\$
BEGIN
  BEGIN
    INSERT INTO public.order_item_procurement (order_item_id, supplier_id, allocated_quantity)
    VALUES ((SELECT id FROM public.order_items WHERE variant_sku='A4AR-P3'),
            (SELECT id FROM public.suppliers ORDER BY id LIMIT 1), 1);
    RAISE EXCEPTION 'A4A_C_NOT_RED';
  EXCEPTION WHEN SQLSTATE '42P01' THEN RAISE NOTICE 'A4A_42P01_OK';
  END;
END \$c\$;
ROLLBACK;
SQL
)"
printf '%s' "$o" | grep -q 'A4A_42P01_OK' \
  && ok "[③c] 反例成立:DROP 不被 DB 擋、後續 DML 才 42P01 ⇒ 順序是人的責任(runbook 依賴清零檢查的存在理由)" \
  || bad "[③c] 反例未成立 — $(printf '%s' "$o" | grep -m1 -E 'ERROR|A4A_C' | cut -c1-160)"

o="$(run_steps_2_4_5)"
printf '%s' "$o" | grep -q 'A4A_S5_OK' \
  && ok "[②④⑤] 單一交易完成(快照+對帳+撤除+凍結驗證)" \
  || bad "[②④⑤] 失敗 — $(printf '%s' "$o" | grep -m1 -E 'ERROR|A4A_S5' | cut -c1-160)"
[ "$(q "SELECT count(*) FROM public.a4a_rollback_divergence")" = "0" ] \
  && [ "$(q "SELECT count(*) FROM public.a4a_rollback_received_drift")" = "0" ] \
  && ok "[②] 健康資料:divergence = 0 且 received_drift = 0(三形狀口徑)" || bad "[②] 健康資料竟有分歧留檔"
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname IN $TRIG4 AND NOT tgisinternal")" = "0" ] \
  && [ "$(q "SELECT count(*) FROM pg_proc WHERE proname IN $FN5")" = "0" ] \
  && ok "[④] 四 trigger 五函式全撤(依賴清零)" || bad "[④] 撤除不完整"
q "SELECT obj_description('public.order_item_quantity_summary'::regclass)" | grep -q 'STALE' \
  && ok "[④] stale 標記在位(dashboard 可見)" || bad "[④] stale 標記缺"
run_step_6_and_forward
ROW="$(q "SELECT ordered_quantity||','||instock_quantity||','||cancelled_quantity
            FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'")"
[ "$ROW" = "3,2,1" ] && [ "$(oracle_red_count)" = "0" ] \
  && ok "[fwd] 摘要由真相重建 (3,2,1) + 漂移 oracle 0" || bad "[fwd] 重建後不符:$ROW / oracle=$(oracle_red_count)"
q "DROP TABLE public.a4a_rollback_snapshot, public.a4a_rollback_divergence, public.a4a_rollback_received_drift" >/dev/null

# ── S3 變體 (b) drift 資料(災難分支)────────────────────────
echo "== S3 災難變體(三形狀:值竄改 / received drift / 缺列 —— codex K2-R2-2)=="
ITEM3R="$(q "SELECT id FROM public.order_items WHERE variant_sku='A4AR-P3'")"
# 🔴 塑形順序承重:received 竄改的 UPDATE 打在 procurement 上,會級聯 zc 重算把 P5 摘要自癒
#    ⇒ 必須先 received、後 cancelled(其後只碰 P3,不再觸發 P5 重算)。首版反序被自癒反咬,實錘。
psql "$URL" -v ON_ERROR_STOP=1 -qtAX -c "SELECT set_config('pcm_a4a.received_sync','1',false)" \
  -c "UPDATE public.order_item_procurement SET received_quantity=0 WHERE order_item_id='$ITEM5'" \
  -c "SELECT set_config('pcm_a4a.received_sync','',false)" >/dev/null
q "UPDATE public.order_item_quantity_summary SET cancelled_quantity = 0 WHERE order_item_id='$ITEM5'" >/dev/null
psql "$URL" -v ON_ERROR_STOP=1 -tAX >/dev/null 2>&1 <<S3FX
DO \$fx\$
DECLARE v_canc uuid; v_staff text; v_order uuid;
BEGIN
  SELECT id INTO v_order FROM public.orders WHERE display_id='PCM-9996-0001';
  SELECT id INTO v_staff FROM public.staff ORDER BY id LIMIT 1;
  INSERT INTO public.order_cancellations (order_id, reason_code, idempotency_key, payload_hash, actor)
  VALUES (v_order, 'customer_request', gen_random_uuid(), encode(sha256('a4a-s3-missing'::bytea),'hex'), v_staff)
  RETURNING id INTO v_canc;
  INSERT INTO public.order_cancellation_items (cancellation_id, order_id, order_item_id, cancelled_quantity)
  VALUES (v_canc, v_order, '$ITEM3R', 1);
  DELETE FROM public.order_item_quantity_summary WHERE order_item_id = '$ITEM3R';
END \$fx\$;
S3FX
[ "$(q "SELECT cancelled_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'")" = "0" ] \
  && [ "$(q "SELECT received_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM5'")" = "0" ] \
  && [ "$(q "SELECT count(*) FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM3R'")" = "0" ] \
  && [ "$(q "SELECT count(*) FROM public.order_cancellation_items WHERE order_item_id='$ITEM3R'")" = "1" ] \
  && ok "[S3] 三形狀災難就位(P5 值竄改 cancelled→0 + received 2→0 drift;P3 有活動但摘要列被刪)" \
  || bad "[S3] 災難塑形沒到位(c=$(q "SELECT cancelled_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'") r=$(q "SELECT received_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM5'") p3s=$(q "SELECT count(*) FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM3R'") p3c=$(q "SELECT count(*) FROM public.order_cancellation_items WHERE order_item_id='$ITEM3R'") item3r=$ITEM3R)"
o="$(run_steps_2_4_5)"
printf '%s' "$o" | grep -q 'A4A_S5_OK' \
  && [ "$(q "SELECT count(*) FROM public.a4a_rollback_divergence WHERE order_item_id='$ITEM5' AND snap_cancelled=0 AND truth_cancelled=1")" = "1" ] \
  && [ "$(q "SELECT count(*) FROM public.a4a_rollback_divergence WHERE order_item_id='$ITEM3R' AND snap_cancelled IS NULL AND truth_cancelled=1")" = "1" ] \
  && [ "$(q "SELECT count(*) FROM public.a4a_rollback_received_drift WHERE snap_received=0 AND truth_received=2")" = "1" ] \
  && ok "[S3-②⑤] 三形狀分流成立:值竄改/缺列/received drift 全數留檔、程序未卡死、以真相為準續行" \
  || bad "[S3-②⑤] 災難分支失敗 — $(printf '%s' "$o" | grep -m1 -E 'ERROR|A4A_S5' | cut -c1-160)"
run_step_6_and_forward
ROW="$(q "SELECT ordered_quantity||','||instock_quantity||','||cancelled_quantity
            FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM5'")"
[ "$ROW" = "3,2,1" ] && [ "$(oracle_red_count)" = "0" ] \
  && [ "$(q "SELECT received_quantity FROM public.order_item_procurement WHERE order_item_id='$ITEM5'")" = "2" ] \
  && [ "$(q "SELECT cancelled_quantity FROM public.order_item_quantity_summary WHERE order_item_id='$ITEM3R'")" = "1" ] \
  && ok "[S3-fwd] 三形狀災難經回滾+重建全數修復(值/received/缺列 = 真相)" \
  || bad "[S3-fwd] 修復失敗:$ROW / oracle=$(oracle_red_count)"
q "DROP TABLE public.a4a_rollback_snapshot, public.a4a_rollback_divergence, public.a4a_rollback_received_drift" >/dev/null

# ── S4 收尾:清 fixture、驗還原世界 ──────────────────────────
echo "== S4 收尾 =="
psql "$URL" -v ON_ERROR_STOP=1 -tAX >/dev/null 2>&1 <<'SQL'
BEGIN;
DELETE FROM public.order_item_procurement_receipts WHERE procurement_id IN
  (SELECT p.id FROM public.order_item_procurement p JOIN public.order_items i ON i.id=p.order_item_id WHERE i.variant_sku LIKE 'A4AR-%');
DELETE FROM public.order_item_procurement WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A4AR-%');
DELETE FROM public.order_cancellation_items WHERE order_item_id IN
  (SELECT id FROM public.order_items WHERE variant_sku LIKE 'A4AR-%');
DELETE FROM public.order_cancellations WHERE order_id IN
  (SELECT id FROM public.orders WHERE display_id='PCM-9996-0001');
COMMIT;
SQL
RC1=$?
q "DELETE FROM public.orders WHERE display_id='PCM-9996-0001'" >/dev/null
[ "$RC1" -eq 0 ] \
  && [ "$(q "SELECT count(*) FROM public.orders")" = "$ORDERS_N0" ] \
  && [ "$(q "SELECT count(*) FROM public.order_item_quantity_summary")" = "$SUMM_N0" ] \
  && [ "$(q "SELECT count(*) FROM pg_class WHERE relname IN ('a4a_rollback_snapshot','a4a_rollback_divergence','a4a_rollback_received_drift')")" = "0" ] \
  && ok "[S4] fixture 與快照表零殘留(orders=$ORDERS_N0 summ=$SUMM_N0 復歸)" \
  || bad "[S4] 殘留:orders=$(q "SELECT count(*) FROM public.orders") summ=$(q "SELECT count(*) FROM public.order_item_quantity_summary")"
[ "$(q "SELECT count(*) FROM pg_trigger WHERE tgname IN $TRIG4 AND NOT tgisinternal")" = "4" ] \
  && [ "$(q "SELECT count(*) FROM pg_proc WHERE proname IN $FN5")" = "5" ] \
  && [ "$(oracle_red_count)" = "0" ] \
  && ok "[S4] 還原世界:四 trigger 五函式在位、oracle 0(演練零淨變)" \
  || bad "[S4] 世界未還原"

echo
echo "== 結果:PASS=$PASS FAIL=$FAIL(預期 PASS=$EXPECTED_TOTAL)=="
[ "$FAIL" -eq 0 ] && [ "$PASS" -eq "$EXPECTED_TOTAL" ] || exit 1
