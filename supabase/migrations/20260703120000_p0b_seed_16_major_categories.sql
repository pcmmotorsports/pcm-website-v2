-- ============================================================
-- Phase 0 P0-B Slice：seed 16 大類(major_category_zh、多品牌上架分類地基)
-- ============================================================
-- 對齊：
--   docs/specs/2026-07-03-phase0-multibrand-foundation-plan.md §2.7 / §4 P0-B
--   Sean 拍板:Q3=A(只 seed 16 大類、97 子類暫不 seed)/ Q2=A(RPM「碳纖維部品」不動)
--
-- 設計脈絡：
--   多供應商上架:per-group 供應商(gbracing/bonamici…)依來源 major_category_zh 對 categories.raw_path
--   resolve 出 category_id(rpm-import resolveIdOrNull)。products.category_id NOT NULL + FK ON DELETE RESTRICT
--   → 試點寫入前必先有這 16 個分類,否則 resolve=null 撞 NOT NULL(backlog #261)。
--   本片只 seed 分類、不寫 products(那是 Phase 1 試點寫入)。零可見變化
--   (前台 featured/目錄仍釘死「碳纖維部品」、§5 C1;分類樹尚未接真、尚無商品指向這 16 類)。
--
-- 字面 vs 事實(鐵則 11)：
--   - 16 個 name/raw_path = 來源 view storefront_catalog_v.major_category_zh 的 DISTINCT 值,
--     2026-07-03 唯讀 MCP 查證(報價單 B庫 dllwkkfanaebrsuyuedy)逐字 + group_count;
--     raw_path 必與來源逐字相同、否則 per-group resolve 對不上(如「四輪 ATV/UTV」含空格+slash 原樣、不清洗)。
--   - sort_order 1-16 依 group_count 降冪(操控部品 7290 最多=1 … 行李箱包 26=16;數字見下方註)。
--     現有「碳纖維部品」sort_order=0 不動(Q2=A、RPM 專屬留最前)。
--   - 單層(parent_category_id NULL、segments 單元素);97 子類 Q3=A 暫不 seed。
--
-- group_count(查證留證、僅供 sort_order 依據、非入庫欄):
--   操控部品 7290 / 周邊配件 3462 / 車殼外觀 2723 / 引擎部品 1732 / 騎士好物 575 / 後視鏡 438 /
--   電子系統 246 / 車架 197 / 煞車系統 187 / 燈具方向燈 173 / 駐車架 160 / 傳動齒比 128 /
--   服飾配備 93 / 四輪 ATV/UTV 46 / 排氣系統 28 / 行李箱包 26。
--
-- 冪等(可重播)：ON CONFLICT (raw_path) DO NOTHING — 重跑 skip 已存在、不報錯。
-- 執行身分：migration 走 postgres(table owner)、bypass RLS(categories INSERT 限 service_role)。
--
-- Rollback(forward-only、僅供參考勿執行;需先確認無 products 掛這些 category_id、否則 FK RESTRICT 擋)：
--   DELETE FROM categories WHERE raw_path IN (
--     '操控部品','周邊配件','車殼外觀','引擎部品','騎士好物','後視鏡','電子系統','車架',
--     '煞車系統','燈具方向燈','駐車架','傳動齒比','服飾配備','四輪 ATV/UTV','排氣系統','行李箱包'
--   );
-- ============================================================

INSERT INTO categories (name, raw_path, segments, sort_order, parent_category_id) VALUES
  ('操控部品',     '操控部品',     '["操控部品"]'::jsonb,     1,  NULL),
  ('周邊配件',     '周邊配件',     '["周邊配件"]'::jsonb,     2,  NULL),
  ('車殼外觀',     '車殼外觀',     '["車殼外觀"]'::jsonb,     3,  NULL),
  ('引擎部品',     '引擎部品',     '["引擎部品"]'::jsonb,     4,  NULL),
  ('騎士好物',     '騎士好物',     '["騎士好物"]'::jsonb,     5,  NULL),
  ('後視鏡',       '後視鏡',       '["後視鏡"]'::jsonb,       6,  NULL),
  ('電子系統',     '電子系統',     '["電子系統"]'::jsonb,     7,  NULL),
  ('車架',         '車架',         '["車架"]'::jsonb,         8,  NULL),
  ('煞車系統',     '煞車系統',     '["煞車系統"]'::jsonb,     9,  NULL),
  ('燈具方向燈',   '燈具方向燈',   '["燈具方向燈"]'::jsonb,   10, NULL),
  ('駐車架',       '駐車架',       '["駐車架"]'::jsonb,       11, NULL),
  ('傳動齒比',     '傳動齒比',     '["傳動齒比"]'::jsonb,     12, NULL),
  ('服飾配備',     '服飾配備',     '["服飾配備"]'::jsonb,     13, NULL),
  ('四輪 ATV/UTV', '四輪 ATV/UTV', '["四輪 ATV/UTV"]'::jsonb, 14, NULL),
  ('排氣系統',     '排氣系統',     '["排氣系統"]'::jsonb,     15, NULL),
  ('行李箱包',     '行李箱包',     '["行李箱包"]'::jsonb,     16, NULL)
ON CONFLICT (raw_path) DO NOTHING;
