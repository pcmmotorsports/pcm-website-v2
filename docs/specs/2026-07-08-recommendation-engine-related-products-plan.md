# 商品推薦引擎(通用)+ 商品頁 N°03 相關商品改造 — 正式 plan(草案 v0.3)

> 產出:2026-07-08 Claude Code session(dev)。**鐵則 8 重大改動(schema/migration + 共用元件 + 跨層)+ 鐵則 12(migration/schema)→ 先提 plan 等 Sean 批、動 schema 必 codex 審、Sean db push。**
> **v0.3 = 折入 codex 關卡1 round2(gpt-5.5、唯讀零留痕)7 must-fix + 2 nit**(修法均先派偵察兵對 repo 查證、非憑假設):
> ① trigger `WHEN(TG_OP...)` 非法 → 拆 **AFTER INSERT** + **AFTER UPDATE OF fitments WHEN(OLD DISTINCT)** 兩個 trigger。
> ② 🔴 **車輛反查斷點**:URL `?vehicle=` 存的是 taxonomy 去重後 slug id(含碰撞序號 `-2`),裸 `slugify(motoBrand)` 比不回去 → server 端用**同一份 taxonomy** 把 slug 解回**原始車廠名**(複用 `parseVehicleFromUrl` 邏輯),product_fitments 存**原始 motoBrand/modelCode 名**、用名字 join。
> ③ **UI product 無車輛/品牌 uuid**(只有商品品牌 `brandSlug`)→ 引擎改吃 **domain `Product`**(有 `brand.id`),輸出才 strip 成 `UIProduct`。
> ④ 🔴 **下架洩漏**:`products_public` 靠底層 RLS 藏下架(非 view WHERE)→ 新表 product_fitments **啟用 RLS + 照抄 `product_variants_public` policy**(`EXISTS products WHERE delisted_at IS NULL`),不裸 GRANT 原表。
> ⑤ **hasMore** 不可 per-source `limit+1`(去重/排自身後會誤判)→ **最終候選流組完、去重、排自身後**才取 `limit+1` 判斷。
> ⑥ **通用款** `fitments IS NULL` 是死條件(欄 NOT NULL DEFAULT '[]')+ jsonb_array_length 遇髒 abort → 改 `NOT EXISTS product_fitments`(不碰 jsonb)。
> ⑦ **R1/R2 過大(鐵則 4)** → 拆 R1a(建表+RLS+trigger+backfill)/ R1b(db push 後驗證)/ R2a(repository 方法)/ R2b(引擎+測)/ R3(前端)。
> nit⑧ domain 無 `formatYears`(是元件 local)→ 年份數值比對用 domain `resolveEnd`;nit⑨ `ix_pf_year` 走不走 index 由 R1b `EXPLAIN` 實測、備援 partial index/int4range+GiST。
> 觸發:Sean 商品頁肉眼驗 N°03「相關商品」用「同分類」推薦怪。Sean 拍:改「同車型適用(跨品牌)」+ 左右滑小卡 + 參考業界成熟做法不自己發明 + 配合未來 AI + **可重用引擎**(沿用會員/購物車/首頁 + 帳號/車庫/搜尋紀錄)。
> 三路研究報告(有來源)存 scratchpad;偵察查證結論見各節 🔎。

---

## 0. Sean 拍板彙整(2026-07-08、收尾對帳用)

- **演算法(q1:a)**:情境感知分層——
  - **Case A 有選車(URL `?vehicle=`)** → 推薦「**選定的那台車**能裝的其他部品」(fitment 反查、跨品牌)。排序:先同分類×同車 3-4 → 再不同品牌×同車 亂數 → 湊滿。不足 → 同分類 → 通用款。
  - **Case B 沒選車(直接點商品)** → 以「商品同品牌」推薦。排序:先同品牌×同分類 3-4 → 再不同品牌 亂數 → 湊滿。不足 → 同分類 → 通用款。
