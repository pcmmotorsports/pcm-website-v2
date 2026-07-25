# Medusa v2 訂單/退款模型研究(供 PCM 後台重建參考)

範圍聲明:全文只查 **Medusa v2**(`develop` branch,commerce-modules/order)。v1 模型(`docs.medusajs.com/v1/...`)完全不用,若命中一律標註排除。

---

## 1. Order 狀態欄位 enum

來源(GitHub 原始碼,權威):
`https://raw.githubusercontent.com/medusajs/medusa/develop/packages/core/types/src/order/common.ts`

```ts
type OrderStatus =
  | "pending" | "completed" | "draft" | "archived" | "canceled" | "requires_action"

type PaymentStatus =
  | "not_paid" | "awaiting" | "authorized" | "partially_authorized"
  | "captured" | "partially_captured" | "partially_refunded" | "refunded"
  | "canceled" | "requires_action"

type FulfillmentStatus =
  | "not_fulfilled" | "partially_fulfilled" | "fulfilled"
  | "partially_shipped" | "shipped" | "partially_delivered"
  | "delivered" | "canceled"
```

補充(`OrderChangeStatus`,用於 order edit/return/claim/exchange 的審核流程,同檔):
```ts
type OrderChangeStatus = "confirmed" | "declined" | "requested" | "pending" | "canceled"
```

**⚠️ 未完全確認**:`ReturnStatus` 有兩個不一致來源 —
- `common.ts`(同上 URL)寫的 union type:`"requested" | "received" | "partially_received" | "canceled"`
- 但 `return.ts` model 原始碼(`https://raw.githubusercontent.com/medusajs/medusa/develop/packages/modules/order/src/models/return.ts`)實際 default 值是 `ReturnStatus.OPEN`(`status: model.enum(ReturnStatus).default(ReturnStatus.OPEN)`),`OPEN` 不在上面 union 清單內 —— 代表真正的 runtime `ReturnStatus` enum(定義在 `@medusajs/framework/utils`)比 `common.ts` 那個 type 完整,我沒能定位到該 enum 的原始檔(搜了 `packages/core/utils/src/common` 目錄無果、GitHub code search API 需認證被擋)。**確定至少含 `OPEN` + `requested/received/partially_received/canceled`,完整清單未確認。**

Order 主表 `status` 欄位定義(`order.ts` model):`status: model.enum(OrderStatus).default(OrderStatus.PENDING)` — 單一 enum,不是 payment/fulfillment 的衍生欄位;payment_status / fulfillment_status 實際上**不是 Order 表的欄位**,是透過 `OrderSummary.totals`(JSON,見第6節)與 `OrderItem` 累積量即時算出的衍生狀態(admin UI 用 workflow 算,非 DB 欄位)——這點對 PCM 很關鍵:Medusa 不是三個平行 DB enum 欄位,是 1 個 DB status enum + 2 個計算狀態。

---

## 2. 退款/退貨資料表

### (d) Return 與 Refund 是不是分開兩張表?

**是分開概念,但 Medusa v2 沒有獨立的 `Refund` 資料表。** 退款是透過 `OrderTransaction`(`transaction.ts` model)記錄一筆金額為負(或帶方向欄位)的交易,`transaction` 可以 `belongsTo` `return` / `claim` / `exchange` / `order`,四選一關聯。也就是說:**Return 描述「貨物退回」的物流/庫存狀態,實際「錢退了多少」記在 `OrderTransaction` 上,兩者用外鍵連。**

- 文件原文(`https://docs.medusajs.com/resources/commerce-modules/order/return`):「The Return model connects to financial records through the OrderTransaction data model, which represents the refunds made for the return.」

### Return model(`return.ts`,權威 URL 同上)欄位
`id`(前綴 `return`)、`order_version`、`display_id`(自增)、`status`(enum ReturnStatus,default OPEN,見上)、`location_id`(nullable)、`no_notification`、`refund_amount`(BigNumber,nullable)、`created_by`、`metadata`、`requested_at`、`received_at`、`canceled_at`;關聯:`order`(belongsTo)、`exchange`(hasOne, nullable)、`claim`(hasOne, nullable)、`items`(hasMany ReturnItem,刪除時串刪)、`shipping_methods`(hasMany OrderShipping)、`transactions`(hasMany OrderTransaction)。

