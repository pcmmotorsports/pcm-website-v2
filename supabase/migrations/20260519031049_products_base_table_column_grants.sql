-- ============================================================
-- Slice A:products base 表權限鎖定(欄位級 GRANT)
-- ============================================================
-- 背景:
--   products_public / products_list_public 皆 security_invoker = true view、
--   anon/authenticated 須對 base products 表有 SELECT 權限 view 才能讀。
--   Supabase 預設 default privileges 把 base 表【整套 ALL 權限】開給
--   anon/authenticated(2026-05-19 實測:SELECT + INSERT/UPDATE/DELETE/
--   TRUNCATE/REFERENCES/TRIGGER 全有)。
--   後果:
--   (1) 外部可直接 GET /rest/v1/products?select=price_by_tier,price_store,metadata
--       繞過 view 取得經銷敏感價;
--   (2) TRUNCATE 不走 row-level RLS、grant 留著即為真實風險面
--       (INSERT/UPDATE/DELETE 目前由 RLS 無 anon policy 擋下)。
--
-- 修法(對齊 Codex review P1):
--   REVOKE ALL 移除整表 over-grant、再 column-level GRANT 只開 14 個公開欄。
--   不能整表 REVOKE 後不補:products_public / products_list_public 為
--   security_invoker view、anon 需對 base 表這 14 欄有 SELECT view 才能運作。
--   view 僅投射這 14 欄;RLS products_select_public USING(true) 不動(本 slice
--   修的是欄位權限、非 row visibility)。
--
-- 欄位清單依據:
--   products_public(14 欄)⊇ products_list_public(9 欄)
--   見 supabase/migrations/20260516072210_products_views_pricing_split.sql
--   敏感欄 price_by_tier / price_store / metadata 不在任何 view、故不 GRANT。
--
-- 對齊:docs/architecture/supabase-schema-design.md §6.1 / §9.2
--
-- Rollback(僅供參考、勿執行;Supabase migration 為 forward-only):
--   REVOKE SELECT (id, external_id, title, subtitle, description, handle,
--     fitments, images, availability, brand_id, category_id,
--     created_at, updated_at, price_general) ON TABLE products
--     FROM anon, authenticated;
--   GRANT ALL PRIVILEGES ON TABLE products TO anon, authenticated;
-- ============================================================

REVOKE ALL PRIVILEGES ON TABLE products FROM anon, authenticated;

GRANT SELECT (
  id, external_id, title, subtitle, description, handle,
  fitments, images, availability, brand_id, category_id,
  created_at, updated_at, price_general
) ON TABLE products TO anon, authenticated;
