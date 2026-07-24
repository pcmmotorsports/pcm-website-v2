# PCM 全站功能缺口盤點與「後台可管理網站」開啟規劃(2026-07-25;**v3 = codex 關卡1 R1+R2 兩輪 findings 折入**)

> **緣起**:Sean 2026-07-25 交辦 ——(A)把後台擴成「可以從網站管理修改我們網站的內容、像一般購物車網站那樣方便,同時 AI 或手動都能調」;(B)「搜尋功能目前鎖起來了」要修;(C)「先認真規劃、plan、一審、二審」,決策題留早上。
> **本檔性質**:規劃真權威(缺口盤點 + 分批施工順序 + 決策題)。**只規劃、零程式實作**。
> **版本沿革**:v1 凍結送審(`eb249d4`)→ codex 關卡1 **R1 FAIL、12 must-fix+1 nit** → v2 全折入(`b1f4efd`)→ codex **R2 FAIL、8 must-fix+1 nit** → **v3(本版)7 must-fix+1 nit 折入、1 條實查後駁回**(§12)。🔴 **規劃層審查 2 輪上限已用盡、不跑 R3**。🔴 **其中 6 條是 v1 寫錯的「現況事實」**(見 §11 銷案表),已逐條實查更正。
> **事實紀律**:本版每條現況宣稱都由**主對話親自 grep/開檔驗證**(不再直接採信偵察 subagent 對「函式實際行為」的轉述——v1 正是因此把錯誤前提寫進給 Sean 的決策題)。

---

## 0. 一頁摘要(給 Sean 早上五分鐘看完)

**先講一件重要的事**:我昨晚第一版規劃裡寫錯了 6 個現況事實,被第二個 AI(codex)抓出來。**其中最嚴重的是**:我說「首頁最新商品是寫死撈碳纖維部品分類」並據此問你要不要改 —— **這是錯的**,它早就是真正的「最新上架前 4 件」(`lib/products.ts:247-255`,而且註解明寫是 M-4a 前菜 D 改好的)。那題已經刪掉。以下是更正後的版本。

現在整站的缺口:

| 類別 | 意思 | 代表例子 |
| --- | --- | --- |
| 🔴 **客人看得到「壞掉」** | 現在就在傷體驗 | **點搜尋完全沒反應**(不是被鎖,是半成品) |
| 🟢 **已寫好、只差開路由** | 程式躺在 repo 裡 | 獨立品牌落地頁 `/brands/[slug]`(內容已嵌在商品頁,但沒有獨立頁) |
| 🟡 **客人看得到但你改不了** | 內容寫死 | **首頁大圖是 Unsplash 圖庫圖 + 文案寫死** |
| ⚪ **還沒有的功能** | 你要的後台管理 | 手動新增商品、首頁內容管理、圖片上傳 |

**三個最重要的發現(全部主對話親驗)**:

1. 🔴 **搜尋是半成品,不是被鎖**。Header 搜尋框點下去會發事件 `pcm-open-search`,但**正式站程式(`apps/storefront`)沒有任何一行在聽**。有趣的是 **design 資料夾裡有完整的監聽器和搜尋彈窗**(`design-reference/components/App.jsx:346`、`SearchOverlay.jsx` 205 行)—— 所以缺的**就只是把 design 搬進正式站**(這正是我們的鐵則 1 在做的事)。⚠️ 但**沒有 v1 說的那麼簡單**:design 那份吃的是前端假資料,正式站的搜尋函式在資料層、不能從瀏覽器直接呼叫 → 要先定「搜尋走哪條伺服器路徑、結果長什麼樣、點下去去哪裡」。
2. 🟡 **首頁大圖是 Unsplash 圖庫圖**,網址和文案都寫死。你想換,現在做不到;而且商業網站用圖庫圖有授權要確認。
3. ⚪ **後台完全沒有圖片上傳**(整個 repo 零實作)。但 ⚠️ **這不擋住全部內容管理** —— 文字內容(文案、故事)可以先做,只有「換自己的圖」需要等上傳做好。

**還有一件你會想知道的**:圖片上傳存哪裡,**我們兩年前就決定過了** —— ADR-0004 拍板用 **Supabase Storage**(`docs/architecture/supabase-schema-design.md:586-590` 明寫「內建 CDN、免另外接 Cloudflare R2」)。我第一版擅自推薦 R2 卻沒告訴你這是在推翻舊決策,已改正(§9-Q2)。

**要你早上決定的事** → §9,共 5 題(v1 的 6 題有 2 題作廢、1 題前提錯誤刪除、新增 2 題)。

---

## 1. 前台缺口

### 1.1 🔴 搜尋「沒反應」的真正原因(最高優先)

**症狀**:客人點 Header 搜尋框 → 什麼都沒發生。

| 環節 | 現況 | 檔案:行號 | 親驗 |
| --- | --- | --- | --- |
| 桌機搜尋框 | 存在、可見、可點,`readOnly`(刻意:點開才打字) | `Header.tsx:159-170` | ✅ |
| 手機搜尋圖示 | `onClick={() => openSearch()}` | `Header.tsx:128` | ✅ |
| 觸發 | `window.dispatchEvent(new CustomEvent('pcm-open-search', ...))` | `Header.tsx:50-52` | ✅ |
| 🔴 **正式站監聽者** | **`apps/storefront` 內零 `addEventListener('pcm-open-search')`** | 全域 grep | ✅ |
| ✅ **design 監聽者** | **存在**:`window.addEventListener('pcm-open-search', onOpen)` | `design-reference/components/App.jsx:346-347` | ✅ **v2 更正**(v1 誤寫「全 repo 零 listener」) |
| 🔴 搜尋彈窗元件 | 只在 `design-reference/components/SearchOverlay.jsx`(205 行完整 UI),未搬進 `apps/storefront` | — | ✅ |
| 🔴 樣式檔 | `layout.tsx:11` 註解列出應 import,`apps/storefront/src/styles/` 下無此檔 | `layout.tsx:11` | ✅ |
| 後端關鍵字搜尋 | `searchByKeyword()` 已實作(`products_public` view + ILIKE `title/subtitle/description`),**零呼叫端** | `SupabaseProductAdapter.ts:357-383`;`product-query-support.ts:13` | ✅ |
| `/search` 路由 | 不存在 | `app/` 下無 search 目錄 | ✅ |

