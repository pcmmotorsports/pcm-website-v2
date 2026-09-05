-- ROLLBACK for 20260905180000_m4b_late_payment_pending_refund_sweep.sql
--
-- 🔴🔴 執行順序:**先停排程, 再刪函式**。
--    反過來做 ⇒ cron 每 10 分鐘呼叫一支不存在的函式 ⇒ `cron.job_run_details` 每輪一筆錯,
--    而**掃描器該補的東西一樣沒補** ⇒ 一個吵而且沒用的狀態。
--
-- 🛑🛑 **資料不回滾** —— 本支可能已經開出一些 `order_pending_refunds` 列。
--    **那些列本來就該存在**(它們代表真的有一筆錢要退)⇒ **不要 DELETE**。
--    要作廢走既有的 `voided_at` + `void_reason`, 而那是一個人的決定, 不是回退腳本的。
--
-- ⚠️ 本檔【證不到】:它不知道排程在被停掉之前補了幾列。
--    ⛔ ~~去查 `cancellation_id IS NULL` 的那些~~ —— **那個判準是錯的**(R4-MF2):
--       `pcm_pending_refund_open_for` 在那張單**只有一筆取消單**時**會填** `cancellation_id`
--       (`20260905070000:192-199`)⇒ 正常世界照它查會拿到約 **0**,
--       ⇒ 🛑 而 3am 的人會據此下結論「它什麼都沒補」。
--    ✅ 正解是用【時間】:`opened_at >= 本支 apply 的那個時刻`。
--       ⚠️ 而那個時刻**沒有任何地方自動記著** —— 去 `supabase/APPLIED.tsv` 那一列的日期欄,
--          或 `cron.job_run_details` 最早那一筆。**兩個都是人要去찾的, 不是這支檔給得出來的。**
--
-- 🔴🔴 **R2-⑧:半夜只想【暫停】而不是拆掉, 用這一行, 不要跑本檔**:
--    `SELECT cron.alter_job(job_id => (SELECT jobid FROM cron.job WHERE jobname = 'pcm-late-payment-sweep'), active => false);`
--    ⇒ 它可逆、不動函式、不動 ACL、不動 COMMENT。**3am 想做的多半是這個。**
--    🔴 **R4-N3:而停下來【有代價】, 而那個代價只寫在 migration 檔頭 —— 他不會打開那支。**
--       `20260905070000:168` 逐字把「取消與付款同時在飛」那個競態**託付給這支掃描器**。
--       ⇒ 🛑 **停掉它 = 那個世界暫時沒有人接。**停多久 = 曝露多久。
--       ⇒ ✅ 停了之後要有人記得開回來,而**沒有任何東西會提醒他** —— 那一格今天是空的。
--
-- 🔴🔴 **R2-⑦:跑完本檔之後的狀態【不等於】本片從來沒上過** —— 差的那一格是:
--    `packages/domain/src/ops/cron-jobs.ts` 的 `CRON_JOB_WHITELIST` 裡**還留著這一列**,
--    而它是**部署好的 TS**, DB 回退動不到它。
--    ⇒ 🛑 儀表仍會找 `pcm-late-payment-sweep` 的心跳 ⇒ **每天一封告警, 永遠**。
--    🔴 **R4-MF3:而「找不到心跳」那個描述只對【從來沒跑過就回退】那一種** ——
--       跑過一陣子才回退的話, `sweeper_heartbeat` 那一列**留著**(本檔不刪它)
--       ⇒ 走的是 `stale`(它停了)那條, 不是 `never_beat`。**兩種病, 同一封信, 不同的那行字。**
--    ✅ 完整回退**還要**:`DELETE FROM public.sweeper_heartbeat WHERE job_name = 'pcm-late-payment-sweep';`
--       🛑 而**本檔刻意不做它** —— 那一列是**證據**(它證明這支跑過、補過);
--          刪它是一個「我要抹掉這段歷史」的決定, 不是回退的一部分。**要刪的人自己下那一行。**
--    ⇒ 📌 **完整回退 = 本檔 + 退掉那一列(連同 `FAILURE_COUNT_MEANINGLESS` 與三支測試的釘樁)。**
--    ⚠️ 而那道「白名單有、migrations 沒排」的守門**抓不到它** —— 因為 migration 檔還在 repo 裡。
--
-- 用法:`psql "$CONN" -f scripts/20260905180000-down.sql`

