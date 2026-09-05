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
--    要那個, 去查 `order_pending_refunds` 上 `opened_at` 落在上線之後、
--    而 `cancellation_id IS NULL` 的那些(兜底開的列沒有取消單對應時會是 NULL)。
--
-- 🔴🔴 **R2-⑧:半夜只想【暫停】而不是拆掉, 用這一行, 不要跑本檔**:
--    `SELECT cron.alter_job(job_id => (SELECT jobid FROM cron.job WHERE jobname = 'pcm-late-payment-sweep'), active => false);`
--    ⇒ 它可逆、不動函式、不動 ACL、不動 COMMENT。**3am 想做的多半是這個。**
--
-- 🔴🔴 **R2-⑦:跑完本檔之後的狀態【不等於】本片從來沒上過** —— 差的那一格是:
--    `packages/domain/src/ops/cron-jobs.ts` 的 `CRON_JOB_WHITELIST` 裡**還留著這一列**,
--    而它是**部署好的 TS**, DB 回退動不到它。
--    ⇒ 🛑 儀表仍會找 `pcm-late-payment-sweep` 的心跳、找不到 ⇒ **每天一封告警, 永遠**。
--    ⇒ 📌 **完整回退 = 本檔 + 退掉那一列(連同 `FAILURE_COUNT_MEANINGLESS` 與三支測試的釘樁)。**
--    ⚠️ 而那道「白名單有、migrations 沒排」的守門**抓不到它** —— 因為 migration 檔還在 repo 裡。
--
-- 用法:`psql "$CONN" -f scripts/20260905180000-down.sql`

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
