-- ============================================================
-- M-1-03-main-a2-2 v3 Slice A2: products RLS 4 policy migration
-- ============================================================
-- 對齊 docs/specs/M-1-03-products-schema-prd-v3.md
--   §6 RLS policy(L152-176)— 4 policy(SELECT public + INSERT/UPDATE/DELETE service_role)
--   §6 慣例摘要(L179-184)對齊 a2-1 brands/categories 落地結構
--
-- ALTER TABLE ENABLE ROW LEVEL SECURITY 仍寫:
--   Slice A1(commit 53ef799)落地後 products 表 RLS 已被 Supabase rls_auto_enable() function 自動觸發 enable
--   本 slice 仍寫 ALTER TABLE 對齊 PRD v3 §6 字面 + idempotent(PostgreSQL 重複 enable 無副作用)+ 環境差異防禦
--   對齊 backlog #101 advisor 警告 trigger
-- ============================================================


-- ============================================================
-- products RLS(對齊 PRD v3 §6 L152-176)
-- 全 SELECT 公開 / INSERT+UPDATE+DELETE service_role only
-- 對齊 a2-1 brands/categories 落地結構慣例(20260505130758_init_brands_categories.sql)
-- ============================================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_select_public
  ON products
  FOR SELECT
  USING (true);

CREATE POLICY products_insert_service_role
  ON products
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY products_update_service_role
  ON products
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY products_delete_service_role
  ON products
  FOR DELETE
  TO service_role
  USING (true);
