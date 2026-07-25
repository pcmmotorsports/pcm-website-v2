# 後台通用 UX 模式研究(Shopify Polaris / Medusa Admin / WooCommerce / Odoo 實測)

> 查證日期 2026-07-25。設計規範類斷言附官方 URL;畫面觀察附截圖檔名(存於本檔同目錄 `shots2/`)。
> 查不到的一律標「未確認」,不用印象補。

---

## 1. 列表頁通用模式

**Shopify Polaris — IndexTable**
來源: https://polaris-react.shopify.com/components/tables/index-table

- 密度:預設一般密度;`condensed` 屬性隱藏批次操作,官方建議**只在螢幕寬度 <490px 時使用**。
- 可排序:`sortable` 為每欄布林陣列控制是否可排序;`defaultSortDirection` 預設 `descending`;`onSort(headingIndex, direction)` callback;`sortToggleLabels` 可自訂升降序標籤文字。
- 分頁:`pagination` prop 啟用表格底部分頁;官方文字明寫「**列表超過 50 筆項目時應分頁**」;未規定每頁預設筆數。
- 列點擊:列中若有 `data-primary-link` 屬性的錨點,點擊觸發 `onNavigation(id)`;可用 `onClick` 覆蓋預設點擊行為。
- hover 動作:官方文件**未明確說明** hover 狀態的標準互動設計(未確認)。
- 空狀態:`emptyState` 可傳入自訂 ReactNode;內容指引「應識別資源類型,通常用標題表示(如 Products)」。
- 選取:`selected` 支援 `boolean | "indeterminate"` 三態;`selectionRange` 支援 Shift 範圍多選;預設 checkbox label = "Select {resourceName}"。

**Medusa Admin — DataTable**
來源: https://docs.medusajs.com/resources/admin-components/components/data-table

- 建構方式:`createDataTableColumnHelper().accessor(...)` 定義欄位,`header`/`cell` 自訂渲染。
- 排序:`enableSorting: true` 逐欄開啟;`sortLabel`/`sortAscLabel`/`sortDescLabel` 可自訂文案(範例用 "A-Z"/"Z-A")。
- 分頁:官方範例 **`limit = 15`(每頁 15 筆,寫死)**,`offset = pageIndex * limit`,搭配 `<DataTable.Pagination />`;**每頁筆數選項(page size selector)文件未提及**(未確認)。
- 選取與批次操作、空狀態:**本頁文件未涵蓋**(未確認,需查其他頁面或原始碼)。

**Odoo(實測截圖,非規範文件、僅供對照)**
- 桌機列表(`shots2/02-odoo-sales-list.png`):view switcher 圖示(list/kanban/map/calendar/pivot/graph/activity)並排在右上角;分頁用「1-27 / 27」文字 + 上一頁/下一頁箭頭,**無傳統頁碼列**;checkbox 在最左欄;金額欄右對齊;狀態用彩色圓角 pill。
- 桌機批次選取(`shots2/07-odoo-bulk-select.png`):選取後標題列直接被「N selected ✕」+ 動作按鈕(Create Invoices / Confirm Orders / Print / Actions 齒輪選單)取代,**動作內嵌在原本工具列位置、不是額外浮動 bar**;選取列有色塊高亮+左側色條。

---

## 2. 篩選與搜尋模式

**Shopify Polaris — Filters / IndexFilters**
來源: https://polaris-react.shopify.com/components/selection-and-input/filters 、 https://polaris-react.shopify.com/components/selection-and-input/index-filters

- 位置:Filters 為 composite component,搭配 ResourceList/DataTable 放在列表上方一整條 bar。
- 多選:`allowMultiple` 啟用;篩選內容用 Popover 彈窗 + ChoiceList 呈現。
- 已套用篩選:以 **「filter pills」**呈現,每個 pill 有 `onRemove` 可個別移除,另有 `onClearAll()` 一次清除。
- 建議:「**行動優先篩選(promoted filters)最多 2-3 個**」,常用篩選 `pinned to the front of the bar`。
- 搜尋:獨立 `queryValue` 文字欄,可用 `hideQueryField`/`disableQueryField` 控制顯示,`onQueryChange`/`onQueryClear` 即時回調(即時性細節文件未給出防抖數值,未確認)。
- **Saved views(儲存檢視)**:IndexFilters 用 **Tabs** 實作 — 每個 tab = 已排序/篩選/搜尋的一個命名子集;可 `rename`/`duplicate`/`edit`/`delete`;`isLocked: true` 常用於預設「All」tab;新建檢視需 `canCreateNewView` + `onCreateNewView` 回傳 `Promise<boolean>`;`primaryAction` 自動在 "Save"(編輯既有檢視)與 "Save as"(新建檢視)間切換。

