-- M-1-05 刀 2 Sub-slice 2-2:products_list_public 新建 + products_public CREATE OR REPLACE
--
-- 設計脈絡(對齊 Sean 兩題拍板):
--   fitments = A(露、Vehicle Finder + toUIProduct 讀 fitments[0])
--   images = A(不露、toUIProduct 不讀、M-1-13 走 products_public 拿全圖)
--
-- 對齊 lessons §12-26 規則 1(投射欄位 × 角色對照矩陣)+ backlog #119(list-projection vs detail-projection)

-- 1. 新建 products_list_public(list 用、9 欄)
CREATE OR REPLACE VIEW products_list_public WITH (security_invoker = true) AS
SELECT
  id,
  title,
  subtitle,
  handle,
  brand_id,
  category_id,
  availability,
  fitments,
  price_general
FROM products;

GRANT SELECT ON products_list_public TO anon, authenticated;

COMMENT ON VIEW products_list_public IS
  'List projection(M-1-05 刀 2 Sub-slice 2-2 / backlog #119):9 欄、含 price_general、排除 description / images / price_by_tier / price_store / metadata / external_id / timestamps。adapter 4 list method 走此 view(M-1-05 刀 2 Sub-slice 2-3 接線)。M-1-16 種子前無 row。';

-- 2. CREATE OR REPLACE products_public(detail 用、13 欄 → 14 欄、加 price_general)
--    price_general 置於 SELECT 末欄:CREATE OR REPLACE VIEW 僅允許在既有欄位末尾
--    append 新欄、不可插入中段(Postgres 限制);view 欄序純排列、adapter 以欄名取值。
CREATE OR REPLACE VIEW products_public WITH (security_invoker = true) AS
SELECT
  id,
  external_id,
  title,
  subtitle,
  description,
  handle,
  fitments,
  images,
  availability,
  brand_id,
  category_id,
  created_at,
  updated_at,
  price_general
FROM products;

GRANT SELECT ON products_public TO anon, authenticated;

COMMENT ON VIEW products_public IS
  'Detail projection(M-1-05 刀 2 Sub-slice 2-2 改寫 / 對齊 backlog #119):14 欄、含 price_general、仍排除 price_by_tier + price_store + metadata(敏感)。adapter findById 走此 view(Sub-slice 2-3 接線)。';
