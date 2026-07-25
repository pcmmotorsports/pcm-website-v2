# Shopify 訂單狀態模型研究(Admin GraphQL API + Admin 說明中心)

研究日期:2026-07-25。全部 enum 值與欄位皆為 WebFetch/firecrawl 親自讀取官方頁面取得,逐字照錄,未憑記憶。

---

## 1. Order 狀態欄位

### `financialStatus`(非 display 版)—— **不存在**
- 直接訪問 `https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderFinancialStatus` → **HTTP 404**(該 enum 已被移除/不存在於目前 Admin GraphQL API)。
- 再讀 `https://shopify.dev/docs/api/admin-graphql/latest/objects/Order` 確認:Order 物件上**沒有非 display 版的 `financialStatus` 欄位**,只有 `displayFinancialStatus`。
- 補充(非 GraphQL enum、是 REST 風格搜尋語法):orders query 的 `financial_status:` search filter 接受 `paid / pending / authorized / partially_paid / partially_refunded / refunded / voided / expired`(來源:`https://shopify.dev/docs/api/admin-graphql/latest/queries/orders`,WebFetch 摘要、未逐字覆核,信心中等)。

### `displayFinancialStatus` — `OrderDisplayFinancialStatus` enum
來源:`https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderDisplayFinancialStatus`
Order 欄位定義:"An order's financial status for display in the Shopify admin."

| 值 | 官方定義 |
|---|---|
| `AUTHORIZED` | The payment provider has validated the customer's payment information. |
| `EXPIRED` | Payment wasn't captured before the payment provider's deadline on an authorized order. |
| `PAID` | Payment was automatically or manually captured, or the order was marked as paid. |
| `PARTIALLY_PAID` | A payment was manually captured for the order with an amount less than the full order value. |
| `PARTIALLY_REFUNDED` | The amount refunded to a customer is less than the full amount paid for an order. |
| `PENDING` | Orders have this status when the payment provider needs time to complete the payment. |
| `REFUNDED` | The full amount paid for an order was refunded to the customer. |
| `VOIDED` | An unpaid (payment authorized but not captured) order was manually canceled. |

### `fulfillmentStatus`(非 display 版)—— **未確認**
未直接查證是否存在(未 404 測試該 URL)。已知 Order 物件文件只提到 `displayFulfillmentStatus`(見下)。若需精確排除,需再對 `enums/OrderFulfillmentStatus` 做一次 404 測試。

### `displayFulfillmentStatus` — `OrderDisplayFulfillmentStatus` enum
來源:`https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderDisplayFulfillmentStatus`
Order 欄位定義:"The order's fulfillment status that displays in the Shopify admin to merchants."

| 值 | 官方定義 |
|---|---|
| `FULFILLED` | All the items in the order have been fulfilled. |
| `IN_PROGRESS` | All of the items in the order have had a request for fulfillment sent to the fulfillment service or all of the items have been marked as in progress. |
| `ON_HOLD` | All of the unfulfilled items in this order are on hold. |
| `OPEN` | None of the items in the order have been fulfilled. |
| `PARTIALLY_FULFILLED` | Some of the items in the order have been fulfilled. |
| `PENDING_FULFILLMENT` | A request for fulfillment of some items awaits a response from the fulfillment service. |
| `REQUEST_DECLINED` | Some of the items in the order have been rejected for fulfillment by the fulfillment service. |
| `RESTOCKED` | All the items in the order have been restocked. |
| `SCHEDULED` | All of the unfulfilled items in this order are scheduled for fulfillment at later time. |
| `UNFULFILLED` | None of the items in the order have been fulfilled. |

補充(REST 風格 search filter,信心中等,同上來源):`fulfillment_status:` 接受 `unshipped / shipped / fulfilled / partial / scheduled / on_hold / unfulfilled / request_declined`。