**Medusa DataTable**
- `filterHelper.accessor(...)` 支援三種篩選型態:`select`(下拉多選)、`radio`(單選)、`date`(日期)。
- 搜尋用 `<DataTable.Search>` + `q` API 參數,即時性細節未提供防抖數值(未確認)。

---

## 3. 批次操作模式

**Shopify Polaris**
來源: 同上 IndexTable 頁

- 選取:全選 checkbox 在表頭;`selectionRange` 支援 Shift 範圍選;**跨頁全選**有專屬文案 API — `paginatedSelectAllActionText` / `paginatedSelectAllText`(即「已選取本頁全部,是否選取全部 N 筆」的標準模式)。
- 動作列出現方式:`promotedBulkActions`(常用動作直接露出) + `bulkActions`(其餘收進選單);官方文案規則「**動詞+名詞**公式」(如 "Archive products",非 "Products archive")。
- 小螢幕:condensed 模式下**隱藏批次操作**(<490px)。
- 確認對話框/失敗處理/進度回饋:**Polaris IndexTable 頁未提供**(未確認;Banner 頁面也未提及破壞性動作確認元件,見下節)。

**Odoo 實測**(`shots2/07-odoo-bulk-select.png`)
- 選取後原標題「Quotations」位置被「2 selected ✕」取代,動作按鈕(依 model 而異,如 Create Invoices / Confirm Orders / Print / 齒輪 Actions 選單收其餘動作)直接顯示在同一列、不彈出額外 bar。
- checkbox 選取態視覺:方框變實心勾選 icon(青色),列背景加深。
- **上限與失敗處理、進度回饋**:未實測到(未確認)。

---

## 4. 表單頁通用模式

**Shopify Polaris — Banner(表單錯誤相關)**
來源: https://polaris-react.shopify.com/components/feedback-indicators/banner

- 「當商家提交長型或複雜表單出現錯誤時,使用 **critical banner 總結問題**」,banner 置於表單頂端並**移動焦點至該 banner**。
- 「始終為特定欄位包含**行內錯誤訊息**,讓商家在情境中理解如何修正」——即 banner(總結)+ inline error(逐欄)雙層並存。
- Banner 預設應可關閉,除非內容是關鍵資訊或必要步驟。

**Polaris Accessibility 基礎頁**(焦點管理規則,通用於表單)
來源: https://polaris-react.shopify.com/foundations/accessibility

- 「商家啟動連到頁面它處的連結時,焦點應移到該內容」;需要商家存取覆蓋層時焦點移過去。
- 「**表單提交產生錯誤時,焦點移至錯誤訊息**」——這條直接對應「行內驗證時機」與「儲存失敗回饋」設計。
- 不應做:背景內容更新時搶焦點、商家在頁面其他地方工作時搶焦點、未經同意就程式化移動焦點。

**主欄/側欄分工、區塊卡片化、sticky save bar、離開警告、auto-save vs 手動儲存**:
Polaris 官方頁面**未直接查到**專屬頁面規範這幾點(未確認;僅從 IndexFilters/DataTable 範例與 Odoo 實測畫面間接觀察到卡片化 pattern)。

**Odoo 實測(表單頁,`shots2/03-odoo-form.png`)**
- 桌機:頁首麵包屑「Requests for Quotation / P00014」+ 星號收藏 + 上一筆/下一筆記錄導覽箭頭(不是分頁,是同篩選集合內換記錄);左上一排主要動作按鈕(Receive/Upload Bill/Send PO/…);右上狀態列(statusbar,階段式進度條:RFQ → Purchase Order);主欄位單欄左標籤右輸入;分頁籤(Products / Other Info)在主欄位下方切換次要區塊;明細列表(line items)每列有拖曳把手 + 刪除垃圾桶圖示。
- 手機(`shots2/06-odoo-mobile-form.png`):**單欄堆疊**,每個欄位獨占一整行、label 在欄位上方(非左側);頂部只留返回箭頭+記錄號+主要動作按鈕(精簡到 1-2 個);狀態徽章(pill)疊在欄位卡片內。

