-- ============================================================
-- R1a:正規化 fitment 索引表 product_fitments(推薦引擎 Case A 車輛反查用)
-- ------------------------------------------------------------
-- 背景:products.fitments(jsonb NOT NULL DEFAULT '[]')是「相容車輛」單一真相。
--   商品頁顯示直接讀 jsonb 夠用;但推薦引擎 Case A =「反查某台車能裝的所有商品」
--   需要「以車查商品」= jsonb 做不到(planner 低估筆數、無法索引年份區間、40k 規模退化)。
--   → 建**衍生索引表** product_fitments(一列一相容),trigger 自動同步、products.fitments 仍為真相。
--   plan:docs/specs/2026-07-08-recommendation-engine-related-products-plan.md v0.3 §3(codex 兩輪折入)。
--
-- 設計要點(對齊 repo 既有慣例):
--   - product_id uuid REFERENCES products(id)(對齊 products.id uuid、init_products.sql:24)。
--   - moto_brand / model_code 存 domain FitmentSpec 的**原始名**(如 'Ducati' / 'Streetfighter V4 S';
--     實測 8461 元素、camelCase motoBrand/modelCode/yearStart?/yearEnd)、非 slug(車輛 slug 在 taxonomy
--     去重後才成立、含碰撞序號、不可逆算 → server 端反查時用 taxonomy 把 URL slug 解回原始名再查此表)。
--   - 年份四態:no-year(NULL/NULL)/ 單年(Y/Y)/ 區間(A/B)/ 開放式(Y/NULL);實測年份皆原生 number。
--   - RLS 照抄 product_variants_select_public 範式(20260602135934:67)delisted 連動隱藏,不裸曝下架商品 fitment。
--   - trigger 拆 INSERT / UPDATE OF fitments 兩個(CREATE TRIGGER WHEN 不可用 TG_OP;UPDATE 版加 DISTINCT 防 40k churn)。
--   - 註:init_products.sql:20「不寫 BEFORE UPDATE trigger」是針對 updated_at 的慣例;此處為衍生索引同步
--     (AFTER trigger、單一真相在 products.fitments)、用途不同、故用 trigger 保證同步一致性。
-- ============================================================


-- ── 1. 表 + 索引 ────────────────────────────────────────────
CREATE TABLE product_fitments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  moto_brand   text NOT NULL,   -- 原始車廠名(對齊 FitmentSpec.motoBrand,如 'Ducati')
  model_code   text NOT NULL,   -- 原始車型碼(對齊 FitmentSpec.modelCode,如 'Streetfighter V4 S')
  year_start   int,             -- NULL=無年份資料(見四態)
  year_end     int,
  -- 四態不變式:year_start IS NULL ⇒ year_end IS NULL(禁 (NULL,Y) 非法態、避免反查誤當「通吃所有年份」)。
  --   同步邏輯保證絕不產生違反列 → 此 CHECK 對 trigger 路徑零觸發、僅防直寫/未來 regression(codex 關卡2)。
  CONSTRAINT product_fitments_year_state_valid CHECK (year_start IS NOT NULL OR year_end IS NULL)
);

-- ix_pf_lookup:車輛反查主力(moto_brand+model_code 等值定位、year_* 附帶;每 brand+model 僅數筆年份區間、
--   四態年份含 NULL/OR 條件在少量列上 filter 成本可忽略;R1b EXPLAIN 實測、退化再評 partial/GiST、backlog nit⑨)。
--   前綴 (moto_brand, model_code) 已涵蓋純 brand+model 等值查 → 不另建冗餘 brand_model 索引。
CREATE INDEX ix_pf_lookup  ON product_fitments (moto_brand, model_code, year_start, year_end);
-- ix_pf_product:trigger DELETE by product_id + 通用款 listGeneral NOT EXISTS(product_id) + FK。
CREATE INDEX ix_pf_product ON product_fitments (product_id);

COMMENT ON TABLE product_fitments IS
  '相容車輛正規化索引(衍生自 products.fitments jsonb、trigger 自動同步)。推薦引擎 Case A 反查「以車查商品」用。單一真相仍為 products.fitments;此表可 DROP 重建。moto_brand/model_code 存原始名(非 slug)。';


-- ── 2. RLS:delisted 連動隱藏(照抄 product_variants_select_public 範式)────
-- products_public 靠底層 products RLS products_select_public USING(delisted_at IS NULL) 藏下架整列;
-- 本表若裸 GRANT 會讓 anon 讀到「下架商品」的 fitment(products_public 已藏)→ 加對應 RLS 閘住。
ALTER TABLE product_fitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS product_fitments_select_public ON product_fitments;
CREATE POLICY product_fitments_select_public
  ON product_fitments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM products p
      WHERE p.id = product_fitments.product_id
        AND p.delisted_at IS NULL
    )
  );