### `returnStatus` — `OrderReturnStatus` enum
來源:`https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderReturnStatus`
Order 欄位定義:"The order's aggregated return status for display purposes."

| 值 | 官方定義 |
|---|---|
| `IN_PROGRESS` | Some items in the order are being returned. |
| `INSPECTION_COMPLETE` | All return shipments from a return in this order were inspected. |
| `NO_RETURN` | No items in the order were returned. |
| `RETURN_FAILED` | Some returns in the order were not completed successfully. |
| `RETURN_REQUESTED` | A return was requested for some items in the order. |
| `RETURNED` | Some items in the order were returned. |

### `cancelReason` — `OrderCancelReason` enum
來源:`https://shopify.dev/docs/api/admin-graphql/latest/enums/OrderCancelReason`
Order 欄位定義:"The reason provided for an order cancellation."

| 值 | 官方定義 |
|---|---|
| `CUSTOMER` | The customer wanted to cancel the order. |
| `DECLINED` | Payment was declined. |
| `FRAUD` | The order was fraudulent. |
| `INVENTORY` | There was insufficient inventory. |
| `OTHER` | The order was canceled for an unlisted reason. |
| `STAFF` | Staff made an error. |

---

## 2. 退款/退貨模型

### Return 物件
來源:`https://shopify.dev/docs/api/admin-graphql/latest/objects/Return`

| 欄位 | 型別 | 說明 |
|---|---|---|
| closedAt | DateTime | 何時關閉 |
| createdAt | DateTime! | 何時建立 |
| decline | ReturnDecline | 被拒絕退貨的細節(未展開查證欄位) |
| exchangeLineItems | ExchangeLineItemConnection! | 附掛於此 return 的換貨品項 |
| id | ID! | 全域唯一 ID |
| name | String! | return 名稱 |
| order | Order! | 所屬訂單 |
| refunds | RefundConnection! | 與此 return 關聯的退款 |
| requestApprovedAt | DateTime | 何時核准 |
| returnLineItems | ReturnLineItemTypeConnection! | 被退回的品項 |
| returnShippingFees | [ReturnShippingFee!]! | 退貨運費 |
| reverseFulfillmentOrders | ReverseFulfillmentOrderConnection! | 逆物流訂單 |
| staffMember | StaffMember | 建立退貨的員工 |
| status | ReturnStatus! | 退貨狀態 |
| suggestedFinancialOutcome | SuggestedReturnFinancialOutcome | 建議財務結果 |
| totalQuantity | Int! | 所有退貨品項數量總和 |
| transactions | OrderTransactionConnection! | 此 return 產生的交易 |
| suggestedRefund | SuggestedReturnRefund | (已棄用)建議退款金額 |

### ReturnStatus enum
來源:`https://shopify.dev/docs/api/admin-graphql/latest/enums/ReturnStatus`

| 值 | 官方定義 |
|---|---|
| `CANCELED` | The return has been canceled. |
| `CLOSED` | The return has been completed. |
| `DECLINED` | The return was declined. |
| `OPEN` | The return is in progress. |
| `REQUESTED` | The return was requested. |

### ReturnLineItem 物件
來源:`https://shopify.dev/docs/api/admin-graphql/latest/objects/ReturnLineItem`

數量相關欄位(**回答 (a)(b) 的關鍵**):
| 欄位 | 型別 | 說明 |
|---|---|---|
| `quantity` | Int! | The quantity being returned. |
| `processableQuantity` | Int! | The quantity that can be processed. |
| `processedQuantity` | Int! | The quantity that has been processed. |
| `unprocessedQuantity` | Int! | The quantity that hasn't been processed. |
| `refundableQuantity` | Int! | The quantity that can be refunded. |
| `refundedQuantity` | Int! | The quantity that was refunded. |

其他欄位:`id`、`customerNote`(≤300字)、`fulfillmentLineItem`(指回原本被履行的品項)、`returnReason`(已棄用)、`returnReasonDefinition`、`returnReasonNote`(≤255字)、`restockingFee`、`totalWeight`、`withCodeDiscountedTotalPriceSet`。

