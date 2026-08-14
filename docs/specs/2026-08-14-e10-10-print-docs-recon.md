# `#10` 列印出貨單 / 揀貨單 — 查證報告(A 窗夜跑,零 code、**不設計**)

> 事實親查於 `pcm-void-readers` @ `43d6ef8f`。🔴 **全部來自 repo 檔案,未對正式庫查詢。**

## §1 「印」這件事在這個 repo 是零

數法(範圍 `apps` + `packages`,排除 `.next`):
`grep -rn "window.print\|@media print\|react-to-print\|pdfkit\|jspdf\|puppeteer\|@react-pdf" --include="*.ts" --include="*.tsx" --include="*.css"` ⇒ **0**。
**正向對照**(同範圍同寫法換一個一定在的字):`grep -rn "shipment" apps/admin/src` ⇒ **424 行** ⇒ 掃描範圍不是空的。
⇒ §1-A 的「整個能力不存在」**成立**,而且連 CSS 層的列印樣式都沒有。

## §2 出貨流程現在走到哪

已在:`shipments` + `shipment_items` 兩表、建箱 / 掛品項 / 標出貨 / 作廢 / 反作廢五支 RPC、
admin 的 `shipment-dialog` / `shipment-section` / `shipment-launcher` 一整族。
⇒ **「哪些貨在哪個箱」這件事系統知道**,缺的只是把它印出來。

🔴 **但有兩個結構事實會直接決定「印得出什麼」**:

1. **一箱屬於一位客人,但可以跨多張訂單**(Sean 2026-08-05 Q1=B 併箱)。
   `shipment-section.tsx:112` 逐字「`shipments` **沒有 order_id**」;`:7` 逐字「同一個箱號會**同時出現在兩張訂單**的詳情頁」。
   ⇒ 「一張出貨單對一張訂單」這個直覺**在這裡不成立**。
2. 🔴🔴 **箱子上沒有地址。** `shipments.recipient_snapshot` 的 CHECK
   (`20260805170000:120-125`)逐字 `?& ARRAY['name','phone','line']`
   **加上** `(recipient_snapshot - ARRAY['name','phone','line']) = '{}'::jsonb`
   ⇒ **恰三鍵、多一鍵就被擋**。地址只在 `orders.shipping_address_snapshot`,
   而跨訂單併箱時**一箱可能對到多張訂單的地址**,誰是對的沒有人決定過。

## §3 揀貨單 vs 出貨單:兩件事,各缺不同的東西

| | 揀貨單(給倉庫的人) | 出貨單(給客人的) |
|---|---|---|
| 要什麼 | 品項 + 數量 + **放在哪** | 收件人 + **地址** + 品項 + **金額** |
| 現有 | `shipment_items` 有 `order_item_id` + `shipped_quantity`(`database.types.ts:2549` 起) | `recipient_snapshot` 三鍵(姓名/電話/LINE) |
| 🔴 缺 | **「放在哪」整個概念不存在**。數法:`grep -rn "location\|bin_\|warehouse\|shelf\|儲位" supabase/migrations/*.sql` 過濾欄位定義列 ⇒ **0**。PCM 是代購、貨從供應商來,**本來就沒有儲位模型** | **地址**(§2-2)與**金額**(`shipments` 無任何金額欄;金額在 `orders`,而一箱可跨單) |

⇒ **兩張單的難度差很多**:
**揀貨單**只用得到 `shipment_items` 已有的東西(品項 + 數量),**現在就印得出來**,只是沒有儲位可印。
**出貨單**在「跨訂單併箱」下**規格未定**(地址取誰的、金額怎麼算),**不是缺程式,是缺決定**。

## §4 新竹物流:託運單是它印的,不是我們印的

`docs/reference/hct-logistics-api-reference.md:16` 逐字:新竹提供兩組獨立服務「①查貨 ②**出貨/託運單列印**」;
`:64` 的 `TransData()` 逐字回傳「貨號、到著站、**標籤圖片字串**」;`:108` 逐字「hex 字串 → byte[] → Bitmap…1bpp 黑白單色」。
⇒ **貼在箱子上那張託運單 = 新竹回傳的圖,我們只負責顯示與列印,不自己排版。**

