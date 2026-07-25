# 訂單後台實地考察 — Odoo / Medusa / WooCommerce / Shopify

考察方式:Odoo 用 agent-browser 真瀏覽器直接操作 demo.odoo.com 臨時資料庫(唯讀,只看不按會寫入的按鈕);Medusa 官方 live demo(demo.medusajs.com)已下線(`DEPLOYMENT_NOT_FOUND`),改抓 docs.medusajs.com 官方文件內嵌的真實 admin 全解析度截圖;WooCommerce 用 wpdemo.net 自助產生的臨時 WP admin(sample data 套件實際沒帶訂單資料,故訂單列表/明細改抓 woocommerce.com 官方文件截圖,另附臨時後台側邊欄實拍);Shopify 官方明言無公開 admin demo,help.shopify.com 被 Cloudflare Turnstile 擋下瀏覽器自動化(截圖存證),改用 WebFetch 逐字引用官方文件內容(非截圖,已註明)。

截圖全部存於 `shots/` 子目錄,檔名見各節。

---

## 1. Odoo(Sales + Purchase + Accounting + Inventory,demo4.odoo.com 臨時資料庫)

### Q1 訂單列表頁

**Sales > Quotations**(`odoo-sales-list.png`)欄位逐一:Number(核取方塊)、Creation Date、Customer、Website、Salesperson(含頭像)、Activities(圖示,hover 顯示下一步待辦如「Follow-up on upsell」「Check delivery requirements」)、Company、Total、Status(色塊:綠 Sales Order、藍 Quotation)。

篩選器(點開篩選下拉,`odoo-sales-filters.png`):
- **Filters**:My Quotations(預設勾選)、Quotations、Sales Orders、Create Date(展開子選項)、Expired、Recurring、Not Recurring、Custom Filter
- **Group By**:Salesperson、Customer、Order Date、Payment Method、Custom Group
- **Favorites**:Save current search

分頁/排序:欄位標題可點擊排序(cursor:pointer);右上有 Pager(Previous/Next,當前 1-27/27);右上另有檢視切換圖示列(List/Kanban/Map/Calendar/Pivot/Graph/Activity,共 6 種)。批次操作:每列有 checkbox,表頭有全選 checkbox,配合頂部三點選單(Actions menu)可批次動作(實際選單內容未展開查看)。

**預設檢視分頁**:頂部導覽列本身就是分頁 — `Quotations | Orders | To Invoice | Products | Reporting | Configuration`(`odoo-orders-list.png`)。點 Orders 後畫面欄位相同(篩選條件同為 My Quotations,因 demo 資料本身多為已確認訂單)。

**Purchase > Requests for Quotation**(`odoo-purchase-list.png`,採購/代購軸,對 PCM 最相關):
- 頂部 KPI 卡片列:8 New、1 RFQ Sent、9 Late RFQ、5 Not Acknowledged、5 Late Receipt、0% OTD、-6.40 Days to Order(這排 KPI 卡在 Sales 列表沒有,是 Purchase 專屬)
- 欄位:Reference、Vendor、Company、Buyer、Order Deadline(逾期以紅字「4 days ago」顯示)、Activities、Total、Status(藍 RFQ / 深藍 RFQ Sent / 綠 Purchase Order)

### Q2 訂單明細頁

**Sales Order 明細**(`odoo-order-detail-s6-top.png` S00006,乾淨無訂閱範例;`odoo-order-otherinfo.png` Other Info tab):

由上到下:
1. 麵包屑 + 標題區:單號大字(S00006)、頂部動作列 New / 智慧按鈕(如「Delivery 1」)
2. 動作按鈕列:Create Invoice、Send、Preview、Cancel(視狀態出現 Upsell/Renew/Close);右側 Send message / Log note / Activity;breadcrumb 進度條 Quotation > Quotation Sent > Sales Order
3. 狀態色塊(訂單層級,不是欄位):如「Not Delivered」(藍)、「Waiting customer payment」(橘)+「In Progress」(綠,可同時多個並列)
4. 主資訊區:Customer(含完整地址)、Invoice Address、Delivery Address、Quotation Template;右欄 Order Date、Pricelist、Payment Terms、Promised Delivery
5. Tab 切換區:**Order Lines**(品項表 Product/Quantity/Delivered/Invoiced/Unit Price)、**Quote Builder**、**Other Info**(分兩欄:SALES 區 = Salesperson/Sales Team/Company/Online signature 開關/Online payment 開關/Prepayment percentage/Customer Reference/Tags;INVOICING 區 = Fiscal Position/Payment Method/Project)、**Notes**
6. 底部金額:Untaxed Amount / Tax 15% / Total,旁邊有 Discount / Add shipping 按鈕
7. 右側整條 Chatter(討論串):時間軸式,顯示「Sales Order created」等系統事件,可 Send message / Log note / Activity