-- 防禦兩層(對齊 product_variants 20260531142533:86):先 REVOKE 移除 Supabase 預設 over-grant
--   (anon/authenticated 預設持 INSERT/UPDATE/DELETE),再只開 SELECT。全欄非敏感(無經銷價)→ 表級 GRANT SELECT(非欄級)。
--   寫入靠「無寫 grant + RLS 無寫 policy」雙擋;service_role 依 Supabase 預設 table grant + BYPASSRLS 寫入。
REVOKE ALL PRIVILEGES ON TABLE product_fitments FROM anon, authenticated;
GRANT SELECT ON product_fitments TO anon, authenticated;


-- ── 3. 同步 function + 雙 trigger(fail-closed 防髒 jsonb、DISTINCT 防 churn)──
-- SECURITY INVOKER(預設):products 的 INSERT/UPDATE 僅 service_role 可為(anon/authenticated 無 DML grant)、
--   service_role BYPASSRLS → 可寫 product_fitments;不用 SECURITY DEFINER(避免不必要提權面、對齊 PCM SECDEF 審慎)。
CREATE OR REPLACE FUNCTION sync_product_fitments()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- 先清該商品舊列(全量重建、避免部分更新漂移)
  DELETE FROM product_fitments WHERE product_id = NEW.id;

  -- 防禦性 unnest:非 array → 0 列(不 abort);逐元素僅在 object + motoBrand/modelCode 為「JSON 字串型」且非空才成列
  --   (非字串如 123/true 跳過、codex 關卡2);年份文字正則 ^[0-9]{4}$ 白名單(4 位才取;float/超界/非 4 位 → NULL、絕不 ::int abort);
  --   year_end 僅在 year_start 亦合法時取(守四態不變式、不產生 (NULL,Y));DISTINCT 去重;單一髒元素跳過、絕不 rollback products。
  IF jsonb_typeof(NEW.fitments) = 'array' THEN
    INSERT INTO product_fitments (product_id, moto_brand, model_code, year_start, year_end)
    SELECT DISTINCT
      NEW.id,
      elem->>'motoBrand',
      elem->>'modelCode',
      CASE WHEN (elem->>'yearStart') ~ '^[0-9]{4}$' THEN (elem->>'yearStart')::int ELSE NULL END,
      CASE WHEN (elem->>'yearStart') ~ '^[0-9]{4}$' AND (elem->>'yearEnd') ~ '^[0-9]{4}$' THEN (elem->>'yearEnd')::int ELSE NULL END
    FROM jsonb_array_elements(NEW.fitments) AS elem
    WHERE jsonb_typeof(elem) = 'object'
      AND jsonb_typeof(elem->'motoBrand') = 'string'
      AND jsonb_typeof(elem->'modelCode') = 'string'
      AND btrim(elem->>'motoBrand') <> ''
      AND btrim(elem->>'modelCode') <> '';
  END IF;

  RETURN NULL;  -- AFTER trigger、回傳值忽略
END;
$fn$;

COMMENT ON FUNCTION sync_product_fitments() IS
  'AFTER INSERT/UPDATE OF fitments ON products:全量重建該商品 product_fitments 列。防禦性(非 array/髒元素跳過、不 abort products 寫入)。';

-- INSERT:無 OLD、必同步、不加 WHEN
DROP TRIGGER IF EXISTS trg_pf_sync_ins ON products;
CREATE TRIGGER trg_pf_sync_ins
  AFTER INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION sync_product_fitments();

-- UPDATE OF fitments:僅 fitments 欄異動且值真的變才同步(每日 40k upsert 值未變 → 不 churn)
DROP TRIGGER IF EXISTS trg_pf_sync_upd ON products;
CREATE TRIGGER trg_pf_sync_upd
  AFTER UPDATE OF fitments ON products
  FOR EACH ROW
  WHEN (OLD.fitments IS DISTINCT FROM NEW.fitments)
  EXECUTE FUNCTION sync_product_fitments();


-- ── 4. 回填(現有 products.fitments 一次性;同 function 防禦邏輯)────────────
-- LATERAL + CASE 守 non-array(FROM 端 set-returning function 在 WHERE 前求值、需在此處先擋)。
INSERT INTO product_fitments (product_id, moto_brand, model_code, year_start, year_end)
SELECT DISTINCT
  p.id,
  elem->>'motoBrand',
  elem->>'modelCode',
  CASE WHEN (elem->>'yearStart') ~ '^[0-9]{4}$' THEN (elem->>'yearStart')::int ELSE NULL END,
  CASE WHEN (elem->>'yearStart') ~ '^[0-9]{4}$' AND (elem->>'yearEnd') ~ '^[0-9]{4}$' THEN (elem->>'yearEnd')::int ELSE NULL END
FROM products p
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(p.fitments) = 'array' THEN p.fitments ELSE '[]'::jsonb END
) AS elem
WHERE jsonb_typeof(elem) = 'object'
  AND jsonb_typeof(elem->'motoBrand') = 'string'
  AND jsonb_typeof(elem->'modelCode') = 'string'
  AND btrim(elem->>'motoBrand') <> ''
  AND btrim(elem->>'modelCode') <> '';
