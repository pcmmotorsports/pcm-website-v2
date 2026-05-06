-- ============================================================
-- M-1-03-main-a2-2 v3 Slice A1: products schema migration
-- ============================================================
-- 對齊 docs/specs/M-1-03-products-schema-prd-v3.md
--   §2.1 表 schema(L62-88)
--   §4 跨表 FK 規則(brand_id / category_id ON DELETE RESTRICT、對齊 a2-1 Q2=B1)
--   §7 索引策略階段 1(3 explicit index + 2 unique 自動)
--
-- Sean 拍板共識:
--   2026-05-06 v3 5Q + 3Q 全拍(Q1=A variants 推遲 / Q2=B trigger 不寫 / Q3=A ON DELETE RESTRICT 補)
--   2026-05-07 Slice A1:apply 走 supabase db push(對齊 a2-1 commit 3684036 慣例)
-- ============================================================


-- ============================================================
-- products 表(對齊 PRD v3 §2.1 L62-88)
-- price_by_tier jsonb 三 tier 全部存在(CHECK 強制)
-- availability 二選一(in-stock / out-of-stock、CHECK 強制)
-- brand_id / category_id ON DELETE RESTRICT(避免孤兒商品、對齊 a2-1 Q2=B1 慣例)
-- 不寫 BEFORE UPDATE trigger(對齊 v3 Q2=B、updated_at application 端 set、backlog #103)
-- ============================================================

CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id     text UNIQUE NOT NULL,
  title           text NOT NULL,
  subtitle        text,
  description     text,
  handle          text UNIQUE NOT NULL,
  price_by_tier   jsonb NOT NULL,
  fitments        jsonb NOT NULL DEFAULT '[]',
  images          jsonb NOT NULL DEFAULT '[]',
  availability    text NOT NULL DEFAULT 'in-stock',
  brand_id        uuid REFERENCES brands(id) ON DELETE RESTRICT,
  category_id     uuid REFERENCES categories(id) ON DELETE RESTRICT,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT availability_valid CHECK (
    availability IN ('in-stock', 'out-of-stock')
  ),
  CONSTRAINT price_by_tier_keys CHECK (
    price_by_tier ? 'general' AND
    price_by_tier ? 'store' AND
    price_by_tier ? 'premiumStore'
  )
);


-- ============================================================
-- products 索引(對齊 PRD v3 §7 L192-201)
-- 3 條 explicit index + 2 條 unique 自動(external_id / handle、UNIQUE 約束自動建立、不需 explicit CREATE INDEX)
-- 階段 2(GIN on fitments jsonb_path_ops)推遲 backlog #30、1k-5k SKU 觸發
-- 階段 3(tsvector + pg_jieba)推遲 backlog #35、Supabase Pro 升完觸發
-- ============================================================

CREATE INDEX idx_products_brand_id    ON products(brand_id);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_availability ON products(availability) WHERE availability = 'in-stock';
