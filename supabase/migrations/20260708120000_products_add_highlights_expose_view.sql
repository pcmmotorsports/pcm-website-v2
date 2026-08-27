-- ============================================================
-- A(#270 系列 / GBracing 賣點條列):products 加 highlights + 公開 view 曝露
-- ============================================================
-- 交接:~/.claude/plans/SESSION-HANDOFF-gbracing-copy-to-website-v2-2026-07-08.md。
--   報價單庫 storefront_catalog_v 已備 highlights_zh(jsonb 字串陣列=賣點條列);
--   本 migration 讓顧客庫存得下、前台讀得到、商品頁「商品介紹」渲染成 bullet list。
-- 鐵則 8(動 schema + 共用 view)+ 鐵則 12(動 schema/公開 API view)。
-- Sean 2026-07-08 拍 A:highlights 先上、summary 不碰;B(GB/Bonamici 品牌行銷大版面)另開獨立項目。
--
-- 三動作(原子、單 migration):
--   1. products 加 highlights jsonb NOT NULL DEFAULT '[]'(對齊 fitments/images 既有 jsonb 陣列欄慣例)。
--   2. 欄位級 GRANT SELECT (highlights) 給 anon/authenticated —— products 走欄位級 grant 模型
--      (20260519031049 REVOKE ALL + 逐欄 GRANT)、products_public 為 security_invoker view 靠呼叫者權限;
--      漏此 grant → 前台讀 view 撞 permission denied(同 s1 對 supplier_slug 處置、20260602135934 L54)。
--   3. products_public 末欄 append highlights(CREATE OR REPLACE VIEW 僅允許末尾 append、Postgres 限制)。
--
-- 🔴 經銷防護不削弱:view SELECT 只多末欄 highlights(公開賣點文字、非價格);
--    仍排除 price_by_tier / price_store / metadata / delisted_at;security_invoker=true 不漏;
--    寫入權限 REVOKE(20260605120000)不受 CREATE OR REPLACE 影響(不 drop view、既有 grant 保留)。
--    products_list_public / product_variants_public 不動(卡片/變體頁不顯示賣點)。
--
-- 動手前真 DB 交易模擬(BEGIN→套用本邏輯→SET LOCAL ROLE anon 讀 highlights→驗經銷欄仍不可見→ROLLBACK、
--   跑後查 information_schema 零留痕;來源 MCP execute_sql、2026-07-08、bmpnplmnldofgaohnaok):見本 session 執行紀錄。
--
-- Rollback(Supabase forward-only、僅供參考、可手動執行):見檔尾。
-- ============================================================


-- ── 1. products 加 highlights(jsonb 字串陣列、預設空陣列;對齊 fitments/images 慣例)──
ALTER TABLE products ADD COLUMN highlights jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN products.highlights IS
  '賣點條列(jsonb 字串陣列、如 ["6AL-4V G5 鈦合金輕量耐腐蝕","DLC 黑鈦塗層"])。來源=報價單 storefront_catalog_v.highlights_zh、經 rpm 同步管線寫入(與 description 同 supplier-config.syncDescription gate:true 才寫、rpm=false 不碰)。前台商品頁「商品介紹」渲染成 bullet list。DEFAULT [] = 未同步/無賣點的商品天然空、前台 guard 空陣列不渲染。';


-- ── 2. 欄位級 GRANT(security_invoker view 需呼叫者對此欄有 SELECT;漏 grant → view permission denied)──
GRANT SELECT (highlights) ON products TO anon, authenticated;


-- ── 3. products_public 末欄 append highlights(security_invoker 必帶、不碰任何敏感欄)──
-- ⚠️ 經銷防護回歸點:以下 SELECT 只比現行(20260602135934)多末欄 highlights、
--    絕無 price_by_tier / price_store / metadata / delisted_at;security_invoker=true 不可漏。
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
  supplier_slug,
  highlights
FROM products;

GRANT SELECT ON products_public TO anon, authenticated;

COMMENT ON VIEW products_public IS
  'Detail projection(A/#270 加末欄 highlights、共 16 欄):含 price_general / supplier_slug / highlights,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。';


-- ============================================================
-- Rollback(forward-only、勿在正常流程執行;還原本 migration 前狀態、可手動跑):
-- ============================================================
-- -- 3. view 還原(去 highlights 末欄)+ COMMENT 還原 16→15 欄:
-- CREATE OR REPLACE VIEW products_public WITH (security_invoker = true) AS
--   SELECT id, external_id, title, subtitle, description, handle, fitments, images,
--          availability, brand_id, category_id, created_at, updated_at, price_general, supplier_slug FROM products;
-- COMMENT ON VIEW products_public IS 'Detail projection(S1 加末欄 supplier_slug、共 15 欄):含 price_general / supplier_slug,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。';
-- -- 2. grant 還原:
-- REVOKE SELECT (highlights) ON products FROM anon, authenticated;
-- -- 1. 欄移除:
-- ALTER TABLE products DROP COLUMN highlights;
-- ============================================================
