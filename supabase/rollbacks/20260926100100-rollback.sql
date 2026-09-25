-- 20260926100100 退回:儲值金流水外鍵改回 ON DELETE CASCADE(20260523034911:101 的原樣)。
-- 🔴 要退 20260926100000 之前先退這一支。20260926100200 不用另外退(外鍵在這裡整個重建)。
-- 🔴 退回後, 刪除會員會連同儲值金流水一起刪掉;admin_delete_customer 仍會因「有流水」回 HAS_RECORDS, 但資料庫不再兜底。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.customer_wallet_ledger
  DROP CONSTRAINT customer_wallet_ledger_customer_user_id_fkey,
  ADD CONSTRAINT customer_wallet_ledger_customer_user_id_fkey
    FOREIGN KEY (customer_user_id) REFERENCES public.customers(user_id) ON DELETE CASCADE;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conname = 'customer_wallet_ledger_customer_user_id_fkey'
                    AND c.conrelid = 'public.customer_wallet_ledger'::regclass
                    AND c.confdeltype = 'c' AND c.convalidated) THEN
    RAISE EXCEPTION '事後閘:外鍵沒有回到 ON DELETE CASCADE';
  END IF;
END
$post$;

COMMIT;