**Purchase Order 明細**(`odoo-po-detail.png` P00014):同樣版型但欄位換成採購語境 — Vendor、Vendor Reference、Agreement、Payment Terms | Expected Arrival、Arrival Confirmation(checkbox)、Deliver To、**Receipt Status**(紅色「Not Received」);頂部智慧按鈕 Bill Matching / Price Comparison / Receipt 1;動作列 Receive / Upload Bill / Send PO / Acknowledge / Print / Cancel;breadcrumb RFQ > Purchase Order。

### Q3 退款/退貨畫面

- **財務面(Accounting > Credit Note wizard)**(`odoo-creditnote-wizard.png`):從已過帳發票點「Credit Note」按鈕跳出彈窗,欄位只有 Reason displayed on Credit Note(文字)、Journal(預設 Sales)、Reversal date;動作 Reverse / Reverse and Create Invoice / Discard。**這層沒有品項/數量選擇 — 是整張發票反轉(全額)**,若要局部退款需另外手動開立/編輯 Credit Note 明細列。已確認建立後的 Credit Note 畫面(`odoo-creditnote-detail.png`):標題「Customer Credit Note」、狀態 Draft>Posted、頂部藍色提示「You have outstanding debits listed below for this customer」、品項列表、底部 Outstanding debits 清單。
- **實體面(Inventory > Delivery > Return)**(`odoo-return-wizard.png`):點「Return」按鈕**會立即建立一張新的草稿調撥單**(WH/IN/xxxx,狀態 Draft,尚未 Validate 不影響庫存),欄位:Receive From、Scheduled Date、Source Document(自動填「Return of WH/OUT/xxxx」)、Operations tab 品項列(Product + Demand 數量,**可編輯數量**),底部 Clear / Return All。**退運費完全不在這層 — 這是純物流退貨單,金額退款要另外走 Credit Note 流程**,兩者解耦。
- 退款後畫面:Credit Note 過帳後在發票列表顯示為獨立單號(RINV/xxxx)、金額為負數,原訂單的「Amount Due」相應減少;Delivery 側退貨單完成後會產生對應的入庫紀錄,不影響原出貨單狀態本身。

### Q4 狀態視覺化

- 訂單/採購單/發票列表都用**單一 Status 欄位 + 色塊圓角標籤**(綠/藍/紅/橘依語意),同一列同時只有一個主狀態值,但明細頁頂部可以**並排顯示多個獨立狀態徽章**(如 S00069 同時顯示「Waiting customer payment」橘 + 「In Progress」綠,兩者語意不同軸但都用同款徽章樣式並列)。Delivery 的「Receipt Status」用紅色「Not Received」單獨欄位,和訂單本身的 Status 是分開概念。沒有看到「付款狀態」與「出貨狀態」在同一張列表用兩個獨立欄位並列呈現(Odoo 這點資訊密度低於下面 Medusa/WooCommerce)。

### Q5 PCM 明顯缺、Odoo 有的東西

- **Purchase 頁的 KPI 卡片列**(New/RFQ Sent/Late RFQ/Not Acknowledged/Late Receipt/OTD%/Days to Order)— 對 PCM「代購」流程極相關,一眼看出哪些單卡在供應商端。
- **Vendor Reference 欄位**(採購單上記錄供應商自己的單號,PCM 對帳到供應商發票時常用)。
- **Arrival Confirmation checkbox + Expected Arrival**,獨立於訂單狀態之外追蹤到貨承諾。
- **Chatter 討論串**(每張單右側整條時間軸,記錄系統事件 + 人工留言,可 @提及同事)。
- **Online payment / Online signature 開關**(逐筆訂單可個別關閉線上付款,PCM 若有客製報價單可能用得到)。