### Refund 物件
來源:`https://shopify.dev/docs/api/admin-graphql/latest/objects/Refund`

| 欄位 | 型別 | 說明 |
|---|---|---|
| createdAt | DateTime | The date and time when the refund was created. |
| duties | [RefundDuty!] | 此退款包含的關稅退款 |
| id | ID! | A globally-unique ID. |
| legacyResourceId | UnsignedInt64! | REST API 對應 ID |
| note | String | 退款備註 |
| order | Order! | The order associated with the refund. |
| orderAdjustments | OrderAdjustmentConnection! | 與此退款關聯的訂單調整 |
| processedAt | DateTime! | The date and time when the refund was processed. |
| refundLineItems | RefundLineItemConnection! | 被退款的品項 |
| refundShippingLines | RefundShippingLineConnection! | 被退款的運費 |
| return | Return | 關聯的 Return(若有) |
| staffMember | StaffMember | 發起退款的員工 |
| totalRefundedSet | MoneyBag! | The total amount across all transactions for the refund. |
| transactions | OrderTransactionConnection! | 關聯的付款交易 |
| updatedAt | DateTime! | 更新時間 |
| totalRefunded | MoneyV2! | (已棄用) |

Refund **沒有自己的 status enum**——一筆 Refund 本身是「已發生的動作」記錄(有 processedAt 即代表已處理),狀態粒度是掛在 Return.status / OrderReturnStatus / OrderDisplayFinancialStatus 上,不是 Refund 物件本身。

### RefundLineItem 物件
來源:`https://shopify.dev/docs/api/admin-graphql/latest/objects/RefundLineItem`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | ID | A globally-unique ID |
| lineItem | LineItem! | 對應的原始訂單品項 |
| location | Location | 補回庫存的地點 |
| priceSet | MoneyBag! | 退款品項價格(雙幣別) |
| **quantity** | **Int!** | **The quantity of a refunded line item**(這就是「品項數量3只退1」的表達方式——單一整數,不是布林) |
| restocked | Boolean! | 是否已補回庫存 |
| restockType | RefundLineItemRestockType! | 補庫存類型 |
| subtotalSet | MoneyBag! | 小計(雙幣別) |
| totalTaxSet | MoneyBag! | 稅額(雙幣別) |

### ReverseFulfillmentOrder 物件(退貨物流/逆物流訂單)
來源:`https://shopify.dev/docs/api/admin-graphql/latest/objects/ReverseFulfillmentOrder`

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | ID! | A globally-unique ID |
| lineItems | ReverseFulfillmentOrderLineItemConnection! | 逆物流品項 |
| order | Order | 所屬訂單 |
| reverseDeliveries | ReverseDeliveryConnection! | 逆物流配送記錄 |
| status | ReverseFulfillmentOrderStatus! | 逆物流訂單狀態 |
| thirdPartyConfirmation | ReverseFulfillmentOrderThirdPartyConfirmation | 第三方物流確認資訊 |

### ReverseFulfillmentOrderStatus enum
來源:`https://shopify.dev/docs/api/admin-graphql/latest/enums/ReverseFulfillmentOrderStatus`

| 值 | 官方定義 |
|---|---|
| `CANCELED` | The reverse fulfillment order has been canceled. |
| `CLOSED` | The reverse fulfillment order has been completed. |
| `OPEN` | The reverse fulfillment order is in progress. |

### (a) 部分退款怎麼表達?
- 一筆 `Refund` 只包含實際要退的 `refundLineItems`(每個帶 `quantity`)+ `refundShippingLines`,金額用 `totalRefundedSet`(MoneyBag,分幣別)。
- Order 層級狀態會反映在 `OrderDisplayFinancialStatus.PARTIALLY_REFUNDED`。
- 一張訂單可以有多筆 Refund(`Refund` 是逐次退款事件記錄,不是訂單上唯一一個欄位)。