**未確認**:sticky save bar 是否為 Polaris/Medusa 標準做法、未儲存變更離開警告的官方元件、auto-save vs 手動儲存的官方建議 — 三者都沒查到官方文件明確表態,Odoo 實測畫面也沒觸發存檔情境驗證到。

---

## 5. 回饋與錯誤

**Toast(依 WebSearch 摘要,非直接 WebFetch 全文,標記查證方式)**
來源: 搜尋結果摘要指向 https://polaris.shopify.com/components/deprecated/toast(⚠️ Polaris 標示此元件 **deprecated,建議改用 App Bridge Toast API**)

- 「Toast 應維持顯示至少 **10,000 毫秒**(10 秒)以符合無障礙要求,尤其當 toast 含有可互動的 action 時」。
- 「Toast 用於簡短訊息確認動作,**文字不超過 3 個字**」;用於一般性、非關鍵的成功/動作確認。
- 位置:「非侵入式訊息,出現在介面**底部**」。

**Banner**(見上節)= 表單層級/需要商家採取行動的訊息用 critical banner,非 toast。

**破壞性動作確認模式**:Polaris Banner 頁**未提及**確認對話框(Modal)機制(未確認,需另查 Modal 元件頁,本輪未排入查證範圍)。

**樂觀更新 vs 等待伺服器**:官方文件**未查到**明確表態(未確認)。

---

## 6. 導覽結構

**Shopify admin 側邊欄頂層項目**
來源: WebSearch 摘要(help.shopify.com 系列頁,無法逐字 WebFetch 因 Cloudflare/內容限制,以下為搜尋引擎摘要整理,非逐字原文——標記為**中等信心**)

Home、Orders、Products、Customers、Analytics、Marketing、Discounts、Settings(另有 Sales channels/Apps 作為安裝後動態加入項目)。

**Shopify Settings 分類**(來源: help.shopify.com/en/manual/shopify-admin/shopify-admin-overview,WebFetch 摘要)
- 確認命中:General(帳戶詳情/管理員偏好)、Security、Apps、Sales channels。
- **完整分類清單(Plan/Billing/Users and permissions/Payments/Checkout/Shipping and delivery/Taxes and duties/Locations/Notifications/Custom data/Files/Languages/Policies/Domains)未在可抓取頁面逐字證實**——這些是 Sean prompt 裡列的常見項目,本輪**未逐項核實**,標「未確認」。

**Medusa Admin — Settings 分類**(高信心,WebFetch 逐字)
來源: https://docs.medusajs.com/user-guide/settings

Manage Store、Manage Users、Manage Regions、Manage Tax Regions、Manage Return Reasons、Manage Refund Reasons、Manage Sales Channels、Manage Product Types、Manage Product Tags、Manage Location & Shipping Settings、Manage Publishable API Keys、Manage Secret API Keys、Manage Workflow Executions、Manage Profile。
Settings 在側邊欄**最底部**,點擊後**切換成獨立的第二套側邊欄**(非同一頁展開)。

**Medusa Admin 頂層導覽**(未逐字 WebFetch 到官方單一清單頁,WebSearch 摘要 + GitHub issue 間接證實):Orders、Products、Inventory、Customers、(其餘如 Price Lists / Promotions / Settings 未逐字核實)——標**中等信心**。

**WooCommerce**
來源: https://woocommerce.com/document/woocommerce-menu-items/(WebFetch)

WordPress admin 新增 4 個頂層選單:
1. **WooCommerce**(子項:Home、Orders、Customers、Reports、Settings、Status、Extensions)
2. **Products**(子項:All Products、Add New、Brands、Categories、Tags、Attributes、Reviews)
3. **Analytics**(子項清單原文未列出,僅說明涵蓋 products/revenue/orders/coupons/taxes/downloads/inventory 等報告)
4. **Marketing**(子項:Overview、Coupons)

→ 三家對照:Shopify/Medusa 是「**扁平頂層 + 各自 Settings 收斂**」;WooCommerce 因寄生 WordPress admin,是「**少量頂層 + 深子選單**」,PCM 目前規模應更接近 Shopify/Medusa 模式(扁平)。

---

## 7. 響應式/手機

**Polaris 官方**:IndexTable 文件僅提到 condensed 模式在 <490px 隱藏批次操作,無更多手機專屬版面規則(未確認完整手機表格方案)。

