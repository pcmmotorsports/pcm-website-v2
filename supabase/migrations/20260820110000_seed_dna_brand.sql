-- ============================================================
-- 20260820110000_seed_dna_brand — 品牌上架線:補 seed DNA 品牌列
--
-- 顯示名/slug 已由 Sean 拍板:對 Q1(brandSlug='dna'、顯示名='DNA FILTERS',即清單裡的選項甲)
-- 答「OK」。出處(三處一致,查證過):
--   `~/pcm-mailbox/MAIN-085-主視窗交接-20260820-07.md:18,96`(「OK」⇒ Q1 定案)
--   `~/pcm-mailbox/MAIN-SEAN-待決清單-20260820.md:29`(選項甲逐字 dna / DNA FILTERS)
--   memory `project_0820-dna-brand-page-rulings.md:11`(逐字「OK」)
--
-- 🔴 顯示名字面在三個系統各自不同,這是正常的,不要拿去「統一」:
--   報價單 DB 正式名='DNA Filters'、報價單賣場簡稱='DNA'、本表顯示名='DNA FILTERS'(全大寫)。
--   核對過既有 20 家 brand-content.ts 的 name 欄全部是全大寫慣例(AKRAPOVIČ/BONAMICI RACING/…),
--   'DNA FILTERS' 對齊那個慣例,是對的,不是三邊沒對齊的錯誤。
-- 🔴🔴 任何跨庫(報價單庫 ↔ 網站庫)對帳/比對,一律用 supplier_slug / brand slug('dna')當鍵,
--   不准用顯示名字面——三個系統的顯示名寫法不同,拿顯示名比對會在該對上的世界對不上。
--   這句話寫在這裡(不只寫在 plan 裡)是因為 plan 執行完會被丟掉,migration 不會。
--
-- 為何現在先寫這一半(對齊 K-SPEED 同款分工,同一支檔頭的說法):
--   DNA 商品匯入有兩個前置,缺一即 fail-closed 擋下:
--   (a) 本 seed — brands 表要有 dna 列(否則 resolveId('brands','slug','dna') throw);
--   (b) scripts/supplier-config.ts 要登記 dna entry(brandSlug='dna';否則 getSupplierConfig
--       在 resolveId 之前就 throw)。→ 本片只做 (a);(b) 同一片一起做(見 supplier-config.ts diff)。
--   兩者未齊前 dna 乾跑會 throw = 預期行為(同 k-speed/ebc 前例)。
--
-- 🔴 執行:Sean db push 或 MCP apply_migration(Claude 不碰 prod schema)。
-- premium_extra_pct=0:DNA 不在 design-reference data/products.js 原始合約內、無 design 依據
--   → 取保守值 0(比照 ebc/akrapovic/samco/eazi-grip/k-speed 慣例);
--   實際經銷利差待 Sean 確認後再調(不阻擋本片)。
-- name 大寫慣例對齊既有 seed(20260601005859 / 20260710120000 / 20260724140000)。
-- ============================================================

INSERT INTO brands (name, slug, premium_extra_pct) VALUES
  ('DNA FILTERS', 'dna', 0)
ON CONFLICT (slug) DO NOTHING;

-- ── down-migration(rollback 用、註解保存)──
-- 前提1:dna 尚無 products 指向(products.brand_id FK ON DELETE RESTRICT;有商品後先清 products)。
-- 前提2:確認該列確為本 migration 建立、非 ON CONFLICT no-op 命中的既存列(現況 0 列、不可達)。
-- DELETE FROM brands WHERE slug = 'dna';
