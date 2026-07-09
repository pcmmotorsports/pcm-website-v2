-- ============================================================
-- 20260710120000_seed_ebc_brand — 品牌放量 8+1 家:補 seed EBC 品牌列
-- (2026-07-10 kickoff §1:brands 表 21 家 seed 未含 ebc、MCP 實查確認缺列;
--  ebc 同步管線 supplier-config 已登記 brandSlug='ebc',resolveId fail-closed
--  → 本 migration 未套用前 ebc 乾跑會 throw = 預期行為)
--
-- 🔴 執行:Sean db push(Claude 不碰 prod schema;kickoff 硬規則 1 零 prod 寫入)。
-- premium_extra_pct=0:ebc 不在 design-reference data/products.js 21 家合約內、
--   無 design 依據 → 取保守值 0(同 eazi-grip/samco);要調整=Sean 決策(晨報決策題)。
-- name 大寫慣例對齊既有 seed(20260601005859)。
-- ============================================================

INSERT INTO brands (name, slug, premium_extra_pct) VALUES
  ('EBC BRAKES', 'ebc', 0)
ON CONFLICT (slug) DO NOTHING;

-- ── down-migration(rollback 用、註解保存)──
-- 前提:ebc 尚無 products 指向(首載前 rollback 才安全;有商品後先清 products)
-- DELETE FROM brands WHERE slug = 'ebc';