**Odoo 實測(唯一有真實截圖佐證的部分)**
- 桌機表格 → 手機**自動轉成卡片列表**(`shots2/05-odoo-mobile-list.png`):每張卡片主要欄位(客戶名)加粗置頂,次要欄位(單號+日期+活動 icon)副行,金額+狀態 pill 靠右對齊。表格的多欄資訊被重新排版成「主要-次要-右側標籤」三段式,而非橫向捲動表格。
- 頂部導覽:漢堡選單(☰)取代橫向 tab 列;搜尋收進圖示按鈕;view switcher 收進圖示按鈕。
- 手機表單(`shots2/06-odoo-mobile-form.png`):見第 4 節,單欄堆疊、label 上置。
- **未實測**:手機上「橫向捲動表格」這個常見替代方案是否也被使用(Odoo 本輪只看到卡片化這一種,未確認是否有其他頁面用捲動表格)。

---

## 8. 無障礙與鍵盤

**Shopify admin 鍵盤快捷鍵**
來源: https://help.shopify.com/en/manual/shopify-admin/productivity-tools/keyboard-shortcuts (WebFetch)

- 按 **`?`** 鍵開啟快捷鍵清單彈窗;`Esc` 或點外部關閉。
- 快捷鍵為**序列式**(如 `A` `P`,非同時按),須**由左到右依序輸入、約 1 秒內完成**。
- 具體快捷鍵清單內容(如各頁面對應鍵)**該頁未提供**(未確認)。
- **Cmd/Ctrl+K 命令面板**:WebSearch 未找到 Shopify admin 主介面有此功能的證據(未確認/可能不存在;POS 系統另有 Cmd+K 但不算主 admin)。

**Polaris Accessibility 基礎**
來源: https://polaris-react.shopify.com/foundations/accessibility

- 焦點管理三規則(見第 4 節):連結導頁移焦點、開覆蓋層移焦點、**表單錯誤移焦點到錯誤訊息**;反例:背景更新/商家操作中/未經同意時不該搶焦點。
- 互動元素應可用 **Enter 或 Space** 觸發(標準鍵盤操作預期)。
- 優先原生 HTML 元素,自訂控制項須有清楚說明+標準替代操作。
- 使用 ARIA(WAI-ARIA)補充原生語意,目標 **WCAG 2.1 Level A/AA**。
- 元件圖示/圖片需替代文字支援螢幕閱讀器。

**Medusa / Odoo**:本輪未查到 Medusa 官方無障礙專頁;Odoo 未做鍵盤/ARIA 專項測試(未確認)。

---

## 截圖清單(`shots2/`)

| 檔名 | 內容 |
|---|---|
| `01-odoo-home.png` | Odoo app launcher 首頁,含完整頂層 app 清單(Sales/Inventory/Purchase/…) |
| `02-odoo-sales-list.png` | 桌機列表頁(Quotations):view switcher、分頁箭頭、filter pill、狀態 pill |
| `03-odoo-form.png` / `03-odoo-form-clean.png` | 桌機表單頁(Purchase Order):statusbar、主欄位、分頁籤、明細列表 |
| `04-odoo-inventory-kanban.png` | Inventory app 總覽(對照用) |
| `05-odoo-mobile-list.png` | 手機版列表 = 卡片化,390×844 |
| `06-odoo-mobile-form.png` | 手機版表單 = 單欄堆疊,390×844 |
| `07-odoo-bulk-select.png` | 桌機批次選取:動作內嵌工具列、非浮動 bar |

---

## 未確認清單(總表)

1. IndexTable / DataTable 的 hover 動作標準設計。
2. Medusa DataTable 的每頁筆數選項、列選取與批次操作、空狀態設計(官方頁面未涵蓋)。
3. Polaris 批次操作的確認對話框/失敗處理/進度回饋機制。
4. Sticky save bar、未儲存變更離開警告、auto-save vs 手動儲存的官方建議(Polaris/Medusa 都未查到)。
5. 破壞性動作確認模式(Modal)的官方規則(本輪未排入查證範圍)。
6. 樂觀更新 vs 等待伺服器的官方表態。
7. Shopify Settings 完整分類清單(僅確認 General/Security/Apps/Sales channels,其餘常見項目未逐字核實)。
8. Medusa Admin 頂層導覽完整清單(僅 Orders/Products/Inventory/Customers 有一定信心)。
9. Shopify admin 具體快捷鍵清單內容、是否有 Cmd/Ctrl+K 命令面板。
10. 手機版是否也用「橫向捲動表格」而非只有卡片化(本輪 Odoo 只看到卡片化)。
