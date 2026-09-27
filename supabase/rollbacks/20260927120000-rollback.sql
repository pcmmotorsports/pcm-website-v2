-- 20260927120000-rollback.sql —— 退回 20260927120000_m4b_admin_save_manual_order_address.sql
--
-- 🔴 順序:先 revert 後台呼叫它的那一顆,再跑本檔。反過來 ⇒ 建單照樣成功,畫面多一句「地址沒有存進客人資料」。
-- 🔴 已經存進客人地址簿的地址【不會】被刪(那些是正確的地址;要刪用 admin_audit_log 的 customer.address.save_from_order 找)。
-- 🔵 可重跑:IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.admin_save_manual_order_address(uuid, text, text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_save_manual_order_address(uuid, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '退回後置閘:admin_save_manual_order_address 還在';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
