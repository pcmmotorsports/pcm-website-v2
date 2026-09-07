-- ══════════════════════════════════════════════════════════════════════
-- 🔴🔴 災難還原:**只有在 73 貼下去之後、決定要把它拿掉時才跑。**
-- 🛑 它做的事只有一件:**移除那支更正 RPC**。
--    它【不會】、也【不該】把已經更正過的帳本改回去 ——
--    那些列記的是【外面真的發生過的錢】, 而 A3 產生的新列與被作廢的舊列
--    都是真實紀錄。要動它們是另一個決定, 要人看過。
-- ⚠️ 跑之前先看一眼下面第 0 步印出來的數:**已經有幾筆是靠 A3 更正出來的**。
--    不是 0 ⇒ 停下來找人, 不要一路跑到底。
-- ══════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

\echo '--- 0 🔴 先看:已經有幾筆靠 A3 更正出來的列(不是 0 就停下來找人) ---'
SELECT count(*) AS rows_created_by_a3 FROM public.order_refunds WHERE reason LIKE '更正自 %';
SELECT id, order_id, status, refund_amount, tappay_refund_id, left(reason,60) AS reason
  FROM public.order_refunds WHERE reason LIKE '更正自 %' ORDER BY created_at;

\echo ''
\echo '--- 1 移除那支 RPC(帳本一列都不動) ---'
BEGIN;
DROP FUNCTION IF EXISTS public.admin_correct_backfilled_refund(uuid, integer, text, text, text);

\echo '--- 2 回核:它必須不在了 = 0, 而 A2 的作廢 RPC 必須還在 = 1 ---'
SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_correct_backfilled_refund') AS correct_rpc_should_be_0,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_void_backfilled_refund') AS void_rpc_should_be_1;

\echo '--- 3 🟢 帳本沒被動過:A3 產生的列數與第 0 步必須一樣 ---'
SELECT count(*) AS rows_created_by_a3_still FROM public.order_refunds WHERE reason LIKE '更正自 %';

\echo ''
\echo '🔴 上面三項對得上才 COMMIT。對不上就打 ROLLBACK;'
\echo '   (本檔【不】自動 COMMIT —— 由貼的人自己下)'
