SET LOCAL lock_timeout = '5s';
-- 20260928260000 退回:停掉排程 pcm-cron-run-log-purge、刪函式、刪心跳列。
-- 🔴 順序與上線相反:先推「白名單(packages/domain/src/ops/cron-jobs.ts)拿掉這一支」的碼,
--    dev(後台儀表板)與 main(顧客站,異常告警排程在這裡跑)都部署完成,再貼本檔。
--    反過來(先刪心跳、白名單還有名字)⇒ 後台標「從來沒寫過心跳」,告警寄假警報。
-- 🔴 正式退役要另寫一支 migration(含 cron.unschedule)跟白名單同一顆 commit,排程白名單漂移閘才會過;
--    本檔是緊急時手動用的。退役那顆 commit 不放 APPLIED.tsv,貼成功之後才記(貼板工具看到已記帳就拒絕)。
-- 已刪的舊紀錄無法還原。
-- 貼完同批跑 pcm_acl_approve_latest(p_note 帶 20260928260000 rollback)。
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT cron.unschedule('pcm-cron-run-log-purge') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-cron-run-log-purge');
DROP FUNCTION IF EXISTS public.pcm_cron_run_log_purge() RESTRICT;
DELETE FROM public.sweeper_heartbeat WHERE job_name = 'pcm-cron-run-log-purge';
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-cron-run-log-purge')
     OR pg_catalog.to_regprocedure('public.pcm_cron_run_log_purge()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.sweeper_heartbeat WHERE job_name = 'pcm-cron-run-log-purge') THEN
    RAISE EXCEPTION '退回事後閘:排程、函式或心跳列還在';
  END IF;
END
$post$;
COMMIT;
