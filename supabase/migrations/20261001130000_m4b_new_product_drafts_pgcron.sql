-- 20261001130000 · M-4b 每日自動新品草稿:pg_cron 每天台灣 09:05(UTC 01:05)呼叫 /api/cron/new-product-drafts。
--
-- 為什麼:Sean 2026-10-01 Q6 甲「合併上線, 並設定每天 09:00 自動產新品草稿」(計畫 ~/pcm-mailbox/計畫-每日自動新品草稿-20261001.md 片 6)。
-- 形狀:BEGIN 到 COMMIT 逐段照抄 20260929040000(Bing 週報)—— 同一支 wrapper pcm_cron.invoke_cron_route(vault 裡的 cron_secret),
--   前置閘(wrapper 在、同名 job 若存在必須同內容)、套前快照既有 job、by-name schedule、後置閘(新 job 逐欄、nodename/nodeport
--   與 pcm-settle-sweep 一致、既有 job 零回歸、零消失)。只換 job 名稱、時間與 route。
-- 為什麼是 09:05:每天 07:45 的網站同步大約 08:00 跑完, 之後才有當天的新品;錯開 09:00 那一輪異常告警(同 Bing 週報 09:05)。
--   時區:正式庫 cron.job_run_details 唯讀量, pcm-anomaly-alert('0 1,13 * * *')實際在 UTC 01:00 / 13:00 跑 ⇒ 排程時區是 UTC。
--
-- ┌────────────────────────────────────────────────────────────────────────────
-- │ 🔴 **貼這支之前, 顧客站(main)要已經部署到有 /api/cron/new-product-drafts 的版本,
-- │    而且 Vercel 顧客站 Production 已設 NEW_PRODUCT_DRAFTS_ENABLED=on【並重新部署】(env 要重新部署才生效)。**
-- │    避開台北 08:55–09:10 貼(手動觸發與排程撞在一起會跑兩輪, 最多 6 份;同商品不重複)。
-- │    貼完【立刻】手動觸發一次:
-- │        SELECT pcm_cron.invoke_cron_route('/api/cron/new-product-drafts');
-- │    ⚠️ 這一句只回 request id, route 失敗或旗標沒生效它一樣「成功」⇒ 要再查到心跳時間才算完成:
-- │        SELECT last_success_at FROM public.sweeper_heartbeat WHERE job_name = 'pcm-new-product-drafts';
-- │    理由(同 Bing 週報):白名單一上線, 異常告警就會檢查這一支;還沒成功跑過的排程
-- │    會被算成「從沒跑過」(20260831170000 的 never_beat)⇒ 告警印「要處理:排程」。
-- └────────────────────────────────────────────────────────────────────────────
-- 心跳:route 跑完寫 pcm-new-product-drafts 成功心跳;旗標關 ⇒ 不寫(兩天後亮燈)。白名單 packages/domain/src/ops/cron-jobs.ts(門檻兩天)。
--
-- 回滾:另開一顆 commit, 新增一支 migration(內容 = supabase/rollbacks/20261001130000-rollback.sql:cron.unschedule 這一支、其他 job 不動),
--   同一顆拿掉 packages/domain/src/ops/cron-jobs.ts 那一列, 並讓 cron-allowlist-drift-gate 與
--   apps/admin/src/lib/dashboard/cron-heartbeat-read.test.ts 認得 unschedule(兩者都只掃 supabase/migrations/, 不看 rollbacks/)。
--   ⚠️ 只跑 rollbacks/ 那支而不新增 migration ⇒ migrations 裡仍有這支的 cron.schedule、白名單卻沒有 ⇒ 閘紅。rollbacks/ 那支是 SQL 內容的預演。
--   要立刻停而不撤排程:Vercel 拿掉 NEW_PRODUCT_DRAFTS_ENABLED 並重新部署(route 照被打, 但不建草稿)。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ══ 0. 前置檢查 ══════════════════════════════════════════════════════════════
DO $$
DECLARE v_sched text; v_cmd text;
BEGIN
  IF pg_catalog.to_regprocedure('pcm_cron.invoke_cron_route(text)') IS NULL THEN
    RAISE EXCEPTION '前置閘一:pcm_cron.invoke_cron_route(text) 不存在 ⇒ 20260723120000 還沒貼, 本檔沒有可呼叫的 wrapper';
  END IF;
  SELECT j.schedule, j.command INTO v_sched, v_cmd FROM cron.job j WHERE j.jobname = 'pcm-new-product-drafts';
  IF FOUND AND (v_sched IS DISTINCT FROM '5 1 * * *'
                OR v_cmd IS DISTINCT FROM 'SELECT pcm_cron.invoke_cron_route(''/api/cron/new-product-drafts'')') THEN
    RAISE EXCEPTION USING MESSAGE =
      '前置閘二:pcm-new-product-drafts 已經存在而內容不是本檔要設的(schedule=' || COALESCE(v_sched, '<null>')
      || ')⇒ 有人動過它, 本檔不蓋掉, 停下人工對齊';
  END IF;
