-- ============================================================
-- M-4b · Bing 週報的 **pg_cron 排程**(route = /api/cron/bing-weekly;Sean 2026-09-29 選甲)
--
-- 計畫:~/pcm-mailbox/計畫-Bing週報LINE-20260929.md 第 12～14 節(Fable 新架構 R1 FAIL → R2 PASS)。
-- 排程 `5 1 * * 1` = UTC 星期一 01:05 = 台北星期一 09:05(錯開 09:00 那一輪異常告警)。
--
-- ┌────────────────────────────────────────────────────────────────────────────
-- │ 🔴 **貼這支之前, 顧客站要已經部署到有 /api/cron/bing-weekly 的版本, 而且 Vercel 已設
-- │    BING_WEBMASTER_API_KEY。** 貼完【立刻】手動觸發一次(計畫 12.5 第 4 步):
-- │        SELECT pcm_cron.invoke_cron_route('/api/cron/bing-weekly');
-- │    理由:白名單一上線, 異常告警每天 09:00 / 21:00 就會檢查這一支;還沒成功跑過的排程
-- │    會被算成「從沒跑過」(20260831170000 的 never_beat)⇒ 告警印「要處理:排程」。
-- │ 🔴 本檔【自己擋不住】「route 還沒上線」—— migration 看不到 Vercel。這一格靠上線順序。
-- └────────────────────────────────────────────────────────────────────────────
--
-- 本檔不建表、不建函式、不改權限;只新增一支 cron job。形狀照 20260820070000(請款重查排程)。
-- ============================================================

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ══ 0. 前置檢查 ══════════════════════════════════════════════════════════════
DO $$
DECLARE v_sched text; v_cmd text;
BEGIN
  IF pg_catalog.to_regprocedure('pcm_cron.invoke_cron_route(text)') IS NULL THEN
    RAISE EXCEPTION '前置閘一:pcm_cron.invoke_cron_route(text) 不存在 ⇒ 20260723120000 還沒貼, 本檔沒有可呼叫的 wrapper';
  END IF;
  SELECT j.schedule, j.command INTO v_sched, v_cmd FROM cron.job j WHERE j.jobname = 'pcm-bing-weekly';
  IF FOUND AND (v_sched IS DISTINCT FROM '5 1 * * 1'
                OR v_cmd IS DISTINCT FROM 'SELECT pcm_cron.invoke_cron_route(''/api/cron/bing-weekly'')') THEN
    RAISE EXCEPTION USING MESSAGE =
      '前置閘二:pcm-bing-weekly 已經存在而內容不是本檔要設的(schedule=' || COALESCE(v_sched, '<null>')
      || ')⇒ 有人動過它, 本檔不蓋掉, 停下人工對齊';
  END IF;
END $$;

-- ══ 1. 先拍既有 job 的快照(保護別人的排程)══════════════════════════════════
CREATE TEMP TABLE _bing_jobs_before ON COMMIT DROP AS
  SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active
    FROM cron.job
   WHERE jobname IS DISTINCT FROM 'pcm-bing-weekly';

DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM _bing_jobs_before;
  -- 🔴 cron.job 是空的時, before/after「兩邊都空 ⇒ 相等 ⇒ 全綠」;所以至少要有一支。
  IF v_cnt < 1 THEN
    RAISE EXCEPTION '套用前 cron.job 一支既有 job 都沒有 ⇒ 下面的 before/after 比對沒有對象;拒繼續';
  END IF;
  RAISE NOTICE '已快照 % 支既有 cron job', v_cnt;
END $$;

-- ══ 2. 排程(command 只呼 wrapper、零 secret;by-name upsert 冪等 + 顯式 active)══
DO $$
DECLARE v_id bigint;
BEGIN
  v_id := cron.schedule('pcm-bing-weekly', '5 1 * * 1',
    $job$SELECT pcm_cron.invoke_cron_route('/api/cron/bing-weekly')$job$);
  -- by-name upsert 不會改 active ⇒ 顯式設 true(沿 20260820070000)。
  PERFORM cron.alter_job(job_id => v_id, active => true);
