# PCM 網站成長、商品探索與成交優化 — Claude 交接文件

> **文件狀態：** 規劃交接，不代表任何功能已完成。
> **核對日期：** 2026-08-21（Asia/Taipei）。
> **核對者：** Codex，執行模式；本輪只新增本文件並更新 CURRENT 接手指標，未修改產品程式、資料庫或正式環境。
> **本機快照：** branch=`dev`、HEAD=`be906f89`、`origin/dev=b2707e08`、本機領先 1 顆 commit。這些數字會變，Claude 接手時必須重跑起手檢查。
> **用途：** 讓 Claude 先重新驗證，再替 Sean 拆出可以逐步批准的執行計畫；**不是拿到文件就直接開工**。

---

## 0. 給 Sean 的白話結論

PCM 現在最需要的不是再做一個 AI 聊天機器人，也不是重做已經存在的 SEO。真正順序是：

1. 先把員工登入、訂單、付款、退款與通知等上線關鍵路徑收尾。
2. 把目前隱藏、尚未接好的網站搜尋真正做完。
3. 從上線第一天開始記錄搜尋與成交資料，避免日後永遠補不回來。
4. 先整理最有成交機會的商品與熱門車型頁，不要一次重做全部商品。
5. 再接 Google Merchant Center、真實安裝案例、合作店家與回購機制。
6. ChatGPT／Gemini 的商品探索規格仍快速演進，先維持網站可讀、資料正確、可追蹤；新的商品 Feed／AI commerce protocol 僅列觀察，不在 Phase 1 猜規格實作。

---

## 1. Sean 已確認的業務方向

以下不是待 Claude 自行改寫的技術偏好，而是規劃必須遵守的業務邊界：

1. **AI 的目的**：讓 ChatGPT、Gemini、Google 等外部系統更容易找到 PCM、理解 PCM 商品，並在適合的情境推薦 PCM。
2. **不要客戶 AI 聊天機器人**：網站與 LINE 都不需要讓 AI 直接回答客人。
3. **LINE 由真人回答**：可以由網站帶入商品、SKU、車型與問題類型，減少真人來回確認；不可以變成 AI 自動客服。
4. **不公開實際庫存數量**：PCM 多數商品採訂貨，不要在前台顯示內部庫存數字、供應商狀態或採購細節。
5. **不可誤導**：不公開數量不等於可以宣稱現貨。對外狀態、交期與可下單條件必須符合實際情況。
6. **Phase 1 不擴成九大藍圖**：目前先完成可上線、員工可用的前後台；Phase 2 生態系能力只預留、不要偷跑。

補充：未來若做 LINE 訂單通知、到貨通知或預約通知，這不等同 AI 客服，但仍須按功能個別讓 Sean 拍板，不得從本文件推定已同意。

---

## 2. Claude 接手前的真相順序

請依以下順序判斷，不要把本文件當成永遠正確：

1. 當下可驗證的 Git、程式、測試、資料庫與部署事實。
2. `STATUS.md`。
3. `docs/handoff/CURRENT.md`。
4. 本文件、歷史規格、memory 與舊對話。

### 2.1 必讀順序

1. `CLAUDE.md`
2. `STATUS.md`
3. `docs/ops/AI_CONTRACT.md`
4. `docs/handoff/CURRENT.md`
5. `docs/PHASE-1-NORTHSTAR.md`
6. `docs/PHASE-2-VISION.md`
7. `docs/decisions/0004-m1-pre-launch-decisions.md`
8. `docs/decisions/0005-custom-supabase-direct.md`
9. `docs/specs/2026-07-25-site-wide-gap-and-admin-platform-plan.md`
10. `docs/specs/2026-07-25-search-engine-options-recon.md`
11. `docs/specs/2026-07-12-search-vehicle-work-plan.md`
12. `docs/phase-1-backlog.md` 的 #35、#183～#188、#247。

### 2.2 起手檢查

```bash
cd /Users/sean_1/pcm-website-v2 && git branch --show-current && git status --short && git log --oneline -8 && git rev-parse --short origin/dev && git rev-list --count origin/dev..HEAD
```

如果 branch、HEAD、dirty files 或 `STATUS.md` 已和本文件不同，以當下事實為準，先回報差異，不要自行 reset、stash、刪除或順手提交別人的修改。

### 2.3 本輪接手前已存在的 dirty files

2026-08-21 01:42 量到 22 個 dirty entries，屬其他視窗／既有工作，本文件作者未修改：

