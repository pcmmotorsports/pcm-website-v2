-- 20260915120000_m4b_anomaly_alert_twice_daily.sql
-- 異常告警改一天兩次:`0 1 * * *` ⇒ `0 1,13 * * *`(台北早上 9 點 + 晚上 9 點)。
-- pcm:idempotent: yes
--   理由:本檔**不新建任何 job**, 只把既有那一列的 `schedule` 欄改成同一個值 ⇒ 重跑寫入相同的東西。
--
-- ══ 為什麼(2026-09-14 22:4x 的實例)═══════════════════════════════════
-- `/api/cron/email-sweep` 從 2026-09-13 貼板起【每一輪回 503】(42501, 見 20260915110000),
-- 而**沒有人知道, 直到今晚有人去翻 Vercel log**。
-- 🔬 而告警那條路【是通的】—— 我查過每一格, 不是它壞掉:
--   · 503 那條路有 `recordHeartbeatFailure(emailSweep)`(`email-sweep/route.ts:1366` / `:1411`)⇒ 寫 `sweeper_heartbeat`
--   · `pcm-email-sweep` **不在** `FAILURE_COUNT_MEANINGLESS`(`packages/domain/src/ops/cron-jobs.ts:144`)
--     ⇒ `consecutive_failures > 0` 就算 abnormal(`20260831170000:136`)
--   · `cronHeartbeatAbnormalCount > 0` **進 `shouldAlert`**(`check-anomaly-alerts.ts:1581`)⇒ 早上摘要那一行會印「排程」
--   · 正式庫唯讀(2026-09-14):`pcm-email-sweep` last_success 08:15、consecutive_failures **78**、離上次成功 6h31m
--     (staleMinutes 15 ⇒ 早就 stale);其餘 9 支全 0。
-- 🎯 **⇒ 病不在「沒有人在看」, 在【它一天只講一次話】。** 壞在傍晚 ⇒ 要等隔天早上九點才有人聽得到。
-- ⇒ 主視窗 2026-09-14 裁甲:加一班晚上的。**零程式改動**(route / 內容 / 判準一個字都不動)。
--
-- ══ 做什麼 ═══════════════════════════════════════════════════════════
-- 把既有那一列**鎖住**(`SELECT … FOR UPDATE`)、驗過之後,用 `cron.alter_job(job_id, schedule => …)`
-- **只改 schedule 那一格**。`command` / `active` / 擁有者一個字都不動。
-- 🔴 **刻意不開第二個 job 名**:新名字會進 `CRON_JOB_WHITELIST` 的分母, 而寄心跳的那一端仍只寫
--    `CRON_JOB_NAME.anomalyAlert` 這一個名字 ⇒ 新名字永遠 `never_beat` ⇒ **每天叫一個假的異常**。
-- 🛑 **第一版寫的是 `cron.schedule('pcm-anomaly-alert', …)` 靠 by-name upsert** —— 那句話本身沒錯
--    (pg_cron 確實會 upsert), 而它**會連 `command` 一起重寫、並把 `active` 設回 true**
--    ⇒ 有人修好 command、或為了事故手動停用, 都會被本檔**無聲蓋掉**, 而後置閘看到的是自己剛寫的東西 ⇒ 照樣綠。
--    (codex R1 MF2;R2 查 pg_cron 上游原始碼確認 `alter_job` 只動有傳進去的欄位。)
-- 🛑 前置閘與改動**併在同一個 `DO` 裡**也是刻意的(codex R1 MF3):普通 `SELECT` 不鎖列
--    ⇒ 「我讀到合法值 → 別人改掉並 commit → 我覆蓋他 → 我的後置閘過」。`FOR UPDATE` 扣到 COMMIT 才關得起來。
--    🔬 雙連線實測(拋棄式 PG):另一條先扣住 ⇒ 本檔當場 `canceling statement due to lock timeout`。
--
-- ══ 🔴 跟這支一起動的那一格(在 TS 那半, 不在 SQL)═══════════════════════
-- `cron-jobs.ts` 的 `staleMinutes` 從 `26 * 60` 改成 **`14 * 60`** —— **同一顆, 不准分開上**。
-- 🔴 **理由不是順手收緊, 是不改的話這支 migration 會讓偵測【變晚】**(codex R1/R2 MF1;
--    我第一版在測試裡寫「絕對值沒有變壞」, 那句話是假的):
--    晚班會**刷新「最後成功時間」**, 而 stale 判準是 `minutesAgo > staleMinutes`
--    (`apps/admin/src/lib/dashboard/cron-heartbeat-read.ts`):
--      台北 9/16 21:05 整支停掉(且沒有失敗心跳)
--        舊(一班 · 26 小時):最後成功 9/16 09:00 ⇒ 9/17 11:00 才 stale(停掉後 14 小時)
--        兩班而門檻不動      :最後成功 9/16 21:00 ⇒ 9/17 23:00 才 stale(停掉後 26 小時)← 晚 12 小時
--        兩班 + 門檻 14 小時 :最後成功 9/16 21:00 ⇒ 9/17 11:00 就 stale(停掉後 14 小時)← 追平
-- ✅ **2026-09-14 Sean 拍甲**:門檻 26 ⇒ 14 小時,與晚班同一顆。
--    (`cron-jobs.ts:58` 原本逐字寫著「26 小時 = Sean 拍的 ⇒ 改它之前要回去問」—— 問過了, 這是那次的答案;
--     那條「要回去問」的規矩沒有被取消, 下一個想動它的人一樣要問。)
-- 🔬 那三條時間軸有一格**真的跑過**, 不是只寫在註解裡:
--    `apps/admin/src/lib/dashboard/cron-heartbeat-read.test.ts`「告警器自己停掉」那兩格。
-- 🛑 **⇒ 只貼這支 SQL 而沒有部署 TS 那半 ⇒ 就是上面那個「晚 12 小時」的世界。**
--
-- ══ 回滾 ═══════════════════════════════════════════════════════════
-- `supabase/rollbacks/20260915120000-rollback.sql`:同一句改回 `0 1 * * *`。

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ── 前置閘 + 改排程(同一個 DO,因為 `FOR UPDATE` 的鎖要一路扣到 COMMIT)──────
-- 🔴 為什麼前置閘與改動不分兩段(codex R1 MF3):普通 `SELECT` 不鎖列 ⇒
--    「A 讀到合法值 → B 把排程改掉並 commit → A 覆蓋 B → A 的後置閘看到的是自己寫的東西 ⇒ 過」。
--    `FOR UPDATE` 把那一列扣住到本交易結束, B 只能等 ⇒ 那條路才關得起來。
DO $do$
DECLARE
  v_id bigint; v_sched text; v_cmd text; v_active boolean;
  -- 逐字照 `20260723120000:131-132`。本檔**只換排程**, command 一個字都不動。
  c_cmd  CONSTANT text := 'SELECT pcm_cron.invoke_cron_route(''/api/cron/anomaly-alert'')';
  c_want CONSTANT text := '0 1,13 * * *';
