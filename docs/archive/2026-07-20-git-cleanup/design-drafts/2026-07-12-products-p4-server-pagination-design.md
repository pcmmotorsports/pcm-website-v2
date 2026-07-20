# 商品目錄 P4 伺服器分頁設計

> 狀態：Sean 已批准架構（2026-07-12）。本文件是實作前的設計真相；細項工作與測試步驟另由正式 implementation plan 定義。

## 目標

把 `/products` 從「一次傳完整目錄、瀏覽器再篩選和分頁」改成「網址描述結果集、伺服器只回當頁安全列表投影」。使用者既有的篩選、商品連結、返回與深連結行為必須保持正確，且不得讓經銷價或內部欄位進入一般會員瀏覽器。

## 已驗證現況

- 正式站公開目錄為 12,302 筆；全量 detail 投影約 4.12 MB gzip／23.8 MB 解壓，導致首頁點進型錄約 7 秒才有資料。
- `apps/storefront/src/app/products/page.tsx` 無車款條件時呼叫 `fetchCatalogProducts()`；它經 `SupabaseProductAdapter.listAllProducts()` 分頁撈完 `products_public` detail 投影。
- `products_public` 是詳情投影，含 description、highlights、images、fitments、安裝資源等；它不適合商品卡列表。
- 現有 `products_list_public` 是 `security_invoker=true` 的公開列表 view，已物理排除 `price_store`、`price_by_tier`、metadata、description、images 與內部時間欄位；目前仍缺卡片需要的顯示資料。
- 2026-07-12 已上線 route loading fallback。它在資料抵達前顯示既有 Header、細進度線與 8 張骨架卡；P4 保留此回饋。
- 車款 URL 已由 `search_products_by_vehicle` RPC 處理，結果為 direct fitment 與 `product_fitments_effective` inherited fitment 的聯集。MT-09 SP 2021 的正式驗證結果為 124 件，不能退回舊的 client filter 或單純 JSONB 查詢。

## 批准的設計

### 1. URL 是商品結果集的唯一來源

`/products` route 解析並驗證下列參數，將其正規化為一個 catalog query：

- `page`、`per`：頁碼和每頁筆數。
- `sort`：目前可用的推薦、價格低到高、價格高到低；未實作資料語意的新品／折扣排序維持既有 no-op，不在 P4 擴張。
- `category`：現有分類深連結語意。
- `pbrand`：產品品牌 slug 的多選值。採新 key，避免和車輛舊長版 `brand`／`model` URL 命名空間衝突。
- `price`、`pmin`、`pmax`：價格標籤與滑桿範圍，兩者同時存在時取交集。
- `vehicle`：現有短版車款參數；長版 `brand` + `model` + `year` 只作舊書籤讀取相容，輸出時正規化為 `vehicle`。

客戶端操作篩選、排序、每頁筆數或頁碼時，會建立正規化網址並以 App Router 導覽。伺服器依網址重新取當頁資料；不再以 `history.replaceState` 偽裝狀態變更。page 大於最後一頁時收斂到最後一頁並使用正規化 URL。

### 2. 安全的卡片列表投影

新增一個 forward-only Supabase migration，擴充 `products_list_public`；維持 `WITH (security_invoker = true)`、既有 `GRANT SELECT` 和底層 RLS 行為。投影只能新增商品卡與列表查詢所需的公開欄位：

- 安全識別與顯示：商品 id、handle、title、subtitle、availability、supplier slug。
- 公開價格：`price_general`。
- 卡片呈現：首張公開圖片或可安全推導的卡片圖片欄位、fitment 摘要。
- 篩選與連結：brand id／slug／名稱、category id／raw path／顯示名稱。

禁止加入：`price_store`、`price_by_tier`、metadata、成本／來源金額、description、highlights、manuals、video URL、下架時間或 base table 的任何未列白名單欄位。migration 必須附 rollback SQL、以 transaction 模擬 + anon 角色唯讀驗證 view/RLS/GRANT，並更新生成型別或以最小化、可移除的 typed boundary 收斂。

### 3. 伺服器端分頁與篩選

新增清楚的 catalog-page query contract，回傳 `{ items, total }`；items 最多為已驗證的每頁上限。它會：

