# PCM 全站功能缺口盤點與「後台可管理網站」開啟規劃(2026-07-25)

> **緣起**:Sean 2026-07-25 交辦兩件事 ——(A)把後台擴成「可以從網站管理修改我們網站的內容、像一般購物車網站那樣方便,同時 AI 或手動都能調」;(B)「搜尋功能目前鎖起來了」要修。並要求「先認真規劃、plan、一審、二審」、決策題留早上。
> **本檔性質**:規劃真權威(缺口盤點 + 分批施工順序 + 決策題)。**只規劃、未實作任何一行程式**。
> **事實來源**:2026-07-25 三路偵察實查(admin 路由/寫入機制/權限、前台首頁 8 區塊資料來源、搜尋鏈路),每條結論附 `檔案:行號`。**不憑記憶**;與舊文件字面衝突時以本檔實查為準並註明。
> **上位關係**:本檔不改動 `docs/PHASE-1-NORTHSTAR.md` 範圍定義;§7 明列哪些項目屬 Phase 1 範圍內、哪些是範圍擴張需 Sean 拍板。

---

## 0. 一頁摘要(白話,給 Sean 早上五分鐘看完)

現在整站的缺口分四種顏色:

| 類別 | 意思 | 有幾項 | 代表例子 |
| --- | --- | --- | --- |
| 🔴 **客人看得到「壞掉」** | 現在就在傷客人體驗 | 1 | **點搜尋完全沒反應**(不是被鎖,是從來沒做完) |
| 🟢 **已經寫好、只差接上線** | 程式在 repo 裡躺著,開個路由就有 | 2 | 12 個品牌介紹頁只掛在測試路徑、正式網址進不去 |
| 🟡 **客人看得到但你改不了** | 內容寫死在程式裡,要改得找 AI | 6 | **首頁大圖是 Unsplash 圖庫圖 + 文案寫死** |
| ⚪ **還沒有的功能** | 你要的後台管理能力 | 8 | 手動新增商品、首頁內容管理、圖片上傳 |

**三個最重要的發現(都是實查、不是推測)**:

1. 🔴 **搜尋不是「被鎖」,是半成品**。Header 搜尋框點下去會發出一個事件,但**整個 repo 沒有任何一行程式在聽這個事件** → 點了就是沒反應。搜尋彈窗的 UI 在 design 資料夾裡有完整 205 行,從來沒搬進正式程式碼。後端搜尋函式也寫好了但**沒有任何地方呼叫它**。⇒ 這是「接線」工作,不需要你開任何開關。
2. 🟡 **首頁大圖用的是 Unsplash 圖庫的圖**,而且圖片網址和文案都寫死在程式裡。⇒ 你想換首頁大圖,現在做不到;而且**商業網站用圖庫圖有授權問題要查**(我列成決策題)。
3. ⚪ **後台完全沒有圖片上傳功能**(整個 repo 零實作)。⇒ 這是「你要能自己換首頁圖/商品圖」的**硬前置**,不先做這個,後面的內容管理都是空談。

**我建議的做法**:分 6 批、由便宜到貴。前兩批(搜尋接線 + 品牌頁上線 + 客戶累計金額)加起來大約半天,能立刻看到成果;真正的大工程是第 4 批「商品管理」,它有一個必須先想清楚的技術題(§3 權威鎖)。

**要你早上決定的事** → §8,共 6 題。

---

## 1. 前台缺口

### 1.1 🔴 搜尋功能「沒反應」的真正原因(最高優先)

**症狀**:客人點 Header 搜尋框 → 什麼都沒發生。

**根因鏈(逐段實查)**:

| 環節 | 現況 | 檔案:行號 |
| --- | --- | --- |
| 桌機搜尋框 | 存在、可見、可點,但是 `readOnly`(刻意設計:點開才打字) | `apps/storefront/src/components/Header.tsx:159-170` |
| 手機搜尋圖示 | 存在,`onClick={() => openSearch()}` | `Header.tsx:128` |
| 觸發動作 | `window.dispatchEvent(new CustomEvent('pcm-open-search', ...))` | `Header.tsx:50-52` |
| 🔴 **監聽者** | **全 repo 零 `addEventListener('pcm-open-search')`** | 全域 grep 0 命中 |
| 🔴 **搜尋彈窗元件** | 只存在 `design-reference/components/SearchOverlay.jsx`(205 行完整 UI),**從未搬進 `apps/storefront/src/components/`** | — |
| 🔴 **樣式檔** | `layout.tsx:11` 註解列出應 import `search-overlay` CSS,但 `apps/storefront/src/styles/` 下**無此檔** | `layout.tsx:11` |
| 後端關鍵字搜尋 | `searchByKeyword()` **已實作**(`products_public` view + ILIKE 三欄 title/subtitle/description),**零呼叫端** | `packages/adapters/src/supabase/SupabaseProductAdapter.ts:357-383`;`product-query-support.ts:13` |
| `/search` 路由 | **不存在** | `app/` 下無 search 目錄 |

