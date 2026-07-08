# /products Server 端分頁 + 列表輕量投影(P4)— 正式 plan(草案 v0.2)

> 產出:2026-07-08 Claude Code session(dev)。**鐵則 8 重大改動 → 先提 plan 等 Sean 批准才動工。**
> v0.2 = 已折入 4-critic 對抗審查(8 must-fix):修 §2.2 欄位事實、新增 §3.1 正確性不變量 6 漂移點、D2/D4 修正、新增 D5-D7 決策、Slice 2/4 驗收強化。**關卡1 codex-adversary 待 Sean 選定執行後再跑。**
> 父 plan:`docs/specs/2026-07-08-storefront-perf-fix-plan.md` §P4(P1-P3 已上線 prod、P4 當初拍板「上線實測後另提」= 本檔)。backlog anchor:**#51**。
> 一句話:**現在 /products 一次撈全店 3,602 件(3.8MB)到瀏覽器,前端才篩選/排序/分頁;P4 把這四件事整組下推 DB,列表只回「當頁 + 輕量欄位」,順便恢復快取。**

---

## 1. 編號沿革(先講,避免混淆)

`docs/phase-1-backlog.md` #51 的**舊字面**是「JSDoc TODO 一致性」小項;但 code 內多處註解(`products.ts:256`、`SupabaseProductAdapter.ts:191`、`IProductRepository` 3 處 `@TODO #51`)已把 **#51 重新挪用**為「server 分頁/篩選」的錨點。本 plan 沿用此挪用義,並在 backlog 補一行澄清。

---

## 2. 現況(偵察查證、附 檔案:行號)

### 2.1 8 維篩選其實只有 4 維是活的
| 維度 | 位置 | 活/死 |
|---|---|---|
| 車輛 fitment | `products-filter-logic.ts:57-73` | 🟢 活(最複雜) |
| 分類 | `products-filter-logic.ts:86-91` | 🟢 活 |
| 品牌 | `products-filter-logic.ts:100-108` | 🟢 活 |
| 價格(標籤+滑桿) | `products-filter-logic.ts:115-122` | 🟢 活 |
| 現貨 inStock | `products-filter-logic.ts:111` | ⚪ UI 已隱藏(`filter-state.ts:31` `SHOW_IN_STOCK_FILTER=false`) |
| 新品 isNew | `products-filter-logic.ts:112` | 🔴 死路徑(`products.ts:134` general tier 恆 `false`) |
| 特價 isSale | `products-filter-logic.ts:113` | 🔴 死路徑(`products.ts:135` 恆 `false`) |
| 顏色 color | `products-filter-logic.ts:114` | 🔴 死路徑(`products.ts:138` 全 hardcode `'silver'`) |

排序 `sortProducts`(`:128-142`):只有 `price-asc`/`price-desc` 是真;`new`/`sale` 靠死旗標=恆無效;預設 `recommend`=id 序(等於 `.order('id')`)。
**結論:server 只需真下推 4 維篩選 + 2 種價格排序;死路徑不必接 server,可維持 no-op 或砍(見決策 D3)。**

### 2.2 資料層現況(為何 3.8MB、為何不能快取)
- `fetchCatalogProducts`(`lib/products.ts:260-274`)→ `adapter.listAllProducts()`(全量分頁撈到底)→ `toUIProduct(p,'general')`。
- `listAllProducts`(`SupabaseProductAdapter.ts:198-228`)走 `products_public` **detail view**(`PRODUCT_SELECT_DETAIL`,`:47-48`:15 扁平欄〔含 `description`/`highlights[]`/`images[]`/`fitments[]`〕+ brands/categories 2 join。⚠️ **list 路徑不含 variants**——變體 embed 只在 `PRODUCT_SELECT_DETAIL_WITH_VARIANTS`〔`:62`〕、僅 `findById`/`findByHandle` 用;list 商品的 `variants` 恆空陣列〔mapper `product.ts:200-204` 證實〕。products_public view 現為 16 欄=最新 migration `20260708120000` COMMENT〔審查更正:原寫 14 欄+variants 為過時/錯誤〕)。
- 3.8MB(實測 3,816,327 bytes)肥在:每商品仍是 detail 級 payload(`description`/`highlights`/`images`/`fitments` 全文字串 + brand/category join)× 3,602 件〔**非** variants 造成〕。**超過 Next data cache 單條 2MB → `unstable_cache` 寫入被拒**(`products.ts:252-259` 留證),P3 只能豁免 /products。

