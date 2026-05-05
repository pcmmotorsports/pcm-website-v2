-- ============================================================
-- M-1-03-main-a2-1: brands + categories schema migration
-- ============================================================
-- 對齊 docs/architecture/supabase-schema-design.md
--   §3 Brand 表(L152-190)
--   §4 Category 表(L191-228)
--   §9.2 RLS policy 規劃表(L451-459):brands + categories 全 SELECT 公開 / service_role only
--   §10.1 索引階段 1(L474-499):補 idx_categories_parent_category_id(查樹)
--
-- Sean 2026-05-05 拍板:
--   Q1=A1 對齊真權威編號 §3/§4
--   Q2=B1 ON DELETE RESTRICT(避免孤兒分類)
--   Q3=C1 4 policy 各別寫(每表 SELECT/INSERT/UPDATE/DELETE)
--   Q4=D2 加 idx_categories_parent_category_id(真權威 §10.1 未列、進 backlog #New)
-- ============================================================


-- ============================================================
-- brands 表(對齊 supabase-schema-design.md §3 Brand L157-165)
-- ============================================================

CREATE TABLE brands (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,         -- design 字面、例:'CNC RACING'(對齊 ADR-0003 §4 #1)
  slug        text NOT NULL UNIQUE,         -- URL slug、kebab-case、例:'cnc-racing'
  description text,
  logo_url    text,                          -- Supabase Storage URL(對齊 ADR-0004 Q2=A2)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- categories 表(對齊 §4 Category L196-204)
-- parent_category_id ON DELETE RESTRICT(Q2=B1、避免孤兒分類)
-- ============================================================

CREATE TABLE categories (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_category_id  uuid REFERENCES categories(id) ON DELETE RESTRICT,
  name                text NOT NULL,        -- 例:'排氣管'(葉節點)
  raw_path            text NOT NULL UNIQUE, -- 例:'引擎部品 · 排氣管'(根→葉路徑、design 字面)
  segments            jsonb NOT NULL,       -- 例:["引擎部品", "排氣管"](解析陣列)
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- brands RLS(對齊 §9.2、Q3=C1 4 policy 各別寫)
-- 全 SELECT 公開 / INSERT+UPDATE+DELETE service_role only
-- ============================================================

ALTER TABLE brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY brands_select_public
  ON brands
  FOR SELECT
  USING (true);

CREATE POLICY brands_insert_service_role
  ON brands
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY brands_update_service_role
  ON brands
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY brands_delete_service_role
  ON brands
  FOR DELETE
  TO service_role
  USING (true);


-- ============================================================
-- categories RLS(對齊 §9.2、Q3=C1 4 policy 各別寫)
-- 全 SELECT 公開 / INSERT+UPDATE+DELETE service_role only
-- ============================================================

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY categories_select_public
  ON categories
  FOR SELECT
  USING (true);

CREATE POLICY categories_insert_service_role
  ON categories
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY categories_update_service_role
  ON categories
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY categories_delete_service_role
  ON categories
  FOR DELETE
  TO service_role
  USING (true);


-- ============================================================
-- categories 索引(Q4=D2:idx_categories_parent_category_id 查樹)
-- 註:supabase-schema-design.md §10.1 真權威未列、觸發 backlog 候選 #New
-- 註:brands 不需額外索引(name + slug UNIQUE 自動有 unique index)
-- 註:categories.raw_path UNIQUE 自動有 unique index、不重列
-- ============================================================

CREATE INDEX idx_categories_parent_category_id ON categories(parent_category_id);
