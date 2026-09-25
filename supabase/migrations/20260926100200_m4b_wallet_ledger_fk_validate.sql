-- 20260926100200 · 驗證儲值金流水外鍵(接 20260926100100)
--
-- 上一支用 NOT VALID 建外鍵, 只保護新寫入;這一支回頭檢查既有流水都對得到會員。
-- VALIDATE CONSTRAINT 只拿 SHARE UPDATE EXCLUSIVE 鎖, 不擋一般寫入;要掃整張儲值金流水表, 所以單獨一支。
-- 🔴 失敗只要重跑這一支(上一支已生效, 新寫入的流水不受影響)。
-- 🔴 退回:這一支不用退(退 20260926100100 時外鍵整個重建)。只寫檔, 由 Sean 貼。

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $gate$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conname = 'customer_wallet_ledger_customer_user_id_fkey'
                    AND c.conrelid = 'public.customer_wallet_ledger'::regclass
                    AND c.confdeltype = 'r') THEN
    RAISE EXCEPTION '前置閘:20260926100100 還沒貼(外鍵不是 ON DELETE RESTRICT)⇒ 停。';
  END IF;
END
$gate$;

ALTER TABLE public.customer_wallet_ledger VALIDATE CONSTRAINT customer_wallet_ledger_customer_user_id_fkey;

DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conname = 'customer_wallet_ledger_customer_user_id_fkey'
                    AND c.conrelid = 'public.customer_wallet_ledger'::regclass
                    AND c.confdeltype = 'r' AND c.convalidated) THEN
    RAISE EXCEPTION '事後閘:外鍵沒有驗證完成(convalidated 仍是 false)';
  END IF;
END
$post$;

COMMIT;
