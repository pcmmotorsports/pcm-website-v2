# ERP / 代購訂單狀態模型研究(給 PCM 訂單後台重建參考)

調查日期 2026-07-25。凡標「未確認」= 已試查證來源但找不到官方逐字定義,禁止推測填充。

---

## 1. Odoo:Sale Order ↔ Purchase Order 關聯(dropshipping / MTO)

### 1.1 sale.order 的 state 完整 enum(Odoo 18.0)
來源:https://github.com/odoo/odoo/blob/18.0/addons/sale/models/sale_order.py (fields.Selection on `state`)

| key | label |
|---|---|
| `draft` | Quotation |
| `sent` | Quotation Sent |
| `sale` | Sales Order(已確認,tracking 3、有 confirmation date 的 SQL 約束) |
| `cancel` | Cancelled |

注意:18.0 原始碼**已無 `done`**(舊版本論壇文章仍提到 `done`,但那是舊版殘留、18.0 已移除,官方原始碼為準)。

### 1.2 purchase.order 的 state 完整 enum(Odoo 18.0)
來源同上,`addons/purchase/models/purchase_order.py`

| key | label |
|---|---|
| `draft` | RFQ(詢價單) |
| `sent` | RFQ Sent |
| `to approve` | To Approve |
| `purchase` | Purchase Order(已確認採購單) |
| `done` | Locked |
| `cancel` | Cancelled |

附帶 `invoice_status`(computed selection):`no`(Nothing to Bill)/`to invoice`(Waiting Bills)/`invoiced`(Fully Billed)。

### 1.3 SO↔PO 關聯機制
- Dropshipping:Purchase app → Settings → Logistics → 勾選 Dropshipping。產品層設 route。
- MTO(Replenish on Order):產品 Inventory tab 勾 "Replenish on Order (MTO)" route,搭配 Buy 或 Manufacture route;同一張 SO 內可混用 MTO 與一般庫存出貨(逐行設定)。
- 確認 SO 時,dropship 產品明細行自動觸發生成一張 RFQ(確認後成為 purchase.order),兩者透過 **procurement group(`group_id`)** 關聯,同一 SO 產生的多張 PO 共用同一個 procurement group。
- `purchase.order.line` 有 `sale_order_id` / `sale_line_id` 欄位理論上可直連,但社群論壇多次提到**不保證自動填值**、需自行加欄位或走 stock.move traceability(SO 出貨 move → `move_dest_ids` → 收貨 move → PO line)才穩定拿到關聯。此段**未在官方技術文件找到權威保證**,僅論壇/社群佐證,列入「未確認」。
- Dropship 出貨面:確認後產生一張「dropship receipt」(`stock.picking`),來源地點=供應商、目的地點=客人,倉管收到供應商出貨後手動「驗證(Validate)」此據點,才算完成。**沒有找到官方文件明講「客人訂單畫面上有一個欄位顯示『已向供應商下單/供應商已出貨』」**——目前機制是靠這張 dropship receipt 的 `state`(見 1.4)間接反映,PCM 若要「已定/未定」這種一眼欄位,Odoo 官方模型本身也沒有現成欄位、是隱含在 PO 是否存在 + PO/picking state 裡。此點列「未確認(Odoo 無官方明文的客戶訂單頁專屬旗標)」。
來源:
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/dropshipping.html
- https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/mto.html
- https://www.odoo.com/documentation/19.0/applications/websites/ecommerce/order_handling.html(確認此頁**未提供**供應商下單狀態指標,只連結回上述兩頁)

### 1.4 stock.picking(倉儲操作,含 dropship receipt/交貨/退貨)state enum
來源:https://github.com/odoo/odoo/blob/18.0/addons/stock/models/stock_picking.py

| key | label | 意義 |
|---|---|---|
| `draft` | Draft | 尚未確認 |
| `waiting` | Waiting Another Operation | 等待另一步驟(前置操作未完成) |
| `confirmed` | Waiting | 已確認、等庫存可用 |
| `assigned` | Ready | 庫存已預留、可執行 |
| `done` | Done | 已完成 |
| `cancel` | Cancelled | 已取消 |

---

## 2. Odoo 退貨 / Return / 貸項通知單(Credit Note)

來源:
- https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/returns.html
- https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/credit_notes.html