END $$;

-- ══ 3. 後置斷言(任一異常 → 整檔 ROLLBACK)══════════════════════════════════
DO $$
DECLARE v_cnt int;
BEGIN
  -- 3a. 新 job 逐欄、恰好 1 筆。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-bing-weekly' AND username='postgres' AND active
     AND database=current_database() AND schedule='5 1 * * 1'
     AND command='SELECT pcm_cron.invoke_cron_route(''/api/cron/bing-weekly'')';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'pcm-bing-weekly job 不符(實 % 筆);拒繼續', v_cnt;
  END IF;

  -- 3b. nodename/nodeport 與 pcm-settle-sweep 一致(by-name upsert 不更新這兩欄, 漂掉會靜默不執行)。
  --     證得到的是「兩者一致」, 不是「會跑」—— 同 20260820070000:3b 的射程說明。
  IF NOT EXISTS (
    SELECT 1
      FROM cron.job c
      JOIN cron.job r ON r.jobname = 'pcm-settle-sweep'
     WHERE c.jobname = 'pcm-bing-weekly'
       AND c.nodename IS NOT DISTINCT FROM r.nodename
       AND c.nodeport IS NOT DISTINCT FROM r.nodeport
  ) THEN
    RAISE EXCEPTION 'pcm-bing-weekly 的 nodename/nodeport 與 pcm-settle-sweep 不一致 ⇒ 可能靜默不執行;拒繼續';
  END IF;

  -- 3c. 零回歸:既有每一支 job 的每一欄套前套後逐格相同。
  SELECT count(*) INTO v_cnt
    FROM _bing_jobs_before b
    JOIN cron.job a ON a.jobid = b.jobid
   WHERE a.jobname   IS DISTINCT FROM b.jobname
      OR a.schedule  IS DISTINCT FROM b.schedule
      OR a.command   IS DISTINCT FROM b.command
      OR a.nodename  IS DISTINCT FROM b.nodename
      OR a.nodeport  IS DISTINCT FROM b.nodeport
      OR a.database  IS DISTINCT FROM b.database
      OR a.username  IS DISTINCT FROM b.username
      OR a.active    IS DISTINCT FROM b.active;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '既有 cron job 被本檔改動了(實 % 支);拒繼續', v_cnt;
  END IF;

  -- 3d. 既有 job 一支都沒有消失(3c 用 JOIN, 看不到被刪掉的列)。
  SELECT count(*) INTO v_cnt
    FROM _bing_jobs_before b
   WHERE NOT EXISTS (SELECT 1 FROM cron.job a WHERE a.jobid = b.jobid);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '有 % 支既有 cron job 在本檔之後消失了;拒繼續', v_cnt;
  END IF;
  RAISE NOTICE '[20260929040000] 後置閘全過;pcm-bing-weekly = 5 1 * * 1(台北週一 09:05)';
END $$;

COMMIT;

-- ── Rollback(Supabase forward-only;手動)────────────────────────────────────
--   SET lock_timeout = '5s';
--   SELECT cron.unschedule('pcm-bing-weekly');
--   ⚠️ 還原要【另開一顆 commit】:新增一支帶上面那句的 migration, 同時從
--      packages/domain/src/ops/cron-jobs.ts 拿掉 pcm-bing-weekly 那一列
--      (cron-allowlist-drift-gate 只從 migration 算還排著的名字)。
--      apps/admin/src/lib/dashboard/cron-heartbeat-read.test.ts 那格只收集 cron.schedule、
--      不扣 unschedule, 還原那顆要一併讓它認得 unschedule(計畫第 14 節第 2 點)。
--   ⚠️ 只拿掉 BING_WEBMASTER_API_KEY 不夠:排程照跑、每週回 503 記失敗心跳 ⇒ 告警會提醒。