- 從安全 list view 取資料，使用 exact count 與穩定排序。
- 分類、產品品牌多選、價格標籤、價格滑桿都在資料庫下推；Infinity 上界不會送成 SQL 的 `Infinity`。
- 所有排序補 id 升冪作 tie-break，避免跨頁重複或遺漏。
- 車款條件走現有 `search_products_by_vehicle` RPC 的擴充分頁版本，保留 direct + inherited 結果、現有年份語意與安全白名單 JSON 回傳。
- 車款 RPC 也必提供確定的排序與 total，避免 PostgREST 的 1,000 筆上限造成靜默截斷。

P4 以小型 list DTO 給 `ProductsPage`，不會強迫它還原完整 `Product` entity。詳情頁、首頁、sitemap 與價格會員邏輯不改。

### 4. 側欄與 UI

- 車款 taxonomy 繼續走既有快取的輕量 fetch。
- 品牌 taxonomy 改走獨立輕量來源，不再由當頁商品反推；品牌和車款數字都維持全站總數。
- 分類樹保留既有快取來源。
- `ProductsPage` 顯示伺服器給的 `total`，卡片只渲染當頁 `items`。Pagination 改用真實 `<Link href>`；保留 scroll-to-top 及既有手機抽屜／Active Chips 行為。
- 任何 client cascade state 都是 URL query 的受控投影，不能再有「網址一套、client filter 一套、server list 一套」的雙腦結果集。

### 5. 快取與錯誤處理

當每頁 payload 已小於 Next 2 MB entry 限制後，catalog page query 可採 `unstable_cache`。所有可改變結果的正規化參數（含 page、per、sort、category、品牌集合、價格、vehicle）必是快取 key 的顯式引數，禁止從閉包讀取，避免跨訪客／跨頁污染。

資料庫或 RPC 失敗時 route 保持既有「載入失敗、請稍後再試」分支；loading fallback 保持可見。無結果是正常空狀態，不能誤顯為錯誤。

## 正確性與安全不變量

1. 一般會員請求只讀公開 view／公開 RPC 白名單，瀏覽器和 HTML 不含經銷價或內部欄位。
2. 相同正規化 URL 必回同一結果集與順序；排序 tie-break 為 id。
3. 品牌、分類、價格和車款條件為 AND；多個產品品牌為 OR。
4. 車款結果必包含目前 RPC 的 inherited fitment 命中；不能從 124 件退回 direct-only 結果。
5. 同一 URL 重整、前進／後退、分享連結皆還原同一篩選、排序、每頁數和頁碼。
6. 第 2 頁可由原生連結到達；沒有 JavaScript 時仍可載入 URL 對應的 server-rendered 列表。
7. 側欄 count 是全站總數，不承諾為目前交集的 facet count。

## 驗證策略

- TDD：每個 contract、URL parser、query filter、stable sort 與 UI 導覽改動先寫一個會紅的測試，再最小實作。
- query parity：以正式唯讀資料，將 P4 query 的結果和現行 `filterProducts`／`sortProducts` 的基準結果逐組比對；至少覆蓋品牌多選、分類、價格標籤＋滑桿交集、三種 vehicle 粒度、排序同價、空值價格、超出頁碼與 1,000 筆以上車款品牌。
- 安全：migration transaction 模擬，anon role 證明 public view/RPC 無敏感欄且 RLS 不回下架列；adapter test 鎖住 table／projection 白名單。
- 端對端：production build 實走首頁→型錄、每種篩選、換頁、回上一頁、刷新、分享 URL、車款 MT-09 SP 2021、手機寬度；確認 loading skeleton 即時出現且完成後正確退場。
- 成效：上線前後量測 TTFB、傳輸 bytes、HTML/Flight payload 與完整導覽時間。目標是從全量 detail payload 降為當頁級 payload 並恢復有效快取；實測數字才可宣稱達成。

## 範圍與回滾

不包含會員定價、商品詳情、金流、資料同步、隱藏新品／特價／顏色篩選的產品功能化。

資料層先以加法方式落地：新 view 投影、query contract 和測試不改現有全量路徑。最後才切換 `/products` UI。任一資料或 UI slice 都可 revert；若最後 UI 切換有回歸，revert 即回到目前「全量載入較慢但功能正確」的版本。schema migration 使用 forward-only rollback SQL，只在明確事故處置時手動執行。
