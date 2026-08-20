-- ============================================================
-- M-4b · 請款狀態重讀的 **pg_cron 排程**(backlog #785;route = /api/cron/capture-recheck)
--
-- ┌────────────────────────────────────────────────────────────────────────────
-- │ 🔴🔴 **這一支【不能】與其他 migration 一起套。它排在 route 部署到線上【之後】。**
-- │
-- │ 理由:排程一開,pg_cron 每 10 分鐘就會去打 `/api/cron/capture-recheck`。
-- │ 若那個 route 還沒部署到線上 ⇒ **每 10 分鐘一發 404**,而那個噪音**沒有人會去看**。
-- │
-- │ 🔴 **而本檔【自己擋不住】那個錯誤** —— 我明說,不假裝有守門:
-- │   migration 跑在 DB 裡,**看不到 Vercel 上有沒有那個 route**。
-- │   下面那些斷言驗的是「job 建對了」,**不是**「它打得到東西」。
-- │   ⇒ 這一格靠的是**人在對的時刻套它**,而本檔能做的只有把這句話寫在第一段。
-- │   (先例:`20260810200000:36-46` 逐字證偽了「同批 apply ⇒ 風險窗為零」——
-- │    repo 的 apply 路徑逐 statement/逐檔自動提交。所以「順序」不是機制,是紀律。)
-- └────────────────────────────────────────────────────────────────────────────
--
-- ── 🔴 而這一支只是【第一把鑰匙】,兩把都要轉 ────────────────────────────────
--   即使排程開了,只要 `CAPTURE_RECHECK_CUTOFF_DAYS` 這個 env **沒設**,
--   route 會直接回 200 + `skipped_no_cutoff`、**一發 TapPay 都不打、連 DB deps 都不建**
--   (`apps/storefront/src/app/api/cron/capture-recheck/route.ts` 的上膛閘)。
--   ⇒ **排程 = 第一把鑰匙;env = 第二把。兩把都轉了才會真的開始運作。**
--   ⇒ 形狀照 `api/cron/email-sweep/route.ts:18-20` 逐字(「真正的『上膛』動作是設 env,不是排程」)。
--
-- ── 頻率 `*/10 * * * *` 的來源與效期 ────────────────────────────────────────
--   主視窗 2026-08-20 端給 Sean 的建議是「每 10 分鐘,只問最近 3 天的單」,他回「**要**」——
--   🔴 **沒有推翻那組數字,也沒有明確採納** ⇒ **主視窗暫定,Sean 未逐字確認。**
--   ⇒ 「3 天」那一半做成 env(改它不用動 DB);**「10 分鐘」這一半在這裡**,
--     改它要 `cron.alter_job` 或再一支 migration。**這個不對稱是刻意的,而它的代價要記著。**
--
-- ⛔ apply 停點:**不進「整包一起套」那批。** 見檔頭第一段。
-- ============================================================

BEGIN;

-- ══ 1. 先拍既有 job 的快照(保護別人的排程)══════════════════════════════════
-- 🔴 形狀照 `20260819160000:187-207`:`cron.schedule` 是 by-name upsert,而**我要證明我沒動到別人的**。
CREATE TEMP TABLE _capture_jobs_before ON COMMIT DROP AS
  SELECT jobid, jobname, schedule, command, nodename, nodeport, database, username, active
    FROM cron.job;

DO $$
DECLARE v_cnt int;
BEGIN
  SELECT count(*) INTO v_cnt FROM _capture_jobs_before;
  -- 🔴 少了這一格,若 cron.job 是空的,before/after 會「兩邊都空 ⇒ 相等 ⇒ 全綠」——
  --    **一個【什麼都沒有】的比對,和一個【什麼都沒變】的比對,在輸出上是同一句話。**
  IF v_cnt < 1 THEN
    RAISE EXCEPTION '套用前 cron.job 一支既有 job 都沒有 ⇒ 下面的 before/after 比對沒有對象、結論不成立;拒繼續';
  END IF;
  RAISE NOTICE '已快照 % 支既有 cron job(全部納入下面的逐欄比對保護)', v_cnt;
END $$;

-- ══ 2. 排程(command 只呼 wrapper、零 secret;by-name upsert 冪等 + 顯式 active)══
DO $$
DECLARE v_id bigint;
BEGIN
  v_id := cron.schedule('pcm-capture-recheck', '*/10 * * * *',
    $job$SELECT pcm_cron.invoke_cron_route('/api/cron/capture-recheck')$job$);
  -- by-name upsert 不會改 active,故顯式設 true(沿 20260723120000 F4 / 20260819160000:215)。
  PERFORM cron.alter_job(job_id => v_id, active => true);
END $$;

-- ══ 3. fail-closed 斷言(自閘 COMMIT;任一異常 → 整檔 ROLLBACK、DB 不半套)══════
DO $$
DECLARE v_cnt int;
BEGIN
  -- 3a. job 本身逐格。
  SELECT count(*) INTO v_cnt FROM cron.job
   WHERE jobname='pcm-capture-recheck' AND username='postgres' AND active
     AND database=current_database() AND schedule='*/10 * * * *'
     AND command='SELECT pcm_cron.invoke_cron_route(''/api/cron/capture-recheck'')';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'pcm-capture-recheck job 不符(實 % 筆);拒繼續', v_cnt;
  END IF;

  -- 3b. 🔴 by-name upsert **不會更新 nodename/nodeport**;那兩欄漂掉時 job 會顯示 active、
  --     排程存在、而**永遠不執行**,且本檔仍然 apply 成功 ⇒ 又一個「看起來成功而什麼都沒發生」。
  --     ⇒ **不寫死任何值**,拿同一張表裡的 `pcm-settle-sweep` 當基準(照 `20260819160000:248-258`)。
  --     🔴 而這一格證得到的是「**兩者一致**」,**不是「會跑」** —— 兩支同時漂掉時本格照樣通過。
  --        要升級成「量到活的」得查 `cron.job_run_details`,**本檔沒做**:
  --        本窗沒有 pg_cron 環境可以驗那張表的可讀性,而**加一道我驗不了的檢查會讓 apply 因假理由失敗**
  --        (那正是 `20260819160000:262-267` 拒絕過的同一件事)。⇒ 留為已知射程,不留為假斷言。
  IF NOT EXISTS (
    SELECT 1
      FROM cron.job c
      JOIN cron.job r ON r.jobname = 'pcm-settle-sweep'
     WHERE c.jobname = 'pcm-capture-recheck'
       AND c.nodename IS NOT DISTINCT FROM r.nodename
       AND c.nodeport IS NOT DISTINCT FROM r.nodeport
  ) THEN
    RAISE EXCEPTION 'pcm-capture-recheck 的 nodename/nodeport 與現行的 pcm-settle-sweep 不一致 ⇒ 可能靜默不執行;拒繼續';
  END IF;

  -- 3c. 🔴 **零回歸**:既有每一支 job 的每一欄套前套後逐格相同。
  --     這一格擋的是「by-name upsert 打到別人」——而那是多窗共用一張 cron.job 時最真實的風險。
  SELECT count(*) INTO v_cnt
    FROM _capture_jobs_before b
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

  -- 3d. 反面:既有 job 一支都沒有消失(3c 用 JOIN,刪掉的列不會被它看到)。
  SELECT count(*) INTO v_cnt
    FROM _capture_jobs_before b
   WHERE NOT EXISTS (SELECT 1 FROM cron.job a WHERE a.jobid = b.jobid);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '有 % 支既有 cron job 在本檔之後消失了;拒繼續', v_cnt;
  END IF;
END $$;

COMMIT;

-- ── Rollback(Supabase forward-only;手動)────────────────────────────────────
--   SELECT cron.unschedule('pcm-capture-recheck');
--   ⚠️ 而**更快的關法不是這個** —— 把 env `CAPTURE_RECHECK_CUTOFF_DAYS` 拿掉即可:
--      排程照跑,而 route 直接回 200 no-op、一發 TapPay 都不打。**那是第二把鑰匙的用途。**