### ReturnItem model(`return-item.ts`)—— **(b) 一列數量 3 個只退 1 個怎麼存的答案**
`id`(前綴 `retitem`)、`quantity`(BigNumber,本次申請退貨數量)、`received_quantity`(BigNumber,default 0,merchant 實際收到並確認的數量)、`damaged_quantity`(BigNumber,default 0,收到但判定損壞不可上架的數量)、`note`、`metadata`、`reason`(belongsTo `ReturnReason`,nullable)、`return`(belongsTo Return)、`item`(belongsTo OrderLineItem)。
→ 訂單列原始 `quantity=3`,顧客只退 1 個:在 `OrderItem`(注意不是 `OrderLineItem`,見第6節)上累加 `return_requested_quantity`,`ReturnItem.quantity=1`;等倉庫收到才寫 `received_quantity`;可以只收到 1 個裡的 0 個完好 1 個損壞,`damaged_quantity` 獨立記。

### (a) 部分退款怎麼存
`Return.refund_amount`(單一 BigNumber 金額)+ 對應一筆 `OrderTransaction`(金額=負值/退款方向)。不是逐 item 存退款金額,是整張 Return 一個總額欄位。

### (c) 已出貨後退貨、貨在路上的中間態
`Return.status` enum(`OPEN` → `requested` → …→ `received`/`partially_received` → `canceled`,見上未確認完整清單);另外 `OrderItem` 上有 `return_requested_quantity`(顧客申請退但貨還沒到)vs `return_received_quantity`(倉庫已簽收)vs `return_dismissed_quantity`(申請被拒/駁回)三個獨立累積量欄位並存,「貨在路上」的中間態 = `return_requested_quantity > 0` 但 `return_received_quantity` 尚未等量增加。

### ReturnReason model(`return-reason.ts`)—— PCM 要的「退貨原因字典」對應這張表
`id`(前綴 `rr`)、`value`(可搜尋文字,如程式碼值)、`label`(可搜尋+多語系翻譯)、`description`(多語系,nullable)、`metadata`;支援階層:`parent_return_reason`(belongsTo 自己)、`return_reason_children`(hasMany 自己)。**沒有獨立的 `RefundReason` 表** —— 題目問的「RefundReason」在 Medusa v2 實際上就是這張 `ReturnReason`(退貨原因)在做,退款本身沒有另一組原因字典。

---

## 3. Claim(瑕疵求償)vs Exchange(換貨)

來源:`https://docs.medusajs.com/resources/commerce-modules/order/claim`、`.../exchange`、model 原始碼。

- **Claim** 適用情境:「顧客收到瑕疵品或錯誤商品」(defective or incorrect item)。`type` 欄位是 `ClaimType`(即程式碼裡 `OrderClaimType`)enum:`"refund" | "replace"`(來源 `packages/core/types/src/order/mutations.ts`)。
  - `refund` 型:退款,金額存 `OrderClaim.refund_amount`(BigNumber)。
  - `replace` 型:換新品,新品項存 `OrderClaimItem`(`is_additional_item=true` 的那些列)。
  - 建立 Claim 時**自動連帶建立一張 Return**(收回舊貨用),`OrderClaim.return` 是 hasOne 關聯。
- **Exchange** 適用情境:「顧客想把訂購的商品換成另一個商品」(replacement of an item with another),不強調瑕疵,單純換貨/換尺寸換款。
  - 核心欄位 `difference_due`(BigNumber,nullable):負值=商家要退錢給顧客,正值=商家要跟顧客多收錢,0=不用轉錢。實際轉帳一樣記在 `OrderTransaction`。
  - 一樣自動連帶建立 Return(`exchange.return` hasOne)。
  - `allow_backorder`(boolean,default false)— Exchange 特有欄位,Claim 沒有:換貨新品缺貨時是否允許超賣出貨。

