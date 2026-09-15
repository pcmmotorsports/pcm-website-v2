-- 20260916050000-rollback.sql —— 退回 20260916050000_m4b_sql_cron_healthchecks_ping.sql
--
-- 🔴 順序是承重的:同一個交易【先】把 5 支排程 command 改回原句逐字、【再】DROP 函式。
--    反過來的話,DROP 到改回之間的每一輪排程都會因為找不到 pcm_cron.ping_healthcheck 而 failed
--    (排程指令第一句成功、第二句丟錯 ⇒ 第一句的寫入也回滾;拋棄式 PG 2026-09-15 實測)。
-- 🔴 command 既不是新句也不是原句 ⇒ 有人動過,拒退(不猜要改回什麼)。
-- ⚠️ Vault 那 5 個 hc_ping_* secret 留著無害;healthchecks.io 那 5 個 check 由 Sean 暫停。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $back$
DECLARE
  v_orig constant jsonb := pg_catalog.jsonb_build_object(
    'pcm-expire-unpaid-orders', 'SELECT pcm_cron.expire_unpaid_orders(500)',
    'pcm-settle-retry',         'SELECT public.pcm_settle_retry_sweep();',
    'pcm-late-payment-sweep',   'SELECT pcm_cron.late_payment_pending_refund_sweep()',
    'pcm-acl-digest',           'SELECT public.pcm_acl_digest_record();',
    'pcm-net-exposure',         'SELECT public.pcm_net_exposure_record();'
  );
  v_new constant jsonb := pg_catalog.jsonb_build_object(
    'pcm-expire-unpaid-orders', 'SELECT pcm_cron.expire_unpaid_orders(500); SELECT pcm_cron.ping_healthcheck(''pcm-expire-unpaid-orders'');',
    'pcm-settle-retry',         'SELECT public.pcm_settle_retry_sweep(); SELECT pcm_cron.ping_healthcheck(''pcm-settle-retry'');',
    'pcm-late-payment-sweep',   'SELECT pcm_cron.late_payment_pending_refund_sweep(); SELECT pcm_cron.ping_healthcheck(''pcm-late-payment-sweep'');',
    'pcm-acl-digest',           'SELECT public.pcm_acl_digest_record(); SELECT pcm_cron.ping_healthcheck(''pcm-acl-digest'');',
    'pcm-net-exposure',         'SELECT public.pcm_net_exposure_record(); SELECT pcm_cron.ping_healthcheck(''pcm-net-exposure'');'
  );
  k         text;
  v_id      bigint;
  v_cmd     text;
  v_cmd2    text;
  v_sched   text;
  v_active  boolean;
  v_sched2  text;
  v_active2 boolean;
BEGIN
  FOR k IN SELECT pg_catalog.jsonb_object_keys(v_orig) LOOP
    SELECT j.jobid, j.command, j.schedule, j.active INTO v_id, v_cmd, v_sched, v_active FROM cron.job j WHERE j.jobname = k;
    IF NOT FOUND THEN
      RAISE EXCEPTION '退回前置閘一:cron.job 裡沒有 % ⇒ 不知道要退什麼', k;
    END IF;
    IF v_cmd = (v_orig ->> k) THEN
      RAISE NOTICE '退回:% 已經是原句 ⇒ 冪等略過', k;
      CONTINUE;
    END IF;
    IF v_cmd IS DISTINCT FROM (v_new ->> k) THEN
      RAISE EXCEPTION USING MESSAGE =
        '退回前置閘二:' || k || ' 的 command 既不是新句也不是原句 ⇒ 有人動過, 拒退。實得:' || COALESCE(v_cmd, '<null>');
    END IF;
    PERFORM cron.alter_job(job_id => v_id, command => v_orig ->> k);
    SELECT j.command, j.schedule, j.active INTO v_cmd2, v_sched2, v_active2 FROM cron.job j WHERE j.jobid = v_id;
    IF v_cmd2 IS DISTINCT FROM (v_orig ->> k) THEN
      RAISE EXCEPTION USING MESSAGE = '退回事後比對:' || k || ' 沒有改回原句。實得:' || COALESCE(v_cmd2, '<null>');
    END IF;
    IF v_sched2 IS DISTINCT FROM v_sched OR v_active2 IS DISTINCT FROM v_active THEN
      RAISE EXCEPTION '退回事後比對二:% 改 command 的同時 schedule / active 跟著變了 ⇒ 整筆回滾', k;
    END IF;
  END LOOP;
END
$back$;

-- 🔴 5 支都改回原句之後才 DROP(同一個交易)
DROP FUNCTION IF EXISTS pcm_cron.ping_healthcheck(text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('pcm_cron.ping_healthcheck(text)') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘:pcm_cron.ping_healthcheck(text) 還在';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job j WHERE j.command LIKE '%ping_healthcheck%') THEN
    RAISE EXCEPTION '退回後置閘:還有排程 command 呼叫 ping_healthcheck ⇒ 下一輪會 failed';
  END IF;
END
$post$;

COMMIT;
