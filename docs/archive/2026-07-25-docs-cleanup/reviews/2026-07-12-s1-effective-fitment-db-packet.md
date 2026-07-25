# Codex Review Packet — S1 變體補足 · DB 三件套(effective fitment)

> 2026-07-12 · 鐵則 12 · **範圍限 DDL(尚未 apply prod、尚未 commit)**。TS 消費層另審(code-reviewer)。
> Codex 無需 repo:本檔自帶 SQL 全文 + 已驗事實 + 規則摘錄。目標=在 Sean 手動 apply 兩庫前擊破 correctness/RLS/跨庫一致性。

## 0. 背景與目標
網站選 YAMAHA MT-09 SP 2021 只出 74 件、報價單同條件展開 105 件(onboarded)。根因:網站車款比對字串完全相等,掛母款 MT-09 的通用件不展開到子款 MT-09 SP;報價單家族樹展開只授 service_role、不對外。

**架構(Sean 拍板):報價單當大腦、網站消費。方案 C + UNION:**
- 報價單 B庫(`dllwkkfanaebrsuyuedy`)新增對外 view `storefront_fitments_v`(一列一展開後 fitment,只給 service_role)。
- 網站庫(`bmpnplmnldofgaohnaok`)新增 `product_fitments_effective`(direct+inherited 超集,每日同步灌)。
- 車款搜尋 RPC = `product_fitments`(既有、direct、即時 trigger)**∪** `product_fitments_effective`(展開)去重 → 零回歸、目標 74→124。
- 🔴 **不碰** `product_fitments`(餵推薦引擎)、**不碰** `products.fitments`(原始 provenance)。

## 1. 已驗事實(read-only 實查、非估計)
- Y016(bonamici,原始 all_models=["MT-09"])→ view 展開 7 列:MT-09(direct)+ 6 繼承(含 **MT-09 SP**),全 source_model_code=MT-09、年份 2021-2026。
- 全庫完整性:`(NULL, year_end)` 非法態 **0/19197**;`search_vehicles` 全合法陣列;繼承列找不到母款(source NULL)**0/30710**;`search_vehicles` 重複 vehicle **0 組**。
- 跨庫對應:report `main_sku` ↔ network `external_id`(同 supplier),MT-09 SP 2021 onboarded 105 筆 **100% exact match、0 孤兒**。
- 數字:網站現況 74;報價單 onboarded 權威 105;UNION 後 124(+28 繼承 core +22 evotech direct-freshness);另有 19 筆「網站有、報價單展開沒有」= 未解釋漂移,UNION 保留、backlog 另查。
- effective 表規模(onboarded 上界)103369 列(direct 72659 + inherited 30710),對比既有 product_fitments 81756,同數量級。
- 網站 products_public 具 RPC 讀的 18 欄;anon 對 brands/categories 保有 SELECT;products RLS `delisted_at IS NULL` live。

## 2. 待審 SQL — 報價單 B庫 view

```sql
CREATE OR REPLACE VIEW storefront_fitments_v
WITH (security_invoker = true)
AS
SELECT DISTINCT
  g.supplier_slug,
  g.main_sku,
  sv.brand  AS moto_brand,
  sv.model  AS model_code,
  g.year_start,
  CASE WHEN g.year_start IS NULL THEN NULL ELSE g.year_end END AS year_end,
  CASE WHEN sv.model = ANY(g.all_models) THEN 'direct' ELSE 'inherited' END AS match_source,
  CASE WHEN sv.model = ANY(g.all_models) THEN sv.model
       ELSE COALESCE(fc.ancestor, sv.model) END AS source_model_code
FROM product_groups_v g
CROSS JOIN LATERAL jsonb_to_recordset(
  CASE WHEN jsonb_typeof(g.search_vehicles) = 'array' THEN g.search_vehicles ELSE '[]'::jsonb END
) AS sv(brand text, model text)
LEFT JOIN LATERAL (
   SELECT c.ancestor FROM model_family_closure_v c
   WHERE c.brand = sv.brand AND c.descendant = sv.model AND c.ancestor = ANY(g.all_models)
   ORDER BY c.depth ASC LIMIT 1
) fc ON true;

REVOKE ALL ON storefront_fitments_v FROM anon, authenticated;  -- 只 service_role 讀
```
年份規則:展開列一律套 group `year_start/year_end`(商品自身區間)。product_groups_v.vehicles 幾乎不帶逐款年(75/19197),group year 是聚合值,對齊報價單既有 search 語意(見 §4 F7)。

## 3. 待審 SQL — 網站庫 表 + RPC

