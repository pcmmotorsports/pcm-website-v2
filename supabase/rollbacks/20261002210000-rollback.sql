-- 還原 20261002210000_m4b_admin_set_manual_product_images.sql:DROP 這支函式。
-- 🔴 先退後台碼(gallery-actions.ts 寫回那段)再跑本檔;已寫回 products.images 的照片網址留著, 不影響其他東西。
BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION public.admin_set_manual_product_images(uuid, jsonb, text, text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.admin_set_manual_product_images(uuid, jsonb, text, text)') IS NOT NULL THEN
    RAISE EXCEPTION '還原事後閘:admin_set_manual_product_images 還在';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';

COMMIT;
