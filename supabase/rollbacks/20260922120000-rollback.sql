-- 20260922120000 回滾:3 筆上線前測試付款通知改回「需人工、未處理」(processed = false、processed_at = NULL)。
-- 用同一組 3 個主鍵;先檢查它們目前是「processed = true、仍是需人工」, 再改回, 並斷言實際更新 3 筆。
-- 這 3 筆對不到訂單, attempt_count 已是 8, 排程不會再撈 ⇒ 改回也不會觸發扣款或寄信;提醒會重新計入它們。
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $undo$
DECLARE
  v_ids  text[] := ARRAY['D20260724gUTcg1', 'D20260811tgQ2QE', 'D20260811zGoCz3']::text[];
  v_ok   integer;
  v_rows integer;
BEGIN
  PERFORM 1 FROM public.payment_webhook_events e
   WHERE e.rec_trade_id = ANY (v_ids)
   ORDER BY e.rec_trade_id
     FOR UPDATE;
  SELECT pg_catalog.count(*) INTO v_ok
    FROM public.payment_webhook_events e
   WHERE e.rec_trade_id = ANY (v_ids) AND e.needs_manual_review AND e.processed;
  IF v_ok <> 3 THEN
    RAISE EXCEPTION '回滾前置閘:這 3 筆應都是「需人工、已處理」, 實際 % 筆 ⇒ 停下', v_ok;
  END IF;

  UPDATE public.payment_webhook_events e
     SET processed = false,
         processed_at = NULL
   WHERE e.rec_trade_id = ANY (v_ids) AND e.needs_manual_review AND e.processed;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 3 THEN
    RAISE EXCEPTION '回滾更新筆數應為 3, 實際 % ⇒ 中止', v_rows;
  END IF;
END
$undo$;

COMMIT;
