-- ============================================================
-- M-1-03-main-a 刀 3:price_by_tier 二 key + brands.premium_extra_pct + UPDATE 清舊 row
-- ============================================================
-- 對齊 docs/architecture/supabase-schema-design.md
--   §2.1 CHECK 二 key(price_by_tier ? 'general' AND ? 'store')
--   §3.1 brands 第 8 欄位 premium_extra_pct integer NOT NULL DEFAULT 0 CHECK (0-30)
--
-- M-1-03-post-supplement 落地時程(對齊本檔 commit body):
--   sub-slice 0a/0b(2026-05-11):schema doc + M-1-03 PRD 字面修(二 key + brands 第 8 欄位)
--   刀 1a(2026-05-12):utils tier mapping + schema doc 註解清理
--   刀 1b(2026-05-12):domain Brand 加 premium_extra_pct + 構造端 4 處修
--   刀 2(2026-05-12):SupabaseBrandRow required + PRODUCT_SELECT JOIN brands 擴
--   刀 3(2026-05-12、本 migration):DB schema 落地 + UPDATE 清舊 row
--
-- 操作順序(對齊 Sean D1b 拍板:UPDATE 在 DROP CHECK 之前、避免 CHECK 反向卡):
--   (1) brands ADD COLUMN premium_extra_pct
--   (2) UPDATE products 清舊 price_by_tier.premiumStore key
--   (3) DROP 三 key CHECK
--   (4) ADD 二 key CHECK
--
-- 既有 row 處置(2026-05-12 偵察揭示):
--   apply 時 products 表 0 row、UPDATE 不會清任何資料、預防性對齊新 schema
-- ============================================================


-- (1) brands ADD COLUMN premium_extra_pct(對齊 §3.1 字面)
ALTER TABLE brands ADD COLUMN premium_extra_pct integer NOT NULL DEFAULT 0
  CHECK (premium_extra_pct >= 0 AND premium_extra_pct <= 30);


-- (2) UPDATE 清舊 row price_by_tier.premiumStore key(D1b 拍板)
--     使用 jsonb 運算子 #- '{premiumStore}' 移除 key
--     WHERE 過濾 ? 'premiumStore' 防 jsonb 不含此 key 的 row 也被 UPDATE(no-op 但 row 被 mark dirty)
UPDATE products
  SET price_by_tier = price_by_tier #- '{premiumStore}'
  WHERE price_by_tier ? 'premiumStore';


-- (3) DROP 既有三 key CHECK(constraint 名稱對齊 20260507004826_init_products.sql)
ALTER TABLE products DROP CONSTRAINT price_by_tier_keys;


-- (4) ADD 二 key CHECK(對齊 §2.1 字面)
ALTER TABLE products ADD CONSTRAINT price_by_tier_keys CHECK (
  price_by_tier ? 'general' AND
  price_by_tier ? 'store'
);
