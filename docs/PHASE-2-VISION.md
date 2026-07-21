# PCM Phase 2 業務藍圖 — 9 點輪廓

> **讀者:** 新 Claude Code(從零進入此 repo、無上下文)
> **作者:** Claude.ai(基於 Sean 2026-04-29 列出的 9 點業務願景)
> **目的:** 讓 Phase 1 schema 設計時、知道 Phase 2 要長什麼樣、預留正確擴展空間
> **狀態:** v1 / 2026-04-29
>
> 配合閱讀:`docs/PROJECT-OVERVIEW.md`(整體 PCM 是什麼)、`docs/features/vehicle-service-ecosystem.md` v0.2(Phase 2 完整 PRD、本檔指向)

---

## 0. 為什麼有這份檔

**Sean 在腦袋裡有完整的 PCM 終局願景、但分散在多次對話裡。** 這份是 9 點集中藍圖、避免新 Claude Code 設計 Phase 1 schema 時忽略 Phase 2 擴展需求。

Phase 1 是「上架真權威前台 + 對應後台」、不直接做這 9 點功能。但 **Phase 1 schema 必須預留這 9 點所需的資料欄位與擴展點**、否則 Phase 2 落地時會痛苦 migration。

---

## 1. 九大藍圖一覽

| # | 功能 | Phase 1 影響 | 完整 PRD |
|---|---|---|---|
| 1 | Excel 大量上架 + 爬蟲 / API 同步 | 不預設(Phase 2 PRD 一起想) | 暫無、Phase 2 寫 |
| 2 | 商品圖片 / PDF 用連結 | schema 設計用 URL string | 暫無、Phase 2 寫 |
| 3 | 客戶 ↔ 店家預約整流程 + LINE | schema 預留 booking 模組 | `vehicle-service-ecosystem.md` §4 |
| 4 | 下單後到貨再預約店家或寄客人 | order 多 fulfillment 模式 | `vehicle-service-ecosystem.md` §4.1 |
| 5 | 車輛履歷、可移轉 | **vehicle 與 user 解耦** | `vehicle-service-ecosystem.md` §5.1 §7 |
| 6 | 店家價錢分級管理 | **product 多 price tier、customer_group** | `vehicle-service-ecosystem.md` §5.6 |
| 7 | 員工後台訂單管理 + Excel UI | Medusa Admin 客製 / 擴充 | 暫無、Phase 2 寫 |
| 8 | 預約 QR / 驗證碼 + 保養歷程 + 行事曆 | shop_calendar + booking schema | `vehicle-service-ecosystem.md` §4.4 §8.4 |
| 9 | SEO + AI 友善 | **Phase 1 day 1 起就建** | 暫無、Phase 2 寫 |

---

## 2. 各點輪廓

### #1. Excel 大量上架 + 廠商資料自動同步

**痛點:** PCM 商品數量大(目標 1000+ SKU)、手動一筆筆上架不可行。員工(Sean / 小編)需要批次工具。**目前現況有雙工問題**:

```
廠商網站爬蟲 (已寫好)  ↘
                        Google Sheet 報價單  →  員工整理  →  上架
廠商 API 串接 (已寫好)  ↗
```

員工從 Google Sheet 把資料整理進系統、是雙工流程。

**方向(待 Phase 2 PRD 釐清細節):**

整體願景:把現有的爬蟲 / API 串接 pipeline 整合進 PCM 後台、減少 / 取代 Google Sheet 雙工。

```
廠商網站爬蟲          ↘
                        →  ???(Phase 2 PRD 決定中介架構)→ Medusa product
廠商 API 串接          ↗
                              ↓
                       員工只做「審核 + 微調」
```

