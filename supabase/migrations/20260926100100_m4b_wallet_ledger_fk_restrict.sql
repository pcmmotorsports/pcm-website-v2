-- 20260926100100 · 儲值金流水外鍵改成「有流水就擋下刪除會員」(後台刪除會員計畫第 8 版第四節)
--
-- 原本 customer_wallet_ledger → customers 是 ON DELETE CASCADE(20260523034911:101):刪會員會把儲值金流水一起靜靜刪掉。
-- 改成 ON DELETE RESTRICT 後, 「有流水就不能刪」由資料庫保證, 不只靠 admin_delete_customer 的檢查
--   (員工任何時間點幫會員調整儲值金, 都不會被刪除帶走)。
-- 🔴 NOT VALID:這一支只改目錄、不掃舊資料 ⇒ 持鎖時間短;貼上後新寫入的流水立刻受保護。
--    回頭驗證舊資料在下一支 20260926100200(VALIDATE 不擋寫入;失敗只要重跑那一支)。
-- 🔴 順序:20260926100000 → 本支 → 20260926100200。
-- 🔴 退回:supabase/rollbacks/20260926100100-rollback.sql(改回 CASCADE)。只寫檔, 由 Sean 貼。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $gate$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conname = 'customer_wallet_ledger_customer_user_id_fkey'
                    AND c.conrelid = 'public.customer_wallet_ledger'::regclass
                    AND c.confrelid = 'public.customers'::regclass
                    AND c.confdeltype = 'c') THEN
    RAISE EXCEPTION '前置閘:customer_wallet_ledger_customer_user_id_fkey 不是「指向 customers、ON DELETE CASCADE」那一版 ⇒ 停。';
  END IF;
END
$gate$;

ALTER TABLE public.customer_wallet_ledger
  DROP CONSTRAINT customer_wallet_ledger_customer_user_id_fkey,
  ADD CONSTRAINT customer_wallet_ledger_customer_user_id_fkey
    FOREIGN KEY (customer_user_id) REFERENCES public.customers(user_id) ON DELETE RESTRICT NOT VALID;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conname = 'customer_wallet_ledger_customer_user_id_fkey'
                    AND c.conrelid = 'public.customer_wallet_ledger'::regclass
                    AND c.confrelid = 'public.customers'::regclass
                    AND c.confdeltype = 'r') THEN
    RAISE EXCEPTION '事後閘:外鍵沒有變成 ON DELETE RESTRICT';
  END IF;
END
$post$;

COMMIT;