- **Q1=A** 單一橫滑區(兩區 Baymard 列 future)。**Q2=A** 上限 **8** + 超過收「查看全部相容」。
- **規模**:現 **3,311**、將 **>4 萬** → fitment **正規化表現在做**(非 defer)。
- **通用引擎**:抽引擎吃「情境 + 用途」回「排序清單」;Phase 1 只實作 pdp 策略,介面為未來(會員/購物車/首頁 + 帳號/車庫/搜尋紀錄/AI)預留。
- **codex 兩輪 + Sean 拍板(2026-07-08)**:round1 折 10、round2 折 7;Sean 選「補好直接開工、每片實作 diff 走 codex 關卡2、不再跑 plan-codex」。

---

## 1. 研究背書(不自己發明)

- 規則式 content-based = 無行為資料小站的標準冷啟動解(協同過濾需 1,000+ 互動/25+ 使用者、高品質 50,000 筆,AWS Personalize `docs.aws.amazon.com/personalize/latest/dg/interactions-datasets.html`)。
- 抽層 = 未來換 AI 的關鍵(Google Cloud 生成式推薦架構=推薦邏輯獨立 service、前端只拿清單 `docs.cloud.google.com/architecture/genai-product-recommendations`)。
- 40k → 必須正規化 fitment(jsonb 讓 planner 低估筆數 12 萬倍、慢 2000 倍,Heap `heap.io/blog/when-to-avoid-jsonb-in-a-postgresql-schema`;業界 ACES/VCdb 正規化 `apaengineering.com/technology-article/aces-and-pies-for-beginners/`)。
- 年份區間查詢 jsonb 做不到,需正規化 + btree/`int4range`(Postgres `postgresql.org/docs/current/rangetypes.html`)。
- 相關商品 UX / carousel:Baymard `baymard.com/blog/product-page-suggestions` + `/homepage-carousel`、NN/g `nngroup.com/articles/mobile-carousels`(不自動輪播、半露暗示可滑、≤5-8、scroll-snap)。
- Fits-your-vehicle/Garage 標準(Amazon Garage、eBay Guaranteed Fit)→ 未來登入車庫情境有範式。pgvector 現不需要(精確 fitment 是結構化配對非語意相似;Supabase `supabase.com/docs/guides/ai/vector-columns`)。

---

## 2. 架構:通用推薦引擎(port + rule-based adapter)

> 🔎 偵察查證:UI product(`toUIProduct`/`MockProduct`,`lib/products.ts:107` `mock-products.ts:79`)**只有商品品牌 `brand`/`brandSlug`(如 'rpm-carbon')、無任何 uuid**,且與「車輛廠牌 motoBrand」是不同命名空間(`domain/src/catalog/types.ts:97`)。故引擎**吃 domain `Product`**(`mapSupabaseProductToDomain` 產出、含 `brand.id` uuid + `brand.slug` + `category` + `handle` + `fitments`),輸出時才 strip 成 client 安全的 `UIProduct`。

