-- ============================================================
-- 20260925060000_seed_arrow_brand — Arrow 上架線:補 seed ARROW 品牌列
--
-- 為什麼要這支:Arrow 商品匯入要先在網站 brands 表找到 slug='arrow',
--   查不到 ⇒ rpm-import 的 resolveId('brands','slug','arrow') 直接 throw,連乾跑都跑不動
--   (2026-09-25 前台窗乾跑實測:「brands.slug='arrow' 不存在」)。
-- 上架授權:Sean 2026-09-25 Q6 甲(有說明的 1,105 件先上,其餘補好再上)。
-- 顯示名 'ARROW' = 顧客站品牌頁 apps/storefront/src/data/brand-content.ts 的 name(全大寫慣例)。
-- premium_extra_pct=0:比照 dna / ebc / k-speed 等新家的保守值;實際經銷利差待 Sean 確認後再調。
-- 🔴 跨庫比對一律用 slug('arrow'),不用顯示名。
-- 🔴 執行:Sean 貼或他授權的那一次(Claude 不自己貼正式庫)。
-- ============================================================

INSERT INTO brands (name, slug, premium_extra_pct) VALUES
  ('ARROW', 'arrow', 0)
ON CONFLICT (slug) DO NOTHING;

-- ── down-migration(rollback 用、註解保存)──
-- 前提:arrow 尚無 products 指向(products.brand_id FK ON DELETE RESTRICT;有商品後先清 products)。
-- DELETE FROM brands WHERE slug = 'arrow';
