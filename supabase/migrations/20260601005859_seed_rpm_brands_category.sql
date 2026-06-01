-- ============================================================
-- M-1-16b-1 Slice：seed brands(21) + category(碳纖維部品)
-- ============================================================
-- 對齊：
--   docs/handoff/2026-05-31-m-1-16-rpm-import-handoff.md §4 16b(seed brands/categories)
--   design-reference/data/products.js:11-31 brands 真權威(21 筆、grep 驗證字面)
--   Sean 拍板:Q-A=A(21 品牌全 seed)/ Q-E=A(category 單層)
--
-- 設計脈絡：
--   16b RPM 匯入前置 — products.brand_id / category_id 是 FK(ON DELETE RESTRICT)、
--   寫商品前必先有對應 brand + category，否則 FK 中不到(0 orphan)。
--   本片只 seed brands + category、不寫 products/variants(那是 16b-2/16b-3 腳本)。
--
-- 字面 vs 事實(鐵則 11)：
--   - brands 21 筆 name/slug/premium_extra_pct 100% 取 design products.js:11-31 字面
--     (RPM 匯入 FK 硬需求只 RPM CARBON 1 筆;Q-A=A 拍板一次 seed design 全 21 品牌、
--      避免後續上架別家撞 FK / 缺品牌頁)。
--   - category name「碳纖維部品」= Sean Q-E 拍板字面(B)、業務 override：
--     design L124 根分類真權威 name 是「碳纖維」(id='carbon'、5 子類)、
--     RPM 來源 category 單一值 'Carbon Fiber Fairing' 無細分 → 採單層 + Sean 白話命名「碳纖維部品」。
--   - description / logo_url：design brands 物件無對應欄(只有 tagline/logo design-only)→ 留 NULL。
--   - AKRAPOVIČ(Č)/ ÖHLINS(Ö) 非 ASCII、UTF-8 原樣(products.brand JOIN brands.name 須逐字一致)。
--
-- 冪等(可重播)：ON CONFLICT (slug / raw_path) DO NOTHING — 重跑 skip 已存在、不報錯。
-- 執行身分：migration 走 postgres(table owner)、bypass RLS(brands/categories INSERT 限 service_role)。
--
-- Rollback(forward-only、僅供參考勿執行)：
--   DELETE FROM categories WHERE raw_path = '碳纖維部品';
--   DELETE FROM brands WHERE slug IN (...);  -- 上方 INSERT 的 21 個 slug
--   (注意:若 products 已掛 brand_id/category_id、ON DELETE RESTRICT 會擋、須先清 products)
-- ============================================================


-- ============================================================
-- brands seed(21 筆、design-reference/data/products.js:11-31 字面)
-- name / slug / premium_extra_pct 取 design;description / logo_url 留 NULL(design 無對應)
-- ============================================================

INSERT INTO brands (name, slug, premium_extra_pct) VALUES
  ('BONAMICI RACING',     'bonamici',   5),
  ('CNC RACING',          'cnc-racing', 4),
  ('DBK SPECIAL PARTS',   'dbk',        3),
  ('EAZI-GRIP',           'eazi-grip',  0),
  ('EVOTECH PERFORMANCE', 'evotech',    5),
  ('EXTREME COMPONENTS',  'extreme',    6),
  ('FRONT 3D',            'front3d',    4),
  ('GB RACING',           'gb-racing',  3),
  ('GILLES TOOLING',      'gilles',     5),
  ('KINEO',               'kineo',      7),
  ('LIGHTECH',            'lightech',   5),
  ('MATERYA',             'materya',    8),
  ('MOTOGADGET',          'motogadget', 4),
  ('RPM CARBON',          'rpm-carbon', 6),
  ('SAMCO SPORT',         'samco',      0),
  ('WRS',                 'wrs',        3),
  ('RIZOMA',              'rizoma',     5),
  ('AKRAPOVIČ',           'akrapovic',  6),
  ('BREMBO',              'brembo',     3),
  ('ÖHLINS',              'ohlins',     8),
  ('TERMIGNONI',          'termignoni', 5)
ON CONFLICT (slug) DO NOTHING;


-- ============================================================
-- category seed(1 筆、碳纖維部品、單層)
-- Q-E=A 單層 + name Sean Q-E=B 拍板字面(業務 override design「碳纖維」)
-- raw_path 單段(無「 · 」分隔)、segments 單元素、parent_category_id NULL(根級)
-- ============================================================

INSERT INTO categories (name, raw_path, segments, sort_order, parent_category_id) VALUES
  ('碳纖維部品', '碳纖維部品', '["碳纖維部品"]'::jsonb, 0, NULL)
ON CONFLICT (raw_path) DO NOTHING;