**差異一句話**:Claim = 商家的錯/商品瑕疵→退款或換貨兩選一;Exchange = 顧客單純想換(通常自己選的),一定是換貨、且换貨可能要找補差價。兩者都是「先建一張 Return 收舊貨」為共同底層機制。

### OrderClaim model 欄位(`claim.ts`)
`id`(前綴 `claim`)、`order_version`、`display_id`(自增)、`type`(enum ClaimType)、`no_notification`、`refund_amount`(nullable)、`created_by`、`canceled_at`、`metadata`;關聯:`order`(一對一)、`return`(一對一,nullable)、`additional_items`/`claim_items`(hasMany OrderClaimItem,刪除串刪)、`shipping_methods`、`transactions`。

### OrderClaimItem model(`claim-item.ts`)
`id`(前綴 `claitem`)、`reason`(enum `ClaimReason`,nullable,值:`"missing_item" | "wrong_item" | "production_failure" | "other"`,來源 `mutations.ts`)、`quantity`、`is_additional_item`(default false,區分「被退回的舊品」vs「補寄的新品」)、`note`、`metadata`;關聯 `claim`、`item`(OrderLineItem)、`images`(hasMany OrderClaimItemImage,刪除串刪)。

### OrderExchange model 欄位(`exchange.ts`)
`id`(前綴 `oexc`)、`order_version`、`display_id`、`no_notification`、`difference_due`(nullable)、`allow_backorder`(default false)、`created_by`、`metadata`、`canceled_at`;關聯:`order`(hasOne)、`return`(hasOne,nullable)、`additional_items`(hasMany OrderExchangeItem)、`shipping_methods`、`transactions`。

### OrderExchangeItem model(`exchange-item.ts`)
`id`(前綴 `oexcitem`)、`quantity`、`note`、`metadata`;關聯 `exchange`、`item`(OrderLineItem)。

---

## 4. Order Edit / 訂單改單模型

來源:`https://docs.medusajs.com/resources/commerce-modules/order/edit` + `order-change.ts` / `order-change-action.ts` 原始碼。

- 改單的載體是 **`OrderChange`**(不是獨立的 "OrderEdit" 表)——同一張表也拿來記錄 return/claim/exchange 的審核流程,靠 `change_type` 欄位(文字,值含 `"edit"`)區分用途。
- **有版本機制**:`Order.version`(number,default 1)。訂單建立時 version=1;任何 edit/return/claim/exchange 一旦「確認(confirm)」,`Order.version` 就 +1。`OrderItem.version`、`OrderTransaction.version`、`OrderChange.version` 都各自帶版本號,代表「這筆變動是在哪個訂單版本下發生的」,可以拿舊版本重建歷史金額。
- **差額怎麼存**:改單本身不直接寫金額差,而是透過 `OrderChangeAction`(`order-change-action.ts`)逐筆記錄動作:`action`(文字,如 `ITEM_ADD`/`ITEM_UPDATE`/`ITEM_REMOVE`/`SHIPPING_ADD`…,完整 22 種見第1節 `ChangeActionType` union)、`details`(JSON,存 item id/price/quantity 等細節)、`amount`(BigNumber,nullable)、`applied`(boolean,default false,是否已套用到訂單)、`ordering`(自增,保證動作套用順序)、`internal_note`。
- **OrderChange 本身的審核欄位**(狀態機):`status`(enum `OrderChangeStatus`:pending/requested/confirmed/declined/canceled)、`requested_by`/`requested_at`、`confirmed_by`/`confirmed_at`、`declined_by`/`declined_at`/`declined_reason`、`canceled_by`/`canceled_at`、`description`、`internal_note`、`carry_over_promotions`(boolean,nullable,v2.12.0+)。
- 換句話說 PCM 若要做「改單」:①開一張 change 記錄(pending)②每個動作各存一條 action(含 diff)③顧客/商家確認後 `applied=true` 且訂單 version+1、實際金額寫回 `OrderItem`/`OrderSummary`。這是**逐動作 event log + 版本快照**混合模型,不是單純存「改前/改後」兩份 diff。

---