### 2.3 現成可複用(不必從零造)
- **輕量 view 已存在但沒接線**:`products_list_public`(migration `20260516072210`,9 欄:`id,title,subtitle,handle,brand_id,category_id,availability,fitments,price_general`)——排除 description/images/經銷價,**含 fitments**,但只有 `brand_id`/`category_id`(無 join 出的名稱)。#118/#119 當初拍板「9 欄組不出完整 Product entity」暫不用,但**正是 P4 的輕量投影候選**。
- **server 篩選能力已有先例**:`listByCategory`(`.eq category_id`)、`listByBrand`(`.eq brand_id`)、`listByFitment`(`:273-300`,jsonb `.contains()` prefilter + app 層年份 cross-check 兩段式)、`searchByKeyword`(`:314-340`,`{count:'exact'} + .range()` = server 分頁+總數的現成範本)。

### 2.4 列表卡片實際只用這些欄位
`ProductCard.tsx:137-204`:`imgTone`/`brand`(當 label)/`id`/`image`(首張)/`name`/`fits`(**單字串**,取首筆 fitment、`products.ts:108-111`)/`price`/`originalPrice`/`tierLabel`/(死)`isNew`/`isSale`/`origPrice`。href 另用 `slug`/`category`(`ProductsPage.tsx:313-341`)。
🔴 **完整 `fitments[]` 不在卡片 render 內**——只有衍生的 `fits` 字串被用。

### 2.5 兩個隱藏牽動面(必須一起處理,否則白做)
- **URL 狀態刻意用 `history.replaceState` 避免重抓**(`products-url-state.tsx:160-165` 註解):因 /products 是 force-dynamic、`router.replace` 會重打 server 重撈全量。**P4 要反轉這個設計**——當每頁查詢變便宜後,換頁/換篩選就該真的重抓那一頁(這是本 plan 最核心的架構翻轉、也是最大風險點)。
- **側欄 taxonomy 也吃全量 products**:`buildVehicleTaxonomy(products)`(`ProductsPage.tsx:194`)、`buildBrandTaxonomy(products)`(`:197`)都從傳入的全量陣列衍生。若列表改輕量投影、側欄卻還要全量,等於沒瘦到。分類樹已是獨立輕量 fetch(`fetchCategories`/`getCategoryTreeCached` 已快取);車輛已有輕量版 `fetchVehicleTaxonomy`(select `id,fitments`)但 /products 沒用;品牌側欄型別已預留輕量輸入(`brand-taxonomy.ts:25` `Pick<MockProduct,'brand'|'brandSlug'>`)但**缺獨立輕量 fetch 函式**、要新增。

---

## 3. 目標架構

```
客人開 /products?page=2&brand=bonamici&vehicle=... 
  → Next App Router server component 讀 searchParams
  → adapter.listCatalogPage({ filters, sort, page, perPage })
       ├ 輕量投影(products_list_public 或等價):只回卡片欄位 + 衍生 fits + brand/category 名
       ├ server 端 4 維篩選下推(category_id / brand_id / price gte·lte / fitment contains+年份)
       ├ server 端排序(price-asc/desc/id)
       └ { items: 當頁(≤100 件), total: count } 
  → 側欄 taxonomy 走各自獨立輕量 fetch(不再吃全量)
  → 單頁 payload <2MB → 恢復 unstable_cache(tags ['catalog'])
```
**經銷價安全**:全程走 `products_public`/`products_list_public`(物理排除 `price_store`/`price_by_tier`),與現況同層、不削弱(鐵則:client bundle 零經銷價)。

