-- ══════════════════════════════════════════════════════════════════════
-- 🔴🔴 災難還原:**只有在 79 貼下去之後、決定要把補登能力收回時才跑。**
-- 🛑 它做的事只有一件:**移除那支補登 RPC**。
--    它【不會】、也【不該】把已經補登進去的列刪掉 ——
--    那些列記的是【外面真的發生過的錢】。要動它們是另一個決定, 要人看過。
-- ⚠️ **順序**:若 80(讓路)已經貼了, **先跑 `80r` 再跑本檔** ——
--    留著一道「只對補登列生效」的讓路而補登 RPC 不在, 是一個沒有人走得到的分支
--    (不會出事, 而它會讓下一個讀守門的人以為補登還開著)。
-- ══════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

\echo '--- 0 🔴 先看:已經補登進去幾列(不是 0 就停下來找人) ---'
SELECT count(*) AS rows_created_by_backfill FROM public.order_refunds
 WHERE backfilled_source IS NOT NULL AND reason = 'TapPay 後台補登';
SELECT id, order_id, status, refund_amount, tappay_refund_id, backfill_attested_by, backfill_occurred_at
  FROM public.order_refunds
 WHERE backfilled_source IS NOT NULL AND reason = 'TapPay 後台補登'
 ORDER BY created_at;

\echo ''
\echo '--- 1 移除那支 RPC(帳本一列都不動) ---'
BEGIN;
DROP FUNCTION IF EXISTS public.admin_backfill_tappay_console_refund(
  uuid, integer, text, timestamptz, boolean, text, text);

\echo '--- 2 回核:它不在了 = 0;而 A2 的作廢 RPC 與 A3 的更正 RPC 都還在 = 1 / 1 ---'
SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_backfill_tappay_console_refund') AS backfill_should_be_0,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_void_backfilled_refund')        AS void_should_be_1,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='admin_correct_backfilled_refund')     AS correct_should_be_1;

\echo '--- 3 🟢 帳本沒被動過:補登列數與第 0 步必須一樣 ---'
SELECT count(*) AS rows_still FROM public.order_refunds
 WHERE backfilled_source IS NOT NULL AND reason = 'TapPay 後台補登';

\echo ''
\echo '🔴 上面三項對得上才 COMMIT;對不上打 ROLLBACK;(本檔【不】自動 COMMIT)'
