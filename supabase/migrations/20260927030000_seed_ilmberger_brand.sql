-- ============================================================
-- 20260927030000_seed_ilmberger_brand — Ilmberger 上架線:補 seed ILMBERGER CARBON 品牌列
--
-- 為什麼要這支:Ilmberger 商品匯入要先在網站 brands 表找到 slug='ilmberger',
--   查不到 ⇒ rpm-import 的 resolveId('brands','slug','ilmberger') 直接 throw,連乾跑都跑不動
--   (同 20260925060000 Arrow 那次;2026-09-27 唯讀實查網站正式庫 brands 沒有這一列、ilmberger 商品 0 筆)。
-- 上架授權:Sean 2026-09-27 D1 甲(Ilmberger 先上)。slug 'ilmberger' = Sean 2026-09-15 定的。
-- 顯示名 'ILMBERGER CARBON' = 顧客站品牌頁 apps/storefront/src/data/brand-content.ts 的 name(全大寫慣例)。
-- premium_extra_pct=0:比照 arrow / dna / ebc / k-speed 等新家的保守值(高級店家目前不啟用,Sean 2026-09-25)。
-- 🔴 跨庫比對一律用 slug('ilmberger'),不用顯示名。
-- 🔴 執行:Sean 貼或他授權的那一次(Claude 不自己貼正式庫)。回滾:supabase/rollbacks/20260927030000-rollback.sql。
-- 冪等:ON CONFLICT (slug) DO NOTHING,重跑仍是 1 列(拋棄式 PG 驗兩次;09-27 Fable R1 核 brands_slug_key 存在、正式庫無同名同 slug)。
-- pcm:idempotent: yes
-- ============================================================

INSERT INTO brands (name, slug, premium_extra_pct) VALUES
  ('ILMBERGER CARBON', 'ilmberger', 0)
ON CONFLICT (slug) DO NOTHING;
