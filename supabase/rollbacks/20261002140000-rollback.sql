-- 還原 20261002140000_m4b_admin_search_product_ids.sql:刪掉後台版商品搜尋。
-- 程式那邊叫不到時會退回只比料號的舊查法(manual-order-catalog.ts), 建單不會壞。
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.admin_search_product_ids(text[]);
DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_search_product_ids(text[])') IS NOT NULL THEN
    RAISE EXCEPTION '還原事後閘:admin_search_product_ids 還在';
  END IF;
END
$post$;
COMMIT;
