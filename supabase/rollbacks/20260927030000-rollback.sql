-- 20260927030000-rollback.sql —— 退回 20260927030000_seed_ilmberger_brand.sql
--
-- 前提:ilmberger 品牌底下還沒有任何商品(products.brand_id 外鍵 ON DELETE RESTRICT)。
--   已經首灌過 ⇒ 本檔會在前置閘停下;那時要先處理商品, 不是刪品牌列。
-- 只刪本檔建的那一列(slug='ilmberger'), 刪完核對剩 0 列。
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $pre$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.products p JOIN public.brands b ON b.id = p.brand_id WHERE b.slug = 'ilmberger'
  ) THEN
    RAISE EXCEPTION '退回前置閘:ilmberger 品牌底下已經有商品 ⇒ 不能刪品牌列, 先處理商品';
  END IF;
END
$pre$;

DELETE FROM public.brands WHERE slug = 'ilmberger';

DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM public.brands WHERE slug = 'ilmberger') THEN
    RAISE EXCEPTION '退回後置閘:brands 仍有 ilmberger';
  END IF;
END
$post$;

COMMIT;
