-- 20260915120000-rollback.sql —— 退回 20260915120000_m4b_anomaly_alert_twice_daily.sql
-- 把 `pcm-anomaly-alert` 從一天兩班改回一天一班:`0 1,13 * * *` ⇒ `0 1 * * *`。
-- 🔴 退回的代價寫清楚:晚上那一班沒了 ⇒ **傍晚壞掉的排程要等隔天早上九點才有人聽得到**
--    (那正是 2026-09-13 email-sweep 每輪 503 沒人發現的那個形狀, 見正檔檔頭)。
--    ⇒ 只在「晚上那封信本身造成問題」時才退。
-- 🔵 同時要退【兩個】TS 的格子, 只退一個會紅(codex R1 nit):
--    ① `packages/domain/src/ops/cron-jobs.ts` 白名單那一列的 `schedule` 字串改回 `'0 1 * * *'`
--       (那一欄是唯讀撈來的當時值, 不改 ⇒ 板上那一欄跟正式庫對不上)。
--    ② `packages/domain/src/ops/cron-jobs.test.ts` 的 `PERIOD_MINUTES_BY_SCHEDULE`:
--       `'0 1,13 * * *': 720` 換回 `'0 1 * * *': 1440`, 並把語意分類那一格退回「九支停了嗎 / 一支準時嗎」。
--       🔴 只退 ① 的話, 對照表上那一格會變成「沒有人用的週期」⇒ 當場紅。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 🔴 與正檔同形:`FOR UPDATE` 扣住那一列到 COMMIT(避免 TOCTOU), 而且只用 `alter_job` 改排程 ——
--    **不重寫 command、不替任何人把停用中的 job 打開**(codex R1 MF2 / MF3)。
DO $do$
DECLARE
  v_id bigint; v_sched text; v_cmd text; v_active boolean;
  c_cmd  CONSTANT text := 'SELECT pcm_cron.invoke_cron_route(''/api/cron/anomaly-alert'')';
  c_want CONSTANT text := '0 1 * * *';
BEGIN
  SELECT j.jobid, j.schedule, j.command, j.active
    INTO v_id, v_sched, v_cmd, v_active
    FROM cron.job j
   WHERE j.jobname = 'pcm-anomaly-alert'
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '退回前置閘一:cron.job 裡沒有 pcm-anomaly-alert ⇒ 沒東西可退';
  END IF;
  IF v_cmd IS DISTINCT FROM c_cmd THEN
    RAISE EXCEPTION USING MESSAGE =
      '退回前置閘二:command 不是我認得的那一句 ⇒ 有人動過它, 本檔不准蓋掉。實得:' || COALESCE(v_cmd, '<null>');
  END IF;
  IF NOT COALESCE(v_active, false) THEN
    RAISE EXCEPTION '退回前置閘三:pcm-anomaly-alert 目前是停用中 ⇒ 本檔不准替他打開, 先去問清楚';
  END IF;
  IF v_sched = c_want THEN
    RAISE NOTICE '退回前置閘:已經是一天一班 ⇒ 本檔重跑, 下面那一句是冪等的';
  ELSIF v_sched <> '0 1,13 * * *' THEN
    RAISE EXCEPTION USING MESSAGE =
      '退回前置閘四:現在的排程是 ' || v_sched || ', 不是 20260915120000 設的值 ⇒ 有人動過它, 停下人工對齊';
  END IF;

  PERFORM cron.alter_job(job_id => v_id, schedule => c_want);
END
$do$;

DO $post$
DECLARE v_sched text; v_active boolean; v_n integer;
BEGIN
  SELECT j.schedule, j.active INTO v_sched, v_active
    FROM cron.job j WHERE j.jobname = 'pcm-anomaly-alert';
  IF v_sched IS DISTINCT FROM '0 1 * * *' THEN
    RAISE EXCEPTION USING MESSAGE = '退回後置閘一:排程不是 0 1 * * *(實得 ' || COALESCE(v_sched, '<null>') || ')';
  END IF;
  IF NOT COALESCE(v_active, false) THEN
    RAISE EXCEPTION '退回後置閘二:pcm-anomaly-alert 沒有 active';
  END IF;
  SELECT pg_catalog.count(*) INTO v_n FROM cron.job j WHERE j.jobname LIKE 'pcm-anomaly-alert%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '退回後置閘三:pcm-anomaly-alert%% 有 % 個 job(必須恰好 1)', v_n;
  END IF;
  RAISE NOTICE '[20260915120000-rollback] 退回完成;pcm-anomaly-alert = 0 1 * * *';
END
$post$;

COMMIT;