### (b) 一個品項數量 3 個只退 1 個怎麼表達?
`RefundLineItem.quantity = 1`(對應 `LineItem` 原本數量 3)。若這筆退款是走 Return 流程,則 `ReturnLineItem.quantity`(要求退的數量)與 `ReturnLineItem.refundedQuantity`(已退數量)分開追蹤,兩者都可以是 1(< 原品項數量 3)。

### (c) 已出貨後退貨、貨還沒收回來的中間態叫什麼?
- Admin UI 顯示為 **"Return in progress"**(來源:`https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/creating-returns`、`https://help.shopify.com/en/manual/fulfillment/managing-orders/managing-order-details` 系列頁面提到的 "Return in progress" 卡片區塊)。
- GraphQL 對應狀態:`Return.status = OPEN`("The return is in progress.")與訂單彙總層 `Order.returnStatus = IN_PROGRESS`("Some items in the order are being returned.")。
- 若走 Shopify Fulfillment Network(SFN)逆物流,中間態另有 `ReverseFulfillmentOrderStatus = OPEN`("The reverse fulfillment order is in progress.")。
- Admin 訂單清單「Return status」篩選軸也有獨立顯示值 **"Return requested" / "Return in progress" / "Return closed"**(來源:`https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/filtering-orders`,WebFetch 摘要,信心高但未逐字截圖覆核)。

---

## 3. 換貨(Exchange)有沒有獨立模型?

**沒有獨立頂層模型。Exchange 是掛在 Return 底下的子物件,不是平行於 Return 的獨立實體。**

- 舊模型 `ExchangeV2`(掛在 `Order.exchangeV2s`)**已棄用**,官方社群論壇標題直接是 "GraphQL issue with deprecation of ExchangeV2 in favor of Returns"(來源:`https://community.shopify.dev/t/graphql-issue-with-deprecation-of-exchangev2-in-favor-of-returns/35958`)。直接訪問 `https://shopify.dev/docs/api/admin-graphql/latest/objects/ExchangeV2` → **HTTP 404**,證實現行 API 已移除該物件。
- 現行模型:`Return.exchangeLineItems: ExchangeLineItemConnection!`——換貨品項是 Return 的一個欄位。
- `ExchangeLineItem` 物件欄位(來源:`https://shopify.dev/docs/api/admin-graphql/latest/objects/ExchangeLineItem`):

| 欄位 | 型別 | 說明 |
|---|---|---|
| id | ID! | A globally-unique ID. |
| lineItems | [LineItem!] | 換貨關聯的訂單品項 |
| processableQuantity | Int! | The quantity of the exchange item that can be processed. |
| processedQuantity | Int! | The quantity of the exchange item that have been processed. |
| quantity | Int! | The number of units ordered, including refunded and removed units. |
| unprocessedQuantity | Int! | The quantity of the exchange item that haven't been processed. |
| variantId | ID | The ID of the variant at time of return creation. |
| lineItem | LineItem | (已棄用)單一品項版本 |

- Admin UI 操作面也印證此結構:建立 Return 時,在同一個表單裡有一個「**Exchange items**」子區塊(點 **Add products** 加換貨品項),而不是另開一個獨立的「Exchange」建立流程(來源:`https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/creating-returns`)。
- 財務結算三態(來源同上頁「Understanding return financials」表格):
  1. 商家欠客戶錢(換貨新品項比退回品項便宜)→ 走退款
  2. 客戶欠商家錢(新品項+費用比退回品項貴)→ 走請款(invoice / capture payment)
  3. 等值換貨 → 原付款金額直接轉移到新品項,不產生金流動作

---

## 4. Admin 訂單列表頁

來源:`https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/searching-orders`(欄位/檢視/批次操作)+ `https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/filtering-orders`(篩選軸)

