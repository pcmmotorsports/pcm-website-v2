-- ============================================================
-- M-1-16a Slice：product_variants 表 + 三層經銷價防護
-- ============================================================
-- 對齊：
--   docs/handoff/2026-05-31-m-1-16-rpm-import-handoff.md §4 16a + §3.3 防護三層
--   Sean 拍板：#81 落地走 A 真變體 / Q5=A 只兩整數價欄不建 price_by_tier /
--             D1=A 變體讀接線併 16c / D2=A #172 輕量納管
--   codex 關卡1 findings：consider 3(jsonb_typeof CHECK)
--   審查 session pre-flight（來源 dllwkkfanaebrsuyuedy 實查）：
--     spec 同群 0 碰撞 / spec_null=0 / 值全 string → pv_spec_unique 安全保留
--
-- 設計脈絡：
--   RPM 一商品 ~24 變體（紋路 weave × 表面 finish × special、各自價/庫存/圖）。
--   獨立表（非 products.variants jsonb）：jsonb 無法 column-level 遮經銷價那一欄、
--   防護會破（#81 落地拍板）。三層防護完整鏡像 products（缺一即洩經銷價）。
--
-- 🔴 紅線：
--   - price_store（經銷價）/ metadata（shopee/cost 內部）絕不進 public view、
--     絕不 column-GRANT 給 anon/authenticated、絕不到 client。
--   - join key = sku（UNIQUE）；不用 model（來源會 re-parse 重寫 model canonical）。
--   - 金額用整數（TWD 元位）、禁浮點。
--
-- Rollback（forward-only、僅供參考勿執行）：
--   DROP VIEW IF EXISTS product_variants_public;
--   DROP TABLE IF EXISTS product_variants;   -- CASCADE 連帶清 RLS policy / GRANT
-- ============================================================


-- ============================================================
-- product_variants 表
-- price_general / price_store 兩 integer 欄（Q5=A、鏡像 products 拆法、不建 price_by_tier）
-- nullable + CHECK >= 0（對齊 products price_general/store pattern；RPM 現 100% 定價、
--   保 nullable 與 products 一致、mapper read 時 general null 則 throw）
-- spec / images / metadata jsonb 各自型別 CHECK（codex k1 consider 3、防 sync 寫錯型別）
-- product_id ON DELETE CASCADE（變體隨商品刪、無下游 FK、Order 整合在 M-3）
-- updated_at 無 trigger（同 products、app 端 set；16b/16c 寫入須帶 updated_at）
-- ============================================================

CREATE TABLE product_variants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku           text NOT NULL UNIQUE,                 -- join key（原始料號、大小寫敏感）
  spec          jsonb NOT NULL DEFAULT '{}',          -- {weave,finish,special} 可擴 N 層
  price_general integer,                              -- 公開零售（view 投射、anon 可見）
  price_store   integer,                              -- 🔴 經銷敏感（view 永遠排除、僅 service_role）
  availability  text NOT NULL DEFAULT 'in-stock',
  images        jsonb NOT NULL DEFAULT '[]',          -- 變體圖 [{url}]；無圖 16c fallback 群圖
  sort_order    integer NOT NULL DEFAULT 0,
  metadata      jsonb NOT NULL DEFAULT '{}',          -- 🔴 {shopee,cost} 內部、不外露
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pv_availability_valid CHECK (
    availability IN ('in-stock', 'out-of-stock')
  ),
  CONSTRAINT pv_price_general_non_negative CHECK (
    price_general IS NULL OR price_general >= 0
  ),
  CONSTRAINT pv_price_store_non_negative CHECK (
    price_store IS NULL OR price_store >= 0
  ),
  CONSTRAINT pv_spec_is_object     CHECK ( jsonb_typeof(spec)     = 'object' ),
  CONSTRAINT pv_images_is_array    CHECK ( jsonb_typeof(images)   = 'array'  ),
  CONSTRAINT pv_metadata_is_object CHECK ( jsonb_typeof(metadata) = 'object' ),
  -- 同群（product_id）內 spec 唯一（審查證 933 群 0 碰撞）；sku 全表 UNIQUE 已由欄約束保證
  CONSTRAINT pv_spec_unique UNIQUE (product_id, spec)
);


-- ============================================================
-- product_variants 索引
-- （sku UNIQUE / pv_spec_unique 自動建 unique index、PK 自動、不重列）
-- ============================================================

CREATE INDEX idx_product_variants_product_id   ON product_variants(product_id);
CREATE INDEX idx_product_variants_availability ON product_variants(availability) WHERE availability = 'in-stock';


-- ============================================================
-- 防護層 1：base 表欄位級 GRANT（鏡像 products 20260519031049）
-- REVOKE ALL 移除 Supabase 預設 over-grant、再 column-GRANT 只開公開欄。
-- price_store / metadata 不 GRANT（經銷敏感 + 內部欄）。
-- product_variants_public 為 security_invoker view、anon 需對 base 表這些欄有 SELECT。
-- ============================================================

REVOKE ALL PRIVILEGES ON TABLE product_variants FROM anon, authenticated;

GRANT SELECT (
  id, product_id, sku, spec, price_general,
  availability, images, sort_order, created_at, updated_at
) ON TABLE product_variants TO anon, authenticated;


-- ============================================================
-- 防護層 2：product_variants_public view（security_invoker、鏡像 products_public）
-- 投射公開欄、永遠排除 price_store + metadata（經銷敏感 + 內部）。
-- ============================================================

CREATE VIEW product_variants_public WITH (security_invoker = true) AS
SELECT
  id,
  product_id,
  sku,
  spec,
  price_general,
  availability,
  images,
  sort_order,
  created_at,
  updated_at
FROM product_variants;

GRANT SELECT ON product_variants_public TO anon, authenticated;

COMMENT ON VIEW product_variants_public IS
  'Variant public projection（M-1-16a）：10 欄、含 price_general、排除 price_store（經銷敏感）+ metadata（內部 shopee/cost）。16c adapter 走此 view embed 進 detail 投射（backlog #203）。';


-- ============================================================
-- 防護層 3：RLS 4 policy（逐條完整寫、鏡像 products 20260507012301）
-- 全 SELECT 公開 / INSERT+UPDATE+DELETE service_role only
-- ALTER ENABLE 仍寫（idempotent + 環境差異防禦；rls_auto_enable 亦會自動觸發）
-- ============================================================

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY product_variants_select_public
  ON product_variants
  FOR SELECT
  USING (true);

CREATE POLICY product_variants_insert_service_role
  ON product_variants
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY product_variants_update_service_role
  ON product_variants
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY product_variants_delete_service_role
  ON product_variants
  FOR DELETE
  TO service_role
  USING (true);
