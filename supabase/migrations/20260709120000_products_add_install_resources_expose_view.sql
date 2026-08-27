-- ============================================================
-- #270 安裝資源(說明書 PDF + 安裝影片):products 加 manuals/video_url + 公開 view 曝露
-- ============================================================
-- 真權威 plan:docs/specs/2026-07-09-install-resources-source-chain-plan.md(Sean 2026-07-09 批 P1=A)。
--   報價單庫 storefront_catalog_v 已備 pdf_urls/video_urls(20260709 報價單側 migration 曝露);
--   本 migration 讓顧客庫存得下、前台讀得到、商品頁「安裝須知→安裝資源」渲染下載鈕 + 影片 facade。
-- 照抄範本 = 20260708120000_products_add_highlights_expose_view.sql(上週 highlights 鏈、同手法)。
-- 鐵則 8(動 schema + 共用 view)+ 鐵則 12(動 schema/公開 API view)。
--
-- 三動作(原子、單 migration):
--   1. products 加 manuals jsonb NOT NULL DEFAULT '[]'(結構化 [{label,url,sizeKB?}]、對齊 fitments/images/highlights
--      既有 jsonb 陣列欄慣例)+ video_url text NULL(單一 YouTube URL、無影片=NULL)。
--   2. 欄位級 GRANT SELECT (manuals, video_url) 給 anon/authenticated —— products 走欄位級 grant 模型
--      (20260519031049 REVOKE ALL + 逐欄 GRANT)、products_public 為 security_invoker view 靠呼叫者權限;
--      漏此 grant → 前台讀 view 撞 permission denied(同 highlights 20260708120000 L36-37)。
--   3. products_public 末欄 append manuals, video_url(CREATE OR REPLACE VIEW 僅允許末尾 append、Postgres 限制;
--      接在 highlights 之後、不可插中間)。
--
-- 🔴 經銷防護不削弱:manuals/video_url 是顧客可見的說明書/影片連結(非價格);
--    view SELECT 仍排除 price_by_tier / price_store / metadata / delisted_at;security_invoker=true 不漏;
--    寫入權限 REVOKE(20260605120000)不受 CREATE OR REPLACE 影響(不 drop view、既有 grant 保留)。
--    products_list_public / product_variants_public 不動(卡片/變體頁不顯示安裝資源)。
--
-- 資料寫入:manuals/video_url 由 rpm 同步管線寫(supplier-config.syncInstallResources gate:
--   true〔gbracing/bonamici〕才寫、rpm/cncracing=false 不碰 → DEFAULT []/NULL 天然空、前台 guard 不渲染)。
--
-- 動手前真 DB 交易模擬(BEGIN→套用本邏輯→SET LOCAL ROLE anon 讀 manuals/video_url→驗經銷欄仍不可見→ROLLBACK、
--   跑後查 information_schema 零留痕;來源 MCP execute_sql、bmpnplmnldofgaohnaok):見本 session 執行紀錄。
--
-- Rollback(Supabase forward-only、僅供參考、可手動執行):見檔尾。
-- ============================================================


-- ── 1. products 加 manuals(jsonb 結構化陣列、預設空)+ video_url(text、可 NULL)──
ALTER TABLE products ADD COLUMN manuals jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE products ADD COLUMN video_url text;

COMMENT ON COLUMN products.manuals IS
  '安裝說明書清單(jsonb 物件陣列 [{label,url,sizeKB?}]、如 [{"label":"安裝說明書","url":"https://.../m.pdf"}])。來源=報價單 storefront_catalog_v.pdf_urls(裸 URL text[])、經 rpm 同步管線 normalizeManuals 生成 label(D1=A:單份「安裝說明書」、多份「安裝說明書 N」)、sizeKB 來源無故省。supplier-config.syncInstallResources gate:true 才寫、rpm/cnc=false 不碰。前台商品頁「安裝資源」渲染下載鈕。DEFAULT [] = 未同步/無說明書天然空、前台 guard 空陣列不渲染。';
COMMENT ON COLUMN products.video_url IS
  '安裝影片連結(單一 YouTube URL、無影片=NULL)。來源=報價單 storefront_catalog_v.video_urls(text[] 多支可能含 Vimeo)、經 pickInstallVideo 取第一支 YouTube host(D2=A、Vimeo 暫不支援)。同 manuals gate。前台 YouTube facade 渲染。';


-- ── 2. 欄位級 GRANT(security_invoker view 需呼叫者對此欄有 SELECT;漏 grant → view permission denied)──
GRANT SELECT (manuals, video_url) ON products TO anon, authenticated;


-- ── 3. products_public 末欄 append manuals, video_url(security_invoker 必帶、不碰任何敏感欄)──
-- ⚠️ 經銷防護回歸點:以下 SELECT 只比現行(20260708120000)多末二欄 manuals, video_url、
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
  highlights,
  manuals,
  video_url
FROM products;

GRANT SELECT ON products_public TO anon, authenticated;

COMMENT ON VIEW products_public IS
  'Detail projection(#270 加末二欄 manuals, video_url、共 18 欄):含 price_general / supplier_slug / highlights / manuals / video_url,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。';


-- ============================================================
-- Rollback(forward-only、勿在正常流程執行;還原本 migration 前狀態、可手動跑):
-- ============================================================
-- -- 3. view 還原(去 manuals/video_url 末二欄)+ COMMENT 還原 18→16 欄:
-- CREATE OR REPLACE VIEW products_public WITH (security_invoker = true) AS
--   SELECT id, external_id, title, subtitle, description, handle, fitments, images,
--          availability, brand_id, category_id, created_at, updated_at, price_general, supplier_slug, highlights FROM products;
-- COMMENT ON VIEW products_public IS 'Detail projection(A/#270 加末欄 highlights、共 16 欄):含 price_general / supplier_slug / highlights,仍排除 price_by_tier + price_store + metadata + delisted_at(敏感/內部)。security_invoker=true。RLS USING(delisted_at IS NULL) 隱藏下架。';
-- -- 2. grant 還原:
-- REVOKE SELECT (manuals, video_url) ON products FROM anon, authenticated;
-- -- 1. 欄移除:
-- ALTER TABLE products DROP COLUMN video_url;
-- ALTER TABLE products DROP COLUMN manuals;
-- ============================================================