BEGIN
  SELECT j.jobid, j.schedule, j.command, j.active
    INTO v_id, v_sched, v_cmd, v_active
    FROM cron.job j
   WHERE j.jobname = 'pcm-anomaly-alert'
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '前置閘一:cron.job 裡沒有 pcm-anomaly-alert ⇒ 20260723120000 還沒貼, 本檔沒有對象';
  END IF;

  -- 🔴 command 逐字比對(codex R1 MF2):上一版只看排程就直接 `cron.schedule` 重寫整列
  --    ⇒ **會把別人修好的 command 蓋回舊的**, 而後置閘只看得到自己剛寫下去的東西 ⇒ 照樣綠。
  IF v_cmd IS DISTINCT FROM c_cmd THEN
    RAISE EXCEPTION USING MESSAGE =
      '前置閘二:command 不是我認得的那一句 ⇒ 有人動過它, 本檔不准蓋掉。實得:' || COALESCE(v_cmd, '<null>');
  END IF;

  -- 🔴 停用中就停手(codex R1 MF2):`active = false` 常常是**有人為了事故手動關掉它**。
  --    上一版無條件 `alter_job(active => true)` ⇒ 會把那個人的處置解除, 而沒有人會知道。
  IF NOT COALESCE(v_active, false) THEN
    RAISE EXCEPTION '前置閘三:pcm-anomaly-alert 目前是停用中 ⇒ 可能有人為了事故手動關的, 本檔不准替他打開, 先去問清楚';
  END IF;

  IF v_sched = c_want THEN
    RAISE NOTICE '前置閘:已經是一天兩班 ⇒ 本檔重跑, 下面那一句是冪等的';
  ELSIF v_sched <> '0 1 * * *' THEN
    RAISE EXCEPTION USING MESSAGE =
      '前置閘四:現在的排程是 ' || v_sched || ', 不是 0 1 * * * 也不是本檔要設的值 ⇒ 有人動過它, 停下人工對齊';
  END IF;

  -- 🔵 `alter_job` 只改排程那一格(而不是 `cron.schedule` 重寫整列)⇒ command / active / 擁有者都不動。
  PERFORM cron.alter_job(job_id => v_id, schedule => c_want);
END
$do$;

-- ── 後置閘 ────────────────────────────────────────────────────
DO $post$
DECLARE v_sched text; v_active boolean; v_cmd text; v_n integer;
BEGIN
  SELECT j.schedule, j.active, j.command INTO v_sched, v_active, v_cmd
    FROM cron.job j WHERE j.jobname = 'pcm-anomaly-alert';
  IF v_sched IS DISTINCT FROM '0 1,13 * * *' THEN
    RAISE EXCEPTION USING MESSAGE = '後置閘一:排程不是 0 1,13 * * *(實得 ' || COALESCE(v_sched, '<null>') || ')';
  END IF;
  IF NOT COALESCE(v_active, false) THEN
    RAISE EXCEPTION '後置閘二:pcm-anomaly-alert 沒有 active';
  END IF;
  IF v_cmd IS DISTINCT FROM 'SELECT pcm_cron.invoke_cron_route(''/api/cron/anomaly-alert'')' THEN
    RAISE EXCEPTION USING MESSAGE = '後置閘三:command 被動到了(實得 ' || COALESCE(v_cmd, '<null>') || ')';
  END IF;
  -- 🔴 只有一個 job 名(改排程而不是新建;多一個名字 = 每天叫一個假的異常)
  -- 🔴 `%%` 是逐字的百分號:第一版寫一個 `%` ⇒ RAISE 把它當佔位符 ⇒ 整支 migration 當場
  --    `too few parameters specified for RAISE`(2026-09-14 在拋棄式 PG 上實測撞到, 不是推的)。
  SELECT pg_catalog.count(*) INTO v_n FROM cron.job j WHERE j.jobname LIKE 'pcm-anomaly-alert%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '後置閘四:pcm-anomaly-alert%% 有 % 個 job(必須恰好 1)', v_n;
  END IF;
  RAISE NOTICE '[20260915120000] 後置閘全過;pcm-anomaly-alert = 0 1,13 * * *(台北 09:00 與 21:00)';
END
$post$;

COMMIT;
