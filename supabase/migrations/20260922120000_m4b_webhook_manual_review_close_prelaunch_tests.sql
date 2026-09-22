-- 20260922120000_m4b_webhook_manual_review_close_prelaunch_tests.sql —— 3 筆上線前測試付款通知標成「人工結案」(一次性資料)
--
-- ⟦db-WEBHOOKMANUALBACKLOG⟧ plan `docs/plans/2026-09-22-webhook-manual-backlog-alert-plan.md` 第 4 節 Q1 甲(Sean 2026-09-22 選)。
-- 🛑 未貼(寫好不貼;貼板由 Sean 處理)。
-- pcm:idempotent: yes
--   理由:只動 3 個固定主鍵, 而且只從「需人工、未處理」改成「人工結案」;第二次跑時 3 筆都已是人工結案 ⇒ 印一句就結束、零寫入;
--        狀態混雜(部分已結)⇒ 報錯整筆回滾。拋棄式 PG 連跑兩次實測:第一次 3 筆、第二次 0 筆。
--
-- ══ 為什麼 ═════════════════════════════════════════════════════════════
-- 新提醒(20260922110000 + 程式)一上線, 這 3 筆超過 48 小時 ⇒ LINE 每天早上都會顯示「有錢的事要處理」。
-- 它們是上線前的測試資料:收到時間 07-24 ~ 08-10, 早於第一張真訂單(2026-09-02), 全部對不到訂單。
--
-- ══ 這 3 筆(2026-09-22 唯讀查正式庫, scripts/readonly-prod-sql.sh;全表 52 筆, 需人工未處理 3、需人工已處理 0)══
--   rec_trade_id       amount  received_at(UTC)                 對得到訂單
--   D20260724gUTcg1       101  2026-07-24 09:07:04.87166+00     否
--   D20260811tgQ2QE         6  2026-08-10 18:07:50.505492+00    否
--   D20260811zGoCz3       340  2026-08-10 18:10:25.855424+00    否
--   三筆原值皆為:processed = false、processed_at = NULL、needs_manual_review = true、attempt_count = 8。
--
-- ══ 做什麼 ═════════════════════════════════════════════════════════════
-- 只改這 3 個主鍵:processed = true、processed_at = now()。保留 needs_manual_review = true 與 last_error
-- (= 曾經轉人工的紀錄;plan 2.4 把「需人工 + 已處理」定義為「人工結案」)。
-- 同一交易先檢查這 3 筆都還是「需人工、未處理、processed_at 為空、對不到訂單、attempt_count ≥ 8」,
-- 實際更新筆數必須剛好 3, 任一不符就中止。
-- 這張表沒有 trigger;排程只撈 attempt_count < 8 且未轉人工的列(20260615120000 檔頭 ④)⇒ 不會觸發扣款或寄信。
--
-- ══ ROLLBACK ══════════════════════════════════════════════════════════
-- SET LOCAL lock_timeout = '5s';
--   🔴 rollback 是人貼進 psql 跑的, 而 psql 預設沒有 lock_timeout ⇒ 卡鎖時會無限等。
-- supabase/rollbacks/20260922120000-rollback.sql:同一組 3 個主鍵, 先檢查它們目前是「processed = true、仍是需人工」,
--   再改回 processed = false、processed_at = NULL, 並斷言實際更新 3 筆(不沿用正向的 processed = false 條件, 那樣會更新 0 筆)。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $close$
DECLARE
  v_ids  text[] := ARRAY['D20260724gUTcg1', 'D20260811tgQ2QE', 'D20260811zGoCz3']::text[];
  v_ok   integer;
  v_rows integer;
BEGIN
  -- 先鎖住這 3 筆(依主鍵排序, 避免互鎖), 檢查到更新之間不會被別人改掉(Codex R1 should-fix)。
  PERFORM 1 FROM public.payment_webhook_events e
   WHERE e.rec_trade_id = ANY (v_ids)
   ORDER BY e.rec_trade_id
     FOR UPDATE;
  -- 冪等:3 筆都已經是人工結案(本支貼過了)⇒ 什麼都不做就結束。
  SELECT pg_catalog.count(*) INTO v_ok
    FROM public.payment_webhook_events e
   WHERE e.rec_trade_id = ANY (v_ids) AND e.needs_manual_review AND e.processed AND e.processed_at IS NOT NULL;
  IF v_ok = 3 THEN
    RAISE NOTICE '20260922120000:3 筆已經是人工結案(本支貼過了)⇒ 不再寫入';
    RETURN;
  END IF;
  -- 前置閘:3 筆都在, 而且都還是當初查到的狀態(部分已結 = 狀態混雜 ⇒ 這裡會擋下)
  SELECT pg_catalog.count(*) INTO v_ok
    FROM public.payment_webhook_events e
   WHERE e.rec_trade_id = ANY (v_ids)
     AND e.needs_manual_review
     AND NOT e.processed
     AND e.processed_at IS NULL
     AND e.attempt_count >= 8
     AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id::text = e.order_number);
  IF v_ok <> 3 THEN
    RAISE EXCEPTION '前置閘:這 3 筆應都是「需人工、未處理、對不到訂單」, 實際符合 % 筆 ⇒ 狀態變了, 停下', v_ok;
  END IF;

  UPDATE public.payment_webhook_events e
     SET processed = true,
         processed_at = pg_catalog.now()
   WHERE e.rec_trade_id = ANY (v_ids)
     AND e.needs_manual_review
     AND NOT e.processed
     AND e.processed_at IS NULL
     AND e.attempt_count >= 8
     AND NOT EXISTS (SELECT 1 FROM public.orders o WHERE o.id::text = e.order_number);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 3 THEN
    RAISE EXCEPTION '更新筆數應為 3, 實際 % ⇒ 中止(整筆回滾)', v_rows;
  END IF;

  -- 事後斷言:3 筆都是「人工結案」(需人工 + 已處理), 而且沒有動到別的列
  SELECT pg_catalog.count(*) INTO v_ok
    FROM public.payment_webhook_events e
   WHERE e.rec_trade_id = ANY (v_ids) AND e.needs_manual_review AND e.processed AND e.processed_at IS NOT NULL;
  IF v_ok <> 3 THEN
    RAISE EXCEPTION '事後斷言:人工結案應為 3 筆, 實際 %', v_ok;
  END IF;
  RAISE NOTICE '20260922120000 貼好了:3 筆上線前測試付款通知已標成人工結案';
END
$close$;

COMMIT;
