-- 20260928150000-rollback.sql —— 撤掉後台商品搜尋函式 admin_products_by_keyword(商品頁乙 D1)
--
-- 🔴 順序:先退回 D2 的後台碼(搜尋改回原本的 PostgREST 關鍵字條件)、推上去並確認生效,再貼本檔。
--    反過來做,員工一搜尋就會看到「商品列表載入失敗」。
-- 不動任何資料表。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DROP FUNCTION IF EXISTS public.admin_products_by_keyword(text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_products_by_keyword(text)') IS NOT NULL THEN
    RAISE EXCEPTION '後置閘:admin_products_by_keyword 還在';
  END IF;
  RAISE NOTICE '✅ 20260928150000 退回完成';
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