**排除的假設(逐一 grep)**:無 `*SEARCH*` env/flag(0 命中);CSS 無 `display:none`(`header.css:74-99`);非 404/redirect。

🔴 **v2 重要更正 —— 這不是 40 分鐘的單純搬運**(codex must-fix):
- design 的 `SearchOverlay.jsx:3-68` 依賴 **`window.PCM_DATA`**(前端 mock 資料)與 **`onNav`** callback → 資料結構與正式站不同,不能逐字搬完就通。
- `searchByKeyword()` 是**資料層 adapter 方法**(`SupabaseProductAdapter`),**不能從 client component 直接呼叫**。
- ⇒ **必須先定四件事**才動手:①搜尋讀取邊界(server action 或 route handler)②結果 DTO(要回什麼欄位、經銷價絕不外洩)③`/products` 的 keyword URL contract(🔴 這是 #287/#288 的 URL-state 高風險禁區、`products-url-state.tsx`)④結果點擊目的地 + loading/error 態。

🔴 **v3 新增(R2 must-fix):design 搜尋彈窗有「四組結果」、不只商品**
`SearchOverlay.jsx:56-60` 回傳 `{ products, brands, categories, vehicles, total }`(品牌自商品品牌去重取 6、車款自 taxonomy 取 6);placeholder 逐字為「搜尋商品 / 品牌 / 車款...」(`:88`);無結果提示「試試『排氣管』、『Öhlins』、或你的車款名稱」(`:118`)。
而正式站 `searchByKeyword()` **只回商品**。⇒ E0 必須二擇一並明寫:
- **(推薦)分兩階段**:E0 先只做商品結果(**明列為經核准的 design 偏離**、UI 只渲染商品區塊),品牌/分類/車款三組列 E0b 後續補。
- 或 E0 一次做滿四組(估時再加約 1.5-2h;品牌/分類可自既有 `catalog_brand_counts`/分類查詢取、車款自 `fetchVehicleTaxonomy()`)。
🔴 **不得**在未揭示的情況下「搬了 UI 但只接商品」——那會是靜默的 design 偏離(鐵則 1)。

**還能用的**:車輛「選車」下拉篩選**正常運作**(`VehicleSelect.tsx`/`CascadeFilterTop.tsx`/`FilterSide.tsx`,吃 `fetchVehicleTaxonomy()`、`lib/products.ts:514`)。⇒ 客人**選車找料可以**、**打字搜尋不行**。

**交叉佐證**:`docs/specs/2026-07-12-search-vehicle-work-plan.md` §4① 早已逐字寫下同一根因;`STATUS.md:149` 列此線「未排」。

### 1.2 🟢 品牌介紹:內容已對客顯示,缺的是「獨立落地頁」

🔴 **v2 重大更正**(v1 寫「客人看不到任何品牌介紹頁」= **錯**):

- ✅ **`BrandShowcase` 已掛在正式商品頁**:`apps/storefront/src/components/ProductPage.tsx:202` `<BrandShowcase product={product} />`(順序 Fitments→Tabs→BrandShowcase,見 `:197-201` 註解)。⇒ **客人逛商品頁時已經看得到品牌介紹內容**。
- 缺的是**獨立品牌落地頁** `/brands/[slug]`:目前只有 `app/dev-preview/brands/[slug]/page.tsx`(非正式路由);`BrandIndex.tsx:8-9` 註解明示正式路由「留 Phase 2(#205 系列)」。
- ⇒ BR-1 的價值**從「讓客人第一次看到品牌內容」下修為「給品牌一個可分享/可 SEO 的獨立網址」**。仍有價值(SEO/行銷連結),但不再是「便宜大贏」等級。
- ⚠️ 前置不變:Showcase 都標 `🔴 L2 內容(鐵則 9、backlog #271):信任狀數字 hardcode 無後台 CRUD` → 上線前確認對外數字真實(廣告不實風險)。

### 1.3 🟡 首頁 8 區塊:內容來源(v2 已逐條親驗)

| 區塊 | 元件 | 內容從哪來 | Sean 能改嗎 |
| --- | --- | --- | --- |
| Header 導覽 | `Header.tsx` | hardcode | ❌ |
| **HomeHero 橫幅** | `HomeHero.tsx:11-20` | 🔴 **Unsplash 圖片 URL + 文案「2026 SPRING EDITORIAL」寫死** | ❌ ← Sean 要改 |
| VehicleFinder 選車 | `VehicleFinder.tsx` | DB(`fetchVehicleTaxonomy()`) | ✅ |
| **FeatureEditorial(故事)** | `FeatureEditorial.tsx:13-14,19` | 🔴 **`RIZOMA` 品牌 id 與文案全寫死** | ❌ ← Sean 要改 |
| CategoryGrid 分類 | `CategoryGrid.tsx:14-15` | 分類來自 DB;**裝飾圖 `DECOR_IMAGES` 為 design 佔位圖池 hardcode** | 一半 |
| HomeSelect(最新商品) | `HomeSelect.tsx`;`lib/products.ts:247-255` | ✅ **真的是最新商品**:`listAllProducts({ limit: 4, orderBy: 'created_desc' })`、`unstable_cache` 900s、釘 `general` 防經銷價外洩 | ✅ **自動** ← 🔴 **v2 更正:v1 誤寫「寫死撈碳纖維部品分類」(那是 `fetchRelatedProducts`,不同函式)** |
| HomeStatement 服務三欄 | `HomeStatement.tsx:14-30` | 文案 hardcode | ❌ |
| BrandIndex 品牌牆 | `BrandIndex.tsx:18` | `data/mock-brands.ts` mock 檔 | ❌ |
| HomeFooter | `HomeFooter.tsx` | 部分接 `site-config SOCIAL_URLS`、其餘 hardcode | 一半 |

🔴 **兩個要揭示的問題**:
1. **首頁 8 元件檔頭皆無 L1/L2/L3 分級註解** → 從未經鐵則 9 分級盤點。⚠️ **v2 修正推論**:鐵則 9 說的是「**若**內容是 L3 → 必後台 CRUD + 先寫 PRD」(`PHASE-1-NORTHSTAR.md:196-206`),**不是**「想做後台就自動屬 Phase 1」。⇒ 首頁內容是不是 L3,取決於 **Sean 實際想多常改**(§9-Q1)。
2. **HomeHero 用 Unsplash 圖** → 商業授權需查證 + 原作者可撤圖導致破圖。→ §9-Q3。

### 1.4 ⚪ 其他前台缺口

- **客人端訂單明細頁不存在**:`design-reference/components/AccountPages.jsx:551` 的「查看詳情」按鈕**無 `onClick`、無導頁**;design 本身亦無獨立訂單明細元件。
- 品牌牆資料在 `mock-brands.ts`(mock 非 DB)。

---

## 2. 後台缺口

### 2.0 後台現況(v2 已修正精確度)

**6 條 UI page routes**(🔴 v2 nit 修正:另有 2 條 SSO API routes,非頁面):

| 路由 | 內容 | 檔案 |
| --- | --- | --- |
| `/` | 🔴 骨架占位頁 + M0-S2「選人」(具名身分) | `app/page.tsx:1-60` |
| `/customers` | 客戶列表(tier 篩選、分頁) | `customers/page.tsx:18` |
| `/customers/[id]` | 客戶明細(基本/儲值金/訂單歷史/地址/車庫) | `customers/[id]/page.tsx:38` |
| `/orders` | 訂單列表 | `orders/page.tsx` |
| `/orders/[id]` | 訂單明細 + 改單表單 | `orders/[id]/page.tsx` |
| `/settings/order-statuses` | 訂單狀態選項設定 | `settings/order-statuses/page.tsx` |
| (API) | `/api/sso/start`、`/api/sso/callback` | `app/api/sso/*/route.ts` |

**寫入機制**:4 支 SECURITY DEFINER RPC(`admin_adjust_wallet`/`admin_set_customer_tier`/`admin_update_order_workflow`/`admin_update_order_item_workflow`)+ `order_status_options` 直接 UPDATE/INSERT。
**權限**:SSO 接報價單系統(`proxy.ts:20-35`);寫入三閘 `authorizeAdminMutation`(`lib/session/authorize.ts:24-35`)。🔴 **無角色分級**(「選人」只是稽核標記)。
**篩選能力**(🔴 v2 nit 修正):訂單列表**已有五種 filter** —— `paymentStatus`/`fulfillmentStatus`/`orderSources`/`paymentChannels`/`workflowStatuses`(`lib/orders/order-list-view.ts:141-147`);客戶列表只有 tier。**兩者皆無關鍵字搜尋**(缺口成立)。
🔴 **商品頁面:零**。🔴 **內容管理:零**。🔴 **圖片上傳:零**(grep `storage.from`/`@aws-sdk/client-s3`/`R2_BUCKET`/`CLOUDFLARE` 全 0 命中)。

### 2.1 客戶管理(Sean 要求 ①)

| Sean 要的 | 現況 | 缺口 |
| --- | --- | --- |
| 客戶資訊 | ✅ Email/電話/生日/tier/註冊日(`customer-detail.tsx:126-137`) | — |
| 訂單資訊 | ✅ 訂單歷史逐筆(`customer-detail-sections.tsx:44-77`) | — |
| **累計金額** | 🔴 只有逐筆、無 sum;儲值金卡的「累積儲值」`totalDeposit` 是**儲值總額非消費總額**(易誤讀) | **加「累計消費金額」** |
| 車種 | ✅ 車庫 section 唯讀(`customer-detail-sections.tsx:129-174`) | 列表看不到 |
| — | 列表欄位=姓名/Email/電話/tier/註冊日(`customers-table.tsx:45-49`) | 無金額欄、無法按消費排序 |

### 2.2 商品管理(Sean 要求 ②)—— 核心是「權威鎖」

Sean 原話:「手動新增商品…編輯商品卡片內容?我知道會影響到後台,變成雙向連動,手動修改鎖住權威之類」。**他的直覺完全正確**:

- 同步是 `upsert onConflict='supplier_slug,external_id'`(`scripts/rpm-import.ts`)→ **會覆寫欄位**。
- 現有保護**只有列級隔離**:`supplier_slug='manual'` 不在登記供應商清單(`scripts/supplier-config.ts`)、所有 fetch/delta/reconcile 一律 `.eq('supplier_slug', <registered>)` → 整列碰不到(1 元補差額商品即此手法,`docs/specs/2026-07-24-m3-balance-payment-product-seed.sql:17`)。
- 🔴 **零欄位級保護**(override 表/`is_manual` 旗標/COALESCE 全查無)。
- 現況唯一相關的是**供應商級**開關:`rpm-import.ts:481-487` 的 `ctx.syncDescription`/`ctx.syncInstallResources`。
- 孤兒硬刪:`scripts/rpm-reconcile.ts:212` `DELETE WHERE supplier_slug=<scope> AND sku IN batch`。

⇒ **「編輯已同步商品」現在做會被下次同步吃掉**,必須先建機制(§3)。

### 2.3 首頁與內容管理(Sean 要求 ③)

🔴 **v2 修正依賴關係**(codex must-fix):v1 說「圖片上傳是內容管理硬前置」**過度**。正確拆法:
- **文字內容**(文案、故事、標題)→ **不需要上傳**,可先做。
- **換自己的圖** → 才需要上傳。
- ⇒ **先定「內容發布模型」**(存了就上線 vs 草稿→預覽→發布→可回滾),因為那決定 schema、也決定「圖片何時可被引用/替換/刪除」。→ §9-Q4。

**內容存哪**:🔴 目前**零 CMS 表**(grep `banner`/`page_content`/`announcement`/`cms`/`hero_content`/`site_content` 六種 pattern 全 0 命中)。

**圖片存哪**:🔴 **已有既存架構決策 ADR-0004 Q2=A2 = Supabase Storage**(`docs/architecture/supabase-schema-design.md:586-590`:「image upload 走 Supabase Storage」「內建 CDN(免另外接 Cloudflare R2、對齊 backlog #43 Supersede)」)。→ §9-Q2 改為「沿用既有決策 vs 正式推翻」。

### 2.4 ⚪ 後台自身缺口

1. 首頁是骨架占位頁 → 無 dashboard。
2. **無角色分級**;`2026-07-12-m4a-admin-phase1-prd.md:44` 原要求取消訂單 step-up,但 2026-07-25 Q4=A 已拍「不 step-up、改原因必填+audit」⇒ 缺口改為角色分級。
3. 訂單/客戶列表**無關鍵字搜尋**(訂單已有五種 enum filter,見 §2.0)。
4. `order_status_options` 直接 UPDATE/INSERT 不走 RPC(`status-option-actions.ts:42-60` 自帶三閘未抽共用)→ 未來寫入面要統一路線。

---

## 3. 🔑 核心技術題:「AI 或手動都能改」的權威鎖

### 3.1 三方案

| 方案 | 做法 | 優點 | 缺點 |
| --- | --- | --- | --- |
| **甲(推薦)override 表** | `product_field_overrides`(product_id + 欄位 + 值 + source + 狀態 + 誰 + 何時);同步照常寫 `products`,**讀取時覆蓋** | ①同步 pipeline 零改動 ②可還原(原值還在)③天然支援 AI/手動雙軌 ④完整 audit | 讀取路徑要合併(見 3.3 的硬要求) |
| **乙 `locked_fields` 陣列** | `products` 加 `locked_fields text[]`,同步逐欄跳過 | 讀取零改動 | ①要改已上線同步邏輯 ②原值遺失 ③無 audit |
| **丙 雙欄** | `title`/`title_manual` COALESCE | 概念簡單 | 欄位翻倍、每加一欄要 migration |

**推薦甲**(三視角):擴充性(AI 批次改=多寫幾列、可 review 後套用或退回)、可維護性(9 家供應商 pipeline 完全不動=風險最低)、bug 可追蹤性(誰/何時/AI 或手動/原值都在)。

### 3.2 🔴 v2 新增:甲案的公開讀取落點(codex must-fix,v1 漏掉)

v1 說「合併函式放 `packages/domain`」**不可行**:

- 前台匿名讀的是 **`products_public` view**(`supabase/migrations/20260719150000_catalog_product_image_trim.sql:210` `CREATE OR REPLACE VIEW products_public WITH (security_invoker = true)`)。
- 🔴 **v3 新增(R2 must-fix):還有第二個公開 view 與兩支匿名 RPC** ——
  - `products_list_public`(`supabase/migrations/20260712183000_products_catalog_page_public.sql:5`,`GRANT SELECT ... TO anon, authenticated` 於 `:32`)= **目錄卡片**的來源;
  - `search_catalog_by_vehicle(...)` RPC 自該 view 查(`:57`、`:77`),`GRANT EXECUTE ... TO anon` 於 `:109`;
  - `catalog_brand_counts`(同檔)亦為匿名 RPC。
  - ⇒ **只改 `products_public` 會造成「商品頁/首頁有 override、目錄與篩選仍顯示同步原值」的不一致**。
- 而且**不只 adapter 一條路**:`fetchVehicleTaxonomy()` 用 anon client **直接查**(`apps/storefront/src/lib/products.ts:514-541`)。
- ⇒ 只在 TS domain 層合併,**既拿不到受 RLS 保護的 override、也覆蓋不了 view/RPC/直接查詢**。

**修正後的 E5(PM-1)必須先定稿「公開 projection 方案」**:
- 選項:①在 DB 層合併(同時改 `products_public` **與** `products_list_public`,或兩者都改走受控 RPC)②所有公開讀取統一改走單一受控 RPC。
- 🔴 **必附完整 consumer 清單並逐欄驗收**:`products_public` / `products_list_public` / `search_catalog_by_vehicle` / `catalog_brand_counts` / adapter 直查 / `fetchVehicleTaxonomy` / sitemap。**任一白名單欄位在所有公開頁面必須一致**。
- 🔴 **以匿名角色實測不洩漏 `price_store`/`price_by_tier`**(經銷價鐵則),**兩個 view 與兩支 RPC 都要測**。

### 3.3 🔴 v2 新增:override 的安全與生命週期合約(codex must-fix,v1 缺)

`source='ai'|'manual'` **只記來源、不是發布審核**。PM-1 必須先產出這份合約:

- **可覆寫欄位白名單**(🔴 價格欄一律排除,見 §9-Q5)
- **每商品每欄位唯一 active override**(唯一索引)
- **值型別驗證**(欄位 × 型別對照;jsonb 欄位要 schema 驗)
- **狀態機**:draft → approved → published → withdrawn
- 🔴 **v3 新增(R2 must-fix)狀態 → 可見性矩陣(硬條件,不可只列狀態不定義生效)**:

  | 狀態 | 公開 projection 是否套用 |
  | --- | --- |
  | `draft` | ❌ 絕不 |
  | `approved`(已審未發布) | ❌ 絕不 |
  | `published` | ✅ **唯一會對客生效的狀態** |
  | `withdrawn` | ❌ **一律回 base(同步原值)** |

  ⇒ 公開 view/RPC 的合併條件**必須**含 `status = 'published'`;漏掉此條件 = draft 直接對客生效。此條列為 E5 的**負向測試**(建 draft override → 匿名讀必須看到 base 值)。
- 🔴 **v3 新增:發布/撤回走原子 RPC + append-only audit**(鏡像既有 `admin_audit_log` 慣例:service_role 僅 INSERT)。
- 🔴 **v3 新增:`base_snapshot` 不可變 + 記錄來源同步版本**——AI 提案當下的原值必須凍結保存,否則供應商同步後無法審計「AI 當初是根據什麼提的」。
- **AI 批次**:必附審核者 + 不可變 base snapshot;🔴 **AI 不可直接建立公開生效的 override**(只能建 `draft`)。
- 🔴 **v3 新增:AI 執行者身分邊界**——必須明定 AI 是**哪一個受信任的 server-side 執行者**(服務帳號?具名 actor?)、**可讀哪些資料**(🔴 絕不可讀 `price_store`/`price_by_tier`)、憑證怎麼保管。`source='ai'` 只是標記、**不是授權機制**。
- **商品刪除/下架時**:override 保留或清理的規則(避免孤兒)
- **RLS/RPC 寫入邊界**(誰能寫、誰能發布)

---

## 4. 施工順序(🔴 v2 改標「epic」;每個 epic 內再拆 15-45 分鐘 slice)

> 🔴 **v2 修正(codex must-fix)**:v1 把 50-90 分鐘的工作標成「片」違反鐵則 4(15-45 分)。以下改為 **epic**,逐 epic 開工時再拆成合規 slice 並各自寫 plan。估時為 epic 總量、非單片。

| 序 | Epic | 內容 | 風險層級 | 估時 |
| --- | --- | --- | --- | --- |
| **E0** | **搜尋接線** | ①定搜尋讀取邊界(server action/route)+ 結果 DTO(經銷價零外洩)+ keyword URL contract(🔴 碰 `products-url-state.tsx` #287/#288 禁區)②搬 `SearchOverlay` 進 storefront + 補 CSS + 接 listener ③接 `searchByKeyword()` + loading/error/空結果 | 標準(①若動 URL-state 則升高風險) | 2.5-3.5 h |
| **E1** | **客戶累計消費** | SQL 聚合 + 明細頁卡片 + 列表欄位可排序 | 標準(唯讀聚合) | 1-1.5 h |
| **E2** | **內容發布合約 + 文字內容管理** | 依 Q4 答案定 schema(`site_content`:區塊 key + jsonb + 狀態 + 版本 + 誰改)+ RLS + seed 現值 + 前台改讀 DB(**保留 hardcode fallback、表空不破首頁**)+ 後台文字編輯 UI | 🔴 高風險(鐵則 12 ③DB) | 4-5 h |
| **E3** | **圖片上傳** | 依 Q2 答案(Supabase Storage 或推翻改 R2)+ 型別/大小白名單 + fail-closed + 圖片管理(替換/刪除/孤兒清理) | 🔴 高風險(鐵則 12 ④平台設定 + 新金鑰) | 2.5-3.5 h |
| **E4** | **首頁圖片可換** | HomeHero/CategoryGrid 裝飾圖接內容表 + 上傳 | 標準 | 1.5-2 h |
| **E5** | **權威鎖地基** | PM-1:公開 projection 方案定稿(§3.2)+ override 合約(§3.3)+ schema + 合併邏輯 + 匿名角色洩價實測 | 🔴 高風險(影響全站商品顯示 + 經銷價) | 4-6 h |
| **E6a** | **同步商品後台(唯讀 + override 編修)** | 商品列表/明細(**同步值 vs override 值並陳**)→ 編輯內容(寫 draft override)→ 審核發布 UI | 🔴 高風險 | 4-5 h |
| **E6b** | **手動商品** | 依 §9-Q5 邊界與 Q6 價格窄路;**Q5/Q6 未答前不得開工** | 🔴 高風險 | 依 Q5 定 |
| **E7** | **AI 協助改商品** | AI 寫 draft override + 走 E6a 的審核 UI 套用/退回(建立在 E5 合約上) | 標準 | 2-3 h |
| **E8** | **後台強化** | dashboard / 角色分級 / 訂單客戶關鍵字搜尋 | 角色分級=🔴 高風險(鐵則 12 ②權限) | 3-4 h |
| **E9** | **獨立品牌落地頁** | `/brands/[slug]` 正式路由(內容已在 PDP 顯示,本 epic 給獨立網址+SEO) | 標準 | 1-1.5 h |

**依賴鏈(硬;🔴 v3 修正 R2 must-fix)**:
- E2 →(僅圖片部分)E3 → E4
- **E5 → E6a → E7**(E7 只需要 override 合約 + 審核 UI)
- **E6b(手動商品)自 E5 分出、不阻塞 E7**;E6b 依 §9-Q5/Q6 獨立排程
- ⚠️ v2 原寫 `E5 → E6 → E7` 會讓「手動可販售商品」無故卡住 AI 審核流,已拆開

**無依賴、可任意插隊**:E0、E1、E9。

---

## 5. 🔴 併行策略(v2 大幅修正)

**v1 寫「可安全併行、檔案零重疊」—— codex 指出不成立,我確認 codex 對**:

1. **每個 slice 都要更新 `STATUS.md` 7 欄與 `docs/handoff/CURRENT.md`**(CLAUDE.md 明訂)→ 一定重疊。
2. `docs/handoff/CURRENT.md:5` 明文「**同一時間只允許一個寫入 session**」。
3. 同一個 `dev` branch **不能被多個 worktree 同時 checkout**(git 限制)。
4. 實錘:2026-07-19 與 07-24 各發生一次並行 session 撞車(`git stash` 誤丟、共用 git index 汙染,memory `project_parallel-sessions-shared-git-index-collision`)。

⇒ **v2 立場:預設維持單一寫入 session,不承諾併行**。
若 Sean 仍要併行(§9-Q1 選 C),必須先建立:①各自 feature branch(非共用 dev)②明確整合順序 ③**指定唯一一個 session 負責 rebase 與 STATUS/CURRENT 維護** ④Sean 明確授權此例外。**所有 migration 片一律序列、不得併行**。

---

## 6. 與現有文件對帳(誠實)

| 既有記載 | 處置 |
| --- | --- |
| `PHASE-2-VISION.md:296`「Admin UI 客製化 = Phase 2、Phase 1 用 Medusa Admin」 | 🔴 **字面已被超越**:`PHASE-1-NORTHSTAR.md:45` 明載「依 0002 ADR、後台 admin 由 `apps/admin` Next.js 寫、不用 Medusa Admin(0001 ADR §4 已被推翻)」。建議 Sean 拍板後更新 PHASE-2-VISION 該行 |
| `PHASE-2-VISION.md:298`「大量上架/同步 pipeline Phase 1 不做」 | 🔴 也已被超越(9 家供應商 pipeline 在跑) |
| **ADR-0004 Q2=A2 = Supabase Storage** | 🔴 **v1 未揭露就推薦 R2 = 我的錯**。v2 改為 §9-Q2 兩案並陳 |
| `2026-07-12-search-vehicle-work-plan.md` §4 S3 | E0 = 其中「①修 Header 接 SearchModal」,但 v2 已修正它**不是單純接線**(§1.1) |
| backlog #271 品牌信任狀 hardcode | 由 E2 內容管理涵蓋 |
| backlog #43 | ADR-0004 已 Supersede(改 Supabase Storage) |
| backlog #295 免運門檻後台管理(本 session 新登) | 獨立、退刷線後評估 |
| `STATUS.md:149` 搜尋線「未排」 | 建議排入 E0;待 Sean 拍板後更新 |

---

## 7. 範圍判定(🔴 v2 重寫;codex 指出 v1 邏輯不成立)

**v1 錯在**:把「鐵則 9 說 L3 要後台 CRUD」當成「所以屬 Phase 1 授權」。**鐵則 9 只規定「若是 L3 → 必須做 CRUD + 先寫 PRD」,不是範圍授權**(`PHASE-1-NORTHSTAR.md:196-206`)。

**逐項重判**:

| Epic | 判定 | 依據 |
| --- | --- | --- |
| E0 搜尋 | ✅ **Phase 1 內** | design 有 SearchOverlay = 「把 design 上架」(鐵則 1) |
| E9 品牌落地頁 | ✅ Phase 1 內 | design 有品牌頁結構 |
| E1 客戶累計消費 | ✅ Phase 1 內 | `NORTHSTAR:40-45` 明列 Phase 1 後台含 customer 完整 |
| E6 商品列表/基本管理 | ✅ **Phase 1 方向內** | `NORTHSTAR:40-45` 明列後台含 **product** 完整 + 自建 admin(v1 誤判為「全部擴張」) |
| E2 內容 CMS | ⚠️ **待定** | 取決於 ①Sean 實際改動頻率(是否 L3)②design 有無對應。→ 🔴 **v3 修正:改指 §9-Q6**(v2 誤指 Q1,但 Q1 問的是施工順序、答不出頻率 → 判定無法落地) |
| E3 圖片上傳 | ⚠️ 擴張(新平台依賴+金鑰),但 ADR-0004 已預先指定方向 | → §9-Q2 |
| E5 override 同步覆寫層 | 🔴 **明確擴張、需 Sean gate** | 動全站商品資料流 |
| E6 手動可販售商品 | 🔴 **明確擴張、需 Sean gate** | 新增可下單商品=錢相鄰 → §9-Q5 |
| E7 AI 審核流 | 🔴 **明確擴張、需 Sean gate** | — |
| E8 角色分級 | 🔴 擴張(鐵則 12 ②權限) | — |

---

## 8. 不做 / 風險 / 誠實邊界

- **本檔零程式實作**;所有結論唯讀偵察 + 主對話親驗。
- 🔴 **v1 有 6 條事實錯誤已更正**(§11)。**教訓**:偵察 subagent 對「某函式實際做什麼」的轉述,**主對話必須親自開檔驗證後才能寫進給 Sean 的決策題**(v1 的「最新商品」題就是這樣寫錯的)。
- ~~未查證項①Unsplash 授權~~ → ✅ **2026-07-25 已親讀 https://unsplash.com/license 逐字查證**(結論見 §9-Q3:商用可、免標註、禁販售照片本身與建競品服務 ⇒ 我們合規)。⚠️ **本項曾一度在 v3 草稿被我寫成「已查證」但其實是憑記憶**,發現後立即實查補正 —— 記此以自警(字面 vs 事實)。
- **仍未查證項**:①Supabase Storage 實際費用/流量估算(Q2 定案後查)②override 合併後商品列表效能(E5 實測)。
- **同步 pipeline 未全讀**:`scripts/rpm-import.ts` 與 `apps/sync-engine` 只讀了 `supplier_slug`/override 相關段落 → E5 開工前需完整偵察 pass。
- 🔴 **不得據本檔宣稱任何功能「已上線」或「已修好」** —— 全部是待做項。

---

## 9. 🔴 決策題(等 Sean 早上答;v2 重寫)

> v1 六題的處置:Q1 保留但改寫(原三案不互斥)、**Q2 移出**(退刷線議題不該混進本檔、已回退刷線 plan §11)、Q3 改寫(揭露 ADR-0004)、Q4 保留、**Q5 刪除**(前提事實錯誤)、Q6 改寫。**新增 Q4(發布模型)與 Q5(手動商品邊界)**。

```
Q1 先做哪個?(這題決定接下來兩週的順序)
背景:搜尋點了沒反應是客人現在就看得到的破功能;你最想要的後台內容管理要先定「內容怎麼發布」
     才能定資料表;兩者沒有依賴、誰先都行。
A(推薦): 先修搜尋(E0)——客人看得到的破功能優先,約半天;修完再開內容管理
B: 先做內容管理(E2)——你最想要的先做,搜尋往後排
C: 我開兩條 feature branch 併行 —— 🔴 注意:這需要你額外授權破例(目前規則明文「同一時間
   只允許一個寫入 session」,而且我們已經因為並行撞車兩次、有一次差點丟掉別人的檔案)
A: A|B|C

Q2 圖片存哪裡?
背景:🔴 這件事我們以前決定過 —— 架構文件 ADR-0004 已拍板用 Supabase Storage,理由是它自帶 CDN、
     不用再接 Cloudflare R2。我第一版擅自推薦 R2 而且沒告訴你這是在推翻舊決定,這是我的錯。
A(推薦): 沿用既有決定,用 Supabase Storage —— 不需要新開服務、同一套權限、少一組金鑰要管
B: 正式推翻 ADR-0004 改用 R2 —— 如果選這個,我會先做一份完整比較(費用/公開讀取/上傳簽章/
   生命週期/回滾)再動手,不會直接改
A: A|B

Q3 首頁大圖現在是 Unsplash 圖庫圖,怎麼處理?
背景:HomeHero.tsx:14 的圖片是熱連結
     `https://images.unsplash.com/photo-1558981806-ec527fa84c39?w=2400&q=85&auto=format&fit=crop`
     🔴 授權我已自行查證(2026-07-25 親讀 https://unsplash.com/license,逐字):
       - 商用可否:「Commercial and non-commercial purposes」皆可、「No permission needed」
       - 是否要標註:「No permission needed (though attribution is appreciated!)」= 非必要
       - 明文禁止兩項:「Images cannot be sold without significant modification.」
         與「Compiling images from Unsplash to replicate a similar or competing service.」
     ⇒ 我們拿來當首頁配圖 = **合規、不需要你煩惱授權**。
     ⚠️ 真正的風險是「熱連結」:圖片直接指向 Unsplash 伺服器,
     原作者刪圖或 Unsplash 改網址 → 我們首頁直接破圖,而且我們不會收到任何通知。
A(推薦): 等內容管理做好時換成我們自己的照片(你上傳);在那之前先把圖「轉存到我們自己的空間」
        避免破圖(小改動、我可以順手做)
B: 現在就整個換掉(你給我幾張現有車輛/商品照片,我直接接上)
A: A|B

Q4 後台改內容,是「存了就上線」還是「先存草稿、確認後才上線」?
背景:這題會直接決定資料表怎麼設計,答錯之後要重做。
     它也決定 AI 幫你改文案時,是直接改到客人看得到的網站,還是先變成待審草稿。
A(推薦): 草稿 → 預覽 → 你按發布才上線 → 可以一鍵回到上一版
        (AI 改的東西一律先變草稿、不會直接上線;改壞了能退回)
B: 存了就直接上線(最簡單、最快,但打錯字客人立刻看到、也沒有回滾)
A: A|B

Q5 手動新增的商品,要做到什麼程度?
背景:這題決定手動商品是「內部工具」還是「真的商品」,兩者工程量差很多。
     現在已經有一個手動商品的先例(補差額用的 1 元商品),它是用手寫 SQL 建的、不是後台功能。
A(推薦): 只做「報價/補差額」用途 —— 可以下單付款,但不出現在搜尋和目錄裡
        (安全、工程量小、涵蓋你說的「客製化訂單」需求)
B: 完整商品 —— 公開可搜尋、可下單、可管庫存、可下架
   (等於做一套完整商品後台,工程量大很多,而且要處理跟供應商同步的邊界)
A: A|B

Q6 這兩件事一起問(它們會改變資料表設計,答完才能開工)
背景 6-1:手動商品要能被下單就一定要有價格,但我把「價格」排除在後台內容編輯之外
        (價格牽涉經銷價外洩和金流)。所以手動商品的價格得走一條專用窄路。
背景 6-2:首頁內容你大概多久會改一次?這決定它算不算我們規則裡的「L3 內容」
        (L3 = 每週改好幾次 → 規則要求一定要做後台管理;L2 = 一季改 1-3 次 → 可以先寫死)。
6-1 手動商品的價格誰能設?
A(推薦): 後台專屬表單、每次設價都留紀錄(誰/何時/多少/為什麼),只有你和指定的人能設
B: 先不做後台設價 —— 手動商品一律由我用 SQL 建(維持現狀),等之後再說
6-2 首頁橫幅/故事文案,你預期多久改一次?
A: 每週或更頻繁(節慶、活動、新品)→ 明確是 L3,後台管理是規則要求
B: 一季 1-3 次 → 是 L2,可以排後面一點,先做搜尋跟商品
A: 6-1=A|B / 6-2=A|B
```

---

## 10. 審查狀態

| 關卡 | 狀態 |
| --- | --- |
| 偵察 pass | ✅ 三路完成 |
| 主對話親驗 | ✅ v2 全部現況宣稱已逐條 grep/開檔驗證 |
| **codex 關卡1 R1** | ✅ **已跑 → FAIL、12 must-fix + 1 nit** |
| **v2 折入** | ✅ 13 條全數折入(§11) |
| **codex 關卡1 R2** | ✅ **已跑 → FAIL、8 must-fix + 1 nit** |
| **v3 折入** | ✅ **7 條 must-fix + 1 nit 折入;1 條經實查後駁回**(§12) |
| codex 關卡1 R3 | 🔴 **不跑** —— 規劃層審查上限 2 輪(`~/.claude/rules/00-work-rules.md` §5),已用盡 |
| Sean 拍板 | ⏳ §9 六題 |

---

## 11. codex 關卡1 R1 findings 逐條銷案

| # | finding | 核對 | 處置 |
| --- | --- | --- | --- |
| 1 | 「全 repo 零 listener」不實,`design-reference/components/App.jsx:346` 有 | ✅ **屬實(我錯)** | §1.1 改「正式 `apps/storefront` 無 listener;design 有」——反而更能證明「缺的是搬運」 |
| 2 | 「客人看不到任何品牌介紹」不實,`ProductPage.tsx:202` 已掛 `BrandShowcase` | ✅ **屬實(我錯)** | §1.2 重寫;BR-1/E9 價值下修為「獨立網址+SEO」 |
| 3 | 「最新商品寫死碳纖維分類」不符 live code,實為 `listAllProducts({limit:4,orderBy:'created_desc'})` | ✅ **屬實(我錯、且已寫進決策題)** | §1.3 更正;**Q5 直接刪除**;根因=偵察 agent 把 `fetchRelatedProducts` 誤當 `fetchFeaturedProducts` 且我未親驗 |
| 4 | SR-1 非 40 分鐘單純接線(design 依賴 `window.PCM_DATA`/`onNav`;`searchByKeyword` 是資料層不能 client 直呼) | ✅ 屬實 | §1.1 加「必須先定四件事」;E0 估時改 2.5-3.5h |
| 5 | override 漏公開讀取落點(`products_public` view、`fetchVehicleTaxonomy` 直接查) | ✅ 屬實 | 新增 §3.2「公開 projection 方案」必須先定稿 + 匿名角色洩價實測 |
| 6 | override 缺安全與生命週期合約 | ✅ 屬實 | 新增 §3.3 完整合約清單;AI 不可直接建立公開生效 override |
| 7 | 圖片上傳非內容管理硬前置 | ✅ 屬實 | §2.3 改「文字先行、只有換圖依賴上傳」;E2 前移至 E3 之前 |
| 8 | worktree 併行「零重疊」不成立(STATUS/CURRENT 必動、同 branch 不能多 worktree) | ✅ 屬實 | §5 大幅改寫、刪除併行承諾、改為需 Sean 例外授權 |
| 9 | 範圍判定邏輯不成立(鐵則 9 非授權;NORTHSTAR:40-45 明列 product 完整屬 P1) | ✅ 屬實 | §7 重寫為逐 epic 判定表 |
| 10 | Q3 未揭露 ADR-0004 已選 Supabase Storage | ✅ **屬實(我錯)** | §2.3 + §9-Q2 改為「沿用 vs 正式推翻」 |
| 11 | 50-90 分「片」違反鐵則 4 | ✅ 屬實 | §4 全改標 **epic**、逐 epic 開工再拆合規 slice |
| 12 | 決策題需重寫(Q1 不互斥、Q2 混入退刷線、Q5 前提錯、Q6-B 無可執行方案) | ✅ 屬實 | §9 重寫:Q1 改寫、Q2 移出本檔、Q5 刪、Q6 改為「價格排除」的說明而非選項;新增發布模型與手動商品邊界兩題 |
| 13(nit) | 「6 條路由」應限定 UI page routes;訂單列表已有五種 filter | ✅ 屬實 | §2.0 修正 |

## 12. codex 關卡1 R2 findings 逐條銷案(**R2 判 FAIL、8 must-fix + 1 nit;7+1 折入、1 駁回**)

| # | finding | 核對 | 處置 |
| --- | --- | --- | --- |
| R2-1 | E0 只接商品搜尋,但 design `SearchOverlay` 有品牌/分類/車款/商品**四組**結果 | ✅ 屬實(`SearchOverlay.jsx:56-60` 回 `{products,brands,categories,vehicles,total}`;placeholder `:88`「搜尋商品 / 品牌 / 車款...」) | §1.1 新增四組結果段:E0 必須二擇一並**明列 design 偏離**,不得靜默只接商品 |
| R2-2 | §3.2 漏列 `products_list_public` 與兩支匿名 RPC | ✅ 屬實(`20260712183000_products_catalog_page_public.sql:5` view、`:32` GRANT anon、`:57/:77` RPC 查它、`:109` GRANT EXECUTE anon) | §3.2 補完整 consumer 清單(兩 view + 兩 RPC + adapter 直查 + taxonomy + sitemap),逐欄驗收 + 兩者都做匿名洩價實測 |
| R2-3 | §3.3 未硬定義「公開 projection 只可套用 `published`」;`withdrawn` 回退未定;base snapshot 未要求不可變 | ✅ 屬實 | §3.3 新增**狀態→可見性矩陣**(唯 `published` 生效、`withdrawn` 一律回 base)+ 負向測試 + 原子 RPC/append-only audit + 不可變 `base_snapshot` + **AI 執行者身分邊界**(`source='ai'` 只是標記非授權) |
| R2-4 | `E5 → E6 → E7` 讓手動商品無故阻塞 AI 審核流 | ✅ 屬實 | §4 拆 **E6a**(同步商品 override 編修+審核 UI)/ **E6b**(手動商品);硬鏈改 `E5 → E6a → E7`,E6b 依 Q5/Q6 獨立 |
| R2-5 | §7 說 E2 判定取決於頻率並指向 Q1,但 Q1 問的是施工順序、答不出頻率 | ✅ 屬實(我的內部矛盾) | §7 改指 **§9-Q6-2**(新增的內容改動頻率題) |
| R2-6 | Q3 選項 C「先查授權」不是決策、是 AI 該自己做的調查 | ✅ 屬實 | **已自行查證 Unsplash License 並寫進 Q3 背景**(允許商用、免標註;禁販售照片本身/建競品服務 → 我們合規);Q3 刪除 C,並把**真正的風險改為「熱連結會破圖」** |
| R2-7 | Q5-A 承諾「可下單付款」但價格被排除,無價格權威路徑 | ✅ 屬實 | 新增 **Q6-1 手動商品價格窄路**(後台專屬表單+完整紀錄 vs 維持 SQL 建立);**Q5/Q6 未答前 E6b 不得開工**(§4 已標) |
| R2-8 | 「`STATUS.md:149` 列此線『未排』」是新引入的錯誤宣稱 | 🔴 **駁回(codex 誤判)** | 實查 `STATUS.md:149` 逐字為「**獨立線(未排)**:LINE 補資料線(…);**搜尋 S2 lightech #275→S3 MVP**;M-3 真刷卡 gate;step-up 全套另片。」⇒ 搜尋線**確實**列在「獨立線(未排)」的列舉內,原宣稱正確、不改。codex 只擷取到分號後的子字串即下結論 |
| R2-9(nit) | §3.1「讀取路徑要合併」應交叉引用 §3.2 非 §3.3 | ✅ 屬實 | 已更正 |