```text
.husky/pre-push
.husky/scripts-whitelist-gate.sh
apps/admin/src/lib/orders/subtotal-writers-allowlist.test.ts
apps/storefront/src/app/checkout/callback/page.test.tsx
apps/storefront/src/app/checkout/callback/page.tsx
apps/storefront/src/app/checkout/page.test.tsx
apps/storefront/src/app/checkout/page.tsx
apps/storefront/src/app/login/forgot/page.tsx
apps/storefront/src/components/ForgotPasswordPage.tsx
apps/storefront/src/components/Header.test.tsx
apps/storefront/src/components/Header.tsx
apps/storefront/src/components/LoginPage.tsx
apps/storefront/src/components/RegisterPage.tsx
apps/storefront/src/lib/auth/safe-redirect.ts
docs/patterns/guard-and-instrument-traps.md
package.json
scripts/stale-commit-msgs.py
supabase/migrations/20260820020000_m4b_e10_a8a3g_cancel_guard_sibling_dedup.sql
admin-orders.png
apps/storefront/src/lib/auth/login-next-guard.test.ts
scripts/migration-ledger-divergence.sh
scripts/scripts-whitelist-gate.harness.sh
```

Claude 必須重新量測 ownership；不能因清單出現在本文件就把它們算成本工作內容。

---

## 3. 已重新驗證的本機現況

### 3.1 目前主線仍是 Phase 1 上線，而不是成長功能大擴建

`STATUS.md` 顯示目前為 Phase 1／M-4b「員工上工」線。仍在上線關鍵路徑的項目包括：

- 員工真登入尚未完整落地；目前操作者身分仍有自選／共用登入等邊界。
- 訂單工作區、信件排程、告警與帳號鎖定仍有待辦。
- TapPay Q25「請款端點怎麼取得」仍是可行性 blocker；未取得證據前不得宣稱自動請款完成。
- `STATUS.md` 與 `docs/handoff/CURRENT.md` 的時間新鮮度不同；CURRENT 檔頭仍停在 2026-08-10，不能拿它蓋過當下 Git 與 STATUS。

**規劃結論：** 成長線可以先完成偵察與計畫，但不得搶走 E8-B 真登入、訂單閉環、付款／退款與通知收尾的資源。

### 3.2 已有的能力，不要重做

本機已存在：

- 商品目錄與商品詳情頁。
- 品牌總覽與 20 個品牌內容頁。
- 車型選擇、Fitment 比對與「我的愛車／車庫」。
- 收藏、會員、購物車、結帳與訂單頁骨架。
- 商品相關推薦，目前是規則式／確定性推薦，不是 AI。
- `robots.txt`、動態 `sitemap.xml`、Metadata、canonical、Open Graph。
- Store／Organization、Product 與 FAQPage JSON-LD。
- 服務條款、隱私政策與運送資訊頁。
- `/stores`、`/install` 路由；目前是誠實的功能佔位頁，因此刻意不放進 sitemap。

重要入口：

```text
apps/storefront/src/lib/seo.ts
apps/storefront/src/app/robots.ts
apps/storefront/src/app/sitemap.ts
apps/storefront/src/lib/product-jsonld.ts
apps/storefront/src/components/ProductFAQ.tsx
apps/storefront/src/app/products/page.tsx
apps/storefront/src/app/products/[slug]/page.tsx
apps/storefront/src/data/brand-content.ts
```

### 3.3 目前最大前台缺口：站內搜尋尚未完成

2026-08-21 重新量測結果：

```text
pcm-open-search dispatch：1 個檔案
pcm-open-search listener：0 個檔案
storefront 非測試 searchByKeyword() 呼叫端：0 個檔案
```

`apps/storefront/src/components/Header.tsx` 現在把 `SEARCH_ENTRY_ENABLED` 設為 `false`。這是 2026-08-16 經 Sean 拍板的誠實降級：入口先隱藏，不讓客人按到死功能；**不是取消搜尋需求**。

目前資料層 `searchByKeyword()` 已存在，但前台沒有伺服器讀取邊界、搜尋面板、結果 DTO、空結果與錯誤處理的完整接線。

搜尋技術文件另有一項容易踩的過期敘述：早期規劃寫 `tsvector + pg_jieba`，但 Supabase 無法安裝 `pg_jieba`。不得照舊字面實作；目前應先用真資料比較 ILIKE／`pg_trgm`／PGroonga 的 precision、recall、延遲與維運成本，再由 Sean 拍板。

