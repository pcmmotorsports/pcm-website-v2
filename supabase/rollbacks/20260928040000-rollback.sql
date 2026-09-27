-- 20260928040000-rollback.sql —— 退 20260928040000_m4b_products_category_lock.sql
-- 🔴 順序:先退後台會改分類的程式(商品頁乙 C3–C6)與 M2(20260928050000-rollback.sql),再跑本檔。
-- ⚠️ 本檔拿掉 trigger 之後,員工設過的分類會在下一次同步被供應商的分類蓋掉 —— 退回等於放棄那些分類。
-- 🔵 三欄與 CHECK、索引刻意留著(惰性:沒有 trigger 就沒有任何東西讀它們)。要重新上線要另寫往前修的 migration,
--    不能直接重貼 20260928040000(它的前置閘會因為欄已存在而拒絕)。
-- 冪等:DROP … IF EXISTS。

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_products_category_lock ON public.products;
DROP FUNCTION IF EXISTS public.products_category_lock_guard();

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
              WHERE tgrelid = 'public.products'::regclass AND tgname = 'trg_products_category_lock') THEN
    RAISE EXCEPTION 'rollback:trg_products_category_lock 仍在';
  END IF;
  RAISE NOTICE '✅ rollback 20260928040000:分類鎖 trigger 已移除(三欄刻意留著)';
END
$post$;

COMMIT;