### 預設 5 個 Saved Views(分頁 tab)+ 各自預設欄位
| View 名稱 | 篩選條件 | 預設顯示欄位 |
|---|---|---|
| **All** | 無篩選(預設) | (未列出,是全欄位基準,可調欄位順序但不可刪改篩選) |
| **Unfulfilled** | Status: Open;Fulfillment status: Unfulfilled 或 Partially fulfilled | Order number, Order date, Customer name, Total price, Financial status, Fulfillment status, Fulfill by, Item count, Delivery method, Order tags |
| **Unpaid** | Status: Open;Financial status: Unpaid | Order number, Order date, Customer name, Total price, Financial status, Fulfillment status, Item count, Order tags |
| **Open** | Status: Open | Order number, Order date, Customer name, Total price, Financial status, Fulfillment status, Fulfill by, **Return status**, Item count, Delivery method, Order tags |
| **Closed**(即 Archived) | Status: Archived | Order number, Order date, Customer name, Total price, Financial status, Fulfillment status, Item count, Delivery method, Order tags |
| Local delivery(有開 Locations 才顯示) | Delivery method: local | Order number, Order date, Customer name, Total price, Financial status, Fulfillment status, Item count, Delivery method, Order tags |

其他機制:
- 欄位可自訂顯示/隱藏/排序(**Order** 欄固定最左、不可移動)。
- 點欄位(Customer / Items / Fulfill by / Destination)可彈出詳情 popup。
- 訂單號旁的 icon 提供額外資訊(如有無備註/留言、詐騙風險高)。
- Order view = 已存的「篩選+欄位配置+排序」組合,存成頂端 tab;可新增/改名/刪除(All 除外)。

### 篩選軸(exhaustive,WebFetch 摘要、含精確標籤;信心高但建議日後對照 UI 截圖覆核一次)
Order status(Open/Archived/Canceled)、Payment status、Fulfillment status、Delivery status、**Return status**(Return requested / Return in progress / Return closed)、Label status、Chargeback and inquiry status、Order total、Delivery method、Destination、Address validation、Number of items、Total product weight、Product、Discount code、App、Channel、B2B、Payout action required、Fraud risk、Credit card last 4、Tagged with / Not tagged with、Date。另支援 order metafield 篩選(來源:`https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders`)。

### 批次操作(bulk actions)
- 勾選多筆訂單後可執行,例如 **Print**,或透過 `…` 選單選其他動作;確認過的具體項目:**Cancel orders**(批次取消,單次上限 250 筆)、Archive/Unarchive。其餘 bulk action 清單頁面未逐一列舉全部項目,只給範例——**未完整枚舉,標未確認**(來源:`https://help.shopify.com/en/manual/fulfillment/managing-orders/viewing-orders/searching-orders#use-bulk-actions-with-a-filter` 只舉例未窮舉;`https://help.shopify.com/en/manual/fulfillment/managing-orders/canceling-orders` 確認批次取消存在且上限 250 筆)。

---

## 5. Admin 訂單明細頁

來源:綜合 `managing-order-details`、`refunding-orders`、`canceling-orders`、`returns/creating-returns`、`payments/capturing-payments`(WebSearch 摘要)頁面。**未取得單一頁面「完整 wireframe 區塊列表」的官方逐字說明,以下為從多篇操作型文件反推的區塊+動作清單,已對應每項來源。**