### 3.1 🔴 正確性不變量 —「server 結果集 ≡ 現行前端結果集」的漂移點(對抗審查抓出、Slice 2 驗收逐條對拍)

前端 `filterProducts+sortProducts` 翻成 SQL 有 **6 個會靜默漂移的點**,不逐一對齊會出現「同樣篩選、server 少幾筆或順序不同」:

1. **車輛三態**:前端是漸進三態(只品牌 / 品牌+車型 / +年,`matchesVehicle:57-73`)。`listByFitment` 的 cross-check 硬要求 `modelCode===`,**只選品牌會回空**。→ 車輛下推必須分三態各組 SQL(brand-only=`contains([{motoBrand}])` / +model=`contains([{motoBrand,modelCode}])` / +year 再疊年份 cross-check),不可直接複用 `listByFitment` 簽名。
2. **fitment trim**:前端 `f.motoBrand?.trim()` 比對(防髒資料尾空白);jsonb `@>` 是逐字精確、不 trim → 存了 `'Yamaha '` 的商品 server 會漏。→ 先掃 DB 有無未 trim 值;有則寫入端正規化,或 prefilter 後 app 層 trim cross-check。
3. **排序 tie-break**:前端 JS 穩定排序 = price 主鍵 + **id 升冪次鍵**;server 若只 `.order('price_general')`,同價商品 `.range()` 分頁會重複/漏。→ 排序**一律補次鍵 `.order('id',asc)**`(price-asc→price asc,id asc / price-desc→price desc,id asc / recommend→id asc)。
4. **價格 label + slider 並存**:`extras.price`(標籤)與 `extras.priceRange`(滑桿)是**兩獨立條件 AND 並存**(`:115-122` 兩 if);且 `PRICE_RANGE_TABLE` 「10 萬以上」上界=`Infinity`(**不能 `.lte(Infinity)`**)。→ label 對 Infinity 上界只發 gte;label 與 slider 兩組 gte/lte **同時套(取交集)**。
5. **品牌多選 slug→id**:`cascade.brands` 存的是**品牌 slug**(非 `brand_id` UUID),且多選是 OR。→ Slice 2 建 slug→brand_id 對照(或 view 補 brand_slug),多選走 `.in('brand_id', ids)` 非 `.eq`。
6. **null 價格**:前端 `computeEffectivePrice` 對 null 有自訂回值;Postgres 排序 NULLS 位置(asc NULLS LAST / desc NULLS FIRST)可能與 JS 不同。→ 先查 public view 有無 `price_general IS NULL` 公開列;有則明定 server 的 null filter/NULLS 位置對齊前端。

> Slice 2 驗收 = 對現有 3,602 筆真資料**逐筆對拍** server vs 前端結果集(至少涵蓋上述 6 點各一組測資),不對拍不算過。

---

## 4. 要 Sean 拍板的決策(寫 code 前)

- **D1 換頁/換篩選的抓取模型**:
  - A(推薦)= **Next App Router server 重抓**——狀態進 searchParams,server component 重跑只抓當頁。反轉現有 replaceState hack。代價:換頁一次 server round-trip(sin1+快取後應 <0.3s)、要處理 loading 態 + cascade↔URL 同步收斂(見 §5 Slice 4 風險)。
  - B = 維持 client 分頁,只在「換篩選」時重抓 server(換頁仍前端 slice 當前結果集)。省 round-trip 但邏輯較 hack、大結果集仍一次抓多。
