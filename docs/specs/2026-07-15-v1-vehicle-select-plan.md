# V-1 VehicleSelect 統一元件 — slice plan v1(2026-07-15;真權威=order-item-vehicle-capture-design.md v0.2 §6-8+overnight-kickoff 追加節)

> 鐵則 8 plan(動共用元件+跨多檔)。Sean 已拍 Q4=全站同一元件同一 context+過夜授權;本 plan 只裁「怎麼拆、怎麼落」。

## 驗收條件(=Sean 三痛點+Q4,逐條可 yes/no)
1. 選車款→點分類→進商品→上一頁:車款+分類**保留**(URL 為真相、state 從 URL 水合)。
2. 膠囊拆三顆:brand/model/year 各一顆;刪 brand 連動清 model/year、刪 year 保留 brand+model、刪 model 保留 brand。
3. 首頁選車進型錄:頂部三層選擇器**恆顯示 context 現值**(鏡像)。
4. 型錄+首頁三層選擇**可打字**(prefix 補全、鍵盤上下+Enter、可點選;選項只出 `fetchVehicleTaxonomy` 字典字面=車種鐵律)。
5. 登入會員在首頁+型錄多一排「我的愛車」chips;點擊=**填入文字跑字典精確比對**:唯一命中→直接套用;多/零命中→展開建議清單讓客人挑。**零模糊匹配、零 AI 猜**(§7 紅線;車庫 name=自由文字,不可直接當字典鍵)。
6. 選定車款寫入單一 context util(URL `?vehicle=` 既有 slug 格式為主+sessionStorage 鏡寫,供 V-2 PDP/購物車讀);訪客可用。

## 偵察事實(2026-07-15 Explore 實查,非憑記憶)
- state 層已統一:`cascadeFilterReducer.ts`(289 行;actions selectVehicleBrand/Model/Year/clearVehicle);UI 層四份獨立=VehicleFinder(88)/CascadeFilterTop(166)/FilterSide.VehicleTree(已 hideVehicle 關閉)/FilterDrawer vehicle tab(381)。
- URL:`?vehicle=`(useVehicleUrlSync)、`?category=`(useCatalogFilterUrlSync)**已存在**;kickoff 引的 useBrowseUrlState 只管 page/sort/per=引述過時。⚠️ 痛點 #1 根源待診斷:疑似 sync hook 單向(state→URL)、mount 不從 URL 水合(#3 鏡像同根源)。
- 車款跨頁 context/storage=零(URL 是唯一載體);VehicleSelect/vehicle-context 半成品=零。
- 愛車:`CustomerVehicle`(name 自由文字+year+isPrimary)、SupabaseVehicleAdapter+account/vehicle/actions.ts 齊備。
- design-reference:`ed-finder-bar`/`cft-cascade` 三 select 字面;**typeahead 零先例**=行為層 Sean 口述授權偏離、視覺(尺寸/框線/token)對齊現 select 樣式。
- 鐵則 6 現況:FilterSide 411(已超、本 slice 不碰)、ProductsPage 399(壓線、改動必須淨減行或持平)。

## 拆片(各 15-45 分、各自三綠+code-reviewer+commit;plan 過值班台後照序做)
- **V-1a URL 水合+膠囊三顆**(不新增元件、先解痛點 1/2/3):
  ①診斷:實證 sync hooks 方向(讀 useVehicleUrlSync/useCatalogFilterUrlSync 全文+dev 實跑帶參 URL);若已雙向則痛點 1/3 另找根源(分類點擊導航丟參?)、證據貼 plan 附錄再修。
  ②修:mount 時 vehicle/category/pbrand/price 從 URL 水合進 reducer 初始 state(單一方向規則:URL=真相);
  ③ActiveChips 拆三顆+連動刪除語意;reducer 若缺「只清 year/只清 model」action 則補(含單測)。
- **V-1b VehicleSelect 元件+型錄掛載**:新 `components/vehicle/VehicleSelect.tsx`('use client';三欄可打字 combobox、prefix 匹配、鍵盤導航、aria-combobox;選項=taxonomy props 直出);CascadeFilterTop 桌機+FilterDrawer 車輛 tab 換裝(視覺沿 `cft-*` 對齊);元件 jsdom 行為測(打字過濾/鍵盤選/清除連動)。
- **V-1c 首頁+愛車 chips+context util**:VehicleFinder 換裝同元件+登入會員 chips(server 端 listByCustomer 傳入;點擊=驗收 5 流程);新 `lib/vehicle-context.ts`(URL slug 編解碼共用+sessionStorage 鏡寫;V-2 消費);首頁選車→型錄鏡像走既有 URL。

## 明確不做(範圍鎖)
- 不動 FilterSide(VehicleTree 死碼清理=另開 backlog)、不動 schema/RPC/金流(V-3 事)、不做 PDP 比對與購物車欄(V-2)、不做搜尋線、車庫 CRUD 不動。
- ProductsPage 若因掛載改動逼近 400 行=拆出子元件、不硬塞。

## 風險與 rollback
- 純 client+URL 層、零 migration:rollback=revert 對應 commit。
- 風險 1:URL 水合改 reducer 初始化=動共用 filter 行為 → V-1a 單獨 commit+全 storefront vitest+實跑帶參 URL 驗。
- 風險 2:typeahead 選項量(brand 數十/model 數百)client 過濾=毫秒級,無效能面;taxonomy cache 900s 既有。
- 風險 3:chips 精確比對規則若值班台認為過保守/過鬆 → plan 審裁定,實作前定案。

## L 分級
hint/文案=L2(hardcode+TODO);其餘=功能層無內容分級議題。

## 附錄:V-1a 診斷結果(2026-07-15 plan 提交後、動工前實查;取代 plan 內「待診斷」)
- **URL↔state 其實已雙向**:`useDeepLinkRestore`(products-url-state.tsx:272-301)mount 時已水合 vehicle+category+brands。kickoff 引述的「篩選只在 state」過時。
- **痛點 #1 真根源 = 兩個具體 bug**:
  - **A. 首頁分類卡裸連結**:`CategoryGrid.tsx:52` href=`/products?category=X` 不帶 vehicle → 首頁選車後點大分類、車款在導航一步被洗掉(URL=唯一載體)。PDP 早有 `withVehicle()` idiom(`ProductPage.tsx:123-130`)保留車款、首頁未用。
  - **B. 子分類不回水合**:`parseCategoryFromUrl`(products-url-state.tsx:44-53)自註「子類深連結留 #212」、只還原大類;`useCatalogFilterUrlSync` 寫出 `main · sub` 組合字串,還原端 `selectCategoryMain` 單層 dispatch=回程子分類丟。
- **痛點 #3(鏡像)**:vehicle 水合既有 → 首頁選車進型錄理論上已鏡像;待 V-1a 實跑確認,若仍不鏡像=CascadeFilterTop 顯示層問題另修。
- **design 先例**:design ProductPage.jsx L40-82 有 SPA `globalVehicle` 跨頁機制 → V-1c context util=同語意的 storefront 轉譯(URL+storage),非無中生有。
- **V-1a 修法收斂**:①CategoryGrid(+首頁其他 /products 入口)套 withVehicle 同款保留(抽共用 util)②parseCategoryFromUrl 支援 `main · sub` 還原+dispatch 子類 action ③膠囊拆三顆照原 plan。
