-- ============================================================
-- 20260724140000_seed_kspeed_brand — 品牌上架線:補 seed K-SPEED 品牌列
-- (2026-07-24 Sean 拍板 Q5=A:網站顯示名 'K-SPEED'、brand slug 'k-speed';
--  報價單側 supplier_slug 仍為 'kspeed'、不影響本表。prod brands 22 家實查無 k-speed。)
--
-- 為何現在做:K-SPEED 商品匯入有「兩個」前置,缺一即 fail-closed 擋下:
--   (a) 本 seed — brands 表要有 k-speed 列(否則 resolveId('brands','slug','k-speed') throw);
--   (b) scripts/supplier-config.ts 要登記 kspeed entry(brandSlug='k-speed';否則 getSupplierConfig
--       在 resolveId 之前就 throw)。→ 本片只做 (a);(b) 屬「三家商品匯入」線、需 K-SPEED 供應商資料查證後填。
--   兩者未齊前 k-speed 乾跑會 throw = 預期行為(同 ebc 前例)。
--   BrandShowcase dispatcher case 'k-speed' 元件已備(commit 7e1ac88,BrandShowcase.tsx),商品進來自動生效。
--
-- 🔴 執行:Sean db push(Claude 不碰 prod schema)。
-- premium_extra_pct=0:K-SPEED 不在 design-reference data/products.js 原始 21 家合約內、
--   無 design 依據 → 取保守值 0(比照 ebc/akrapovic/samco/eazi-grip);
--   實際經銷利差待 Sean 確認後再調(晨報決策題,不阻擋本片)。
-- name 大寫慣例對齊既有 seed(20260601005859 / 20260710120000)。
-- ============================================================

INSERT INTO brands (name, slug, premium_extra_pct) VALUES
  ('K-SPEED', 'k-speed', 0)
ON CONFLICT (slug) DO NOTHING;

-- ── down-migration(rollback 用、註解保存)──
-- 前提1:k-speed 尚無 products 指向(products.brand_id FK ON DELETE RESTRICT;有商品後先清 products)。
-- 前提2:確認該列確為本 migration 建立、非 ON CONFLICT no-op 命中的既存列(現況 0 列、不可達)。
-- DELETE FROM brands WHERE slug = 'k-speed';
