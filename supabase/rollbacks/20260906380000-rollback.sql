-- rollback of 20260906380000_m4b_pcm_readonly_column_grants.sql
-- 🔵 **可以直接收** —— 本片只加了欄級 SELECT, 沒有建任何物件、沒有人接在它上面。
--    ⚠️ 而「沒有人接在它上面」today 成立的理由是:本片是**第一次**給 pcm_readonly 這兩張表的權限
--      (前置閘⑥ 當時斷言過它表級 SELECT 為 0)。若之後有人把它接進某個查詢或報表, 收之前先問一聲。
BEGIN;
REVOKE SELECT (id, supplier_slug, started_at, completed_at, outcome)
  ON public.supplier_sync_runs FROM pcm_readonly;
REVOKE SELECT (order_id, attempts, last_attempt_at, gave_up_at)
  ON public.pcm_settle_retry_attempts FROM pcm_readonly;
COMMIT;

-- 收完確認(一樣是【會回傳列】的 SELECT, 不看 NOTICE):全部應該是 f
SELECT c.relname AS 表, a.attname AS 欄,
       pg_catalog.has_column_privilege('pcm_readonly', c.oid, a.attnum, 'SELECT') AS 還讀得到嗎
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
 WHERE n.nspname='public'
   AND c.relname IN ('supplier_sync_runs','pcm_settle_retry_attempts')
   AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY c.relname, a.attnum;
