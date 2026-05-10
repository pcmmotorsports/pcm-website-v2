-- supabase/migrations/20260510134708_products_public_view.sql
-- 對應 M-1-03-audit Slice A 拍板:RLS column-level mask via public view
-- 對應議題 1(RLS column-level 缺、price_by_tier 後台層全開)+ 議題 6(listByCategory/Brand 直回含 priceByTier)
-- 客人端 / storefront 預設讀 view、batch update / admin 才讀 raw products 表
-- TODO 見 backlog #118:adapter 切換 SupabaseProductAdapter 6 method 改讀 view、留接縫不本 slice 連動
-- 對齊 Sean Q-plan「保持可修改、擴充性就好」:只建 view、不立即動 adapter
-- Q-A1=A1a 拍板:加 security_invoker = true(擴充性留 row-level filter 接縫)
-- Q-A2=A2b 拍板:metadata 排除(自由 schema、未來可能混內部欄位、保守對外)

CREATE OR REPLACE VIEW products_public
WITH (security_invoker = true) AS
SELECT
  id,
  external_id,
  title,
  subtitle,
  description,
  handle,
  -- price_by_tier 排除(經銷價敏感欄位)
  fitments,
  images,
  availability,
  brand_id,
  category_id,
  -- metadata 排除(自由 schema、未來可能混內部欄位、保守不對外)
  created_at,
  updated_at
FROM products;

-- view security_invoker=true 啟用呼叫者權限執行、繼承 base table RLS
-- anon / authenticated GRANT 明示對齊 init_products_rls.sql 的 products_select_public policy 對等地位
GRANT SELECT ON products_public TO anon, authenticated;

COMMENT ON VIEW products_public IS
  'M-1-03 audit Slice A:storefront 端公開欄位 view、排除 price_by_tier(經銷價)+ metadata(自由 schema 保守)。security_invoker=true 對齊 Supabase 最佳實踐 + 未來 row-level filter 接縫。adapter 切換見 backlog #118、projection 拆分見 backlog #119。';
