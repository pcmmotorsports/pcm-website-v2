-- 20261004010000-rollback.sql —— 拿掉料號回查函式 storefront_variant_sku_product_ids
-- 🔴 先還原程式(SupabaseProductAdapter.searchByVariantSku 那顆 commit)再跑本檔。
--    順序反過來時, 程式叫到不存在的函式會把錯誤往上丟, lib/search.ts 接住後維持零筆、不記語料 ⇒ 料號回查等於關掉。
-- 只刪這支函式, 不動資料、不動索引。前置閘比對函式本體 md5 ⇒ 不會刪到別人後來改過的同名函式。

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
DECLARE
  v_md5 text;
BEGIN
  IF pg_catalog.to_regprocedure('public.storefront_variant_sku_product_ids(text)') IS NULL THEN
    RAISE EXCEPTION '前置閘①:public.storefront_variant_sku_product_ids(text) 不存在 ⇒ 沒有東西可以還原, 停';
  END IF;
  SELECT pg_catalog.md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.storefront_variant_sku_product_ids(text)');
  IF v_md5 <> '26e512d279d3ef0c5f1f6a06b135de23' THEN
    RAISE EXCEPTION '前置閘②:函式本體 md5 = % , 不是 20261004010000 貼的那一版 ⇒ 停', v_md5;
  END IF;
END
$pre$;

DROP FUNCTION public.storefront_variant_sku_product_ids(text);

DO $post$
BEGIN
  IF pg_catalog.to_regprocedure('public.storefront_variant_sku_product_ids(text)') IS NOT NULL THEN
    RAISE EXCEPTION '事後閘:函式還在 ⇒ 停下來看';
  END IF;
END
$post$;

COMMIT;
