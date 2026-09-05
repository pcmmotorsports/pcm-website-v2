-- ROLLBACK for 20260905140000_m4b_late_payment_pending_refund_sweep.sql
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
-- 用法:`psql "$CONN" -f scripts/20260905140000-down.sql`

BEGIN;

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
  SELECT pg_catalog.count(*) INTO v_cnt FROM cron.job;
  IF v_cnt < 1 THEN
    RAISE EXCEPTION '回退自證③:cron.job 現在一支都不剩 ⇒ 我把別人的也刪掉了';
  END IF;
END $$;

COMMIT;