## 5. Admin 訂單列表

**⚠️ 大部分未在文件裡查到逐欄位規格**,官方 user-guide 頁面(`https://docs.medusajs.com/user-guide/orders`)只有概述,沒有列出精確欄位/篩選器清單,查證結果:

- 預設欄位(概述原文):「order details such as the ID, date, customer, sales channel, and fulfillment and payment status」—— 即 ID、日期、顧客、銷售通路、履行狀態、付款狀態。**逐欄位精確清單未確認**(文件用概述句,非表格)。
- 篩選/排序:文件只說「search, filter, and sort the orders to find the specific order」,**沒有列出可篩選的軸名稱**,未確認。
- 批次操作:**文件完全沒提**,未確認;查了 GitHub issue 找不到批次操作清單。
- **重要實測落差(非我的推測,是官方 GitHub issue,已封存的已知限制)**:
  `https://github.com/medusajs/medusa/issues/14095` —「Unable to filter or order by fulfillment / payment status in admin UI and with graph query」,issue 內容明確指出 v2 admin dashboard **目前無法用 fulfillment_status / payment_status 做 UI 篩選或排序**(v1 可以,v2 因為這兩個是 relation 算出來的衍生值、graph query 不支援對 relation 篩選)。這對 PCM 是個具體可抄的「已知坑」——如果照抄 Medusa 模型,payment_status/fulfillment_status 若做成算出來的衍生欄位、不落 DB,會重蹈這個篩選失效的問題;**建議 PCM 若要能篩選,這兩個狀態應該落地成 order 表上的實體 enum 欄位(用 trigger/workflow 同步),不要純算派生。**

---

## 6. Order 完整欄位清單(主表 + line item)

來源:`order.ts`、`line-item.ts`、`order-item.ts`、`order-summary.ts` 原始碼 + `OrderDTO` reference(`https://docs.medusajs.com/resources/references/order/interfaces/order.OrderDTO`)。

### Order 主表(`order.ts` model,DB 實際欄位)
`id`(前綴 order)、`display_id`(自增,可搜尋)、`custom_display_id`(文字,可搜尋,nullable)、`region_id`(nullable)、`customer_id`(nullable)、`version`(default 1)、`sales_channel_id`(nullable)、`status`(enum OrderStatus,default PENDING)、`is_draft_order`(default false)、`email`(可搜尋,nullable)、`currency_code`(必填)、`locale`(nullable)、`no_notification`(nullable)、`metadata`(nullable)、`canceled_at`(nullable);關聯:`shipping_address`/`billing_address`(hasOne OrderAddress)、`summary`(hasOne OrderSummary,見下)、`items`(hasMany OrderItem)、`shipping_methods`、`transactions`、`credit_lines`(hasMany OrderCreditLine)、`returns`。

**PCM 可能漏掉、Medusa 主表「沒有」的欄位(值得注意的缺席,不是我漏抄)**:
- **沒有** `tax_total`/`shipping_total`/`discount_total`/`subtotal` 這些欄位直接落在 `order` 表 —— 全部改放 `OrderSummary.totals`(JSON,單一欄位)+ 執行期用 `OrderDTO` 計算欄位對外呈現(見下)。
- **沒有** `exchange_rate`(匯率)欄位 —— Medusa 用 `region_id`+`currency_code` 決定幣別,不存匯率快照;PCM 若要記錄下單當下匯率需自己加。
- **沒有** `note`/`tags`/`internal_note` 欄位在 Order 主表本身(`internal_note` 只出現在 `OrderChange`,是改單備註不是訂單備註)—— PCM 若要「訂單備註」欄位,Medusa 沒有現成對應,得自己設計。