```sql
CREATE TABLE product_fitments_effective (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id        uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  moto_brand        text NOT NULL,
  model_code        text NOT NULL,
  year_start        int,
  year_end          int,
  match_source      text NOT NULL,
  source_model_code text NOT NULL,
  CONSTRAINT pfe_year_state_valid   CHECK (year_start IS NOT NULL OR year_end IS NULL),
  CONSTRAINT pfe_match_source_valid CHECK (match_source IN ('direct','inherited'))
);
CREATE UNIQUE INDEX ux_pfe_row ON product_fitments_effective
  (product_id, moto_brand, model_code, year_start, year_end, match_source) NULLS NOT DISTINCT;
CREATE INDEX ix_pfe_lookup  ON product_fitments_effective (moto_brand, model_code, year_start, year_end);
CREATE INDEX ix_pfe_product ON product_fitments_effective (product_id);

ALTER TABLE product_fitments_effective ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_fitments_effective_select_public ON product_fitments_effective
  FOR SELECT USING (EXISTS (SELECT 1 FROM products p
    WHERE p.id = product_fitments_effective.product_id AND p.delisted_at IS NULL));
REVOKE ALL PRIVILEGES ON TABLE product_fitments_effective FROM anon, authenticated;
GRANT SELECT ON product_fitments_effective TO anon, authenticated;
-- 無 trigger:每日同步全量重建(單一真相在報價單)。

CREATE OR REPLACE FUNCTION search_products_by_vehicle(
  p_brand text, p_model text DEFAULT NULL, p_year int DEFAULT NULL)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER
AS $fn$
  WITH matched AS (
    SELECT product_id FROM product_fitments
     WHERE moto_brand = p_brand
       AND (p_model IS NULL OR model_code = p_model)
       AND (p_year  IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                            AND (year_end   IS NULL OR year_end   >= p_year)))
    UNION
    SELECT product_id FROM product_fitments_effective
     WHERE moto_brand = p_brand
       AND (p_model IS NULL OR model_code = p_model)
       AND (p_year  IS NULL OR ((year_start IS NULL OR year_start <= p_year)
                            AND (year_end   IS NULL OR year_end   >= p_year)))
  )
  SELECT jsonb_build_object(
    'id', p.id, 'external_id', p.external_id, 'title', p.title, 'subtitle', p.subtitle,
    'description', p.description, 'highlights', p.highlights, 'manuals', p.manuals,
    'video_url', p.video_url, 'handle', p.handle, 'fitments', p.fitments,
    'images', p.images, 'availability', p.availability,
    'brand_id', p.brand_id, 'category_id', p.category_id, 'price_general', p.price_general,
    'created_at', p.created_at, 'updated_at', p.updated_at,
    'brands', jsonb_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'premium_extra_pct', b.premium_extra_pct),
    'categories', jsonb_build_object('raw_path', c.raw_path, 'segments', c.segments))
  FROM products_public p
  JOIN matched  m ON m.product_id = p.id
  JOIN brands   b ON b.id = p.brand_id       -- INNER:壞資料商品靜默漏(搜尋降級>500整頁);與 mapper throw 分歧為刻意
  JOIN categories c ON c.id = p.category_id
  ORDER BY p.id;
$fn$;
REVOKE ALL ON FUNCTION search_products_by_vehicle(text,text,int) FROM public;
GRANT EXECUTE ON FUNCTION search_products_by_vehicle(text,text,int) TO anon, authenticated, service_role;
```

## 4. 對抗審查(adversarial-reviewer,fresh context)findings + 已處理
- **F1(已修)** view 外層 WHERE 不保證擋 jsonb_to_recordset 非陣列列(planner 下推不保證)→ 守衛移進 LATERAL 的 CASE(對齊 sibling 20260708130000)。
- **F2(已修)** source_model_code LEFT JOIN 可能 NULL 撞表 NOT NULL → `COALESCE(fc.ancestor, sv.model)` 兜底。
- **F3(已修)** view 加 `SELECT DISTINCT`(實測重複 0、防漂移)。
- **F6(已註記)** RPC INNER JOIN 靜默漏 vs mapper throw = 刻意取捨、註明。
- **F5(TS 層,已量+記錄)** 1024/80726(1.3%)fitment 有 yearStart 無 yearEnd:client 當單年、DB 當開放式(≥)。衍生表已丟失單/開區別、推薦引擎早用開放式 → RPC 沿用開放式=搜尋與推薦一致;commit body 記錄此 1.3% 行為對齊。
- **F4(TS 層,必做)** client `matchesVehicle`(對 direct-only products.fitments 過濾)走 RPC 路徑時必須拿掉,否則繼承命中被靜默濾除。
- **F7(業務,待 Sean)** 見下。
- 經銷價洩漏嘗試=擋(RPC 只取 products_public 公開欄、無 price_store/price_by_tier)。

## 5. 請 Codex 重點擊破
1. RPC jsonb 形狀 vs SupabaseProductRow(§ 需對照的欄名/巢狀/型別;created_at 走 jsonb ISO 字串→JS `new Date()`)。
2. UNION 去重 + 三態年份謂詞在兩表對稱性;熱門車型延遲。
3. security_invoker RPC 被 anon 呼叫時三表 RLS(delisted)+ brands/categories grant 是否真的擋下架又讀得到。
4. effective 表 NULLS NOT DISTINCT 唯一鍵 + 每日 delete+insert 一致性;孤兒 FK 失敗模式。
5. 跨庫最終一致性(effective 每日全量 vs product_fitments 即時 trigger,UNION 保底)。
6. F7 年份取捨是否可接受(見下)。

## 6. 待 Sean 拍板(F7)
inherited 車款套 group 聚合年 → 可能過寬(MT-09 SP 繼承 2021-2026,即使 SP 實際更晚才出)。因 report 無逐款年、且對齊報價單既有 search 語意。實務衝擊低(無人有不存在年份的車)。**Sean 確認可接受再上。**

## 7. PCM 規則摘錄(供 Codex 對照)
- 會員等級/價格**必 server 端重查**;client component 不得 import 經銷價;經銷價絕不傳一般會員瀏覽器。
- 金額用整數(分)或 Decimal、禁 float。
- 敏感資訊只在 .env.local;migration 寫 prod = Sean 手動 SQL。
- RLS/schema 改動先交易模擬(BEGIN→模擬→驗→ROLLBACK)+ 零留痕;view 無寫、以 SELECT 復現驗證。
- provenance 鐵律:products.fitments 原始值不覆蓋(退貨/保固/爭議追溯原廠明示 vs 家族推導)。
