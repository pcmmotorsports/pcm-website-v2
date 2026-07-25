# 訂單域模型對照(附錄;主規格見 admin-backend-rebuild-spec)

> ⚠️ **本檔是附錄,不是主規格。** Sean 於同日把範圍從「訂單後台」擴大為「整個網站後台」,
> 主規格 = `docs/specs/2026-07-25-admin-backend-rebuild-spec.md`(含北極星、驗收清單、全域決策題)。
> 本檔保留的價值 = **訂單域三平台狀態軸逐值對照**與退款/退貨模型細節,主規格只摘結論。
>
> 🔴 **只可讀 §2 / §3(現況盤點 + 三平台對照)。§6「不做」與 §7「決策題」已被主規格推翻,勿採用**:
> ①§6 排除「稅額拆分/多幣別匯率」已因 codex C4 與 Sean 成本表撤銷 ②§6 稱 `invoice_*` **四欄**夠用,
> 主規格 §1.2a C6 判定**三欄**承擔不了正式發票生命週期(欄數與結論皆不符)③§7 的 Q1-Q12 全標 ⏳,
> 但主規格已將其中多題當定案(見主規格 §0a / §0.1 / §6)。**衝突一律以主規格為準。**
>
> **狀態:** 🟡 提案階段、**尚未拍板、尚未實作**
> **建立:** 2026-07-25
> **緣起:** Sean 2026-07-25 指出「一題一題慢慢討論效率太低,訂單管理有現成的可以參考,應該先帶入大部分功能再修改」。本檔即該指示的產物。
> **範圍(Sean 2026-07-25 Q1=B):** 整個訂單後台 = 生命週期(付款/出貨/退貨/退款四軸)+ 欄位完整性 + 列表/篩選/明細頁 + 匯出。
> **本檔不是拍板紀錄**,是「現況 vs 成熟平台差距 + 建議模型 + 待決策題」。Sean 答完 §7 決策題後,本檔升為實作依據。

---

## 1. 這份規格解決什麼問題

2026-07-25 Sean 提出三個具體問題,都答不出來:

1. 商品狀態 = 付款 × 出貨的合體,那**退款要怎麼進去**?
2. 一單三列 a/b/c,只退其中兩個,**三列各自要顯示什麼**?已出貨才退款、貨還沒收回來又怎麼算?
3. 上方篩選欄跟下方表格欄位**對不起來**(篩選有付款狀態/出貨狀態,表格沒這兩欄)。

追查後發現這不是漏想,是**當初刻意延後**:

- `docs/architecture/medusa-schema-design.md:570` 逐字:「**廠商缺貨 / 已出貨退貨 / 超商 7 天未取**(reverse logistics):本 slice 不規範、Phase 1 走客服人工流程;Phase 2 設計 reverse logistics 狀態機」
- 同檔 `:560`:「**部分退款**:目前 PaymentStatus 無 `partiallyRefunded` 字面…完整 partial refund 邏輯由 M-3-08 落地時依 TapPay 實況評估(backlog #26)」

backlog #26 已於 2026-07-25 由 RF2a 收掉(`partiallyRefunded` 已上 production)。**「Phase 2 再說」的到期日到了**——正式站已在真實收款(首筆真 3DS 2026-07-24 `PCM-2026-0102`),退款情境已實際發生。

---

## 2. PCM 現況(唯讀盤點,2026-07-25)

完整版:`scratchpad/pcm-order-inventory.md`。摘要:

| 項目 | 現況 |
|---|---|
| 訂單相關資料表 | **8 張**(orders / order_items / payment_charge_attempts / payment_double_charge_anomalies / payment_double_charge_anomaly_events / order_status_options / order_refunds / order_refund_items) |
| 狀態軸 enum | **2 個**:`payment_status` 5 值(unpaid/paid/partiallyPaid/refunded/partiallyRefunded)、`fulfillment_status` 4 值(notOrdered/ordered/inStock/shipped) |
| 操作狀態詞彙 | `order_status_options` **9 筆**,Sean 可 CRUD(L3 已合規) |
| 操作真相層 | `order_items.workflow_status`(2026-07-15 Sean 拍板 Q-A=A);`orders.workflow_status` **已停寫**(TS + DB comment 雙層鎖) |
| 後台訂單 UI | 3 page + 9 component + 8 lib = **20 個功能檔** |
| 列表欄位 | **13 欄**(`orders-table.tsx:182-194`) |
| 篩選軸 | **5 軸**(商品狀態/付款狀態/出貨狀態/來源/管道) |
| 明細頁區塊 | **4 張卡**(客戶/收件出貨/付款/發票)+ 品項表 + 取消橫幅 |

### 2.1 現有 9 個狀態詞彙(`20260714120000:72-81`)

| code | label | 對應語意 |
|---|---|---|
| received_confirmed | 已收已定 | paid × ordered |
| received_unconfirmed | 已收未定 | paid × notOrdered |
| shipped_done | 出貨完成 | paid × shipped |
| instock_available | 現貨在庫 | paid × inStock |
| unpaid_confirmed | 未收已定 | unpaid × ordered |
| unpaid_unconfirmed | 未收未定 | unpaid × notOrdered |
| unpaid_shipped | 未收出貨 | unpaid × shipped |
| unpaid_instock | 未收現貨 | unpaid × inStock |
| cancelled | 已取消 | 雙邊中性 |

= **付款 2 態 × 出貨 4 態 = 8 格 + 1 個取消**,壓平成單一下拉。

### 2.2 已知缺口(盤點實查,非推測)

- 🔴 **退款帳本無任何後台 UI**:`grep -rln "order_refund|OrderRefund" apps/admin/src` 零命中。`order_refunds`/`order_refund_items` 昨日上線,後台完全看不到、不能操作。
- 🔴 **明細頁無退款/退貨區塊**(`order-detail.tsx` 全文 249 行讀過)。
- **無匯出功能**(grep `csv|export|download` 功能性零命中)。
- **無手動建單入口**:`order_source` enum 有 `manual_phone`/`manual_line`/`manual_other` 三值,但 admin 只拿來篩選,沒有建單表單。
- **無訂單備註 / 內部備註 / 標籤欄位**。
- **無操作時間軸**。
- **`fulfillment_status` 只在 orders 表(訂單層)**,`order_items` 沒有出貨欄 → **部分出貨無法表達**。
- **`cancelled_reason` 是自由文字**,無 enum。

---

## 3. 三家成熟平台怎麼做(全部附官方來源)

完整研究:`scratchpad/research-shopify.md`、`research-medusa.md`、`research-erp-procurement.md`。

### 3.1 狀態軸數量與粒度

| | 付款軸 | 出貨軸 | 退貨軸 | 是否合併成單一狀態 |
|---|---|---|---|---|
| **Shopify** | `displayFinancialStatus` 8 值 | `displayFulfillmentStatus` 10 值 | `returnStatus` 6 值 | ❌ 三軸各自獨立顯示 |
| **Medusa v2** | `PaymentStatus` 10 值 | `FulfillmentStatus` 8 值 | `ReturnStatus`(含 OPEN,完整值未確認) | ❌ 三軸獨立 |
| **Odoo** | `invoice_status` 3 值 | `stock.picking.state` 6 值 | Reverse Transfer + Credit Note 兩段 | ❌ 錢與貨完全分離 |
| **WooCommerce** | 單一 `order status` 8 值 | (同一欄) | 無獨立退貨狀態 | ✅ 合併(但因此**沒有部分退款狀態**) |
| **PCM 現況** | `payment_status` 5 值 | `fulfillment_status` 4 值 | ❌ 無 | ⚠️ 另有 `workflow_status` 把前兩軸壓平成 9 值 |

**觀察:** 唯一採合併的 WooCommerce,正是唯一無法表達部分退款的。合併模型在加入退貨軸後會失效——這是可觀察的結構性後果,不是風格偏好。

### 3.2 🔴 最重要的一條:部分退款/部分出貨怎麼表達

**三家一致:不用狀態值,用每列商品上的數量計數器。**

**Medusa `OrderItem`**(`packages/modules/order/src/models/order-item.ts`)每列 8 個數量欄:

```
quantity                    訂購數量
fulfilled_quantity          已備貨
shipped_quantity            已出貨
delivered_quantity          已送達
return_requested_quantity   已申請退貨(貨還沒回來)
return_received_quantity    已收到退貨
return_dismissed_quantity   退貨申請被駁回
written_off_quantity        已核銷
```

**Shopify `ReturnLineItem`** 6 個數量欄:`quantity` / `processableQuantity` / `processedQuantity` / `unprocessedQuantity` / `refundableQuantity` / `refundedQuantity`;`RefundLineItem.quantity` 為整數(非布林)。

**Odoo** Reverse Transfer 彈窗數量可編輯,天生支援部分退。

> **這一條直接解掉 Sean 的問題 2。** 一列 3 個退 1 個,不需要「部分退款」狀態值,只要 `quantity=3, return_requested_quantity=1`,畫面上算給你看。也順帶避開「付款3 × 出貨4 × 退貨3 = 36 格」的組合爆炸——**不窮舉組合,只數數字**。

### 3.3 🔴 第二重要:錢與貨分開

- **Shopify**:`Return`(貨的流向,`ReturnStatus`: REQUESTED/OPEN/CLOSED/DECLINED/CANCELED)與 `Refund`(錢的流向,**沒有自己的 status**,有 `processedAt` 即代表已處理)是兩個物件,`Refund.return` 選擇性關聯。可以只退錢不收貨,也可以收了貨才退錢。
- **Medusa**:`Return`(貨)+ `OrderTransaction`(錢),**沒有獨立 Refund 表**。
- **Odoo**:Reverse Transfer(貨)+ Credit Note(錢),兩者可獨立使用。

> **這一條解掉 Sean 的問題「已出貨收回怎麼算」**:那是**貨的軸**上的中間態,Shopify 叫「退貨處理中」(Return in progress = `Return.status=OPEN` + `Order.returnStatus=IN_PROGRESS`),跟錢退了沒有無關。

**PCM 現況對照:** `order_refunds` 是純「錢」的帳本(有 `bank_refund_id` 冪等鍵、TapPay 退款金額、運費重算)。**「貨」的軸完全不存在。**

### 3.4 換貨(Exchange)

- **Shopify**:**沒有獨立模型**。`ExchangeV2` 已棄用(URL 404 實測)。現行是 `Return.exchangeLineItems`,換貨是退貨表單裡的一個子區塊。財務三態:商家欠客戶→退款 / 客戶欠商家→請款 / 等值→原款轉移不動金流。
- **Medusa**:`OrderExchange` 有獨立表,但**一定連帶建一張 Return**;核心欄位 `difference_due`(負=退錢給客人、正=跟客人收錢、0=不動金流)。另有 `OrderClaim`(瑕疵求償,`type` ∈ refund|replace)。

### 3.5 代購 / 採購軸(PCM 特有,Shopify 完全沒有)

- **Odoo**:SO ↔ PO 靠 procurement group 關聯;**官方文件沒有「客人訂單頁顯示已向供應商下單」的現成欄位**(實查結論,靠 dropship receipt 的 state 間接反映)。
- **AutoDS**(代購專用平台,公開文件完整)狀態鏈:
  `Pending`(等處理)→ `In Order Progress`(處理中)→ `Ordered`(**已向供應商下單、已付款、供應商已確認收單**)→ `Shipped`(供應商已出貨、有追蹤碼)→ `Delivered`(確認送達);異常態:`Error`(缺貨/價差/地址問題)、`Awaiting Payment`。
- 🔴 **缺貨待補(backorder)無現成可抄**:Odoo 的 backorder 是「交貨層部分出貨」機制、WooCommerce 的是「商品層庫存設定」,**兩者都不是訂單狀態**。PCM 的「客人已付款、廠商缺貨要等」得自己設計。

**PCM 現況對照:** `fulfillment_status` = notOrdered → ordered → inStock → shipped,**已經是代購軸**,只是粒度比 AutoDS 粗:缺 `delivered`(已送達)與異常態,且只在訂單層、無法逐品項。

### 3.6 前車之鑑:衍生欄位不能篩選

Medusa v2 把 payment/fulfillment status 做成**算出來的衍生值、不落 DB 欄位**,結果官方 admin **無法用這兩個軸篩選或排序**(GitHub issue #14095,仍 open)。

> **PCM 不能學這一步。** PCM 現在 `payment_status`/`fulfillment_status` 是真 enum 欄位 + 有索引,篩選正常。目標模型必須維持「**計數器是真相,顯示狀態materialize 成實體欄位**」。

### 3.7 列表頁與明細頁(規模參考)

**Shopify 列表**:5 個預設檢視(All / Unfulfilled / Unpaid / Open / Closed)、**23 個篩選軸**(+metafield)、欄位可自訂顯示與排序、批次操作(Cancel 上限 250 筆 / Archive / Print)。
**Shopify 明細頁區塊**:Timeline(操作時間軸+留言+@提及)、Customer、Contact、Notes、Tags、Order Details(含 Refund 按鈕)、Return in progress(有進行中退貨才出現)、Authorized(待請款才出現)、More actions(取消/封存/刪除/看訂單狀態頁)。
**Shopify 匯出 CSV**:69 欄。

**PCM 現況**:0 個預設檢視、5 個篩選軸、欄位不可自訂、無批次操作、無時間軸、無備註、無標籤、無退款區塊、無匯出。

---

## 4. 五個結構性差距(本規格要修的)

| # | 差距 | 後果 | 嚴重度 |
|---|---|---|---|
| G1 | **無逐品項數量進度** | 部分出貨、部分退貨、部分到貨全部無法表達。一單三列退兩列 → 現在只能整單標一個狀態 | 🔴 阻擋 |
| G2 | **「貨的軸」完全不存在** | 已出貨才退款、貨還沒收回來 → 無處可記;退貨物流、驗收、瑕疵判定全無 | 🔴 阻擋 |
| G3 | **退款帳本無 UI** | 昨日上線的 `order_refunds` 在後台完全不可見,真要退款只能下 SQL | 🔴 阻擋 |
| G4 | **兩軸壓平成單一下拉** | 加退貨軸後組合爆炸;篩選軸與表格欄位對不起來(Sean 問題 3) | 🟠 結構 |
| G5 | **後台資訊密度不足** | 無備註/標籤/時間軸/匯出/預設檢視/批次操作/手動建單 | 🟠 營運 |

---

## 5. 建議的目標模型

### 5.1 原則(抄三家的共識,不抄任一家的細節)

1. **計數器是真相,狀態是顯示。** 逐品項數量計數器記事實;訂單層狀態欄由 trigger 算出來並落成實體 enum 欄(可篩選、可排序)。
2. **錢與貨分兩條線。** 退貨(貨)與退款(錢)各自有生命週期,可獨立發生。
3. **軸分開、不合併。** 付款 / 出貨(含代購)/ 退貨三軸各自顯示,不壓平成單一下拉。
4. **不動已上線金流。** `order_refunds` 帳本、`payment_status` 狀態機、TapPay 鏈路一律不改語意,只加新東西。

### 5.2 資料層:新增什麼

**A. `order_items` 加數量計數器**(抄 Medusa `OrderItem`,裁掉用不到的)

```
quantity                    (已有)訂購數量
ordered_quantity            已向供應商下單
instock_quantity            已到貨
shipped_quantity            已出貨給客人
delivered_quantity          已送達(可選,見決策題 Q4)
return_requested_quantity   已申請退貨、貨未回
return_received_quantity    退貨已收回
cancelled_quantity          已取消/缺貨核銷
```

不變式:各計數器 ≤ `quantity`,且 `ordered ≥ instock ≥ shipped ≥ delivered`(逐級遞減)。用 CHECK 約束鎖死。

**B. 新表 `order_returns` / `order_return_items`(貨的軸)**

鏡像既有 `order_refunds` / `order_refund_items` 的形狀(複合 FK 鎖跨單串接、DEFERRED CONSTRAINT TRIGGER 驗主從一致、RLS zero-policy + 精準 GRANT)。狀態:`requested` → `in_transit` → `received` → `closed`,異常態 `declined` / `cancelled`。

`order_refunds` 增選擇性欄位 `return_id`(nullable)關聯到退貨單——**可以只退錢不收貨**(nullable 就是這個用途)。

**C. `fulfillment_status` 擴充**

現 4 值 → 加 `delivered`(已送達)與 `backorder`(缺貨待補)。⚠️ `ALTER TYPE ADD VALUE` 不可逆、且新值在同交易內不可用(RF2a 已踩過,見 `20260725130000` 檔頭),必須獨立 migration。

**D. `orders` 加欄位**

`return_status`(enum,由 trigger 算)、`note`(客人備註)、`internal_note`(內部備註)、`tags`(text[])、`cancel_reason`(enum,抄 Shopify 6 值:customer/declined/fraud/inventory/other/staff,取代現有自由文字)。

### 5.3 顯示層:商品狀態下拉何去何從

三個處置方案,見決策題 **Q1**。無論選哪個,`order_status_options` 表本身保留(Sean 可 CRUD = L3 合規,不能退化成 hardcode)。

### 5.4 UI 層:補什麼

- 明細頁加 **退款/退貨區塊**(有才顯示,抄 Shopify「Return in progress」卡片)
- 明細頁加 **時間軸**(接既有 `admin_audit_log`)、**備註**、**標籤**
- 列表頁加 **預設檢視**(待出貨 / 待付款 / 退貨中 / 全部)
- 列表頁 **欄位與篩選軸對齊**(見 Q7)
- **匯出 CSV**
- **手動建單**(`order_source` 三個 manual 值已備、只缺表單)

---

## 6. 明確不做(本期排除)

- ❌ 匯入整套 Shopify / Medusa 程式碼(ADR-0005 已廢 Medusa-as-API,理由仍成立)
- ❌ 多幣別 / 匯率快照(PCM 單一幣別 TWD)
- ❌ 稅額拆分欄位(台灣發票另有機制,現有 `invoice_*` 四欄夠用)
- ❌ 銷售通路(sales channel)/ B2B / 詐騙風險評分
- ❌ 換貨(Exchange)完整模型 —— 見 Q5,可能延後
- ❌ 訂單改單(Order Edit)含版本快照 —— 見 Q6,可能延後

---

## 7. 待 Sean 拍板的決策題

> 見對話中的白話版。答案回填此節後,本檔升為實作依據。

| # | 題目 | 狀態 |
|---|---|---|
| Q1 | 商品狀態下拉何去何從 | ⏳ 待答 |
| Q2 | 逐品項數量計數器要幾個 | ⏳ 待答 |
| Q3 | 退貨(貨)要不要獨立資料表 | ⏳ 待答 |
| Q4 | 出貨軸要不要加「已送達」「缺貨待補」 | ⏳ 待答 |
| Q5 | 換貨要不要做 | ⏳ 待答 |
| Q6 | 訂單改單要不要做 | ⏳ 待答 |
| Q7 | 列表欄位與篩選軸怎麼對齊 | ⏳ 待答 |
| Q8 | 預設檢視要哪幾個 | ⏳ 待答 |
| Q9 | 備註/標籤/時間軸要哪些 | ⏳ 待答 |
| Q10 | 匯出 CSV 要多完整 | ⏳ 待答 |
| Q11 | 手動建單要不要這期做 | ⏳ 待答 |
| Q12 | 實作順序與上線節奏 | ⏳ 待答 |

---

## 8. 來源與未確認清單

**一手研究檔**(scratchpad,本 session 產出):
- `research-shopify.md`(314 行,全部 enum 值附 shopify.dev 官方 URL)
- `research-medusa.md`(155 行,附 GitHub 原始碼 raw URL)
- `research-erp-procurement.md`(160 行,Odoo 18.0 原始碼 + WooCommerce + AutoDS 官方說明)
- `research-admin-ux.md`(真瀏覽器實地考察,待補)
- `pcm-order-inventory.md`(205 行,每項附 `檔案:行號`)

**🔴 未確認項目(禁止當事實寫進實作)**:
- Medusa `ReturnStatus` 完整 enum(只確認含 `OPEN` + requested/received/partially_received/canceled)
- Shopify 非 display 版 `fulfillmentStatus` 是否存在(未做 404 測試)
- Shopify 批次操作完整清單(官方頁只舉例未窮舉)
- Odoo PO line `sale_order_id` 是否官方保證自動填值(僅社群佐證)
- WooCommerce「無部分退款狀態」為清單反推,非官方逐字聲明
- Odoo `account.move` state 逐字核對版本為 14.0,非 18.0

**PCM 側權威**:
- `docs/architecture/medusa-schema-design.md:560,570`(當初延後的逐字紀錄)
- `docs/decisions/0005-custom-supabase-direct.md`(廢 Medusa-as-API 的理由,仍成立)
- `supabase/migrations/20260714120000_m4a_order_workflow_status.sql:72-81,133-136`(9 詞彙 + 2×4 矩陣)
- `supabase/migrations/20260716120000_m4a_d2_order_items_workflow_status.sql:55,76`(item 層唯一真相 / order 層停寫)
- `supabase/migrations/20260725130100_m3_rf2a2_order_refunds_ledger.sql`(退款帳本形狀,新表比照)