-- 🔵 **半途失敗停在哪(R4-① 指出這一格沒寫)**:本檔整份包在 `BEGIN/COMMIT` 裡,
--    而 `cron.job` 是普通表 ⇒ 任一步炸掉 ⇒ **兩步一起回捲, 停在「本片還在、原封不動」**。
--    ⇒ 📌 那是一個**安全的停點**:再跑一次就好, 不會留半套。

BEGIN;

-- 🔴 先拍快照 —— 沒有它, 下面的「我沒刪到別人的」沒有比對對象。
--    ⚠️ 而空的 cron.job 是**合法的**(這支可能是唯一一支)⇒ 空快照不拒絕, 見自證③。
CREATE TEMP TABLE _down_jobs_before ON COMMIT DROP AS
  SELECT jobid, jobname FROM cron.job;

-- ① 先停排程(by-name;不存在時 unschedule 會 raise ⇒ 包起來)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pcm-late-payment-sweep') THEN
    PERFORM cron.unschedule('pcm-late-payment-sweep');
  ELSE
    RAISE NOTICE '排程 pcm-late-payment-sweep 不在 ⇒ 跳過(不是錯)';
  END IF;
END $$;

-- ② 再刪函式
-- ⚠️ **R4-N6:`DROP FUNCTION` 要 AccessExclusiveLock** ——
--    剛好卡在一輪 sweep 執行中時它會**卡住等**, 而 3am 看起來像「回退當掉了」。
--    ⇒ 🔵 那是**正常等待**不是當掉:①先跑上面那行 `alter_job(active => false)`
--       ②等當下那一輪跑完(最長一輪的時間)③再跑本檔。
DROP FUNCTION IF EXISTS pcm_cron.late_payment_pending_refund_sweep(integer);

-- ── 回退自證 ───────────────────────────────────────────────────
DO $$
DECLARE v_cnt int;
BEGIN
  IF pg_catalog.to_regprocedure('pcm_cron.late_payment_pending_refund_sweep(integer)') IS NOT NULL THEN
    RAISE EXCEPTION '回退自證①:函式還在';
  END IF;
  SELECT pg_catalog.count(*) INTO v_cnt FROM cron.job WHERE jobname = 'pcm-late-payment-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '回退自證②:排程還在(% 筆)', v_cnt;
  END IF;
  -- 🔵 而「我刪掉的那兩個不在了」與「我沒刪到別人的」是兩個宣稱。
  -- 🔴🔴 **codex R3-⑥:我原本寫 `count(*) < 1 ⇒ RAISE`** ——
  --    而**刪完之後 cron.job 本來就可能一支都不剩**(這支是這個庫唯一的排程)
  --    ⇒ 那道自證會**把整份回退回滾掉**, 而**函式與排程原封不動留著**。
  --    🛑 一個為了保護別人而寫的斷言, 在最需要回退的那一刻【把回退本身擋掉】。
  --    🛑 而探針**固定造了一支「別人的排程」** ⇒ 📌 **那條路在測試裡是假綠, 從來沒被走過。**
  -- ✅ 改成比【名字集合】:除了我刪的那一支, 其餘每一支都要還在。
  SELECT pg_catalog.count(*) INTO v_cnt
    FROM _down_jobs_before b
   WHERE b.jobname <> 'pcm-late-payment-sweep'
     AND NOT EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = b.jobname);
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION '回退自證③:有 % 支【別人的】排程被本檔刪掉了', v_cnt;
  END IF;
END $$;

COMMIT;