- **D2 輕量投影來源 + 品牌解析**:A(推薦)= 用/擴充 `products_list_public`(已存在 9 欄含 fitments),補 `brand_slug`/brand 名/category 名 + server 端算好 `fits` 字串(否則側欄 slug→id 與卡片顯示名都要另查);B = view 不動、前端用 taxonomy 表把 id 解回名。
- **D3 死路徑(isNew/isSale/color)**:A(推薦)= 本輪不接 server、UI 維持現狀(不擴張範圍);B = 順手把死 filter chip 從 UI 移除(較乾淨但動 UI、多一份視覺待你驗)。
- **D4 車輛維度下推做法**:A(推薦)= **分三態各組 SQL**(brand-only / +model / +year,見 §3.1-1;**不是**直接搬 `listByFitment`——那個表達不了「只選品牌」);年份 cross-check 若量大太慢再升級 RPC(留 follow-up)。B = 為車輛篩選另建專屬 RPC(較徹底、多一個 migration + codex 審)。
- **D5 🆕 篩選狀態如何序列化進 URL**(審查抓:目前只有 vehicle/category/單一 brand 在 URL,價格 label/滑桿/多選品牌**都不在**):A(推薦)= 新增 `price`(label)/`pmin`+`pmax`(滑桿)/`brand` 多值 param,定義編碼 + 與既有 `?brand=`(vehicle 長版與產品品牌共用、#269)互斥規則;B = 只把部分維度上 URL、其餘不可分享/不可還原(較省但 deep-link 不完整)。
- **D6 🆕 分頁連結 SEO 策略**(審查抓:GEO P0 已上線):A(推薦)= 分頁/篩選用真 `<Link href=?page=N>` anchor(Googlebot 可爬全品類);B = 維持 JS 按鈕 + replaceState(爬蟲只看到第 1 頁、其餘商品靠 sitemap 的 handle 進索引)。**選 B 之後想改回 A 要重做 Slice 4**。
- **D7 🆕 側欄品牌/車種 count 語意**:A(推薦)= 維持現況全域 count(與當前篩選後的 total 天然不一致,但簡單);B = count 隨當前篩選收斂(更準、但每次篩選要重算側欄、多查詢)。

---

## 5. Slice 拆分(鐵則 4:每片 15-45 分鐘可中斷、可肉眼驗)

> 順序刻意讓「資料層先就緒、UI 最後翻轉」,每片獨立三綠 + code-reviewer,RPM/經銷價零回歸。

- **Slice 1 — 輕量投影 + port 分頁簽名(純資料層、UI 無感)**
  接 `products_list_public`(或等價輕量 select),新增 `adapter.listCatalogPage(params)` 回 `{items, total}`;`IProductRepository` 補 `PaginationParams`/`CatalogPageResult`(清 3 處 `@TODO #51`);InMemory + contract 補測。**驗收**:新 method 單元測綠、輕量投影 byte 實測 <2MB、經銷欄零外洩(MCP 唯讀驗)。UI 不變。
- **Slice 2 — server 端 4 維篩選 + 排序 + count 下推(⚠️ 本片藏最多語意漂移、最需對拍)**
  在 `listCatalogPage` 內實作:分類 `category_id`、品牌 `.in('brand_id')`(slug→id,§3.1-5)、價格 label+滑桿雙條件 AND〔Infinity 上界只發 gte,§3.1-4〕、車輛三態 SQL〔§3.1-1,含 trim 對齊 §3.1-2〕+ 排序補 id 次鍵〔§3.1-3〕+ null 價處理〔§3.1-6〕+ `{count:'exact'}`。**驗收**:對現有 3,602 筆**逐筆對拍** server vs `filterProducts+sortProducts`,§3.1 六漂移點各一組測資全過;不對拍不算過。
- **Slice 3 — 側欄 taxonomy 獨立輕量化**
  /products 車輛下拉改用 `fetchVehicleTaxonomy`、品牌側欄新增輕量 fetch(仿 vehicle 模式,但⚠️ vehicle 輕量 fetch 只 select `id,fitments` **無 count**,品牌 fetch 要保留 count 聚合、否則側欄品牌數字徽章消失=視覺回歸);分類樹已 OK。**驗收**:側欄選項 + **各品牌 count 數字**與現況一致、不再依賴全量 products。
- **Slice 4 — ProductsPage/URL 翻轉成 server 分頁 + 恢復快取(最大、動 UI、最高風險)**
  ProductsPage 改吃 `listCatalogPage`;URL 狀態擴充成完整 param schema〔D5:price/pmin/pmax/多選 brand〕並改走 searchParams→server 重抓(D1);分頁改真 `<Link href=?page=N>` anchor〔D6-A,SEO〕;`fetchCatalogProducts` 全量路徑保留到本片驗收後才退役(僅 sitemap 用);單頁投影恢復 `unstable_cache`〔🔴 **filters/sort/page/perPage 全當函式引數傳入序列化進 key**,不可閉包——否則跨頁快取污染;評估只快取熱門頁控 key 基數〕。
  🔴 **cascade↔URL↔server 雙腦同步**是本片最大隱性風險:篩選狀態仍活在 client cascade reducer(驅動側欄 chip),列表改由 URL→server 抓;`toggleBrand` 非冪等 + StrictMode 雙跑(`brandAppliedOnce`/`skipOnceRef`)要重設。定案 cascade 是「從 URL 衍生的 single-source」還是「每次 dispatch 同步 push URL」。
  **驗收**:Playwright production build 實走 Sean 的篩選/換頁/back 還原路徑;**無 JS/爬蟲可達 page 2**;首屏 payload 3.8MB→當頁級;`ProductsPage.test.tsx`(248 行)改寫成 server-fetch 模型時逐條對照舊「replaceState 避重抓」斷言、不放寬;三綠 + 完整 vitest。**這片必請 Sean 肉眼驗。**

> 測試策略:`products-filter-logic.test.ts`(202 行,純函式)在 Slice 2 後其斷言對象改為「adapter/API 回傳」;`ProductsPage.test.tsx`(248 行,鎖 URL round-trip + deep-link)在 Slice 4 需改寫成 server-fetch 模型(現有「replaceState 避重抓」假設被反轉)——這兩檔是回歸鎖,改寫時逐條對照舊斷言語意,不得靜默放寬。

---

## 6. 影響面 / Blast radius

- 會動:`SupabaseProductAdapter.ts`、`IProductRepository`(+contract+InMemory)、`lib/products.ts`、`ProductsPage.tsx`、`products-filter-logic.ts`、`products-url-state.tsx`、`brand-taxonomy.ts`、2 個測試檔;可能 1 個 migration(D2-A 若擴 view / D4-B 若建 RPC)。**跨 3+ 檔 + 動共用資料層 = 鐵則 8 確立。**
- 不動:金流(flag 全 false)、經銷價層(view 物理排除不變)、商品詳情頁(仍走 detail view)、RPM 商品內容、首頁。
- 若 D2-A 擴 view 或 D4-B 建 RPC → 動 schema → 需 DDL 交易模擬(BEGIN→驗→ROLLBACK 零留痕)+ 鐵則 12 Codex Packet。

## 7. Rollback
- Slice 1-3 純加法(新 method/新 fetch,舊路徑仍在)→ 單 commit revert 即回。
- Slice 4 翻轉 UI = 高風險片:保留 `fetchCatalogProducts` 全量路徑到 Slice 4 驗收通過後才退役;revert Slice 4 commit 即回到「全量+前端分頁」現況(功能不失,只是慢)。
- migration(若有)附 rollback SQL;flag 全程 false、無資料遷移。

## 8. 預期效益
/products 首屏 payload 3.8MB → 當頁級(≤100 件輕量,估 <200KB);恢復快取後 TTFB 由 0.8-1.1s 再降;側欄不再逼全量。**治本 P3 當初豁免的那一塊。**
