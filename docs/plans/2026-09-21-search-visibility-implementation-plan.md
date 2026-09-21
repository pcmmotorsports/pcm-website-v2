# Google 搜尋能見度改善計畫

> Sean 於 2026-09-21 選擇「甲」，授權由 Codex 實作原研究結論的第 1–4 項。本計畫記錄實際程式射程；`next.config.ts` 變更依 `CLAUDE.md` 鐵則 8 留下原因、影響與 rollback。

## 目標

讓 Google 能從商品目錄的 HTML 連結逐頁找到商品，並把有明確現代替代頁面的舊 WordPress 網址永久導向正確內容。保留既有 canonical、noindex、商品結構化資料與仍然正確的 404。

## 已確認現況

- `/products` 每頁有商品連結，但分頁控制只有按鈕，沒有 `href`；Google 主要只能靠 sitemap 發現深層商品。
- 首頁分類、首頁品牌、品牌頁分類、商品麵包屑與相關商品都已有可爬取連結，不需重寫。
- Product JSON-LD 已輸出圖片白名單、一般會員價格、TWD、BackOrder、NewCondition、priceValidUntil、SKU、分類與 canonical URL；缺少真實圖片的商品刻意不輸出假圖片。
- Search Console 的 29 筆 404 都是舊 WordPress 網址；只有一部分有明確的新頁面。

## 修改內容

### 1. 商品目錄分頁

- 將有效的上一頁、下一頁與頁碼改為 Next.js `Link`，保留目前外觀、捲動及無效箭頭狀態。
- 每個 `href` 保留目前 query，只更改主清單的 `page` 或通用配件的 `upage`。
- 第 1 頁移除對應 query key，避免產生 `page=1`／`upage=1` 的重複網址。

### 2. 內部連結

- 不新增另一套品牌或分類導覽；既有首頁、品牌頁、商品頁連結已覆蓋。
- 分頁連結補上後，目錄第 2 頁以後會第一次擁有從前一頁可走到的 HTML 路徑。

### 3. 舊 WordPress 精準轉址

使用 308 永久轉址。ASCII destination 沿用 `next.config.ts` 的 `permanent: true`；中文分類 query 則由 `app/[...legacy]/route.ts` 依 URL 正規化後的完整路徑白名單接住，再以 308 Response 回傳單層百分比編碼的 Location。

沒有直接把中文分類 query 寫在 `next.config.ts`：Next production server 會先解碼單層 destination，形成非法 Location；若改成雙層編碼，Vercel 會原樣保留，商品頁收到 `%E6...` 字面後反而丟掉分類。白名單接收器只接受下表九條 URL 正規化後的完整路徑，其餘網址仍呼叫既有 `notFound()`。依 URL 標準，`.`／`..` 區段會在進入應用程式前消除，視為正規化後路徑的等價寫法；編碼斜線、雙重編碼與框架內部標記仍保持不同並回 404。

| 舊網址 | 新網址 |
| --- | --- |
| `/原廠零件-pcm-重機零件販售-pcm-motor/` | `/` |
| `/排氣管/` | `/products?category=排氣系統` |
| `/碳纖維`、`/碳纖維/index.html` | `/products?category=碳纖維部品` |
| `/懸吊系統/`、`/懸吊系統/index.html`、`/懸吊系統/懸吊系統/index.html` | `/products?category=懸吊與車架` |
| `/輪框/`、`/懸吊系統/輪框.html`、`/改裝精品/輪框.html` | `/products?category=懸吊與車架 · 輪圈` |
| `/category/brands`、`/category/brands/index.html` | `/brands` |

下列網址沒有單一且可信的替代內容，繼續回 404：作者頁、留言／分類 Feed、Hello World、`/改裝精品`、`/耗材零件工具`、`/車身改裝精品`、`/category/cases`、`/category/index.html`、`/author/index.html`。

## 影響與 rollback

- 影響只限商品目錄連結與上表精確舊路徑，不改資料庫、商品資料、價格、權限或訂單流程。
- 若分頁導覽回歸，可回復 `Pagination.tsx` 與 `ProductsPage.tsx` 本次差異。
- 若首頁／品牌轉址對照不正確，可從 `apps/storefront/next.config.ts` 移除該單一規則。若中文分類對照不正確，可從 `apps/storefront/src/lib/legacy-category-redirect.ts` 移除該完整路徑；未列入白名單的舊網址維持 404。

## 驗證

- 先跑分頁元件與商品頁測試，證明 `a[href]`、query 保留及邊界箭頭。
- `next.config.test.ts` 檢查 ASCII destination 的精準規則；`legacy-category-redirect.test.ts` 逐條檢查中文路徑、單層編碼、分類解析與 404 負對照。
- 完成後跑 storefront typecheck、lint、build 與 repo 完整測試。
- 本機 production server 以 `curl -I` 驗證代表性舊網址的實際狀態碼、Location 與 404 負對照。
