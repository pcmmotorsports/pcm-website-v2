-- ============================================================
-- S1:報價單↔網站整合 Phase 1 — schema 加 supplier_slug / 軟下架 delisted_at + 清敏感 metadata
-- ============================================================
-- 對齊 docs/specs/2026-06-02-S1-schema-migration-plan.md(v3:codex 關卡1 雙輪 FAIL→修 + Sean 批 A)。
-- 鐵則 8 重大改動 + 鐵則 12 敏感(動 schema + RLS + 碰經銷/成本 metadata)。
--
-- 決策(Sean 拍):
--   Q1=A 軟下架 delisted_at timestamptz(NULL=上架) / Q2=A 清 shopee·cost·source_amount·source_currency、
--   留 name_en·source_corrected(_count) / supplier_slug NOT NULL DEFAULT 'rpm'(現役 RPM-only 過渡、S3 評估移)/
--   唯一鍵切換(廢 RPM- 前綴 + (supplier_slug, main_sku/sku))留 S3。
--
-- 🔴 經銷防護(本片不削弱、且強化):
--   - 三層防護維持:column GRANT 排敏感(price_by_tier/price_store/metadata)/ public view 排敏感 / RLS 寫限 service_role。
--   - 新增 metadata CHECK 硬擋 shopee/cost/source_amount/source_currency(縱深防禦:DB 層拒寫、非僅程序約束)。
--   - delisted_at:grant + RLS USING(delisted_at IS NULL) + view 不投射。grant 不洩漏——RLS 擋掉下架 row 後、
--     anon/authenticated 可見 row 的 delisted_at 必為 NULL、下架 row 整列不可見(codex k1 round1「怕洩漏」+
--     round2「不 grant 會 permission denied」雙輪矛盾,以「grant + RLS 藏整列」一併化解)。
--   - 3 個 public view CREATE OR REPLACE 必帶 WITH (security_invoker = true)(漏寫退 definer、RLS 失效、防護破)。
--
-- 動手前真 DB 實測(來源=MCP execute_sql 交易內 BEGIN + 套用本 migration 邏輯 + SET LOCAL ROLE anon + 查 count + ROLLBACK、
--   2026-06-02、跑後查 information_schema 確認 schema 零留痕未污染;SQL 字面本身不自證、數字以此唯讀查為憑):
--   metadata 4 敏感 key products 933 / variants 7277 全有(jsonb_object_keys count);線上 view/grant/RLS = repo 零漂移、3 view security_invoker=true;
--   RLS 行為:下架 1 商品(12 變體)→ anon 見 932 商品 / 7265 變體、下架資訊洩漏 0(delisted_at IS NOT NULL count=0)、無 permission denied。
--
-- ⚠️ 套此 migration 後、S3 改 rpm-transform 停寫敏感 metadata 前:
--   勿經任何路徑(rpm-import / seed / 修復 migration / 手動 SQL / dashboard)寫
--   shopee/cost/source_amount/source_currency 到 metadata —— CHECK 會拒寫。S3 緊接。
--
-- Rollback(Supabase forward-only、僅供參考、可手動執行):見檔尾。
-- ============================================================


-- ── 1. supplier_slug(兩表、NOT NULL DEFAULT 'rpm' 過渡 backfill;唯一鍵約束切換留 S3)──
ALTER TABLE products         ADD COLUMN supplier_slug text NOT NULL DEFAULT 'rpm';
ALTER TABLE product_variants ADD COLUMN supplier_slug text NOT NULL DEFAULT 'rpm';

CREATE INDEX idx_products_supplier_slug         ON products(supplier_slug);
CREATE INDEX idx_product_variants_supplier_slug ON product_variants(supplier_slug);

COMMENT ON COLUMN products.supplier_slug IS
  '供應商 slug(公開欄、對齊報價單 (supplier_slug, sku) 模型)。S1 NOT NULL DEFAULT ''rpm'' 過渡;S3 評估移 DEFAULT + 唯一鍵切換(群層 (supplier_slug, main_sku))。';
COMMENT ON COLUMN product_variants.supplier_slug IS
  '供應商 slug(公開欄)。S1 DEFAULT ''rpm'';S3 補群↔變體一致性約束(變體須等 parent product supplier)。';


-- ── 2. 軟下架 delisted_at(僅群層 products;靠 RLS 擋整列、grant 但 view 不投射、變體連動)──
ALTER TABLE products ADD COLUMN delisted_at timestamptz;

COMMENT ON COLUMN products.delisted_at IS
  '軟下架時間(NULL=上架)。S4 下架對賬用(源頭消失→UPDATE delisted_at=now()、不硬刪避免撞訂單)。對 anon/authenticated 靠 RLS products_select_public USING(delisted_at IS NULL) 隱藏整列;變體經 product_variants_select_public EXISTS(parent 未下架)連動隱藏。grant 但 view 不投射:RLS 擋下架 row 後可見 row 該欄必 NULL、不洩漏下架資訊。';


-- ── 3. column GRANT(supplier_slug 兩表 + delisted_at products;消除 RLS 引用未 grant column 的 permission denied)──
GRANT SELECT (supplier_slug) ON products         TO anon, authenticated;
GRANT SELECT (supplier_slug) ON product_variants TO anon, authenticated;
GRANT SELECT (delisted_at)   ON products         TO anon, authenticated;


-- ── 4. RLS:下架過濾(products 直接 / product_variants 連動 parent;真 DB 實測 932+7265 隱藏、無 permission denied)──
DROP POLICY IF EXISTS products_select_public ON products;
CREATE POLICY products_select_public
  ON products
  FOR SELECT
  USING (delisted_at IS NULL);