END $$;

-- ══ 1. 先拍既有 job 的快照(保護別人的排程)══════════════════════════════════
CREATE TEMP TABLE _npd_jobs_before ON COMMIT DROP AS
  SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active
    FROM cron.job
   WHERE jobname IS DISTINCT FROM 'pcm-new-product-drafts';

DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM _npd_jobs_before;
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
  v_id := cron.schedule('pcm-new-product-drafts', '5 1 * * *',
    $job$SELECT pcm_cron.invoke_cron_route('/api/cron/new-product-drafts')$job$);
  -- by-name upsert 不會改 active ⇒ 顯式設 true(沿 20260820070000)。
  PERFORM cron.alter_job(job_id => v_id, active => true);
END $$;

-- ══ 3. 後置斷言(任一異常 → 整檔 ROLLBACK)══════════════════════════════════
DO $$
DECLARE v_cnt int;
BEGIN
  -- 3a. 新 job 逐欄、恰好 1 筆。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-new-product-drafts' AND username='postgres' AND active
     AND database=current_database() AND schedule='5 1 * * *'
     AND command='SELECT pcm_cron.invoke_cron_route(''/api/cron/new-product-drafts'')';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'pcm-new-product-drafts job 不符(實 % 筆);拒繼續', v_cnt;
  END IF;

  -- 3b. nodename/nodeport 與 pcm-settle-sweep 一致(by-name upsert 不更新這兩欄, 漂掉會靜默不執行)。
  --     證得到的是「兩者一致」, 不是「會跑」—— 同 20260820070000:3b 的射程說明。
  IF NOT EXISTS (
    SELECT 1
      FROM cron.job c
      JOIN cron.job r ON r.jobname = 'pcm-settle-sweep'
     WHERE c.jobname = 'pcm-new-product-drafts'
       AND c.nodename IS NOT DISTINCT FROM r.nodename
       AND c.nodeport IS NOT DISTINCT FROM r.nodeport
  ) THEN
    RAISE EXCEPTION 'pcm-new-product-drafts 的 nodename/nodeport 與 pcm-settle-sweep 不一致 ⇒ 可能靜默不執行;拒繼續';
  END IF;

  -- 3c. 零回歸:既有每一支 job 的每一欄套前套後逐格相同。
  SELECT count(*) INTO v_cnt
    FROM _npd_jobs_before b
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
    FROM _npd_jobs_before b
   WHERE NOT EXISTS (SELECT 1 FROM cron.job a WHERE a.jobid = b.jobid);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '有 % 支既有 cron job 在本檔之後消失了;拒繼續', v_cnt;
  END IF;
  RAISE NOTICE '[20261001130000] 後置閘全過;pcm-new-product-drafts = 5 1 * * *(台北每天 09:05)';
END $$;

COMMIT;