```ts
type VehicleSelection = { motoBrand: string; modelCode: string; year?: number }; // 🔴 原始車廠/車型「名稱」(已由 URL slug 經 taxonomy 解回)、非 slug、非 uuid
type RecommendationContext = {
  product?: Product;              // 🔴 domain Product(含 brand.id;非 stripped UIProduct)——Case B 用 product.brand.id
  vehicle?: VehicleSelection;     // 🔴 選定車輛(現=URL ?vehicle 解析;未來=登入車庫);Case A 用「這個」反查、非商品自身 fitment
  excludeHandles?: string[];      // 至少排自身
  // future: userId? / savedVehicles? / searchHistory? / cartItems?
};
type RecommendationPlacement = 'pdp-related' | 'cart-addon' | 'member-center' | 'home-editorial'; // Phase 1 只 pdp-related
type RecommendationRequest = { placement: RecommendationPlacement; context: RecommendationContext; limit: number };
type RecommendedProduct = { product: UIProduct; score: number; reason: string }; // 🔴 輸出 UIProduct(client 安全);reason=內部除錯/未來可解釋性(非顧客可見、不受內容分級)
type RecommendationResult = { items: RecommendedProduct[]; hasMore: boolean };  // 🔴 hasMore 供前端決定「查看全部」

interface IRecommendationEngine { recommend(req: RecommendationRequest): Promise<RecommendationResult>; }
```
- **🔴 hasMore 正確實作(codex #5)**:引擎先把各 tier 候選**組成最終有序流 → 去重(union by handle)→ 排自身/excludeHandles** → 再取前 `limit+1` 判斷:`hasMore = 去重後有序候選數 > limit`、`items = 前 limit`。**絕不 per-source 先 `limit+1`**(會被 duplicate/self 裁掉造成誤判)。各來源查詢設合理上界(如 `limit*3`)控成本、hasMore 由組裝後計算。
- **Phase 1**:`RuleBasedRecommendationEngine` 實作 `pdp-related`(Case A/B);其餘 placement 回 `{items:[],hasMore:false}`(明標 not-implemented、不 throw)。
- **落點**:storefront 資料層 `lib/recommendations/`(對齊研究 data-layer + 現有 unstable_cache 位置);查詢經 `IProductRepository`,不在前端元件內嵌演算法。
- **未來換 AI**:新增 `VectorRecommendationEngine`/`HybridEngine` adapter,消費者零改動。
- **經銷價安全(不變)**:引擎回 product → 一律經 `products_public`(物理排除 price_store/price_by_tier/metadata)+ `toUIProduct(p,'general')` strip;新查詢方法沿用、review 硬釘;金額整數(禁浮點)。

---

## 3. DB:正規化 fitment 索引表(codex round1+2 全折)

> 🔎 偵察查證:`products.fitments` = `jsonb NOT NULL DEFAULT '[]'`(`migrations/20260507004826_init_products.sql:31`);元素為 domain `FitmentSpec` 形狀(`domain/src/catalog/types.ts:108`:camelCase `motoBrand`/`modelCode`/`yearStart?`/`yearEnd?:number|null`),mapper 直送不轉換(`mappers/product.ts:191` `fitments: row.fitments`)→ trigger unnest 讀 **camelCase** key。`products_public` 無 delisted 過濾、靠底層 RLS `products_select_public USING(delisted_at IS NULL)`(`20260602135934_...:61`);`product_variants_public` 有自己的 RLS `product_variants_select_public`(`:67`,`EXISTS products WHERE delisted_at IS NULL`)= **本表照抄範式**。

```sql
-- product_id uuid(對齊 products.id uuid);一列一相容;moto_brand/model_code 存 domain FitmentSpec 原始名(非 slug)
CREATE TABLE product_fitments (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  moto_brand   text NOT NULL,   -- 原始車廠名(如 'Yamaha'),對齊 FitmentSpec.motoBrand
  model_code   text NOT NULL,   -- 原始車型碼,對齊 FitmentSpec.modelCode
  year_start   int,             -- NULL=無年份資料
  year_end     int              -- 見下「四態」
);
CREATE INDEX ix_pf_brand_model ON product_fitments (moto_brand, model_code);
CREATE INDEX ix_pf_product     ON product_fitments (product_id);
CREATE INDEX ix_pf_year        ON product_fitments (moto_brand, model_code, year_start, year_end);  -- nit⑨:R1b EXPLAIN 實測、退化則改 partial/GiST

-- 🔴 codex #4:不裸 GRANT。啟用 RLS + 照抄 product_variants_public delisted gate
ALTER TABLE product_fitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY product_fitments_select_public ON product_fitments FOR SELECT
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_fitments.product_id AND p.delisted_at IS NULL));
GRANT SELECT ON product_fitments TO anon, authenticated;   -- 只讀、且被上方 RLS 閘住;不 GRANT 寫;service_role 走預設(RLS bypass)寫入
```
**年份四態(對齊 domain `FitmentSpec.yearStart/yearEnd` + `resolveEnd`,非元件 local `formatYears`)**:
| 語意 | year_start | year_end |
|---|---|---|
| 無年份 | NULL | NULL |
| 單年 Y | Y | Y |
| 區間 A–B | A | B |
| 開放式 Y+ | Y | NULL |

查某年份 Y 適用:`(year_start IS NULL) OR (year_start <= Y AND (year_end IS NULL OR year_end >= Y))`(無年份=通吃、開放式=Y 以後全中)。

**🔴 同步 trigger(codex #1:拆兩個 + fail-closed + 防 churn)**:
- 一個 trigger function `sync_product_fitments()`,兩個 trigger 綁定:
  - `CREATE TRIGGER trg_pf_sync_ins AFTER INSERT ON products FOR EACH ROW EXECUTE FUNCTION sync_product_fitments();`(INSERT 無 `OLD`、不加 WHEN、必同步)
  - `CREATE TRIGGER trg_pf_sync_upd AFTER UPDATE OF fitments ON products FOR EACH ROW WHEN (OLD.fitments IS DISTINCT FROM NEW.fitments) EXECUTE FUNCTION sync_product_fitments();`(fitments 沒變不觸發 → 每日 40k upsert 不 churn)
- function body:`DELETE FROM product_fitments WHERE product_id = NEW.id` → 從 `NEW.fitments` **防禦性** unnest 寫入:`jsonb_typeof(NEW.fitments) <> 'array'` → 0 列;逐元素僅在 `motoBrand`、`modelCode` 均為非空字串才成列;年份**防禦解析**(元素 `yearStart`/`yearEnd`:jsonb number 直取、字串則恰 4 位數字才取、否則 NULL,語意對齊 `resolveEnd`);單一髒元素**跳過不 abort**(絕不讓 products upsert 整批 rollback)。
- **回填**:migration 內從現有 products.fitments 一次性 backfill(同 unnest+防禦邏輯);跑後查 `count(product_fitments)` 對照。

**驗證(R1a/R1b)**:DDL 交易模擬 BEGIN→建表+RLS+trigger+backfill→改一商品 fitments 驗表同步 + 髒 jsonb 不 abort + 反查筆數→ROLLBACK 零留痕;db push 後 `EXPLAIN ANALYZE` 反查走 index(nit⑨)、RLS 唯讀 MCP 驗 anon 讀得到上架 fitment、讀不到「下架商品」fitment、讀不到經銷價。**鐵則 12 → Codex Packet + Sean db push。**

---

## 4. 演算法(RuleBasedRecommendationEngine;codex round1+2 全折)

**判斷情境**:`context.vehicle` 有值?(URL `?vehicle=` 解析 或未來車庫)
- **Case A(有車)**:🔴 池 = **反查 `context.vehicle`**(不是商品自身 fitment)——`listByVehicle({motoBrand, modelCode, year})` 查 product_fitments(**用原始名比對** `moto_brand`/`model_code`;有年份則套四態年份條件)→ 得 product_ids → join products_public(RLS 自動排下架)→ 排自身。
  1. 同分類 × 同車 3-4(score 高)
  2. 不同品牌 × 同車 亂數(score 中)
  3. 不足 → `listByCategory`(同分類不限車)→ **通用款**(見下)
- **Case B(沒車)**:🔴 池 = `listByBrand(context.product.brand.id)`(**用 domain `Product.brand.id` uuid**;偵察確認 UI product 無此欄、故引擎吃 domain Product)、排自身。R2a 確認既有 `listByBrand` 簽章(brand_id uuid);若只有 slug 版則新增 id 版或先 slug→id。
  1. 同品牌 × 同分類 3-4
  2. 不同品牌 亂數(同分類優先)
  3. 不足 → 同分類 → 通用款
- **🔴 通用款 fallback(codex #6 + Sean 2026-07-08 逐筆判斷)**:新 repository 方法 `listGeneral()` 查 `products_public WHERE fitments = '[]'`(真空 fitment = 設計上不綁車型的通用款);排自身/上限由引擎處理。⚠️ **R2a 落地改此語意**(取代原 `NOT EXISTS product_fitments`):兩者差 9 筆「fitments 非空但元素全髒(Honda 品牌/車型空白)」的 gbracing 商品,Sean 逐筆判斷實為 HONDA MOTO3 賽車專用 + 替換件、**非萬用**,故 `fitments='[]'` 排除更準;兩者皆滿足 codex #6 免 dead-predicate/abort(jsonb 等值非 array_length)。🔴 R3 整合實測 PostgREST jsonb 空陣列查法。最後補位。
- 去重(union by handle)、排自身/excludeHandles、cap=limit(8);每筆附 `reason`(`same-vehicle-same-category`/`same-vehicle-other-brand`/`same-brand`/`fallback-category`/`general`,內部用)。
- **🔴 決定性亂數(禁 Math.random)**:seed = `placement + product.handle + vehicleKey`(vehicleKey=`motoBrand:modelCode:year`,無車則空);tie-break handle 升冪 → SSR 兩次 render 一致、不同情境不同序。
- **邊界(codex #5 相關)**:選定車輛無任何相容品 → 走 fallback tier;通用款也空 → 回 `{items:[],hasMore:false}`(不 throw、前端顯空或不顯區塊)。

---

## 5. 前端:N°03 相關商品橫滑區(Q1=A/Q2=A)

> 🔎 偵察查證:URL `?vehicle=brandId:modelId:year`,`parseVehicleFromUrl`(`products-url-state.tsx:36`)用 taxonomy 陣列把 slug 解回**原始名**(`brandObj.name`/`modelObj.name`)。taxonomy 由 `buildVehicleTaxonomy`(`vehicle-taxonomy.ts:54`)從全站 fitments 動態衍生。

- **🔴 車輛解析(codex #2)**:route(server)讀 `searchParams.vehicle` → 用**同一份 taxonomy** 把 slug 解回 `{motoBrand 原始名, modelCode 原始名, year}`(複用 `parseVehicleFromUrl` 邏輯,**禁裸 `slugify` 現算比對**——碰撞序號只有 taxonomy 建構當下知道)→ 組 `context.vehicle`。R3 確認 taxonomy 於 server 端可取得(既有 products 列表頁已建、查快取來源;若每請求重建過重 → R3 決策點 raise)。
- `.pd-related-grid`(現 `grid repeat(4,1fr)`)→ **橫向 scroll-snap 清單**(`display:flex;overflow-x:auto;scroll-snap-type:x mandatory`;子項 `flex:0 0 <寬>`;桌機露 ~4-5、手機露 ~2.5-3 半露邊緣暗示可滑);**不自動輪播**;桌機左右箭頭(可選);手機純滑(像逛目錄)。
- 卡片複用 `ProductCard`(既有 `compact`;小卡可覆寫圖比例);要素=圖+標題+價(+適用車 fits)。
- 🔴 **上限 8 + 「查看全部相容商品」由引擎回傳 `hasMore` 決定顯示**(hasMore=true 才顯)、連到對應篩選(`/products?vehicle=...` 或 `?brand=...`)。
- **資料流**:route `app/products/[slug]/page.tsx` 讀 `searchParams.vehicle` + 解析 → 組 `RecommendationContext{product:<domain Product>, vehicle, excludeHandles:[slug]}` → `engine.recommend({placement:'pdp-related', context, limit:8})` → 傳 ProductPage(`related`:UIProduct[] + `relatedHasMore`)。SSR、經銷價 server strip。
- **🔴 情境化標題(codex 內容分級)= L1**(UI 文案、年 0-1 變,hardcode 可、明標 L1;非後台 CRUD):有車=「這台車也適用」/ 沒車=「同款推薦」(字面 Sean 可調)。`reason` 為內部字串、非顧客可見、不受分級。未來若要頻繁改推薦文案/多 placement 共用 → 屆時升 L2 後台化(列 future)。

---

## 6. Slice 拆分(codex #7:R1/R2 各再拆;每片三綠 + code-reviewer;動 schema 片加 codex 關卡2 + Sean db push)

- **R1a — DB migration(建表)**:一個 migration = CREATE TABLE(uuid FK)+ 3 索引 + ENABLE RLS + `product_fitments_select_public` policy(delisted gate)+ GRANT SELECT anon/authenticated + `sync_product_fitments()` function + INSERT/UPDATE 雙 trigger + 一次性 backfill。**DDL 交易模擬零留痕**(建表+trigger+backfill+改一商品驗同步+髒 jsonb 不 abort+反查筆數)。**鐵則 12 → Codex Packet(commit 前)→ codex 關卡2 → commit → 不 push、Sean db push。**
- **R1b — db push 後驗證**:Sean db push 後,`generate_typescript_types`(database.types)+ `EXPLAIN ANALYZE` 反查走 index(nit⑨、退化改 partial/GiST)+ 唯讀 MCP 行為驗(anon 讀上架 fitment ✓ / 讀不到下架 fitment ✓ / 讀不到經銷價 ✓)。純驗證+types,無 schema 變更。
- **R2a — repository 查詢方法 ✅**:ports `IProductRepository` 加 `listGeneral`;**repoint 既有 `listByFitment`**(取代原規劃新增 listByVehicle——repo 早有此方法且 prod 無 caller、走慢 jsonb;改接 product_fitments 正規化索引、複製 matchFitmentYear 語意、正規化天生消跨車型 false-positive),`listByBrand(brandId uuid)` 已存無需動 → Supabase adapter(查詢抽 `helpers/fitment-queries.ts`、經銷價 strip)+ InMemory + contract 測。R2b Case A 改呼叫 `listByFitment({motoBrand,modelCode,year})`。
- **R2b — 推薦引擎**:`IRecommendationEngine`/`RecommendationResult`/`VehicleSelection` 介面 + `RuleBasedRecommendationEngine`(Case A/B 分層 + 通用款 fallback + 決定性 seed + hasMore 後組裝判斷)+ 單體測(各分層/fallback/去重/排自身/決定性/經銷價 strip/hasMore 正確/空 vehicle/空結果不 throw)。
- **R3 — 前端 N°03 橫滑區**:route 讀 vehicle + **taxonomy 解 slug→原始名** + 接引擎 + `.pd-related`→carousel CSS + ProductCard compact + 「查看全部」(hasMore)+ 情境化標題(L1)+ ProductPage.test 更新(順序斷言沿用 S3、related 改吃引擎、hasMore 顯隱)。Sean 肉眼驗手機橫滑。

> 前後端同步(鐵則 3):R1a/R1b 後端管線先立、R2a/R2b 資料層、R3 前台顯示。零金流、flag 不動。

## 7. 影響面 / Blast radius
- 動:新 migration(product_fitments + RLS + 雙 trigger + backfill + GRANT)、`packages/ports`(IRecommendationEngine + repository 新方法)、`packages/adapters`(Supabase 查詢 + InMemory + contract)、storefront `lib/recommendations/`、`app/products/[slug]/page.tsx`(vehicle 解析 + 接引擎)、`ProductPage.tsx`(related 來源 + N°03 markup)、`product-page.css`(carousel)、`ProductCard`(compact 小卡)、測試多檔、database.types。server 端會用到 vehicle taxonomy(既有,R3 確認取得成本)。
- 不動:商品頁 fitment 顯示(ProductFitments 讀 jsonb)、匯入管線(trigger 自動同步、`WHEN DISTINCT` 不 churn)、金流/經銷價防護面、S1-S3 已完成重構、`products.fitments` jsonb(維持單一真相、product_fitments 是衍生索引)。
- **跨 schema + 跨層 + 共用元件 = 鐵則 8;migration/RLS/trigger/GRANT = 鐵則 12。**

## 8. Rollback
- R1a 可逆(DROP TABLE CASCADE + DROP FUNCTION;jsonb 單一真相不受影響)。R1b 純驗證。R2a/R2b/R3 純加法,revert commit 回舊 `fetchRelatedProducts`。flag 全程無金流。

## 9. Future roadmap(介面已預留、現在不做)
- 其他 placement:`cart-addon`(互補加購)、`member-center`(車庫+搜尋紀錄個人化)、`home-editorial`。
- 車庫(Garage):登入存車 → context.vehicle 來源由 URL 擴為帳號(Amazon/eBay 範式)。
- AI 升級觸發:語意搜尋痛點→pgvector;行為資料到 AWS 門檻→協同過濾/hybrid(換 adapter);對話導購→另開 PRD(鐵則 9 L2/L3)。
- Baymard 兩區(同類替代+互補加購);推薦文案 L2 後台化;product_fitments 年份查升 int4range+GiST(nit⑨、現複合 btree 由 R1b 實測)。
- vehicle taxonomy server 端若重建過重 → 快取層或物化 brand/model 對照表。

## 10. 施工序(Sean 已批 v0.3、每片實作 diff 走 codex 關卡2)
R1a(建表 migration → DDL sim → Codex Packet → codex 關卡2 → commit → Sean db push)→ R1b(db push 後 types+EXPLAIN+RLS 驗)→ R2a(repository)→ R2b(引擎)→ R3(前端、Sean 肉眼驗)。每片三綠 + code-reviewer;R1a 額外 Codex Packet + Sean db push。