### 3.4 成交分析目前沒有埋設

在 `apps/` 與 `packages/` 的非測試程式精準搜尋：

```text
GoogleAnalytics / gtag / GA_MEASUREMENT：0
Clarity / Meta Pixel / PostHog / Plausible：0
view_item / add_to_cart / begin_checkout / purchase：0
select_vehicle / fitment_fail / zero_result：0
```

既有 backlog 已有：

- #183 搜尋日誌，時間敏感、上線後不可回填。
- #184 GA4 基礎電商與 PCM 特有事件，時間敏感、上線後不可回填。
- #185～#187 關鍵字正規化、外部詞庫、BigQuery／推薦／語意搜尋，均以前兩項資料為相依前提。

### 3.5 還沒有的公開成長頁面與系統

目前未看到正式公開的：

- 車型專區 route。
- 商品分類專區 route。
- 部落格／文章／指南 route。
- Google Merchant Center 商品 Feed 或 Merchant API 接線。
- 真實商品評論／星等資料模型。
- 電子報訂閱、棄單、最近瀏覽、推薦碼等資料模型。

這不代表全部都要做。只有能明確改善找商品、成交、信任或回購的項目才進計畫。

---

## 4. 2026 官方方法二次核對與更正

### 4.1 Google 對 AI 搜尋的最新說法：沒有獨立的 GEO 魔法

Google 2026-07-10 更新的官方指南明確指出：

- AI Overviews／AI Mode 仍建立在核心搜尋索引與品質系統上。
- 有價值、第一手、非大量複製的內容，比「為 AI 改寫格式」重要。
- 商品 Feed、Google Business Profile、圖片、影片與良好頁面體驗仍重要。
- `llms.txt` 不會幫助 Google 搜尋或 Gemini 搜尋排名；Google 會忽略它。
- 不需要把內容切成大量小段，也不要為每個可能問法大量產生薄頁。
- Search Console 已有 Generative AI performance report，應用它量測，而不是相信第三方保證排名。

官方來源：