**Phase 2 PRD 階段需釐清(目前未拍板):**
- 爬蟲 / API 串接如何整合(內部服務?讀 Google Sheet 同步?其他)
- Google Sheet 在新架構中的位置(完全取代?保留為中繼?完全退役?)
- 員工 Excel 手動上架 UI(後台介面)
- 錯誤行回報 / 修正流程
- 更新策略(以什麼為 key、覆蓋?新版?)
- 圖片 / PDF URL 來源(廠商提供?自家 CDN?Cloudinary?— 對應 #2)

**Phase 1 預留:**
- **不預設 schema 預留**(Sean 拍板:Phase 1 不預設、等 Phase 2 PRD 一起想)
- product schema 對齊 design 真權威字面即可、不為了 #1 額外加欄位
- 第一輪舊 repo 已有相關爬蟲程式 / API 串接 code、Phase 2 啟動時評估「重用 / 重寫」

**第一輪相關產出參考(已退役、僅供 Phase 2 評估時參考):**
- 舊 repo `data/PRODUCTS-README.md` — product schema 設計原稿
- 舊 repo Medusa Admin extension「大量匯入 / 廠商同步」(舊 backlog 提到、Phase 2 評估是否沿用)
- 舊 repo 爬蟲 / API 串接 code(Phase 2 啟動時評估)

**完整 PRD:** Phase 2 啟動時寫(主要決定:中介架構、UI、錯誤處理、更新策略)

---

### #2. 商品圖片 / PDF 用連結

**痛點:** 圖片與 PDF 體積大、若存 Supabase BLOB 成本高、效能差。

**方向:**
- 圖片 / PDF 全部存外部(自家 CDN、Cloudinary、廠商提供連結等)
- product schema 存 URL string 而非 binary
- 多圖片以 array of URL 處理

**Phase 1 預留:**
- product schema 圖片欄位 = URL string array
- PDF / 文件欄位 = URL string array
- **不引入 BLOB 上傳**(若 design 沒這個 UI 就更不需要)

**完整 PRD:** Phase 2 啟動時寫(主要決定 CDN 選用)

---

### #3. 客戶 ↔ 店家預約整流程 + LINE

**痛點:** 客人買完零件需自己找店家裝、過程脫離 PCM、無法形成生態系。

**方向:**
- 客人下單 → 收到貨 → 在會員中心「詢價安裝」
- 系統 LINE 推播給最多 3 家合作店家
- 店家 LINE 收到 → 點連結 → 開簡單網頁報價
- 客人看比較表 → 選店家 → 預約時段
- LINE 全程通知

**Phase 1 預留:**
- order schema 支援「待詢價」狀態
- customer 與 LINE OA ID 綁定欄位
- 不直接做 booking 模組

**完整 PRD:** `docs/features/vehicle-service-ecosystem.md` v0.2 §4.2、§4.3、§10

---

### #4. 下單後到貨再預約店家或寄客人

**痛點:** 傳統電商下單就決定收件方式、PCM 客人下單時可能還沒想好要寄家還是寄店家裝。

**方向:** 三種收件方式

| 收件方式 | 運費 | 後續 |
|---|---|---|
| 宅配到府 | 需付 | 寄客人家、客人自行安排安裝 |
| 超商取貨 | 需付 | 寄超商、客人取件、自行安排安裝 |
| 寄合作店家(不指定) | 需付、若成功安裝退儲值金 | 系統之後提示客人詢價選店 |

**關鍵設計:** 下單時不需要選店、不需要預約時段。下單只做:選商品、選收件方式、付款。

**Phase 1 預留:**
- order schema fulfillment_method 三選一欄位
- shipping_address 支援「指定店家」與「客人地址」兩種

**完整 PRD:** `docs/features/vehicle-service-ecosystem.md` v0.2 §4.1

---

### #5. 車輛履歷、店家可看、車輛售出可移轉

**痛點:** 二手車市場缺乏可信改裝 / 保養履歷、PCM 錯失平台價值延伸機會。

**方向:**
- 每台車有 vehicles 主檔、跟車不跟人
- 服務記錄 (vehicle_service_records) 包含改裝 + 保養
- A 賣車給 B:A 帳號標「已讓與」、B 加新車從空白起、店家可查跨車主完整歷史
- 防偽三道關卡:車籍 OCR 驗證 + 訂單綁定 + 客人 LINE 確認
- 履歷只開放合作店家查、客人看自己的車、不公開

**Phase 1 預留(關鍵):**
- **vehicle 與 customer 解耦**:vehicles 是獨立 entity、customer 是「持有者」可變更
- 第一輪暫存 `customer.metadata.vehicles`(已退役)、新 repo 應直接 vehicles 主檔
- vehicles schema 必須含 vin(車身號碼)、engine_no(引擎號碼)、verified bool

**完整 PRD:** `docs/features/vehicle-service-ecosystem.md` v0.2 §5.1、§5.2、§6、§7、§9

---

### #6. 店家價錢分級管理

**痛點:** B2B 店家(經銷商)看到的價格與 B2C 一般客戶不同、不同店家還可能有個別 VIP 加成、需多層折扣管理。

**方向:** 三層折扣疊加

| 層 | 對象 | 折扣來源 |
|---|---|---|
| 第一層 | 經銷價 | store / premium_store 等級 |
| 第二層 | 廠牌折扣 | premium_store 依廠牌全體套用(例:Brembo 全店再 -5%) |
| 第三層 | 個人化覆蓋 | 特定 VIP 店家 + 特定廠牌的個別調整 |

**Phase 1 預留(關鍵):**
- product 支援多 price tier(Medusa 內建 Price List 功能)
- customer 有 `tier` 欄位(general / store / premium_store)
- customer_group 預留(廠牌折扣依此套用)
- member_discount_overrides 表(Phase 2 加、Phase 1 schema 預留 FK 欄位)

**完整 PRD:** `docs/features/vehicle-service-ecosystem.md` v0.2 §5.6

---

### #7. 員工後台訂單管理 + Excel UI

**痛點:** 員工(Sean / 小編)管訂單時、Medusa Admin 預設 UI 不夠順手、希望貼近 Excel 的批次操作體驗。商品上架也要方便。

**方向:**
- Medusa Admin UI 客製 / 擴充
- 訂單列表支援批次選 → 批次改狀態 / 批次匯出 CSV
- 商品上架走 Excel 批次(對應 #1)
- 列表 UI 設計參考 Excel 操作直覺

**Phase 1 預留:**
- 用 Medusa Admin 既有 UI、不擴充
- 商品 / 訂單欄位完整、後續擴充 UI 不缺資料
- Phase 2 才做 Admin UI 客製化

**完整 PRD:** Phase 2 啟動時寫(主要是 UI / UX 規範)

---

### #8. 預約 QR / 驗證碼 + 保養歷程 + 行事曆

**痛點:** 客人到店時、店家如何快速認出訂單?店家如何管理當日預約?客人的車如何累積完整保養歷程?

**方向:**

**到店三方法(店家自選):**
1. 客人出示訂單 QR Code → 店家手機掃
2. 客人唸 6 位數驗證碼 → 店家後台輸入
3. 店家輸入客人手機後 4 碼 → 系統列訂單供選

**店家行事曆:**
- 顯示三來源事件:PCM 預約 / 店家自加 / 店家私人事項
- 月 / 週 / 單日檢視
- 每天早上 9 點 LINE 推播當日預約

**保養歷程:**
- 客人輸入 / 店家寫入 / 安裝寫入三方累積里程
- 內建基範保養項目(機油 3000km、煞車片 10000km 等)
- 達標自動 LINE 提醒

**Phase 1 預留:**
- order 有 unique 識別碼可生 QR
- customer 手機欄位
- 不做 booking schema(Phase 2 加)

**完整 PRD:** `docs/features/vehicle-service-ecosystem.md` v0.2 §4.4、§5.5、§5.7、§8.4、§8.5、§9

---

### #9. SEO + AI 友善

**痛點:** PCM 是電商、流量極依賴 Google 搜尋。AI 時代(ChatGPT / Perplexity / Gemini 等)爬取網頁、結構化資料友善的網站獲得更多曝光。

**方向:**
- Next.js Metadata API 每頁完整 OG / Twitter card
- structured data(JSON-LD)Product / Breadcrumb / Organization 全套
- sitemap.xml 動態產生
- robots.txt 友善
- 商品頁、品牌頁、車型頁、品類頁 URL 結構乾淨
- 多語系預留(雖然初期繁中 only)
- llms.txt(可選、AI 友善的入口檔)

**Phase 1 預留(關鍵、Day 1 就建):**
- 不是 Phase 2 才做、而是 Phase 1 day 1 起每頁就有正確 metadata
- structured data 隨頁面落地一起加
- Phase 1 結束時 SEO 底子應該已經完整

**完整 PRD:** Phase 2 啟動時寫(主要是進階 schema.org 規範)

⚠️ **注意:** 雖然 9 點完整 PRD 在 Phase 2 寫、但 **#9 SEO 從 Phase 1 day 1 就要做**、不能延後。

---

## 3. Phase 1 schema 預留檢查清單

新 Claude Code 設計 Medusa schema 時、必須對照下表檢查每項預留:

| 預留項目 | 影響的藍圖 | 檢查 |
|---|---|---|
| product 圖片 / PDF 用 URL string | #2 | array of string、不存 BLOB |
| product 多 price tier(Medusa Price List) | #6 | 預設 retail / wholesale 兩 tier 起步 |
| customer.tier 欄位 | #6 | enum: general / store / premium_store |
| customer.line_oa_id 欄位 | #3 | text、可為 null |
| customer_group 機制 | #6 | Medusa 內建、確認啟用 |
| order.fulfillment_method 三選一 | #4 | enum: home / convenience / partner_shop |
| order 有 unique 識別碼可生 QR | #8 | Medusa 內建 display_id 即可 |
| vehicle 為獨立 entity(不嵌 customer) | #5 | 新 repo 直接 vehicles 主檔、不走 metadata |
| 每頁 Metadata + structured data | #9 | Day 1 起、不延後 |

**注意:** #1 大量上架 / 爬蟲同步**不預設 schema 預留**(Sean 2026-04-29 拍板:等 Phase 2 PRD 一起想、避免猜錯方向)。Phase 1 product schema 對齊 design 真權威字面即可、不為了 #1 加欄位。

---

## 4. 與 Phase 1 的邊界

**Phase 1 做的:**
- 前台:design 直接搬、商品列表 / 詳情 / 分類 / 品牌 / 結帳 / 會員中心基本功能
- 後台:Medusa schema 對應 design、product / order / customer / cart 完整
- 共用:packages/ui + packages/schemas
- 預留:上面 §3 schema 預留檢查清單全部通過

**Phase 1 不做(Phase 2 做):**
- vehicles 主檔(Phase 1 customer 不持有 vehicles)
- shops + shop_staff(Phase 1 無店家端)
- 詢價 + 預約 schema(Phase 1 無)
- LINE 通知整合
- QR Code / 驗證碼到店流程
- 保養提醒
- 二手車履歷邏輯
- Admin UI 客製化(Phase 1 用 Medusa Admin 既有)
- 大量上架 / 爬蟲 / API 同步 pipeline(Phase 1 用 Medusa Admin 單筆建立、不導入廠商同步)

---

## 補充段:搜尋智能 + 行為分析(Search & Behavioral Intelligence)

> **這是補充段、不是第 10 條藍圖。** 上方 §1 九大藍圖框架不動、不重編號。
> **來源:** 2026-05-26 ChatGPT「Vehicle-First 平台藍圖」對照 PCM 現況評估後,補上既有 9 點較少著墨的「搜尋 / 資料智能」側。
> **與 §1 的關係:** 既有 9 點偏「車輛履歷 + 店家生態系」;本段補「搜尋 / 行為資料如何沉澱與運用」、與 9 大互補、不擴增藍圖編號。

**與藍圖 #9 的分工(互補、不重複):**

| | 藍圖 #9 SEO + AI 友善 | 本補充段 搜尋智能 + 行為分析 |
|---|---|---|
| 方向 | 對外(outbound) | 站內(on-site) |
| 目的 | 讓 Google / AI 在站外「找到我們」 | 客人進站後「搜得到、被理解、行為被沉澱」 |
| 例 | metadata / JSON-LD / sitemap / llms.txt | 搜尋日誌 / keyword 正規化 / 行為事件 / 推薦 |

兩者是兩件事:#9 是把流量帶進來,本段是流量進來後的搜尋體驗與資料價值。

**本段收編的能力缺口(均已歸檔 backlog、此處只記輪廓):**

1. **搜尋日誌 search query log** — 記錄「客人搜什麼 / 搜什麼搜不到(缺貨商機)」。
2. **行為事件埋設(GA4)** — view / search / cart / checkout / purchase + PCM 特有 select_vehicle / fitment_fail。
3. **keyword 正規化別名表** — 中文重機改裝俗稱(後移 / 牛角 / 卡夢 / 蠍子管 …)→ 標準詞。
4. **他站搜尋語意爬蟲** — 借 Webike / 蝦皮 autocomplete 補搜尋詞庫冷啟動(抓搜尋詞、非抓商品)。
5. **BigQuery 行為分析 + 推薦引擎 + AI semantic search** — cross-sell / trends / lost sales + 向量語意搜尋。
6. **vehicle schema 深層正規化** — 代別 / 變體 / 別名分層(R9 / YZF R9 / YZFR9 → 同一車),支撐精準 fitment。

**現行技術現況(本段只記能力缺口、不在此重做技術選型):**

- 後端為 **Supabase**(ADR-0005 已廢 Medusa);上方 §2 各點仍寫 Medusa 屬舊敘述、以 ADR-0005 為準。
- 站內搜尋走 **PG `tsvector` + `pg_jieba` 先行**(backlog #35;藍圖建議的 Meilisearch 為有意識延後、非現行選型)。

**時間敏感提醒(資料不可回填):**

第 1 項「搜尋日誌」(backlog **#183**)與第 2 項「GA4 行為事件」(backlog **#184**)屬**時間敏感**:不從上線(M-6)起記錄 / 埋設,歷史資料永遠無法回補,連帶卡住第 3–5 項(backlog #185–#187)的語料與數據起步。詳見 `docs/phase-1-backlog.md` #183–#188。

---

## 補充段:TapPay 加值支付里程碑(Payment Value-Adds)

> **這是補充段、不是第 10 條藍圖。** §1 九大藍圖框架不動、不重編號。
> **來源:** 2026-06-14 Sean 拍板「TapPay 加值功能」+ 處置 A(先落 backlog/roadmap、**M-3 單筆刷卡 3DS 先收尾(地基)**、之後各開獨立 PRD)。
> **與 M-3 關係:** M-3 = 信用卡單筆 3DS 結帳(脊椎 = webhook inbox `b50bd62` + settleCharge);本段 4 個里程碑都**複用該對帳脊椎、非重做**,在其上加付款方式。

**4 個里程碑(皆鐵則 8+12、各走獨立 PRD、建議序輕→重;細節見 `docs/phase-1-backlog.md`):**

| # | 里程碑 | 輕重 | 卡號過商戶? | 業務開通(Sean 辦) | backlog |
|---|---|---|---|---|---|
| 1 | **LINE Pay** | 最輕 | 否(電子支付) | TapPay 客服 02-2366-0080 | #226 |
| 2-3 | **Apple Pay / Google Pay** | 中(共用 Pay-by-Prime) | 否(DPAN) | Apple Developer+網域驗證+付款憑證 / Google 商家+正式審查 🔴**需 live 結帳頁(gated on 部署上線)** | #228 |
| 4 | **卡片記憶(Pay by Card Token)+ Remove Card** | 最重(PCI+card-on-file 法規) | 🔴 是(商戶自存可重扣憑證) | 書面問 TapPay PCI/合約 + 同意/刪卡流程(Sean+法務) | #229 |

**除外(Sean 2026-06-14 拍不做):** 延遲請款 / 自動週期扣款(定期定額)。

**共通紀律:** ① 結算對帳全複用 M-3 webhook inbox + settleCharge;② 涉儲存 `card_key`/token(#229)= 鐵則 12 要害:server-only + 加密 at rest + 零進 client bundle/log/git + 驗 token 歸屬登入會員(防 IDOR)、正式做前提 plan + commit 前 codex CLI 對抗審查(2026-07-21 拍板不產 Packet);③ 逐行 SDK 細讀於各 PRD 啟動時做(TapPay docs 為 SPA、需點分頁渲染或問客服),wallet 介接「需再核實」勿憑記憶;④ 業務開通:**可現在辦**(不需 live 站)= #226 LINE Pay(客服 02-2366-0080 帳號申請、sandbox 可先開發)+ #229 卡片記憶(書面問 TapPay PCI/合約);🔴 **等部署** = #228 Apple/Google Pay(網域驗證/平台審查需 **live 結帳頁** serve 驗證檔 + 看得到實際結帳流 → gated on「新賣場結帳頁部署上線」、**不能部署前辦**)。實作皆須等 M-3 3DS 收尾。

---

## 5. 重要參考

- **完整 PRD(Phase 2 範圍):** `docs/features/vehicle-service-ecosystem.md` v0.2(793 行、車輛履歷 + 店家端 + 預約 + 儲值金回饋全寫)
- **整體 PCM 介紹:** `docs/PROJECT-OVERVIEW.md`
- **Phase 1 範圍:** `docs/PHASE-1-NORTHSTAR.md` v2
- **舊專案教訓:** `docs/lessons-learned.md`

— END —