DROP POLICY IF EXISTS product_variants_select_public ON product_variants;
CREATE POLICY product_variants_select_public
  ON product_variants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_variants.product_id
        AND p.delisted_at IS NULL
    )
  );


-- ── 5. 清 metadata 敏感欄(Q2=A)+ CHECK 硬擋(先清值再加約束、否則現有列違反)──
UPDATE products
  SET metadata = metadata - 'shopee' - 'cost' - 'source_amount' - 'source_currency'
  WHERE metadata ?| array['shopee','cost','source_amount','source_currency'];

UPDATE product_variants
  SET metadata = metadata - 'shopee' - 'cost' - 'source_amount' - 'source_currency'
  WHERE metadata ?| array['shopee','cost','source_amount','source_currency'];

ALTER TABLE products
  ADD CONSTRAINT products_metadata_no_sensitive
  CHECK (NOT (metadata ?| array['shopee','cost','source_amount','source_currency']));
ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_metadata_no_sensitive
  CHECK (NOT (metadata ?| array['shopee','cost','source_amount','source_currency']));


-- ── 6. public view 重建(末欄 append supplier_slug、必帶 security_invoker、不投射 delisted_at、不碰任何敏感欄)──
-- ⚠️ 經銷防護最易回歸點:以下 SELECT 清單只比 S1 前各多末欄 supplier_slug、
--    絕無 price_by_tier / price_store / metadata / cost / shopee / source_*；security_invoker=true 不可漏。

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
  price_general,
  supplier_slug
FROM products;

GRANT SELECT ON products_public TO anon, authenticated;

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
  price_general,
  supplier_slug
FROM products;

GRANT SELECT ON products_list_public TO anon, authenticated;

CREATE OR REPLACE VIEW product_variants_public WITH (security_invoker = true) AS
SELECT
  id,
  product_id,
  sku,
  spec,
  price_general,
  availability,
  images,
  sort_order,
  created_at,
  updated_at,
  supplier_slug
FROM product_variants;

GRANT SELECT ON product_variants_public TO anon, authenticated;

COMMENT ON VIEW products_public IS
  'Detail projection(S1 加末欄 supplier_slug、共 15 欄):含 price_general / supplier_slug,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。';
COMMENT ON VIEW products_list_public IS
  'List projection(S1 加末欄 supplier_slug、共 10 欄):含 price_general / supplier_slug,排除 description/images/price_by_tier/price_store/metadata/delisted_at/external_id/timestamps。security_invoker=true。';
COMMENT ON VIEW product_variants_public IS
  'Variant public projection(S1 加末欄 supplier_slug、共 11 欄):含 price_general / supplier_slug,排除 price_store + metadata。security_invoker=true。RLS EXISTS(parent 未下架)連動隱藏下架商品變體。';


-- ============================================================
-- Rollback(forward-only、勿在正常流程執行;還原 S1 前狀態、可手動跑):
-- ============================================================
-- -- 6. view 還原(去 supplier_slug、保 security_invoker)+ COMMENT 還原(去「S1 加末欄」描述、欄數還原 15→14 / 10→9 / 11→10):
-- CREATE OR REPLACE VIEW products_public WITH (security_invoker = true) AS
--   SELECT id, external_id, title, subtitle, description, handle, fitments, images,
--          availability, brand_id, category_id, created_at, updated_at, price_general FROM products;
-- CREATE OR REPLACE VIEW products_list_public WITH (security_invoker = true) AS
--   SELECT id, title, subtitle, handle, brand_id, category_id, availability, fitments, price_general FROM products;
-- CREATE OR REPLACE VIEW product_variants_public WITH (security_invoker = true) AS
--   SELECT id, product_id, sku, spec, price_general, availability, images, sort_order, created_at, updated_at FROM product_variants;
-- COMMENT ON VIEW products_public IS 'Detail projection(M-1-05 刀 2 Sub-slice 2-2 / backlog #119):14 欄、含 price_general、排除 price_by_tier + price_store + metadata。';
-- COMMENT ON VIEW products_list_public IS 'List projection(M-1-05 刀 2 Sub-slice 2-2 / backlog #119):9 欄、含 price_general、排除 description/images/price_by_tier/price_store/metadata/external_id/timestamps。';
-- COMMENT ON VIEW product_variants_public IS 'Variant public projection（M-1-16a）:10 欄、含 price_general、排除 price_store + metadata。';
-- -- 4. RLS 還原 USING(true):
-- DROP POLICY IF EXISTS products_select_public ON products;
-- CREATE POLICY products_select_public ON products FOR SELECT USING (true);
-- DROP POLICY IF EXISTS product_variants_select_public ON product_variants;
-- CREATE POLICY product_variants_select_public ON product_variants FOR SELECT USING (true);
-- -- 5. CHECK 移除:
-- ALTER TABLE products         DROP CONSTRAINT products_metadata_no_sensitive;
-- ALTER TABLE product_variants DROP CONSTRAINT product_variants_metadata_no_sensitive;
-- -- 3. grant 還原:
-- REVOKE SELECT (supplier_slug, delisted_at) ON products         FROM anon, authenticated;
-- REVOKE SELECT (supplier_slug)              ON product_variants FROM anon, authenticated;
-- -- 1/2. index + column 移除:
-- DROP INDEX idx_products_supplier_slug;
-- DROP INDEX idx_product_variants_supplier_slug;
-- ALTER TABLE products         DROP COLUMN supplier_slug, DROP COLUMN delisted_at;
-- ALTER TABLE product_variants DROP COLUMN supplier_slug;
-- -- 註:清空的 metadata 敏感值不可逆(無風險、S3 重跑同步可回)。
-- ============================================================