- [Google：Optimizing your website for generative AI features on Google Search](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google：Search documentation updates](https://developers.google.com/search/updates)

**對 PCM 的更正：** `docs/PHASE-2-VISION.md` 把 `llms.txt` 列為可選項仍可保留作歷史，但不可排成 Google／Gemini 優化的優先工作。

### 4.2 FAQ JSON-LD 的效益已變

Google 已公告 FAQ rich result 自 2026-05-07 起不再顯示。

**對 PCM 的處置：**

- 現有 FAQ 留著，因為對客人理解訂購、交期與售後仍有價值。
- FAQPage JSON-LD 不需要緊急移除，但不得在成效估算中把它當成可取得 FAQ rich result 的功能。
- 不為了 FAQ schema 大量生產問答頁。

來源：[Google Search documentation updates](https://developers.google.com/search/updates)

### 4.3 ProductGroup 是候選升級，不是立刻套用

Google 2026 年的商品變體文件建議，若各變體具有可辨識的 SKU／GTIN、可直接選到該變體的網址，以及一致 canonical 設計，可以使用 `ProductGroup`、`hasVariant`、`variesBy`。

PCM 現在的 `apps/storefront/src/lib/product-jsonld.ts` 仍是 `Product` + `Offer/AggregateOffer`。Claude 不得只因看到新格式就直接改，必須先確認：

1. PCM variant 的業務語意是顏色、材質、規格，還是不同零件。
2. 每個 variant 是否有真正唯一的 SKU／GTIN。
3. 商品頁網址能否直接預選變體。
4. canonical 與購物車選擇是否一致。
5. 加入後是否會洩漏經銷價或內部庫存。

來源：[Google：Product variant structured data](https://developers.google.com/search/docs/appearance/structured-data/product-variants)

### 4.4 Merchant Center 適合 PCM，但有交期資料前置

Google 官方現況：

- 台灣與 TWD 在 Shopping ads／免費商品刊登支援範圍。
- 符合資格的免費商品可能出現在 Search、Images、Lens、YouTube、Gemini 與 Shopping，但不保證曝光。
- 商品資料需包含價格、圖片、品牌、識別碼與 availability 等資訊，且 Feed、商品頁與結帳資訊要一致。
- `backorder`／`preorder` 必須提供 `availability_date`，並在商品頁顯示預估出貨日期。

官方來源：

- [Google：Free listings for products](https://support.google.com/merchants/answer/13889434?hl=en)
- [Google：Supported languages and currencies](https://support.google.com/merchants/answer/160637?hl=en)
- [Google：Availability attribute](https://support.google.com/merchants/answer/6324448?hl=en)

**PCM 的衝突與建議：**

PCM 多數商品採訂貨，現有「2～12 週」的廣泛說明不等於每項商品都有 Merchant Center 可接受的出貨日期。不能為了曝光把訂貨品標成 `in_stock`，也不能在沒有可靠日期時硬標 `backorder`。

推薦方案：

- 第一批只挑「價格、圖片、品牌、識別碼、可訂購狀態與預估日期都可靠」的 50～100 項商品。
- 不顯示數量，只顯示誠實的可訂購／預估出貨資訊。
- 無法維持日期的商品先不送 Feed。
- 先以 Merchant Center Diagnostics 驗證，再決定是否擴大。

### 4.5 GA4 要先於廣告與推薦引擎

Google 官方建議使用 `view_item`、`select_item`、`add_to_cart`、`begin_checkout`、`add_shipping_info`、`add_payment_info`、`purchase` 與 `refund` 等事件建立電商漏斗。

來源：[Google Analytics：Ecommerce setup Q&A](https://support.google.com/analytics/answer/14143583?hl=en)

PCM 還需要自己的事件：

- `vehicle_selected`
- `fitment_checked`
- `fitment_failed`
- `search_submitted`
- `search_zero_result`
- `line_contact_clicked`
- `favorite_added`
- `garage_vehicle_saved`

不得把會員 ID、電話、Email、LINE 對話、車身號碼或其他個資直接送進分析平台。

### 4.6 ChatGPT／AI commerce：列觀察，不猜規格

2026 年 ChatGPT 商品探索與 agentic commerce 正快速演進，但 PCM 不是 Shopify，且本輪沒有在可直接採用的 OpenAI 開發者文件中確認「台灣獨立商家可自助接入」的穩定合約、資格與上線流程。

因此目前只做：

- 確保公開商品頁可被合法索引、內容正確、速度與無障礙結構合理。
- 追蹤來自 ChatGPT／AI 搜尋的 referral。
- 每季用 OpenAI 官方開發者文件重新確認商品 Feed／ACP 等公開能力。
- 沒有公開穩定規格與 Sean 批准前，不新增 OpenAI API、付款協定或商家 Feed 專案。

這項觀察不代表要做客戶 AI 聊天機器人。

---

## 5. 建議的優先路線

### P0：完成可以穩定上線與營運的地基

先完成既有主線：

1. E8-B 員工真登入與帳號安全。
2. 訂單、付款、退款、出貨與通知閉環。
3. TapPay Q25 證據與可行性確認。
4. 正式環境、CI、告警與文件新鮮度。

**完成判準：** 員工可用真實身分完成每日主要工作；客人可從商品到付款完成；錯誤有可追蹤出口。

### P1：搜尋 + 量測，作為第一個成長基礎里程碑

#### P1-A 站內搜尋

搜尋至少要支援：

- SKU／原廠料號優先。
- 商品名稱與品牌。
- 車型、年份、常見別名。
- 商品分類與台灣常用名稱。
- 空結果、錯誤、載入中與安全降級。
- 客戶 tier 防洩漏：一般客人不能收到經銷價、成本或供應商資料。

第一版不要直接做向量搜尋。先用真實查詢集比較簡單方案，量到需要再升級。

#### P1-B 搜尋日誌與 GA4

同一里程碑安排 #183、#184，避免搜尋上線後資料仍流失。搜尋日誌需有保存期限、匿名化與刪除策略；GA4 需先確認隱私政策、Cookie／同意機制與正式 Measurement ID 管理方式。

#### P1-C LINE 真人轉接上下文

網站只負責整理：

```text
商品名稱 / SKU / 商品網址 / 已選車型年份 / 問題類型
```

由客人主動複製或帶入 LINE，再由 PCM 真人回答。不得自動送出對外訊息，也不得把客戶資料寫入網址 query。

### P2：商品資料品質 + 車型內容

#### P2-A 商品發布品質分數

先做前 100～500 項高價值商品，不一次處理全目錄。建議檢查：

- 主圖與替代文字。
- 商品名稱、品牌、SKU／MPN／GTIN。
- 車型、年份、Fitment 來源與最後確認時間。
- 商品特色、安裝注意事項與真實交期資訊。
- 公開售價與變體一致性。

不完整商品可降權、暫不進外部 Feed；不要用 AI 大量覆蓋人工翻譯、價格、mapping 或商品文案。

#### P2-B 熱門車型專區

先做 10 個真實熱門車系，例如由搜尋、詢問、訂單與商品覆蓋度選出，不憑想像決定。每頁應有：

- 可用年份與型號邊界。
- 適用商品與分類。
- 熱門品牌。
- 真實安裝案例。
- 常見選錯提醒。
- 可分享且穩定的 canonical URL。

不得一次大量產生內容空洞的車型頁。vehicle taxonomy／alias 尚未穩定前，不開大量索引頁。

### P3：外部商品探索與信任

1. Merchant Center 50～100 項合格商品試跑。
2. 真實安裝案例、原創照片與短影片。
3. 合作店家資料完整後，再把 `/stores`、`/install` 從佔位頁改成真內容並加入 sitemap。
4. Google Business Profile 與網站公司／地址／營業資訊一致性。
5. 只有在存在真實評論與驗證機制後，才做 Review／AggregateRating；禁止假評論、假星等。

### P4：利用既有車庫與收藏做回購

既有 Garage／Favorites 完成後，可評估使用者主動同意的：

- 我的車有新商品。
- 收藏商品價格變動。
- 訂貨／到貨狀態通知。
- 安裝說明與保養提醒。

先有同意、退訂、頻率與資料保存規則，再做通知。不要直接做泛用電子報或大量推播。

### P5：未來觀察，不在現在實作

- ChatGPT 商品 Feed／ACP。
- Google UCP／瀏覽器 agent 交易能力。
- BigQuery、向量語意搜尋、個人化推薦。
- ProductGroup 全量升級。
- 評論系統、推薦碼、棄單行銷。
- 簡化 ERP、主動備貨庫存與跨 repo 報價單整合。

觸發條件要用資料決定，例如搜尋量、零結果率、商品數、轉換率與客服成本，不以「2026 流行」當開工理由。

---

## 6. 相依關係與不可顛倒的順序

```text
上線關鍵路徑完成
  ↓
站內搜尋 + 搜尋日誌 + GA4
  ↓
得到真實搜尋、車型與成交資料
  ↓
商品品質分批整理 + 熱門車型頁
  ↓
Merchant Center / 安裝案例 / 合作店家導流
  ↓
回購通知與推薦
  ↓
語意搜尋、個人化與新 AI commerce 協定
```

硬性相依前提：

- 搜尋別名表需要真實 search log，不能先靠想像建滿。
- 推薦引擎需要事件資料，不能先做 AI 再想怎麼量。
- Merchant Center 需要可靠價格、可訂購狀態與交期。
- 車型頁需要 canonical vehicle taxonomy 與 Fitment 品質。
- Review schema 需要真實評論系統。
- 對外廣告需要結帳閉環與轉換追蹤。

---

## 7. 成效指標

### 第一層：網站是否能成交

- 商品頁 → 加入購物車率。
- 加入購物車 → 開始結帳率。
- 開始結帳 → 付款成功率。
- 付款失敗原因與恢復率。

### 第二層：客人是否找得到

- 搜尋使用率。
- 搜尋零結果率。
- 搜尋結果點擊率。
- SKU、品牌、車型、分類各自的查詢占比。
- Fitment 無法判定／不適用比例。

### 第三層：真人服務是否更省時間

- LINE 詢問是否帶齊商品與車型。
- 第一次回覆就能回答的比例。
- 從 LINE 詢問到訂單的轉換率，只做匿名／彙總追蹤。

### 第四層：商品與回購品質

- 重點商品資料完整率。
- 車庫、收藏使用率。
- 回訪與再次購買率。
- Merchant Center 核准率與免費點擊／成交。

不要只用曝光、文章數、索引頁數或 AI 提及次數當成功指標。

---

## 8. 明確不要做

- 不做網站或 LINE 的客戶 AI 自動客服。
- 不公開實際庫存數、供應商、內部採購狀態或成本。
- 不把訂貨商品假標成現貨。
- 不大量產生薄弱的 SEO／GEO 車型頁或文章。
- 不把 `llms.txt` 當 Google／Gemini 成長重點。
- 不為了新規格重做現有 SEO 基礎。
- 不做假評論、假星等或不真實的外部提及。
- 不在交期資料不足時把全目錄送 Merchant Center。
- 不在 #183／#184 尚無資料前做 BigQuery／向量推薦。
- 不照舊文件實作 `pg_jieba` 或 Medusa；現行後端以 Supabase 與 ADR-0005 為準。
- 不修改 `.env*`、production、Supabase、Vercel、Merchant Center、GA4 或 Google Business Profile，除非 Sean 對該外部操作另行明確批准。
- 不 push、不 deploy、不 merge，不混入接手前 dirty files。

---

## 9. Claude 的第一個任務：先複核與排程，不實作

### 工作模式

第一輪使用「規劃／偵察模式」。可以讀程式、文件、測試與官方資料；不得修改產品程式、schema、API、共用元件、正式環境或外部帳號。

### 必做步驟

1. 重跑 §2.2 起手檢查並重新分類 dirty ownership。
2. 對照 `STATUS.md` 當下的上線關鍵路徑，判斷成長線最早何時可插入。
3. 重跑 §3.3、§3.4 的搜尋／分析零命中量測，不照抄本文件數字。
4. 驗證本文件列出的「已有／缺少」是否因其他視窗 commit 而改變。
5. 重新開啟 §4 的 Google 官方文件，確認 2026-08-21 後是否有更新。
6. 若要談 ChatGPT 商品 Feed／ACP，只能以當下 OpenAI 官方開發者文件確認；沒有公開穩定合約就維持觀察，不自行設計。
7. 提出不超過四個里程碑的排程，每個里程碑都要寫：目的、相依前提、範圍、影響面、驗收、風險、復原方式、是否觸發鐵則 8／12。
8. 把「既有 backlog 可直接收編」與「需要新 PRD／新決策」分開。

### Claude 第一次回報格式

請先在對話回報，不要先改檔：

```text
一、現在最重要的三件事（白話）
二、本文件與當下 repo 的差異（沒有也要寫 0）
三、建議的 3～4 個里程碑與先後順序
四、需要 Sean 拍板的題目（每題 2～4 選項，標推薦）
五、這一輪明確不做的項目
```

### 停止條件

遇到以下任一情況，Claude 必須停下回報，不得自行擴張：

- Git／STATUS／CURRENT 互相矛盾，且會改變施工順序。
- dirty file ownership 無法確認。
- 要跨 3 個以上檔案、動 schema／API／共用元件或部署設定。
- 需要 Merchant Center、GA4、Search Console、Google Business Profile、Supabase、Vercel 或 OpenAI 商家帳號操作。
- 需要公開庫存、交期、評論、合作店家或其他業務事實。
- 需要新增 Cookie／追蹤同意、對外通知或個資用途。
- 搜尋技術選型要在 ILIKE／`pg_trgm`／PGroonga／外部服務之間改方向。

---

## 10. 建議 Claude 交付的下一份正式規格

Sean 看過 Claude 第一次回報並說「OK 繼續」後，再建立一份正式 plan，建議路徑：

```text
docs/specs/2026-08-xx-growth-foundation-search-measurement-plan.md
```

該 plan 第一版只應涵蓋：

1. 站內搜尋接線。
2. 搜尋日誌 #183。
3. GA4／PCM 事件 #184。
4. LINE 真人詢問上下文。

商品資料品質、車型頁、Merchant Center、安裝案例與回購機制另拆後續規格，不要塞成一個超大 implementation。

---

## 11. 本文件完成與未完成邊界

### 已完成

- 重新核對本機 Git、STATUS、CURRENT、Phase 1／Phase 2 文件。
- 重新量測站內搜尋接線與分析事件現況。
- 核對現有 SEO、商品 JSON-LD、品牌頁、車庫、收藏與法律頁。
- 以 2026 官方 Google 文件更正 `llms.txt`、FAQ rich result、ProductGroup、Merchant Center 與 GA4 的安排。
- 整理 Claude 的讀取順序、優先級、停止條件與第一次回報格式。

### 尚未執行

- 未修改任何產品功能。
- 未安裝 GA4／Search Console／Merchant Center。
- 未建立搜尋、Feed、車型頁或追蹤事件。
- 未登入或操作任何正式外部帳號。
- 未跑正式網站的瀏覽器、效能、Rich Results 或 Merchant Diagnostics 驗證。
- 未 commit、push、deploy 或 apply migration。

### 需要 Sean

- 先把本文件交給 Claude，請 Claude依 §9 回報。
- Claude 提出里程碑與決策題後，由 Sean 拍板；收到「OK 繼續」才寫正式 plan 或施工。

— END —