### OrderDTO 對外欄位(API 回傳,計算後的金額欄位,不是 DB 實體欄位)
`created_at`/`updated_at`/`deleted_at`(DB 才有的時間戳,model 原始碼摘要沒列出但 DTO 有)+ 以下三組金額(每個都有 `original_*`「原始」與當前值兩版,外加對應 `raw_*` 版本存精確數值):
`item_total`、`item_subtotal`、`item_tax_total`、`item_discount_total`、`total`、`subtotal`、`tax_total`、`discount_subtotal`、`discount_total`、`discount_tax_total`、`credit_line_total`、`gift_card_total`、`gift_card_tax_total`、`shipping_total`、`shipping_subtotal`、`shipping_tax_total`、`shipping_discount_total`,以及 `original_item_total`/`original_item_subtotal`/`original_item_tax_total`/`original_total`/`original_subtotal`/`original_tax_total`/`original_shipping_total`/`original_shipping_subtotal`/`original_shipping_tax_total`。

### OrderSummary model(`order-summary.ts`)—— 上面所有金額實際落地處
`id`(前綴 ordsum)、`version`(default 1)、`totals`(JSON,單一大欄位裝上面全部金額 key)、`order`(belongsTo)。

### OrderSummaryDTO 的另一組總量欄位(算「已付/待收」用,非商品金額)
`pending_difference`、`current_order_total`、`original_order_total`、`transaction_total`、`paid_total`、`refunded_total`、`credit_line_total`、`accounting_total`(各有 `raw_*` 版本)。

### OrderLineItem model(`line-item.ts`)—— 商品「定義」層(不隨數量變動)
`id`(前綴 ordli)、`title`、`subtitle`(nullable)、`thumbnail`(nullable)、`variant_id`(nullable)、`product_id`(nullable)、`product_title`/`product_description`/`product_subtitle`/`product_type`/`product_type_id`/`product_collection`/`product_handle`(全 nullable,商品快照,防止商品之後改名影響歷史訂單)、`variant_sku`/`variant_barcode`/`variant_title`/`variant_option_values`(JSON,nullable,規格快照)、`requires_shipping`(default true)、`is_giftcard`(default false)、`is_discountable`(default true)、`is_tax_inclusive`(default false)、`compare_at_unit_price`(nullable)、`unit_price`(nullable)、`is_custom_price`(default false)、`metadata`;關聯 `tax_lines`/`adjustments`(hasMany)。**沒有 `quantity` 欄位**——這點很關鍵。

### OrderItem model(`order-item.ts`)—— 商品「訂單當下狀態」層,才有數量
`id`(前綴 orditem)、`version`(default 1)、`unit_price`(nullable)、`compare_at_unit_price`(nullable)、`metadata`、**`quantity`**(BigNumber,訂購數量)、`fulfilled_quantity`(default 0)、`delivered_quantity`(default 0)、`shipped_quantity`(default 0)、`return_requested_quantity`(default 0)、`return_received_quantity`(default 0)、`return_dismissed_quantity`(default 0)、`written_off_quantity`(default 0);關聯 `order`(belongsTo)、`item`(hasOne → OrderLineItem)。

→ **架構重點給 PCM 抄**:Medusa 把「商品是什麼(LineItem,含快照文案)」跟「這個商品在這張訂單裡的數量進度(OrderItem,7 個獨立累積量欄位)」拆成兩張表,一列數量的部分退貨/部分出貨/部分交付全靠 OrderItem 上這 7 個獨立計數器互相比對(quantity 對 fulfilled/shipped/delivered/return_* /written_off),不是靠單一 status 欄位判斷。

---

## 未確認清單(禁止當事實抄進 PRD,需要再查或找別的來源)

1. `ReturnStatus` 完整 enum 值(只確認含 `OPEN` + `requested/received/partially_received/canceled`,順序與是否還有其他值未確認 —— 已試:GitHub raw common.ts、GitHub code search API(401 被擋)、grep.app(429 被擋)、docs enum reference 頁(404))。
2. Admin 訂單列表逐一欄位/篩選軸/批次操作的官方文件層級規格(只有概述句,非表格;user-guide 頁本身就沒寫細節,非我漏讀)。
3. `OrderChangeAction.action` 完整值清單已於第1節列出(`ChangeActionType`,22 值),但沒找到每個值對應的官方逐條文字說明頁面,只有 docs 敘述其中 3-4 個(ITEM_ADD/ITEM_UPDATE/SHIPPING_ADD)當範例。