### 2.1 兩種退貨情境
1. **未開發票前退貨**:從已驗證的 delivery order 點「Return」→ 開 Reverse Transfer 彈窗 → 可編輯數量/刪除品項 → 確認後產生一張新的 `stock.picking`(倉儲逆向操作,收退回品)→ 倉管驗證後 SO 的「已交付」數量自動調整,後續發票只算保留的品項。
2. **已開發票/已收款後退貨**:Reverse Transfer(同上)+ Credit Note 兩步驟並用:
   - 從已過帳發票(`account.move`, `move_type=out_invoice`)點「Credit Note」,填 Reason / Journal / Reversal Date,選 "Reverse" 或 "Reverse and Create Invoice",確認後產生 `move_type=out_refund` 的 credit note。
   - 產生後可看到「未沖銷客戶信用額(outstanding credits)」提示。

### 2.2 部分退貨
- Reverse Transfer 彈窗內數量本來就可編輯,天生支援部分退貨(只退部分品項或部分數量)。
- Credit Note 表單同樣可編輯品項/數量,支援部分退款金額。

### 2.3 account.move(發票/貸項通知單)state enum
來源:GitHub `addons/account/models/account_move.py`(查證版本為 14.0,18/19 欄位定義概念不變,但**逐字未在 18.0 原始碼重新核對、標記為次要來源**)

| key | label |
|---|---|
| `draft` | Draft(可編輯) |
| `posted` | Posted(已過帳、鎖定、影響總帳) |
| `cancel` | Cancelled |

`move_type` 區分文件種類:`out_invoice`(客戶發票)/`out_refund`(客戶貸項通知單/退款)/`in_invoice`(供應商帳單)/`in_refund`(供應商貸項通知單)/`entry`/`out_receipt`/`in_receipt`。

---

## 3. WooCommerce order status 完整清單

來源:https://woocommerce.com/document/managing-orders/order-statuses/

| slug | 中文意義 | 官方語意 |
|---|---|---|
| `wc-pending` | 等待付款(Pending payment) | 訂單已建立但尚未付款,等客人動作 |
| `wc-on-hold` | 保留中(On hold) | 等待付款確認(通常線下付款方式如匯款),**庫存已先扣**、但需人工確認付款 |
| `wc-processing` | 處理中(Processing) | 已收到付款、庫存已扣,等待出貨(這是「已付款、待出貨」的狀態) |
| `wc-completed` | 已完成(Completed) | 已出貨/履約完成,無需再動作 |
| `wc-cancelled` | 已取消(Cancelled) | 管理員或客人取消,庫存歸還 |
| `wc-refunded` | 已退款(Refunded) | 管理員已對此訂單全額退款 |
| `wc-failed` | 付款失敗(Failed) | 付款嘗試失敗或被拒絕,未成功收款 |
| `wc-checkout-draft`(核心,block 版結帳) | 草稿 | 客人進到結帳頁但未送出,閒置後自動刪除 |

**pending vs on-hold vs processing 差異(官方原文語意)**:
- `pending` = 完全還沒收到付款嘗試。
- `on-hold` = 已嘗試線下付款、庫存已扣但**等人工確認**收到款項。
- `processing` = 已**確認收到付款**、庫存已扣、等出貨。

**部分退款**:WooCommerce 核心**沒有獨立的「部分退款」訂單狀態**——部分退款是用訂單內的 refund line item / meta 記錄金額,訂單主狀態通常維持不變(除非店家手動改成 refunded);完全退款才會出現 `wc-refunded`。此點官方頁面未逐字明講「無 partial status」,是根據狀態清單反推(清單裡確實只有 `refunded` 一個、沒有 `partially-refunded`),**列為次要確認**(未見官方逐字寫「不存在部分退款狀態」這句話本身)。

---

## 4. Backorder / 缺貨待補

### 4.1 Odoo:stock.picking backorder(交貨面)
來源:
- https://www.odoo.com/forum/help-1/... 多篇論壇 + GitHub `addons/stock/models/stock_picking.py`(欄位定義權威、流程說明次要來源)
- 官方 `stock.picking` 有 `backorder_id`(Many2one 指回原始 picking,若此據點是從原據點拆出的)與 `backorder_ids`(反向 One2many)。
- 流程:驗證交貨時若實際處理數量 < 需求數量,跳出「Create Backorder?」對話框;可選「Create Backorder」(剩餘數量自動建一張新據點延後處理)或「No Backorder」(視為取消剩餘數量)。picking type 上可設定此行為預設值:`Ask`(預設彈窗問)/`Always`(自動建)/`Never`(從不建)。
- **這是「交貨/收貨」層的部分出貨機制,不是「客人已付款、供應商缺貨等下一批」這種採購面 backorder**;採購面若供應商缺貨,Odoo 沒有找到官方文件講一個獨立的「supplier backorder」狀態——實務上是 PO line 數量沒變、收貨 picking 停在 `waiting`/`confirmed`(等供應商到貨),此為**未確認**(找不到官方文件把它明講成「backorder」這個詞用在採購缺貨情境)。