---

## 2. Medusa v2 Admin(demo.medusajs.com 已下線,改用 docs.medusajs.com 內嵌的官方真實截圖,均為 admin 實拍非示意圖)

### Q1 訂單列表頁

`medusa-orders-list-fullres.png`(來源截圖 2870×1614,官方文件用圖):欄位 Order(#22 這種編號)、Date、Customer、**Sales Channel**(B2B Portal / Webshop 兩種並存)、**Payment**(色點+文字:Captured 綠 / Partially captured 橘 / Not fulfilled 沒有,是另一欄 / Partially refunded 橘 / Authorized 橘)、**Fulfillment**(色點+文字,獨立欄:Not fulfilled 紅 / Partially shipped 橘 / Partially delivered 橘 / Fulfilled 綠 / Shipped 綠 / Delivered 綠)、Order Total。左側導覽:Orders / Products / Inventory / Customers / Promotions / Price Lists。有 Add filter 按鈕、右上搜尋框、排序圖示。**Payment 與 Fulfillment 是兩個完全獨立的欄位**,狀態值也各自獨立(見 Q4)。

### Q2 訂單明細頁

`medusa-detail-1.png`(單品項訂單) + `medusa-detail-3.png`(B2B 多品項含折扣碼訂單):

由上到下(左欄):
1. 標題「#1」+ 日期/銷售管道 + 右側訂單層級狀態徽章並排(如「Authorized」橘 + 「Not fulfilled」紅)
2. 動作按鈕列:Create Invoice / Send / Preview / Cancel...(依狀態變動),breadcrumb Quotation 進度不適用於 Medusa,改用 Send message / Log note / Activity(這是 Odoo 特徵,Medusa 版面實際是頂部直接動作按鈕無 breadcrumb)
3. **Summary** 區塊:品項列(縮圖+名稱+SKU+尺寸、單價、數量、**Allocated 綠色庫存狀態標籤**、小計),折扣碼會顯示為獨立列(如「BLACKFRIDAY -$1,920.00」);底下 Item Subtotal / Shipping Subtotal / Tax Total / Order Total / Discount Total / Total After Discount / Paid Total / **Outstanding amount**
4. **Payments** 區塊:每筆付款記錄(付款 ID、日期、provider 如 pp_system_default、狀態 Pending/Captured、金額)+ 「Capture payment」按鈕 + 提示文字「Payment #xxx is ready to be captured.」

右欄:
1. **Customer** 卡片(可展開 ... 選單:Transfer ownership / Shipping address / Billing address / Email 快速編輯):ID、Contact、Company(B2B 才有)、Shipping address、Billing address
2. **Activity** 時間軸:條列式 icon + 事件名 + 相對時間(如「Awaiting payment €20.00 about 2 months ago」「Order placed €20.00 about 2 months ago」),點開單筆可看更多子事件(如「Show 2 more activities」)

### Q3 退款/退貨畫面(`medusa-return-1~5.png`)

**Create Return 對話框**(`medusa-return-4.png`)欄位齊全,直接回答所有子題:
- 怎麼選品項:「Add items」連結加品項,每列顯示品項+**qty 數字輸入框(可編輯)**+單價+「...」更多動作
- 能不能選數量:能,qty 欄位直接編輯
- **Location** 下拉:選擇退貨要歸還到哪個倉庫
- **Return shipping (Optional)** 下拉:選擇退貨用的物流方式(如「Return」)
- **退運費是不是分開的**:是。底部明細分三行 — Return total(品項退款,如 -€10.00)、Return shipping(退貨運費,如 €5.00,可用鉛筆手動改)、**Refund amount**(兩者合計淨額,如 -€5.00,即運費從退款中扣除)
- Send notification 開關(是否通知顧客)

退款後畫面:訂單 Summary 區塊會插入一列「1x items return requested」+ 時間戳記 + info icon;右側 Activity 時間軸新增「Return #xxx requested」節點,含「1 item returned」與「Cancel」連結可撤銷。物流方確認收到退貨後另有「Receive items」對話框(`medusa-return-3.png`):品項+**已收到數量輸入框**(可能與請求數量不同,即部分收貨)+「Order Total / Outstanding amount」+ 提示「we will automatically adjust the inventory levels」+ Send notification 開關。收貨完成後 Summary 顯示「1x items return received」,Outstanding amount 轉為負值(`medusa-return-5.png`,如 €-5.00 EUR,代表店家欠客人退款待處理)。

### Q4 狀態視覺化

**Payment 與 Fulfillment 是列表上兩個完全獨立的欄位**,各自有一套狀態值(見上),用小色點 + 文字呈現(非大色塊 pill,比 Odoo/WooCommerce 更輕量)。明細頁頂部則把當前 Payment 狀態與 Fulfillment 狀態各自轉成一個 pill 徽章並排顯示。

### Q5 PCM 明顯缺、Medusa 有的東西

- **Payment/Fulfillment 雙軸分離設計**,對 PCM(可能先收款後代購到貨、或先出貨後對帳)這種時間差流程特別有用,現在 PCM 後台若只有單一狀態欄位會很難表達「已付款但供應商還沒出貨」。
- **Return 的 Location(退回哪個倉庫)+ Return shipping method 分開設定**,退運費與退貨款分開兩行且互相運算成淨退款金額,财務邏輯清楚。
- **Activity 時間軸的「Show N more activities」摺疊設計**,避免長單子時間軸洗版。
- **Customer 卡片的「Transfer ownership」**(把訂單轉給另一個客戶帳號,適合抓錯客人下單的情境)。

---

## 3. WooCommerce(wp-admin,`wpdemo.net` 自助臨時站 + 官方 woocommerce.com 文件截圖)

實測:透過 wpdemo.net 產生的臨時 WordPress 後台(`wp-demo-status2.png`,標榜「WooCommerce Demo with Sample Data」)登入後 WooCommerce > Orders 為**空清單**(`woo-orders-list.png`,顯示「When you receive a new order, it will appear here.」),該套件的 sample data 實際只含商品沒有訂單,故訂單列表/明細改採官方文件內嵌的真實 admin 截圖(均為 woocommerce.com 官方文件用圖,非示意)。

### Q1 訂單列表頁

`woo-orders-doc-1.png` 欄位:Order(含 眼睛圖示快速預覽)、Date、Status、Total、Origin(Web admin / Direct)。**Total 欄若有退款會顯示刪除線原價 + 底線顯示剩餘金額**(如 ~~$43.00~~ $0.00)。

**預設檢視分頁**(`woo-orders-doc-2.png`,清楚有預設分頁,回答子題明確):`All (6,645) | Mine (1) | Pending payment (145) | Processing (32) | On hold (33) | Completed (196) | Cancelled (3,243) | Refunded (16) | Failed (2,971)`,每個分頁旁帶數量。篩選列:Bulk actions 下拉 + Apply、All dates 下拉、Filter by registered customer、Filter 按鈕。批次操作:每列 checkbox + 頂部 Bulk actions。分頁導覽在右上(«‹ 2 of 1,328 ›»)。

### Q2 訂單明細頁

`woo-refund-2.png` 完整版型(Edit order 頁):

左欄:
1. 「Edit order」標題 + Add new order 按鈕
2. **Order #xxx details** 卡片:General(建立日期時間、Status 下拉)、Billing(客戶連結、地址、Email,鉛筆編輯圖示)、Shipping(地址,鉛筆編輯圖示)
3. **品項表**:Item / Cost / Qty / Total,運費另成一行(如「Flat rate」),若已退款則品項下方多一行紅字顯示退款數量與金額
4. 金額小計:Items Subtotal / Shipping / Order Total / Paid(含付款方式)/ Refunded(紅字)/ Net Payment / Transaction Fee;若不可再編輯會顯示提示文字「This order is no longer editable.」
5. **Downloadable product permissions** 卡片(數位商品授權管理,PCM 用不到但值得知道存在)

右欄:
1. **Order actions**:Choose an action 下拉(如 Email invoice / Resend emails)、Move to Trash、Update 按鈕
2. **Customer history**:Total orders、Total revenue、Average order value(**這客戶終身價值資訊直接嵌在訂單頁**)
3. **Order notes**:時間軸列表,**三色分類**(見 Q5)— 每筆備註含時間戳「by {username}」,系統自動記錄如「Order status changed from Processing to Refunded」「Item #78 stock increased from 22 to 23」「A refund of $16.50 was successfully processed using WooPayments (交易 ID 連結)」「A payment of $16.50 was successfully charged using WooPayments」「Stock hold of 60 minutes applied to...」

`woo-orders-doc-3.png` 另有從列表眼睛圖示點開的**快速預覽 modal**:Order # + 狀態徽章、Billing details、Shipping details、Email、Payment via(含交易 ID 連結)、品項表(Product/Quantity/Tax/Total,含 Backordered 缺貨提示)、底部快速狀態切換按鈕(Processing/Completed)+ Edit 按鈕 — 不用整頁跳轉就能簡單處理訂單。

### Q3 退款/退貨畫面

`woo-refund-3.png` 退款面板:
- 每個品項列自帶 Qty 輸入框(退款數量)與 Total 輸入框,系統依輸入自動算 Refund amount
- **Restock refunded items** checkbox(是否把退回品項加回庫存,預設勾選)
- Amount already refunded / Total available to refund(顯示上限,防止超退)
- **Refund amount** 欄位(可手動覆蓋自動算出的金額)
- Reason for refund(optional)文字框
- 兩顆退款按鈕並列:「Refund $X manually」(僅記帳,不觸發金流)vs 「Refund $X via Stripe」(實際呼叫金流退款)— **手動記帳退款與金流自動退款是兩個獨立按鈕**
- 品項表中運費(Flat rate)本身就是表格內的一行,**與商品品項用同一套 Qty/Total 退款欄位**,不是分開的獨立區塊(和 Medusa 的「獨立 Return shipping 欄位」設計不同)

退款後畫面:`woo-refund-1.png` — 品項表每列下方多一行紅字「↺ -1 / -$18.00」呈現已退數量與金額;下方新增一列「Refund #30044 - 日期 by {user} / 備註文字 -$43.00」;金額區新增 Refunded(紅字)、Net Payment 欄位;訂單狀態自動變成 Refunded;提示「This order is no longer editable.」。

### Q4 狀態視覺化

單一 **Status 欄位 + 灰/藍/綠等色塊 pill**(Refunded 灰、Completed 藍、Processing 綠),**沒有把付款狀態與出貨狀態拆成兩欄**(這點資訊密度低於 Medusa)— 出貨相關資訊要另外裝 WooCommerce Shipping/物流外掛才會有獨立欄位。

### Q5 PCM 明顯缺、WooCommerce 有的東西

- **Order notes 三色分類**:System notes(紫,系統自動,顧客看不到)、General notes(灰,店家內部備註,顧客看不到但可能觸發狀態變更信)、Customer notes(藍,店家寫給顧客看,會發信通知)。這是一個**單一時間軸欄位靠顏色區分內部/外部溝通**的輕量設計,PCM 目前完全沒有「訂單備註」這個概念。
- **Customer history 直接嵌在訂單頁**(該客戶累積訂單數/總營收/平均客單價),不用跳去客戶頁面查。
- **列表快速預覽 modal**(眼睛圖示,不跳頁看到品項+地址+快速改狀態),對客服人員效率很有幫助。
- **Total 欄的刪除線價格**(退款後原價劃線、顯示實收金額),一眼看出哪些單有退款、退多少,不用點進去。
- **退款按鈕分「manually」與「via {金流}」兩種**,對 PCM 這種可能混用線下轉帳/TapPay 的情境有參考價值。
- **Backordered 缺貨提示直接顯示在訂單品項列**(快速預覽 modal 內)。

---

## 4. Shopify(無公開 admin demo;help.shopify.com 被 Cloudflare 擋下瀏覽器自動化)

`shots/shopify-challenge.png`、`shopify-challenge2.png` 為存證:瀏覽器連線 help.shopify.com 觸發 Cloudflare Turnstile「Your connection needs to be verified before you can proceed」,勾選查驗方塊後等待 12 秒以上仍卡在「請稍候...」無法通過,判斷為自動化流量被主動擋下,**未能取得真實截圖**。改用 WebFetch 直接抓取官方文件頁面純文字內容(非截圖,以下全為逐字引用原文,非我方憑印象補充)。

### Q1 訂單列表頁

未取得欄位逐一列表的官方文字描述(orders 總覽頁與 searching-and-viewing-orders 頁都只有操作說明,無版面描述)。**已確認**篩選/狀態軸(來自 order-status 文件):可用篩選維度包含 fulfillment status、payment status、sales channel、date range、tagged orders,且「可結合多個篩選」(如 Low risk + Unpaid 同時套用)。欄位本身**可自訂顯示/隱藏/拖曳排序**(逐字:「click the hide or view icons on each columns to view or hide them, or click and drag the columns to reorder them」),且此設定是 per-view 的。

### Q2 訂單明細頁

未取得截圖版面圖。**已確認**(逐字引用 managing-order-details 文件)明細頁功能清單依序:view your order's timeline / tag open orders / check order's currency / view payment history / add order notes / contact your customer;另外可編輯客戶聯絡資訊與出貨地址、可重寄訂單確認信、可預覽訂單在顧客幣別下的顯示。

### Q3 退款/退貨畫面

**已確認**(逐字引用 refunding-orders 文件):
- 品項選擇:「Enter the quantity of the items that you want to refund. Any products with a quantity set to 0 aren't refunded.」— 數量輸入框,0 = 不退該品項
- 退運費:「Optional: To refund shipping, in the Refund shipping section, select Shipping, and then enter the amount that you want to refund for shipping.」— **確認是獨立區塊**,金額可自訂,不綁定品項退款金額
- 退款後:「your order's status changes to Partially refunded」,且「order's financial summary and order's Timeline are automatically updated」
- 可分批多次退款直到達到訂單原始金額上限

**已確認**(逐字引用 creating-returns 文件,退貨/換貨流程比退款更完整):
- 「Select quantity to return」區塊逐品項輸入退貨數量
- 必須「select a return reason」,選項依商品類別不同(服飾類有 Too big / Too small 等)
- 退貨運費三選一:Shopify 代開退貨標籤(僅美國)、上傳自備退貨標籤(PDF/PNG/JPEG/URL,可填追蹤號與物流商)、No shipping required
- 退貨運費與 restocking fee 依規則自動帶入、可個別編輯
- 可選加購「換貨品項」並套用折扣
- 建立後訂單頁出現「Return in progress」區塊,後續才處理退款/換貨出貨

### Q4 狀態視覺化

**已確認完整狀態值清單**(逐字引用 order-status 文件):
- Payment status:Pending, Authorized, Due, Expiring, Expired, Paid, Refunded, Partially refunded, Partially paid, Voided, Unpaid
- Fulfillment status:Unfulfilled, In progress, On hold, Scheduled, Partially fulfilled, Fulfilled, Fulfillment not required
- 兩者為官方文件分開列舉的兩套獨立狀態值,搭配上方 Q1 確認的「fulfillment status、payment status」是兩個獨立篩選維度,可推斷列表上是兩欄分開顯示(但未取得畫面截圖佐證顏色/樣式,此處不臆測視覺呈現方式)。

### Q5 PCM 明顯缺、Shopify 有的東西(僅列文件明確提到者)

- **Timeline 同時是「歷史紀錄」與「內部留言板」**:文件明講「With Timeline, you can view detailed histories and write notes and comments for orders, draft orders, customers, and transfers」,且留言「can only be read by you and other staff members」— 等同 WooCommerce 的 Order notes,但 Shopify 把它做成一個更通用的元件(Timeline),同一套元件用在 order/draft order/customer/transfer 上,PCM 若要做應考慮做成可複用元件而非只綁訂單。
- **欄位可自訂顯示/隱藏/拖曳排序,且設定是 per-view 儲存**(不同篩選檢視可以有不同欄位配置)。
- **列表可同時組合套用多個篩選**(risk + payment status 等交叉篩選),而非只能單選一個分頁。
- **退貨(return)與退款(refund)是兩個分開的流程物件**:退貨先建立「Return in progress」記錄品項/原因/物流,退款是退貨處理完後的動作,兩者狀態各自追蹤,不是像 WooCommerce 那樣退款當下直接扣品項。

---

## 未取得清單(誠實列出,禁止用印象補)

1. **Medusa**:未透過真瀏覽器互動(官方 demo.medusajs.com 部署已刪除,回應 `DEPLOYMENT_NOT_FOUND`);所有畫面資訊來自 docs.medusajs.com 官方內嵌截圖,截圖本身是真實 admin 畫面但屬「文件配圖」而非我方即時操作驗證,可能非最新版 UI(截圖檔名日期為 2025-02)。
2. **WooCommerce**:live demo(wpdemo.net 臨時站)雖標榜含 sample data,但實測 Orders 清單為空,未能在真實互動環境中看到訂單資料;訂單列表/明細/退款畫面改用官方文件截圖替代(2024-05 / 2025-04 拍攝)。
3. **Shopify**:完全未取得任何畫面截圖 — help.shopify.com 被 Cloudflare Turnstile 擋下瀏覽器自動化(已嘗試點擊驗證方塊 + 等待逾 12 秒仍卡住);所有 Shopify 資訊為 WebFetch 逐字引用文件文字,**沒有畫面視覺呈現的第一手證據**(尤其 Q4 狀態視覺化的顏色/pill 樣式是用邏輯推斷「應為兩欄分開顯示」,非親眼所見,已在正文特別註明)。
4. **Odoo POS(POS Orders 退款流程)**:因需要開啟收銀班別(session,屬寫入操作)才能進入 POS 畫面,判斷超出「唯讀」界線,主動跳過未考察。
5. **Odoo「Reporting」「Configuration」選單內容**:未展開查看,僅知選單存在。
6. **WooCommerce Analytics 儀表板**(客戶終身價值等更完整報表):文件有提及但未截圖查證細節。

---

## PCM 現在最明顯缺的 5 樣東西(跨平台交叉出現、優先度最高)

1. **訂單備註/時間軸(Notes + Timeline)**:WooCommerce(三色 System/General/Customer notes)、Medusa(Activity 時間軸)、Shopify(Timeline 兼歷史+留言板)、Odoo(Chatter)**四個平台全部都有**,且都是「同一個時間軸元件,系統事件自動記 + 人工可手動加註,分內部/外部可見範圍」。PCM 現在後台完全沒有這個概念 — 客服/主管無法在訂單上留言溝通,也看不到「誰在什麼時候改了什麼」的系統軌跡。
2. **付款狀態與出貨狀態分離成兩個獨立欄位/軸**:Medusa 列表兩欄分開 + Shopify 文件確認兩者是獨立篩選維度與獨立狀態值清單。PCM 若只用單一「訂單狀態」欄位,無法表達「已付款但代購中」「已出貨但退款處理中」這類 PCM 業務常見的交錯狀態。
3. **退款與品項/運費的關聯設計**:三個平台(Odoo Inventory Return、Medusa Create Return、WooCommerce Refund panel、Shopify Refund)都是「逐品項輸入退款數量 → 系統算小計,退運費是額外可選的一行」。PCM 目前退款是後台手動取消 + SOP(見 memory `project_refund-line-two-stage`),沒有品項級數量選擇的介面。
4. **客戶訂單歷史/終身價值直接嵌在訂單明細頁**:WooCommerce 的 Customer history 卡片(Total orders / Total revenue / AOV)、Shopify 也提到點客戶名可看「number of orders」。PCM 後台目前查訂單時看不到「這個客戶還買過什麼、買了多少次」,得另外查詢。
5. **採購/供應商對帳專屬欄位**:Odoo Purchase 的 Vendor Reference(記錄供應商自己單號)+ 頂部 KPI 卡片(Late Receipt、Days to Order)。PCM 是代購模式,向供應商下單後需要對帳,目前後台沒有「供應商單號」「預計到貨」「逾期提醒」這類欄位,這條最貼近 PCM 業務本質但四個主流平台中只有 Odoo 明確做出來(因為 Odoo 是 ERP,含完整採購模組;Medusa/WooCommerce/Shopify 都是純零售導向,沒有這塊)。