| 區塊(Section) | 動作按鈕/功能 | 來源 |
|---|---|---|
| **Timeline** | 檢視歷史紀錄、發留言(Leave a comment / Post)、附檔案、@提及員工、連結其他商品/訂單/客戶、展開 payment event 看 "Information from the gateway"、"Resend email" | managing-order-details |
| **Customer** | `...` 選單 → **Edit contact information** / **Edit shipping address**;billing address 不可編輯 | managing-order-details |
| **Contact** | 點客戶 email 開 **Contact customer** dialog → 輸入訊息 → **Review email** → **Send notification**(或 **Back**) | managing-order-details |
| **Notes** | 鉛筆 icon 編輯備註 → **Save** | managing-order-details |
| **Tags** | 輸入新 tag(逗號分隔)或鉛筆 icon 選現有 tag → **Done** | managing-order-details |
| **Order Details / 品項列表** | **Refund** 按鈕(進入退款流程) | refunding-orders |
| **Return in progress**(有進行中退貨時才出現) | **Process return**、`…` → **Remove return items** / **Cancel return** / **Close return** / **Open return**(視狀態) | returns/creating-returns |
| **Authorized**(手動請款模式且訂單為 Authorized 狀態時才出現) | **Capture payment**(可調整金額做部分請款) | payments/capturing-payments(WebSearch 摘要,未逐字截圖覆核) |
| **More actions**(頁面右上選單) | **Cancel order**、**Archive order(s)**、**View order status page**、（已封存/取消訂單另有）**Delete order** | canceling-orders、managing-order-details |
| 頁面頂層 | **Restock**(無需退款時單獨補回庫存) | refunding-orders |

補充:訂單明細頁「Fulfill items」按鈕存在但**未取得官方頁面逐字截圖確認其確切區塊名稱**——僅有 WebSearch 對第三方教學文摘要佐證(來源標「信心中,未逐字核」:`https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/single-fulfillment` 存在但本次未 scrape 逐字驗證按鈕名稱)。

---

## 6. 訂單匯出 CSV 完整欄位清單

來源:`https://help.shopify.com/en/manual/orders/export-orders`

```
Name, Phone, Email, Financial Status, Paid at, Fulfillment Status, Fulfilled at,
Accepts Marketing, Currency, Subtotal, Shipping, Taxes, Total, Discount Code,
Discount Amount, Shipping Method, Created at, Lineitem quantity, Lineitem name,
Lineitem price, Lineitem compare-at price, Lineitem SKU, Lineitem requires shipping,
Lineitem taxable, Lineitem fulfillment status, Billing Name, Billing Street,
Billing Address1, Billing Address2, Billing Company, Billing City, Billing Zip,
Billing Province, Billing Province Name, Billing Country, Billing Phone,
Shipping Name, Shipping Street, Shipping Address1, Shipping Address2,
Shipping Company, Shipping City, Shipping Zip, Shipping Province,
Shipping Province Name, Shipping Country, Shipping Phone, Notes, Note Attributes,
Cancelled at, Payment Method, Payment Reference (deprecated), Payment References,
Refunded Amount, Vendor, Outstanding Balance, Employee, Location, Device ID, Id,
Tags, Risk Level, Source, Lineitem discount, Tax 1-5 Name, Tax 1-5 Value,
Payment ID, Payment terms, Next payment due at
```
共 69 欄(含 "Tax # Name/Value" 各展開到 5 組計為 10 欄的話則欄位總數更多,依實際 CSV 生成而定)。

---

## 未確認清單(禁止當事實使用,需再查證)

1. `Order.fulfillmentStatus`(非 display 版)是否存在——未做 404 測試,只確認官方範例都用 `displayFulfillmentStatus`。
2. `ReturnDecline` 物件完整欄位——未展開查證。
3. Admin 訂單列表 bulk actions 完整清單(除 Cancel orders / Print / Archive 外還有哪些)——來源頁面只舉例未窮舉。
4. 訂單明細頁 "Fulfill items" 區塊的精確官方名稱與按鈕文字——僅有 WebSearch 摘要,未 scrape 原文逐字核對。
5. financial_status / fulfillment_status REST 風格 search filter 的完整合法值清單——來自 WebFetch 對 orders query 頁面的摘要,未逐字二次核對原始表格。
6. Return 篩選軸 "Return requested / Return in progress / Return closed" 三個 UI 顯示字串——來自 WebFetch 摘要,未截圖覆核。