### 4.2 WooCommerce:backorder 是「商品」層設定、不是「訂單」層狀態
來源:https://woocommerce.com/document/managing-products/product-editor-settings/(核心文件,Allow Backorders 欄位)

- Product Data → Inventory → "Allow backorders?" 三個值:`no`(Do not allow)/ `notify`(Allow, but notify customer)/ `yes`(Allow)。
- `notify` 模式:商品頁顯示「Available on Backorder」提示,購物車/結帳頁、訂單、給客人的 email 都會帶這個提示。
- **訂單本身沒有專屬的 backorder 訂單狀態**——下單流程照常走 pending → processing → completed,backorder 只影響「這張訂單裡某個品項庫存不足仍可購買」的商品層旗標與提示文案,不是訂單狀態機的一員。

**PCM 對照**:上述兩套系統都把「缺貨」處理成**商品/庫存層**的屬性(是否允許超賣+提示文案),而不是訂單狀態的一個 enum 值。PCM 目前想要的「客人已付款、供應商缺貨要等」比較接近 Odoo 的 dropship receipt 卡在 `waiting`/`confirmed` 狀態,兩套系統都**沒有**現成一個叫 `backorder` 的訂單狀態可以直接抄。

---

## 5. 代購/dropshipping 專用平台的訂單狀態清單

### 5.1 AutoDS(有公開文件,查到完整清單)
來源:https://help.autods.com/en/articles/12700454-orders-page-settings-navigation-statuses-edit-filter-and-troubleshoot

| 狀態 | 官方定義(節錄) |
|---|---|
| Pending | 訂單等待動作或自動化處理 |
| In Order Progress | 自動化正在處理(黃底=排隊等處理、白底=處理中,即將變 Ordered 或 Error) |
| Ordered | 「已成功向供應商下單、已付款、供應商已確認收單」,停留在此狀態直到供應商出貨產生追蹤碼(供應商通常需 3-4 工作天處理) |
| Shipped | 「供應商已出貨,AutoDS 已抓到追蹤碼」 |
| Delivered | 「追蹤資訊確認已送達買家地址」(AutoDS 不會回寫「已送達」到你的銷售通路) |
| Error (Failed) | 「AutoDS 無法處理此訂單」——常見原因:缺貨、價差、地址問題、技術錯誤、不支援的供應商 |
| Insufficient Funds(限 FBA) | FBA 餘額低於處理中訂單的最高採購金額總和 |
| Payment Revision(限 AliExpress Auto-Order) | 系統未能自動付款,需買家帳號手動完成付款 |
| Awaiting Payment | 買家尚未付款(如 eBay 允許先建單後付款的平台) |

這組狀態**幾乎完整對應 PCM「已定/未定」軸想要的顆粒度**:Pending(尚未下單)→ Ordered(已向供應商下單,對應 PCM 的「已定」)→ Shipped(供應商已出)→ Delivered;Error/Insufficient Funds 對應「下單失敗/缺料」情境。

### 5.2 Spocket
- 查證來源:https://help.spocket.co/en/articles/2121788-how-do-i-process-an-order-on-spocket
- 該頁**沒有列出正式的 order status enum**,只描述流程文字(下單後收確認信→供應商處理→出貨後收追蹤碼信),**未確認**是否存在其他頁面有正式清單(已試 help.spocket.co 該篇 + WebSearch 多次查無獨立 status 頁)。

---

## PCM 代購軸建議抄誰

優先抄 **AutoDS**(§5.1)的 Pending→Ordered→Shipped→Delivered(+Error)顆粒度,這是唯一查到「代購/dropship 專用、且公開文件完整」的訂單狀態清單,語意最貼近 PCM「已定/未定」需求。退款面可搭 Odoo 的 Reverse Transfer(退貨)+ Credit Note(退款)兩段式模型(§2),兩者職責分離、支援部分退貨。WooCommerce/Odoo 的一般電商狀態機(§3、§1.1-1.2)僅供「付款 x 出貨」兩軸參考,不含採購軸、不用照抄。
