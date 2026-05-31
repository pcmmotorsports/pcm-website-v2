# M-1-16 RPM Carbon 快照上架 — 執行 handoff

> 產出:2026-05-31 / pcm-website-v2 session(規劃+跨專案研究)
> 來源:① 本 session 4-agent workflow 研究(商城側) ② pcm-quote-v2 familiar session 的來源側 handoff ③ 雙 Supabase 直查求證
> 對象:新開的乾淨執行 session(自驅 + codex/code-reviewer 把關、照 CLAUDE.md SOP)
> Sean 已批 plan(2026-05-31)。變體走 **A 真變體(落地 backlog #81)**。

---

## 0. 一句話

把 pcm-quote-v2 的 RPM Carbon(**933 商品 / 7277 變體**)**唯讀讀 → 轉換 → 複製寫進** pcm-website-v2 自己的 products + 新建 product_variants 表;商城讀自己的 DB(解耦、安全、快照)。**非 live 引用、絕不 runtime 依賴來源。**

兩個 Supabase project id:
- **來源(唯讀)** pcm-quote-v2 = `dllwkkfanaebrsuyuedy`
- **目標(寫)** pcm-website-v2 = `bmpnplmnldofgaohnaok`

---

## 1. 🔴 三條紅線(來源 session 釘 + 商城側補)

1. **內部價絕不對外**:`price_store`(經銷/車行)、`price_cost`(成本)、`price_source_amount`(供應商原幣進價、RPM=USD)、`price_shopee`(蝦皮通路價)= **內部/他通路、絕不可進一般客瀏覽器**。商城只對外 `price_listing`(零售牌價)。經銷價走商城既有三層防護(見 §4)。
2. **分群用 `main_sku`、不用 product_name、不用原始 sku**:讀來源 `product_groups_mv`(一列=一群=一張卡)。product_name 會撞名、原始 sku 是變體層。
3. **車款(model)還會變 → join key 一律用 `sku`、不用 model**:來源字典會做「終局 re-parse」重寫 model canonical。

---

## 2. 來源資料事實(pcm-quote-v2、實查求證)

### 2.1 分群:讀 `product_groups_mv`(933 RPM 群)
- `product_groups_mv` = `product_groups_v` 的物化檢視、**每 10 分鐘 refresh**。一列 = 一個 main_sku = 一張商品卡。
- **全欄位**:`main_sku / variant_count / product_name / price_store_min~max / price_source_min~max / image_url / all_models / vehicles(jsonb) / group_year_start~end / any_in_stock`(注意:MV 露的是 store/source 區間 = 內部、別對外;對外 listing 價要下到 products 撈)。
- **main_sku 完整 CASE 規則**(來源 session 給、port 同規則):
  ```
  materya 且 sku ~ '^MTY[0-9]+'  → substring(sku, '^(MTY[0-9]+)')
  sku ~* '-(g|m)-'               → upper(regexp_replace(sku, '-(g|m)-.*$', ''))   ← RPM 走這條
  eazigrip 顏色/CL/BL 結尾        → 砍掉
  其餘                            → sku 原樣
  ```
  例:`SUHAY-53-G-T` → main_sku `SUHAY-53`。`-G-`/`-M-` 後段 = RPM 的「光澤/紋路」變體軸(gloss/matte × 3K/12K weave)。
- **變體成員**:拿到 main_sku 後,下到 `products` 表套**同一條 main_sku CASE** 撈同群所有 sku(=變體)。
- ⚠️ `BMS1K2K-04` vs `BMS1K2K303`:main_sku 不同 = **不同商品**(各 12 變體),只是 product_name 剛好同名(都叫「BMW S1000RR…Rear Seat Cover Cowl」);`BMS1K2KR03` 又是另一群(S1000R/M1000R、不同車)。**確認:不要用 product_name 合併它們。**

### 2.2 欄位語義(`products` 表)
| 欄位 | 語義 | 對外? |
|---|---|---|
| `price_listing` | 零售牌價(給一般客)| ✅ 對外 → 商城 general |
| `price_store` | 經銷/車行價 | 🔴 內部 → 商城 store(防護擋住、不到 client)|
| `price_shopee` | 蝦皮通路價 | 🔴 對商城客不顯(進 metadata)|
| `price_cost` | 成本 | 🔴 內部(進 metadata、不外露)|
| `price_source_amount`(+currency) | 供應商原幣進價(RPM=USD)| 🔴 內部 |
| `product_name` / `product_name_zh` | 英文名 / **中文名(RPM 全 null)** | title |
| `category` / `category_zh` | `Carbon Fiber Fairing` / **全空** | → 給「碳纖維部品」|
| `fitment_parsed`(jsonb) | 適用車款 `[{brand,model,year_str,year_start,year_end,unconfirmed,...}]` | → fitments |
| `images`(jsonb `[{url}]`) / `image_url` | 圖 | images |
| `stock_status` | RPM 只 `out`(5274)/`in_stock`(2003)| availability |
| `raw_jsonb->'spec'` | `{weave,finish,special}` 變體規格 | → variant spec |
| `manually_corrected` | RPM 813 筆 = 人工鎖死權威值(穩) | — |

四個台幣價都是 `pricing_rules` 公式衍生值。**RPM 現 7277/7277 全已定價(2026-05-31 重算)。**

### 2.3 不穩定度(決定「快照」策略)
| 資料 | 穩定度 | 處置 |
|---|---|---|
| sku / 英文名 / 圖 / category | ✅ 穩 | 可快照 |
| 價格 | 🟡 半穩 | **每週重抓一次、看 `last_synced_at` 當新鮮度**(每日自動同步剛從停擺救回、節奏未穩)|
| **fitment** | 🔴 **最不穩** | RPM fitment_parsed ~20,265 entries:~19% `unconfirmed=true`(自動展開世代變體、Sean 未審、暫定)、~14% `year_start=null`(年份開放/未知);**字典重構會做「終局 re-parse」重寫 model canonical** → **用 sku join 不用 model、unconfirmed 先過濾/標記、manually_corrected=true(RPM 813)是 Sean 鎖死權威穩值別覆寫;預期 re-parse 後要再同步一次 fitment** |
| **中文商品名** | ❌ **現在拿不到** | `product_name_zh` RPM 全空(翻譯正在 port、還沒灌)→ 第一波 title 留英文 / 機翻佔位、zh 待來源補 |

### 2.4 邊角
- `12K`(`spec.special='12K'`、64 筆)= **碳纖維紋路變體**(非獨立商品)、價較高、保留 special 維度。
- 265 筆缺主圖(`image_url` null、變體層)→ 但 MV 群層 `image_url` 取群內第一張非空 → **「群」通常仍有圖**(某變體有圖即可);商品層用 **群層 image_url**、變體層用變體 `images` jsonb、真的全空才 placeholder。category 很粗(單一值)、真正部件細分在 product_name 不在 category。
- RLS:**來源 DB RLS 未開、用 service key 唯讀、絕不寫來源 DB**。

---

## 3. 目標資料事實(pcm-website-v2、實查求證)

### 3.1 現況 schema
- `products`(14+2 欄、扁平單 SKU、**無變體表**):`external_id! / title! / subtitle / description / handle!(UNIQUE) / price_by_tier jsonb!(CHECK ?general AND ?store) / fitments jsonb! / images jsonb! / availability!(in-stock|out-of-stock) / brand_id uuid! FK / category_id uuid! FK / metadata jsonb! / price_general int / price_store int`。
- `brands`(8 欄、含 **`premium_extra_pct`** = 高級店家品牌%、Sean 早留好):`name!(UNIQUE) / slug!(UNIQUE) / description / logo_url / premium_extra_pct`。
- `categories`(8 欄、巢狀):`name! / raw_path!(UNIQUE) / segments jsonb! / sort_order / parent_category_id`。
- **三表現皆 0 筆**(跑 mock)。**無任何 seed migration(greenfield)。**

### 3.2 🔴 關鍵對映修正(多 agent 交叉抓到、一定要對)
**商城 `brands` 表 = 「零件品牌」(RPM CARBON / Akrapovic / Brembo…),不是車廠!**
- RPM 全部 933 商品的 `brand_id` = **RPM CARBON(固定一個零件品牌)**。
- 車廠(Ducati / BMW / Yamaha…)是 **fitments 的 `motoBrand`**(適配車款維度),**不進 brands 表**。
- 來源 `products.brand` 欄是「車廠」→ 對映時進 **fitment.motoBrand**,不是 brand_id。
- seed brands 真權威 = `design-reference/data/products.js`(14 個零件品牌、含 `rpm-carbon` / RPM CARBON / `premium_extra_pct:6`);**注意 design products[] 另引用 5 個不在 14 清單的品牌(RIZOMA/AKRAPOVIČ/BREMBO/ÖHLINS/TERMIGNONI)**,seed 時要涵蓋(避免之後撞 FK)。

### 3.3 經銷價防護(現有三層、變體層必須鏡像)
1. base `products` 表 `REVOKE ALL FROM anon,authenticated` 後只 column-GRANT 14 公開欄,`price_by_tier`/`price_store`/`metadata` **不 GRANT**(`20260519031049`)。
2. `products_public` view(`security_invoker=true`)只投射公開 14 欄(含 `price_general`、排除 `price_store`/`price_by_tier`)。
3. adapter 只 select view;mapper 把 store/premiumStore 填 dummy;`toUIProduct` 用 `computeEffectivePrice(p,tier)` strip 成單一 `price:number`,`priceByTier` 整包不進 client bundle(`lib/products.ts` + `tier.ts` 有 `server-only` + `typeof window` 雙護欄)。

### 3.4 切換 seam(已半通)
- **首頁精選/會員推薦已讀真 Supabase**(`fetchFeaturedProducts→listByCategory`),現 0 筆走空狀態 → **16b 一灌真資料、首頁自動冒真商品、不用改 code**。
- 仍讀 mock 的 production 頁(16c 工作面、5 個消費點):`ProductsPage.tsx`(列表)、`app/products/[slug]/page.tsx`(詳情)、`BrandIndex.tsx`、`VehicleFinder.tsx`、+ categories。
- **詳情頁缺 by-slug 查詢**:port/adapter 只有 `findById`、route 用 `[slug]`(=handle)→ 16c 要加 `findByHandle(handle)`(仿 findById、`.eq('handle',h)`)。

---

## 4. 四片 slice(六件套精神、執行 session 各自展開)

### 16a — 變體 schema(#81 落地、動 schema = 鐵則 8+12、先提 plan 等 Sean)
**做什麼:**
- 新 migration `supabase/migrations/<ts>_init_product_variants.sql`(走 `supabase db push`、**勿用 MCP apply_migration**、見 memory migration 漂移)。
- **`product_variants` 表**(獨立表、**不用 products.variants jsonb** —— jsonb 沒法 column-level 遮經銷價那一欄、防護會破):
  ```
  id uuid PK / product_id uuid! FK→products ON DELETE CASCADE / sku text!(UNIQUE)
  spec jsonb! default '{}'   -- 自由 key-value 可擴 N 層,RPM={weave,finish,special}
  price_general int / price_store int / price_by_tier jsonb   -- 鏡像 products 雙價拆法
  availability text! CHECK in('in-stock','out-of-stock')
  images jsonb! default '[]' / sort_order int! default 0 / metadata jsonb! default '{}'
  created_at/updated_at
  CONSTRAINT pv_spec_unique UNIQUE(product_id, spec)
  + CHECK price_general/price_store >= 0
  index: (product_id) / (availability) where in-stock
  ```
- **三層經銷價防護(鏡像 products、缺一即洩)**:① base REVOKE ALL→column-GRANT 公開欄(`price_store`/`price_by_tier`/`metadata` 不 GRANT) ② `product_variants_public` view(security_invoker、排除 price_store/price_by_tier/metadata) ③ RLS 4 policy(SELECT public / 寫 service_role)。
- **domain**:`packages/domain/src/catalog/types.ts` 把推延的 `variants` 補上 + 定 `ProductVariant`(sku / spec Record<string,string> / priceByTier / availability / images[] / sortOrder)。
- **adapter**:`SupabaseProductAdapter` `PRODUCT_SELECT_DETAIL` embed `product_variants_public(...)`(不含 price_store);mapper 加 `mapVariantRow`(price_general→priceByTier.general、store/premiumStore placeholder);`save` 變體獨立 upsert(onConflict sku、service_role 雙寫 general+store)。
- **順手帶 backlog #172**:migration 加 `rls_auto_enable()` 納管 + `REVOKE EXECUTE ... FROM PUBLIC,anon,authenticated`(Q3=A 既有拍板、別漏)。
**驗收:** typecheck/lint;migration 在目標 DB apply 成功;variant public view 查不到 price_store;rollback SQL 寫在 migration 註解。
**rollback:** `DROP VIEW product_variants_public; DROP TABLE product_variants;`(無下游 FK、Order 整合在 M-3)。

### 16b — 匯入腳本(讀來源 → 轉換 → 寫目標)
**做什麼:**
- 一次性腳本(或 server-side script):用 Supabase MCP / service key **唯讀**讀來源 `product_groups_mv`(933 RPM 群)+ `products`(7277 變體)。
- **seed**:brands(design 14 零件品牌 + 補 5 個、含 RPM CARBON)、categories(碳纖維部品、grep design-reference 確認字面)。
- **商品層(933 列寫 `products`)**:`external_id='rpm-'||main_sku` / `handle='rpm-'||main_sku`(全小寫 kebab、UNIQUE)/ `title`=機翻佔位或英文(zh 待補)/ `brand_id`=**RPM CARBON** / `category_id`=碳纖維部品 / `price_general`=群最低 `price_listing`、`price_store`=對應最低、`price_by_tier`={general,store} / `availability`=群 bool_or(in_stock) / `fitments`=代表變體 `fitment_parsed` 轉 `{motoBrand←brand, modelCode←model, yearStart←year_start, yearEnd←year_end}` **去重 + 過濾/標記 unconfirmed** / `images`=群代表圖。
- **變體層(7277 列寫 `product_variants`)**:`sku`(原始、join key)/ `spec`=`raw_jsonb->'spec'` / `price_general/store`=變體各自 `price_listing/store` / `availability`=stock_status 映射 / `images`=變體圖 / `metadata`={shopee,cost}(不外露)。
- **內部價**:price_store/shopee/cost **絕不進 products_public、絕不到 client**。
**驗收:** 933 商品 + 7277 變體寫入;0 brand/category orphan(FK 全中);products_public 查不到 price_store;首頁精選自動顯真商品;肉眼抽查幾筆價/車款/圖。
**禁止:** 寫來源 DB;用 model 當 join;product_name 分群。

### 16c — 前台接真變體 + mock→真(5 消費點)
**做什麼:** port/adapter 加 `findByHandle`;`lib/products.ts` 加 `fetchProductByHandle(handle,tier)`;詳情頁 `[slug]/page.tsx` 換真;`ProductInfo` 的 hardcode COLOR_MAP/sizeOptions/colorOptions → 改吃真 `product.variants`(紋路 weave selector + 表面 finish selector、選了換 price/images/availability、`currentVariant` 比對 spec);`MockProduct`/`toUIProduct` 加 variants 欄、去 hardcode 補洞;`ProductsPage`/`BrandIndex`/`VehicleFinder` mock→真(複用 toUIProduct)。**經銷價防護:變體 price 也 server strip 成單一值、不送 priceByTier。**
**注意:** 列表頁 `/products` 是 client 全量 filter,改真資料牽涉 client→server 篩選搬遷、易破鐵則 4 → **建議拆獨立 slice、16c 先聚焦詳情頁 + featured(已通)**。MockProduct→真不是換型別、是補 variants + 去 hardcode(rename UIProduct 屬獨立 cleanup)。
**驗收:** 詳情頁顯真 RPM 商品 + 規格選擇器吃真變體 + 選了換價換圖;桌機+手機;經銷價不洩(grep client bundle 無 price_store)。

### 16d — 肉眼驗 + 每週同步
Sean 實機驗 RPM 上架(逛/選規格/價/圖/車款);排一個**每週重抓同步**機制(讀來源最新 → upsert 目標、看 last_synced_at)。

---

## 5. 待 Sean 拍板(執行 session 開工前一次性問清)
1. **中文商品名**:A 規則組字佔位+標 machine-translated(建議、便宜可逆、正式翻譯來源補)/ B 暫留英文 title、zh 留空 / C 926 標題上 LLM 批次翻。
2. **代表價/代表圖**:A 群最低價變體(建議)/ B 基準款 Plain-Glossy。
3. **變體圖 vs 商品圖**:建議 C 變體無圖 fallback 商品圖。
4. **list 頁真資料**:建議拆獨立 slice、不混 16c。
5. **變體 price_by_tier jsonb 要不要保留**:建議只存 price_general+price_store 兩整數欄(variants 新表、無歷史包袱)。

---

## 6. 前置 checklist(動 16a 前)
- [x] migration 漂移:**已解除**(2026-05-24 repair、線上 12 vs repo 12 零漂移)→ 不阻擋。(注:audit §二 stmt_count=1 數據已過時、現 61、別引用舊論據。)
- [ ] 16a migration 順手帶 #172 `rls_auto_enable` 納管 + REVOKE。
- [ ] seed brands 涵蓋 design 14 + 5 補(含 RPM CARBON);categories 字面 grep design-reference 確認。
- [ ] 確認 storefront 灌前讀 mock 安全(server-only 雙護欄已在)。

## 7. 連結
- 對映權威 SQL:`/Users/sean_1/API大量上架/PCM報價單-V2/docs/PCM-SCHEMA-ALIGN.md`(§6 view SQL:fitments transform B1 / images B2 / ROUND::int B6)
- 商城資料層:`apps/storefront/src/lib/products.ts`、`packages/adapters/src/supabase/SupabaseProductAdapter.ts` + `mappers/product.ts`、`packages/domain/src/catalog/types.ts`(#81 推延欄)
- 防護 pattern 源:`supabase/migrations/20260519031049_*` + `20260516072210_*` + `20260507012301_init_products_rls.sql`
- seed 真權威:`design-reference/data/products.js`
- 來源 session 補充:變體成員怎麼撈 / vehicles jsonb 結構 → 追問 pcm-quote-v2 session(它答得出來)
- memory:`project_m-1-16-rpm-import-plan` / `project_supabase-migration-version-drift`(已解除、可更新)

— END —