🔴 **但那條線一行都還沒接**:數法 `grep -rn "TransData\|Hctrt" apps packages --include="*.ts" --include="*.tsx"`(排除 `.next`/`.test.`)⇒ **0**;
`hct` 現在只是下拉選單的一個字(`shipment-dialog.tsx:43`)與 `CarrierCode` 的一個值(`shipment-repository.ts:39`),
`hct_status` 只有 `draft/submitted/failed` 三值(`20260805170000:131`)且無人寫。
⇒ **今天員工的託運單是在新竹自己的系統印的**(我推論,**未向 Sean 求證**)。

⚠️ **memory 記的兩條限制是 `TransData` 那條線的,不是我們自印那條線的**:
「圖檔一次上限 5 筆」(`:113`)與「當日重複上傳 = 視同更正」(`:117-120`)—— **只有接了 API 才會遇到**。
⇒ **`#10` 若只做「我們自己排版的兩張紙」,完全不碰這兩條限制。** 兩件事要分開排,別綁在一起。

## §5 「印」在這個 stack 上的三種做法(列出來,不選)

| 做法 | 要什麼 | 代價 |
|---|---|---|
| **A 瀏覽器列印**(一個 `/print/...` 路由 + `@media print` CSS) | 零新依賴;現有 Next 路由 + CSS | 版面吃瀏覽器與印表機設定;分頁/頁首頁尾控制弱;**Sean 要肉眼驗**;命中今天那條「CSS 守門釘字面、壞的是用值」⇒ 交件要附真瀏覽器實測 |
| **B server 產 PDF**(`@react-pdf` / `pdfkit`) | **新增依賴**(動 `package.json`)+ 一條產檔路由 | 版面可控、可存檔;bundle 與冷啟成本;PDF 內的中文字型要自己帶(**這條我未查**) |
| **C 產圖**(headless browser) | Playwright/Puppeteer;Vercel 上要 5GB package 額度 | 最重;**本 repo 已有 Playwright(`apps/admin/package.json:33`)但那是測試用**,拉進 runtime 是另一回事 |

🔴 **三者共同的硬需求**:一個**只給員工看**的列印頁。它會顯示金額與收件資訊
⇒ 必須在 admin(有 SSO 保護面)、**不得**放在 storefront。

## §6 鐵則判定

- **鐵則 8**:任一做法都 ≥3 檔(路由 + 版面元件 + 讀模型 + 測試)⇒ **命中,要提 plan 等 Sean 批。**
- **鐵則 12 逐條過六類**:①錢 —— **出貨單要印金額**,但**只讀不寫** ⇒ 我判**不命中**(12 是「動到」);
  ②權限 —— 若新開 admin 路由,要確認它在既有 SSO 保護面內,**這條要在 plan 裡逐字驗、不能假設**;
  ③schema —— A 案零 migration;若決定把地址/金額補進 `shipments` 就**命中**;
  ④平台設定 —— **B/C 案動 `package.json`** ⇒ **命中**;A 案不動;
  ⑤對外 —— 不寄信不發布 ⇒ 否;⑥`packages/ui` —— 視元件放哪,可避開。
  ⇒ **A 案是唯一可能不命中鐵則 12 的路**;B/C 案命中④、改 schema 的路命中③。

## §7 誠實缺口

1. **未對正式庫查詢。** §2 的 CHECK 三鍵、§4 的 `hct_status` 值域都只是 repo 檔案這樣寫。
2. **「員工今天在新竹系統印託運單」是我的推論,沒有向 Sean 求證。** 這條會決定 `#10` 到底要不要做出貨單
   —— 如果託運單已經解決了「貼在箱子上」的需求,那 `#10` 真正缺的可能只有**揀貨單**。**這是本片最該先問的一題,我沒問。**
3. **我沒有讀 `shipment-dialog.tsx` 全文**,只 grep 了 carrier 相關行 ⇒ 可能有我沒看到的既有列印入口
   (但 §1 的全域掃描是 0,所以就算有也不是真的在印)。
4. **B 案的中文字型問題我沒查** —— PDF 產出中文常要內嵌字型檔,那會影響 bundle 大小與授權。
5. **沒查「一箱跨幾張訂單」在正式庫的實際分佈** ⇒ §2-1 那個難題**可能實務上很罕見**,
   而我把它寫成了規格難點。**要數得對 DB 跑,今晚不做。**