**排除的假設(逐一查過)**:無任何 `*SEARCH*` env / feature flag(grep 0 命中);CSS 沒有 `display:none`(`header.css:74-99`);不是 404 或 redirect;資料層權限未成為主因(因為根本沒有呼叫端,無從觸發)。

**交叉佐證**:`docs/specs/2026-07-12-search-vehicle-work-plan.md` §4① **早就逐字寫下同一根因**(「現只 dispatch 無 listener(點了沒反應)→ 接 SearchModal」);`STATUS.md:149` 把這條線列在「獨立線(未排)」。⇒ 三方一致,信心高。

**還能用的搜尋**:車輛「選車」下拉篩選**正常運作**(`VehicleSelect.tsx` / `CascadeFilterTop.tsx` / `FilterSide.tsx` 等,吃 `fetchVehicleTaxonomy()`、`lib/products.ts:544`)。所以客人**選車找料可以**,**打字搜尋不行**。

### 1.2 🟢 品牌介紹頁:12+ 頁已寫好,只掛在測試路徑

- 既有 `*Showcase.tsx` **12 個以上**(Evotech / Akrapovic / Motogadget / CncRacing / ExtremeComponents / EaziGrip / Lightech / Samco / GbRacing / Front3d / Materya / Bonamici …),內容完整。
- **唯一掛載點** = `apps/storefront/src/app/dev-preview/brands/[slug]/page.tsx` ← **非正式路由**。
- `BrandIndex.tsx:8-9` 註解明示正式 `/brands/[slug]` 路由「留 Phase 2(#205 系列)」。
- ⇒ **客人現在看不到任何品牌介紹頁**,但內容早就寫完了。開正式路由 = 極高性價比。
- ⚠️ 前置:這些 Showcase 都標 `🔴 L2 內容(鐵則 9、backlog #271):信任狀數字 hardcode 無後台 CRUD`(`EvotechShowcase.tsx:14`、`AkrapovicShowcase.tsx:19`、`GbRacingShowcase.tsx:17` 等)→ 上線前要確認那些「信任狀數字/年份」是真實可對外的(法遵/廣告不實風險)。

### 1.3 🟡 首頁 8 區塊:內容來源逐一盤點(Sean 改不了的部分)

| 區塊 | 元件 | 內容從哪來 | Sean 能改嗎 |
| --- | --- | --- | --- |
| Header 導覽 | `Header.tsx` | hardcode | ❌ |
| **HomeHero 橫幅** | `HomeHero.tsx:11-20` | 🔴 **Unsplash 圖片 URL + 文案「2026 SPRING EDITORIAL」寫死在 JSX** | ❌ ← Sean 明確要改 |
| VehicleFinder 選車 | `VehicleFinder.tsx` | DB(`fetchVehicleTaxonomy()`、`page.tsx:64`) | ✅ 資料驅動 |
| **FeatureEditorial(故事)** | `FeatureEditorial.tsx:13-14,19` | 🔴 **`RIZOMA` 品牌 id 與文案全寫死** | ❌ ← Sean 明確要改 |
| CategoryGrid 分類 | `CategoryGrid.tsx:14-15` | 分類名/連結來自 DB(`fetchCategories()`);**裝飾圖 `DECOR_IMAGES` 是 design 佔位圖池 hardcode** | 一半 |
| **HomeSelect(最新商品)** | `HomeSelect.tsx:1-2`;`page.tsx:63` | 🔴 **`fetchFeaturedProducts()` 實際是寫死撈「碳纖維部品」分類** —— 不是真的「最新」 | ❌ ← Sean 明確要改 |
| HomeStatement 服務三欄 | `HomeStatement.tsx:14-30` | 文案全 hardcode | ❌ |
| BrandIndex 品牌牆 | `BrandIndex.tsx:18` | `apps/storefront/src/data/mock-brands.ts` **mock 資料檔** | ❌ |
| HomeFooter | `HomeFooter.tsx` | 部分接 `site-config SOCIAL_URLS`、其餘 hardcode | 一半 |

🔴 **兩個必須揭示的問題**:

1. **首頁 8 個元件檔頭都沒有 L1/L2/L3 分級註解** → 首頁內容**從未經過鐵則 9 分級盤點**。依鐵則 9「頻率拿不準 → 預設當 L3 停下問 Sean」,首頁橫幅/故事若 Sean 想「週級」換 → **就是 L3、必須後台 CRUD**。這正是 Sean 要求的方向,規則層面站得住。
2. **HomeHero 用 Unsplash 圖** → 商業使用授權需查證(Unsplash License 允許商用但有條件、且圖片可能被原作者撤下導致首頁破圖)。列決策題 §8-Q4。

### 1.4 ⚪ 其他前台缺口(偵察順帶發現)

- **客人端訂單明細頁不存在**:`design-reference/components/AccountPages.jsx:551` 的「查看詳情」按鈕**無 `onClick`、無導頁**;design 本身也沒有獨立訂單明細頁元件。客人只能在列表看到單號/日期/件數/金額/付款/出貨。
- **`/brands/[slug]` 正式路由**(同 1.2)。
- 品牌牆資料在 `mock-brands.ts`(mock 而非 DB)→ 與「品牌上架線」memory 記載的 K-SPEED brands 表未建相互一致。

---

## 2. 後台缺口

### 2.0 後台現況(實查全貌)

**路由只有 6 條**:

| 路由 | 內容 | 檔案 |
| --- | --- | --- |
| `/` | 🔴 **骨架占位頁** + M0-S2「選人」(具名身分切換) | `apps/admin/src/app/page.tsx:1-60` |
| `/customers` | 客戶列表(tier 篩選、分頁) | `customers/page.tsx:18` |
| `/customers/[id]` | 客戶明細(基本/儲值金/訂單歷史/地址/車庫) | `customers/[id]/page.tsx:38` |
| `/orders` | 訂單列表 | `orders/page.tsx` |
| `/orders/[id]` | 訂單明細 + 改單表單 | `orders/[id]/page.tsx` |
| `/settings/order-statuses` | 訂單狀態選項設定(label/color/sort_order/is_active 可編輯新增) | `settings/order-statuses/page.tsx` |

**寫入機制**:4 支 SECURITY DEFINER RPC(`admin_adjust_wallet` / `admin_set_customer_tier` / `admin_update_order_workflow` / `admin_update_order_item_workflow`)+ `order_status_options` 直接 UPDATE/INSERT。
**權限**:SSO 接報價單系統(`proxy.ts:20-35` 未登入 302 導 `/api/sso/start`);寫入三閘 `authorizeAdminMutation`(`lib/session/authorize.ts:24-35`:session 自驗 + Origin fail-closed + 具名 actor,缺一即拒)。🔴 **無角色分級**——「選人」只是稽核標記,不是授權層。
🔴 **商品頁面:零**。商品資料由 `apps/sync-engine` + `scripts/rpm-*.ts` 供應商 pipeline 寫入。
🔴 **內容管理:零**。🔴 **圖片/檔案上傳:零**(grep `storage.from` / `@aws-sdk/client-s3` / `R2_BUCKET` / `CLOUDFLARE` 全 0 命中;唯一相關的 `scripts/image-trim-scan.ts:5-10` 只是讀供應商既有 CDN 圖去量測白邊,不上傳檔案)。

### 2.1 客戶管理(Sean 要求 ①)—— 大部分已有,缺一個聚合

Sean 要的:「不單純只是客戶資訊,還有訂單資訊、累計金額、車種等等」。

| Sean 要的 | 現況 | 缺口 |
| --- | --- | --- |
| 客戶資訊 | ✅ Email/電話/生日/tier/註冊日(`customer-detail.tsx:126-137`) | — |
| 訂單資訊 | ✅ 訂單歷史表逐筆(單號/日期/件數/金額/付款/出貨)(`customer-detail-sections.tsx:44-77`) | — |
| **累計金額** | 🔴 **只有逐筆金額、無 sum**;儲值金卡的「累積儲值」`totalDeposit` 是**儲值總額、不是消費總額**(容易誤讀) | **要加「累計消費金額」** |
| 車種 | ✅ 車庫 section(name/year/品牌車款字典名/engine/km/mods/service)、唯讀(`customer-detail-sections.tsx:129-174`) | 唯讀可接受;列表看不到 |
| — | 客戶列表欄位=姓名/Email/電話/tier/註冊日(`customers-table.tsx:45-49`) | **列表無金額欄、無法按消費排序** |

⇒ **這項最便宜**:一個 SQL 聚合 + 列表加欄位。屬 Phase 1 範圍內(M-4a 客戶線的自然延伸)。

### 2.2 商品管理(Sean 要求 ②)—— 最大工程,核心是「權威鎖」

Sean 要的:「手動新增商品(以便客製化訂單或者追加某些我們有的品牌或者沒有的品牌商品)、編輯商品卡片內容?我知道會影響到後台,變成雙向連動,手動修改鎖住權威之類」。

**Sean 的直覺是對的,而且問題比想像更具體**:

- 商品資料每次同步都是 `upsert onConflict='supplier_slug,external_id'`(`scripts/rpm-import.ts`)→ **同步會覆寫欄位**。
- 現有保護**只有「列級隔離」**:`supplier_slug='manual'` 的商品不在登記供應商清單(`scripts/supplier-config.ts`)內 → 所有 fetch/delta/reconcile 一律 `.eq('supplier_slug', <registered>)` → **整列碰不到**。這正是 07-24 補差額 1 元商品用的手法(`docs/specs/2026-07-24-m3-balance-payment-product-seed.sql:17`)。
- 🔴 **完全沒有「欄位級」保護**:grep override 表 / `is_manual` 旗標 / COALESCE 保留邏輯 → **全部查無**。
- 現況唯一相關的是**供應商級開關**:`rpm-import.ts:481-487` 的 `ctx.syncDescription` / `ctx.syncInstallResources` 決定「這家供應商要不要覆寫 description/highlights/manuals/video_url」——是**整家供應商**層級,不是單一商品或單一欄位。
- 孤兒硬刪的存在讓風險更高:`scripts/rpm-reconcile.ts:212` `DELETE WHERE supplier_slug=<scope> AND sku IN batch`(scope 限該供應商)。手動商品因列級隔離安全,但**「已同步商品被手動改過」的欄位沒有任何保護**。

⇒ 所以「編輯已同步商品的卡片內容」**現在做會被下次同步吃掉**。要先建機制(§3)。

**手動新增商品的既有先例**:1 元補差額商品是用 seed SQL 手工建(`supplier_slug='manual'`、`brand PCM`、分類「服務/其他」、變體 `PCM-BALANCE-1`),已驗證可行且同步不會刪。⇒ 後台表單化 = 把這條路做成 UI。

### 2.3 首頁與內容管理(Sean 要求 ③)—— 卡在圖片上傳

Sean 要的:「首頁橫幅、最新商品、故事等等可以新增、編輯」。

**硬前置(不做這個,其他都免談)**:
- 🔴 **整個 repo 沒有任何圖片上傳實作**(§2.0)。Sean 要換首頁大圖 → 必須有「選檔 → 上傳 → 存 URL」的鏈路。
- 選項:Cloudflare R2(memory 記載 Lightech 圖 07-24 已定「源頭轉存 R2」方向、且 **Vercel Hobby 的 image transform 5k 上限已撞牆**過)或 Supabase Storage(已有 Supabase Pro)。→ 決策題 §8-Q3。

**內容存哪**:
- 🔴 **目前零 CMS 表**(grep migrations 找 `banner` / `page_content` / `announcement` / `cms` / `hero_content` / `site_content` **六種 pattern 全 0 命中**)。
- 首頁內容全在 code hardcode 或 `apps/storefront/src/data/*.ts`。
- ⇒ 需要新表。設計方向見 §4 批 3。

**「最新商品」要順便修正語意**:現在是寫死撈「碳纖維部品」分類(§1.3),不是真的最新。後台化時應改成「精選商品」由後台挑(或真的按上架時間排序)—— 這是**修一個名不符實的既有行為**,要 Sean 確認要哪一種(決策題 §8-Q5)。

### 2.4 ⚪ 後台自身缺口(Sean 沒提但影響「像一般購物車網站那樣方便」)

1. **首頁是骨架占位頁**(`page.tsx:1-60`)→ 無 dashboard(今日訂單/待處理/營收)。
2. **無角色分級**(§2.0)→ 未來有員工進來就沒有權限邊界;`docs/specs/2026-07-12-m4a-admin-phase1-prd.md:44` 原本要求「敏感操作(取消訂單)要 step-up 驗證」,但 2026-07-25 Q4=A 已拍「不 step-up、改原因必填+audit」⇒ 這條缺口變成**角色分級**而非 step-up。
3. **訂單/客戶列表無關鍵字搜尋**(只有 tier 篩選+分頁)。
4. `order_status_options` 是直接 UPDATE/INSERT、**不走 RPC**(`status-option-actions.ts:42-60` 自帶三閘但未抽共用 helper)→ 與其他四支 admin RPC 的慣例不一致,未來加寫入面時要決定統一走哪條路。

---

## 3. 🔑 核心技術題:「AI 或手動都能改」的權威鎖(Sean 自己點出的那個)

這是整個願景**唯一真正困難的設計題**,做錯會導致「Sean 改的東西隔天被同步吃掉」或「同步壞掉不敢跑」。

### 3.1 三個方案

| 方案 | 做法 | 優點 | 缺點 |
| --- | --- | --- | --- |
| **甲(推薦)override 表** | 新表 `product_field_overrides`(product_id + 欄位名 + 值 + `source: 'manual' \| 'ai'` + 誰 + 何時 + 原因)。同步照常寫 `products`;**讀取時以 override 蓋過同步值** | ①**同步邏輯零改動**(最大優點:不動已在跑的 pipeline)②隨時可還原(刪 override 列即回同步值)③**天然支援 AI 與手動雙軌**(`source` 欄區分)④完整 audit:誰在什麼時候改了哪個欄位、原值還在 | 讀取路徑要合併(products 頁/列表/API 都要套同一個合併函式;漏一處就顯示不一致) |
| **乙 `locked_fields` 陣列** | `products` 加 `locked_fields text[]`,同步時逐欄跳過鎖住的欄位 | 讀取零改動 | ①**要改同步邏輯**(rpm-import 每欄判斷、風險在已上線 pipeline)②**原始同步值遺失**(改了就沒了、無法比對「供應商改了什麼」)③無 audit |
| **丙 雙欄** | `title` / `title_manual` 各一欄,讀取 COALESCE | 概念最簡單 | 欄位翻倍、每加一個可覆寫欄位就要 migration、schema 迅速變醜 |

### 3.2 推薦甲的理由(三視角,鐵則 10)

- **擴充性**:未來要讓 AI 批次改文案(Sean 明確要「可以接受 AI 協助修改商品」),甲案只是多寫幾列 override(`source='ai'`)、可整批 review 後套用或退回;乙丙都要改 schema 或同步碼。
- **可維護性**:同步 pipeline(已在正式跑、9 家供應商)**完全不動** = 風險最低。合併邏輯集中在一個純函式、可窮舉測試。
- **bug 可追蹤性**:出現「這商品顯示怪怪的」→ 查 override 表就知道是誰、何時、用什麼身分(AI/手動)改了哪一欄,原值還在。乙丙都做不到。

### 3.3 甲案的已知代價(誠實揭示)

- 所有讀商品的路徑都必須經過合併函式,**漏一處就是不一致 bug**。→ 對策:合併函式放 `packages/domain`,adapter 層單一入口套用,加守門測試「所有商品讀取路徑都經過合併」。
- override 表會讓「這欄現在的值是什麼」需要兩次查詢或一次 join → 效能面要驗(商品列表 N+1 風險)。
- 🔴 **經銷價欄位絕不可進 override**(`price_store`/`price_by_tier`):價格是金流相鄰、且有經銷價不外洩鐵則。手動改價要走另一條有 audit 的窄路,不混進內容 override。→ 列決策題 §8-Q6。

---

## 4. 建議施工順序(六批;由便宜到貴、每批可獨立驗收)

> 原則:①客人看得到的破功能先修 ②已寫好的先上線 ③基建先於功能 ④動同步/金流的排最後。
> 每批的片型與審查層級照 `CLAUDE.md` 鐵則 12 判定。

### 批 0 —— 立即修:搜尋接線(客人可見破功能)

| 片 | 內容 | 片型 | 估時 |
| --- | --- | --- | --- |
| **SR-1** | 把 `design-reference/components/SearchOverlay.jsx` 依鐵則 1(**直接搬、不翻譯**)搬進 `apps/storefront/src/components/SearchModal.tsx` + 補 `search-overlay.css` + 掛 `addEventListener('pcm-open-search')` + 接既有 `searchByKeyword()` | 標準片(純前台、無金流) | 40 分 |
| **SR-2** | 搜尋結果品質:現況只 ILIKE `title/subtitle/description` 三欄 → 評估加 SKU/品牌/分類(work-plan §4④ 已列) | 標準片 | 30 分 |

🔴 **先做 SR-1 就能讓搜尋「有反應」**;SR-2 是品質提升、可延後。
⚠️ 與既有規劃的關係:`docs/specs/2026-07-12-search-vehicle-work-plan.md` §4 的 S3 原本希望等 S1(車型 token 展開)完成才做完整 query-understanding。**SR-1 刻意只做「關鍵字 ILIKE + UI 接線」、不碰車型 token** → 不依賴 S1、可立刻做。這是對原規劃的**刻意縮範圍**,已在此揭示。

### 批 1 —— 便宜大贏

| 片 | 內容 | 片型 | 估時 |
| --- | --- | --- | --- |
| **BR-1** | 開 `/brands/[slug]` 正式路由(重用既有 12+ Showcase 元件)+ 品牌牆連結接上 | 標準片 | 40 分 |
| **CU-1** | 客戶「累計消費金額」:SQL 聚合 + 明細頁卡片 + 列表加欄位可排序 | 標準片(唯讀聚合、零寫入) | 40 分 |

⚠️ BR-1 前置:確認 Showcase 內「信任狀數字/年份」可對外(§1.2)。

### 批 2 —— 基建:圖片上傳(內容管理的硬前置)

| 片 | 內容 | 片型 | 估時 |
| --- | --- | --- | --- |
| **UP-1** | 圖片上傳鏈路:後台選檔 → 上傳(R2 或 Supabase Storage,見 Q3)→ 回 URL 存 DB。含檔案大小/型別白名單、fail-closed | 🔴 **高風險片**(鐵則 12 ④平台設定 + 新 env/金鑰) | 60-90 分 |
| **UP-2** | 圖片管理:列出已上傳、刪除、替換(避免孤兒檔案累積) | 標準片 | 40 分 |

### 批 3 —— 內容管理:首頁可編輯

| 片 | 內容 | 片型 | 估時 |
| --- | --- | --- | --- |
| **CM-1** | 內容表 schema:`site_content`(區塊 key + 欄位 jsonb + 版本 + 生效狀態 + 誰改的)+ RLS(anon 唯讀 active、service_role 寫)+ seed 現行 hardcode 值 | 🔴 高風險片(鐵則 12 ③DB) | 60 分 |
| **CM-2** | 前台首頁改讀 DB:HomeHero → 內容表(含圖 URL);**保留 hardcode 當 fallback**(表空/查詢失敗 → 顯示現況,不讓首頁破) | 標準片 | 50 分 |
| **CM-3** | 後台首頁內容編輯 UI(橫幅圖+文案、故事區選品牌+文案、服務三欄文案) | 標準片 | 60 分 |
| **CM-4** | 「最新商品」語意修正 + 後台可挑選(依 Q5 答案) | 標準片 | 40 分 |

### 批 4 —— 商品管理(最大工程)

| 片 | 內容 | 片型 | 估時 |
| --- | --- | --- | --- |
| **PM-1** | 權威鎖 schema(§3 甲案):`product_field_overrides` 表 + 合併純函式 + 窮舉測試 | 🔴 高風險片(鐵則 12 ③DB;影響全站商品顯示) | 60 分 |
| **PM-2** | 合併函式接進所有商品讀取路徑 + 守門測試(漏一處=不一致) | 🔴 高風險片(動共用資料流) | 60 分 |
| **PM-3** | 後台商品列表 + 明細(唯讀先行:看得到同步值 vs override 值) | 標準片 | 60 分 |
| **PM-4** | 後台編輯商品卡片內容(寫 override 表;**排除價格欄**見 Q6) | 🔴 高風險片 | 60 分 |
| **PM-5** | 手動新增商品(`supplier_slug='manual'` 表單化,鏡像 1 元商品先例:handle 唯一/brand/category FK/至少一變體/SKU 規則) | 🔴 高風險片(新增可販售商品=錢相鄰) | 60-90 分 |
| **PM-6** | AI 協助改商品:AI 寫 override 表(`source='ai'`)+ 後台審核套用/退回 | 標準片(建立在 PM-1 之上) | 60 分 |

### 批 5 —— 後台強化

| 片 | 內容 | 片型 | 估時 |
| --- | --- | --- | --- |
| **AD-1** | 後台首頁 dashboard(今日訂單/待處理/近期營收) | 標準片 | 50 分 |
| **AD-2** | 角色分級(取代目前只有具名身分;§2.4-2) | 🔴 高風險片(鐵則 12 ②權限) | 60-90 分 |
| **AD-3** | 訂單/客戶列表關鍵字搜尋 | 標準片 | 40 分 |

---

## 5. worktree 併行策略(Sean 提到「開 worktree 同步動工」)

🔴 **硬約束**:`dev` 是線性共用分支,**同一時間只允許一個寫入 session**(`docs/handoff/CURRENT.md:5`);2026-07-19 與 07-24 各發生一次並行 session 撞車(`git stash` 誤丟、共用 git index 汙染,memory `project_parallel-sessions-shared-git-index-collision`)。

**可安全併行(檔案零重疊)**:

| 併行組 | 為什麼安全 |
| --- | --- |
| 批 0(SR 搜尋,`components/SearchModal.tsx` + Header)‖ 批 1 CU-1(admin 客戶) | 一個 storefront、一個 admin,零共用檔 |
| 批 2 UP(上傳基建)‖ 批 1 BR-1(品牌路由) | 一個 admin+平台設定、一個 storefront 路由 |
| 退刷線 RF1(`packages/domain/src/order/`)‖ 批 0 SR-1 | domain vs storefront components |

**必須序列(有依賴或改同一檔)**:
- 批 2 UP-1 → 批 3 CM-2/CM-3(沒有上傳就換不了圖)
- 批 4 PM-1 → PM-2 → PM-3/PM-4/PM-5(權威鎖是全部商品功能的地基)
- 任何動 `packages/domain` 的片彼此序列(退刷線 RF1/RF2a-0 與 PM-1 都會動 domain)
- 🔴 **所有 migration 片一律序列**(migration 檔名時戳 + 套用順序、且都要 Sean db push)

**紀律**:每個 worktree 開工前 `git log --oneline -1` 對齊、收工前 `git status` 確認只有自己的檔;**禁 `git add .`**;每 add 立即 commit(memory `feedback_concurrent-session-git-index-contamination`)。

---

## 6. 與現有路線圖的關係(誠實對帳)

| 既有記載 | 本檔的處置 |
| --- | --- |
| `docs/PHASE-2-VISION.md:296` 列「Admin UI 客製化(Phase 1 用 Medusa Admin 既有)」= Phase 2 不做 | 🔴 **此字面已被現實超越**:PCM 沒用 Medusa Admin,而是自建 `apps/admin` 並已上線(`admin.pcmmotorsports.com`)。Sean 的願景=擴充這個自建後台。**建議在 Sean 拍板後更新該行**,不要留著矛盾字面 |
| `PHASE-2-VISION.md:298` 「大量上架/爬蟲/API 同步 pipeline(Phase 1 不做)」 | 🔴 **也已被超越**:9 家供應商同步 pipeline 早已在跑(`scripts/rpm-*`、`apps/sync-engine`) |
| `docs/specs/2026-07-12-search-vehicle-work-plan.md` §4 S3 搜尋 MVP | 本檔批 0 SR-1 = 其中「① 修 Header 接 SearchModal」那一步,刻意縮範圍先上(§4 批 0 已揭示) |
| backlog #271 品牌信任狀 hardcode 無後台 CRUD | 由批 3 內容管理涵蓋(Showcase 內容也可進內容表) |
| backlog #277 車輛下拉只讀 direct fitment | 與批 0 無關(那是選車資料覆蓋度、非關鍵字搜尋);維持獨立 |
| backlog #295 免運門檻後台管理(本 session 新登) | 與批 3 內容管理同性質但**動 create_order**、風險等級不同 → 維持獨立、退刷線後評估 |
| `STATUS.md:149` 搜尋線列「未排」 | 本檔提議排入批 0;待 Sean 拍板後更新 STATUS |

---

## 7. 範圍判定(Phase 1 內 vs 範圍擴張)

**Phase 1 範圍內(鐵則 9 已授權、不需擴張拍板)**:
- 批 0 搜尋接線(design 已有 SearchOverlay = Phase 1「把 design 上架」的一部分,鐵則 1)
- 批 1 BR-1 品牌頁(Showcase 已寫、design 有)
- 批 1 CU-1 客戶累計金額(M-4a 客戶線自然延伸)
- 批 3 內容管理(**鐵則 9 L3 強制**:若 Sean 週級改首頁 → 必後台 CRUD,規則本身要求)

**🔴 範圍擴張、需 Sean 明確拍板**:
- 批 2 圖片上傳(新平台依賴 + 新金鑰)
- 批 4 商品管理全部(PM-1~PM-6;動同步資料流、新增可販售商品)
- 批 5 AD-2 角色分級

---

## 8. 🔴 決策題(等 Sean 早上答;每題 2-4 選項 + 推薦)

```
Q1 施工順序:先修哪個?
背景:搜尋點了沒反應是客人現在就看得到的;品牌介紹頁 12 頁已寫好只差開路由;
     後台內容管理要先做圖片上傳基建才動得了。
A(推薦): 照我排的批 0→1→2→3→4→5(先修客人看得到的破功能,再上便宜的,基建再後面)
B: 先做後台內容管理(你最想要的),搜尋往後排
C: 兩條併行 —— 我開 worktree,一條走搜尋+品牌頁,一條走圖片上傳+內容管理
A: A|B|C

Q2 退刷線怎麼辦?
背景:退刷自動化線(後台取消訂單自動退款)RF1 的 plan 已經過 codex 兩輪審查,
     兩輪抓到 12 個問題我全部修好了(其中一個是我自己把測試期望值算錯)。
     規則規定 plan 層審查最多 2 輪、第 2 輪還 FAIL 要停下問你。
     第 2 輪的 4 個問題都是機械性錯誤(算錯數字/契約矛盾/文件沒同步),
     沒有一條質疑核心公式或架構方向。
A(推薦): 直接開工實作 RF1(程式碼還會過 code-reviewer + codex 第二關兩道審查)
B: 再跑一輪 plan 審查才動手(多花約 15 分鐘 codex 費用)
C: 退刷線先暫停,把上面全站規劃的批 0/批 1 做完再回來
A: A|B|C

Q3 圖片上傳存哪裡?
背景:後台要能換首頁大圖/商品圖,但現在整個專案零上傳功能。
     兩個現成選項,我們兩邊都已經有帳號。
A(推薦): Cloudflare R2 —— 之前 Lightech 圖片已定調「源頭轉存 R2」,而且 Vercel Hobby 的
        圖片處理額度(5000 張/月)撞過牆,R2 不受這個限制;缺點=要新設一組金鑰
B: Supabase Storage —— 已經有 Supabase Pro、同一套權限系統、不用再開服務;
   缺點=圖片流量算在 Supabase 頻寬,大圖多了要注意費用
A: A|B

Q4 首頁大圖現在用的是 Unsplash 圖庫圖,要怎麼處理?
背景:HomeHero.tsx 的圖片網址直接指向 Unsplash。商業網站這樣用有兩個風險:
     ①授權條款要確認 ②原作者可以撤下圖片,首頁會破圖。
A(推薦): 內容管理做好時一併換成我們自己的照片(你上傳),Unsplash 只當暫時佔位
B: 現在就先換掉(從你現有的車輛/商品照片挑一張,我接上去)
C: 先查清楚 Unsplash 授權能不能商用再決定
A: A|B|C

Q5 首頁「最新商品」區塊要顯示什麼?
背景:它現在的實作其實是「寫死撈碳纖維部品分類」,不是真的最新商品 —— 名字跟行為不符。
A(推薦): 改成「精選商品」,後台可以自己挑要放哪幾個(最靈活,配合你要的後台管理)
B: 改成真正的「最新上架」,按上架時間自動排(零維護,但你控制不了放什麼)
C: 兩個都做:一區精選(你挑)+ 一區最新上架(自動)
A: A|B|C

Q6 後台編輯商品時,價格要不要也能改?
背景:商品內容(標題/描述/圖)走「override 覆寫層」我可以做得很安全。
     但價格牽涉經銷價、會員分級、金流,而且經銷價有「絕不外洩」的鐵則。
A(推薦): 價格不進內容編輯 —— 內容(標題/描述/圖/亮點)可改,價格另走一條有完整
        audit 的窄路、之後單獨規劃(避免改文案時手滑改到錢)
B: 價格也一起做進去(方便,但風險高、要多跑金流層級的審查)
A: A|B
```

---

## 9. 不做 / 風險 / 誠實邊界

- **本檔零程式實作**:所有結論來自唯讀偵察;沒有動任何 code、schema、env、部署。
- **未查證項**:①Unsplash 授權條款原文(Q4-C 才查)②R2 vs Supabase Storage 的實際費用比較(Q3 定案後查)③商品列表套 override 合併後的效能實測(PM-1/PM-2 時做)。
- **估時可信度**:批 0-1 估時信心較高(檔案已定位);批 3-4 是**規劃級估時**,逐片寫 plan 時會重估(鐵則 4 超 45 分即拆)。
- **同步 pipeline 我沒有全讀**:`scripts/rpm-import.ts` 與 `apps/sync-engine` 只讀了與 `supplier_slug`/override 相關的段落。批 4 開工前需針對它做完整偵察 pass。
- 🔴 **本檔提議的施工順序尚未經 codex 對抗審查**(見下方「審查狀態」)。
- 🔴 **不得據本檔宣稱任何功能「已上線」或「已修好」**:全部都是待做項。

---

## 10. 審查狀態

| 關卡 | 狀態 |
| --- | --- |
| 偵察 pass | ✅ 三路(admin 現況 / 前台內容來源 / 搜尋鏈路)完成,結論已附檔案:行號 |
| 自審(字面 vs 事實) | ✅ 每條結論都可回溯到實查行號;與舊文件矛盾處已在 §6 逐條對帳 |
| codex 關卡1(本檔規劃層) | ⏳ **待跑**(本檔為送審凍結版) |
| Sean 拍板 | ⏳ §8 六題待答 |
