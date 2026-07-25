# 客戶/定價/庫存/設定/報表/採購 — Shopify・Medusa・Odoo 研究

研究者:sonnet subagent。查證方式:firecrawl_search + firecrawl_scrape(shopify.dev / help.shopify.com / docs.medusajs.com)、agent-browser 真瀏覽器操作 Odoo 官方 demo(demo2/demo3.odoo.com,公開共享 demo、session 會被伺服器重置,已重新整理繼續)。截圖存 `scratchpad/shots2/`。

---

## 1. 客戶/會員管理後台

### Shopify Customer 物件(GraphQL Admin API)
來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer(親抓 json 抽取,2026-07-25)

完整欄位清單:`addressesV2`(多地址)、`amountSpent`(終身消費額)、`canDelete`、`companyContactProfiles`(B2B contact profile 列表)、`createdAt`、`dataSaleOptOut`、`defaultAddress`、`defaultEmailAddress`、`defaultPhoneNumber`、`displayName`、`events`(時間軸事件)、`firstName`/`lastName`、`id`、`identityProviderSubjects`、`image`、`lastOrder`、`legacyResourceId`、`lifetimeDuration`、`locale`、`mergeable`(可否合併)、`metafield(s)`、`multipassIdentifier`、`note`(備註)、`numberOfOrders`、`orders`(訂單歷史,直接內嵌在客戶物件下)、`paymentMethods`、`productSubscriberStatus`、`state`(帳號狀態:enabled/disabled/invited/declined)、`statistics`、`storeCreditAccounts`、`subscriptionContracts`、`tags`(逗號分隔標籤)、`taxExempt`/`taxExemptions`/`taxSettings`、`updatedAt`、`verifiedEmail`。

重點:訂單歷史直接是 `orders` 欄位(嵌入式關聯,非另開頁面拼接);`tags` 是自由文字逗號分隔(非結構化 enum);`note` 是單一自由文字欄。

### Shopify 客戶分群(Segment)機制
來源:https://shopify.dev/docs/apps/build/marketing/customer-segments/manage(親抓,2026-07-25)

- Segment = 儲存的**查詢字串**(ShopifyQL-like query language),例:`email_subscription_status = 'SUBSCRIBED'`。CRUD 走 `segmentCreate` / `segments` / `segment` / `segmentUpdate` / `segmentDelete` mutation/query。
- `segmentFilters` 查詢可用的篩選欄位(attribute),例:`amount_spent`(Float)、`city`(Enum,含子值如 US-NY-NewYorkCity)、`email_domain`。
- `customerSegmentMembers` 查該 segment 底下的客戶清單+統計(如平均消費)。
- Segment 可直接掛在折扣上:`discountCodeBasicCreate` 的 `customerSelection.customerSegments.add: [segmentId,...]` — 分群與折扣機制是打通的(這對應 PCM「分級價格自動套用」的可能實作路徑)。

### Shopify B2B:Company / CompanyLocation(對應 PCM 店家分級最相關)
來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/Company + https://shopify.dev/docs/apps/build/b2b(親抓,2026-07-25)

模型關係:一個 **Company**(公司/店家帳號)底下有多個 **CompanyLocation**(分店/據點),每個 location 各自有帳單/收件地址、可各自指定 catalog 與稅務豁免與付款條件;Company 底下有多個 **contacts**(該公司員工/採購人員,各自有 role)。

**Company 物件欄位**:`name`、`note`、`customerSince`、`externalId`(外部系統 ID,適合報價單串接用)、`contacts`/`contactsCount`、`contactRoles`(角色清單)、`defaultRole`(新 contact 預設角色)、`mainContact`(主要聯絡人)、`locations`/`locationsCount`、`draftOrders`、`orders`、`ordersCount`(跨所有 location 加總)、`totalSpent`(跨所有 location 加總)、`lifetimeDuration`、`events`、`hasTimelineComment`、`metafield(s)`、`createdAt`/`updatedAt`。

**CompanyLocation 物件欄位**(來自搜尋摘要,非完整親抓,標記待補完整清單):`name`、`note`、preferred locale、`orders`(該 location 的訂單)、roles 清單、staff members 清單;官方文件明確指出 CompanyLocation 可掛 `Catalog`(商品可見範圍)、`TaxExemption`(稅務豁免 enum)、Payment Terms(付款條件)。

**B2B 折扣/定價串接**:Company 官方描述明文 — "CompanyLocation objects can have custom pricing through Catalog and PriceList configurations"(見下節)。這代表 Shopify B2B 的分級價格 = **Company/CompanyLocation → Catalog → PriceList** 三層模型,不是直接掛在客戶身上。

### Medusa Customer Module
來源:https://docs.medusajs.com/resources/commerce-modules/customer + https://docs.medusajs.com/user-guide/customers/groups(親抓,2026-07-25)

- Customer Module 兩大功能:①Customer Management(guest/registered)②Customer Organization = **Customer Group**(客戶分群)。
- Customer Group 用途官方明講:「例如建立 VIP 客戶群給折扣、或 wholesale 客戶群給大量訂購折扣價」— 與 PCM 店家分級用途完全對應。
- 後台操作(Customers → Customer Groups):列表、建立(僅需輸入群組名稱)、詳情頁、加入/移除客戶、刪除。**群組本身沒有內建「規則式自動加入」機制**(不像 Shopify Segment 用查詢字串自動篩選)——加入群組是手動勾選客戶,這點 Medusa 弱於 Shopify。
- 官方行銷頁(medusajs.com/customer-module)提到「RBAC and permissions」是靠 **metadata + Auth Module 自己接**,不是開箱即用的後台角色系統(對應第 4 題設定/權限發現)。
- **Medusa 沒有原生 B2B Company/Location 物件**(不像 Shopify)。B2B 場景走 Customer Group + 客製 metadata/自寫 module 的「recipe」(`docs.medusajs.com/resources/recipes/b2b`,未親讀細節,標記未確認完整內容)。

### 對 PCM 的意義(店家分級 = 最接近 B2B)
PCM 目前「一般/店家/頂級店家」三級會員本質上是 Shopify Customer Segment 的簡化版(用 tier enum 而非動態查詢),比 Shopify 完整 B2B(Company/Location 多據點)簡單,但比 Medusa 預設的手動 Customer Group 更接近「自動依條件分級」。

---

## 2. 價格/折扣機制

### Shopify Price List(GraphQL Admin API)
來源:https://shopify.dev/docs/api/admin-graphql/latest/objects/PriceList(親抓,2026-07-25)

- PriceList = 「for `ProductVariant` 定義價格的清單」,每個 PriceList 綁一個 `Catalog`(適用範圍/客群)。
- 欄位:`catalog`、`currency`(固定價幣別)、`fixedPricesCount`、`name`(唯一人類可讀名稱)、`prices`(PriceListPriceConnection)。
- 兩種定價方式:**固定價**(fixed,直接設每個 variant 的價格)或**相對價**(relative,用 adjustment 百分比對母價做加減,由 price list parent 設定驅動)。
- 適用條件走 **Catalog**(而非直接綁客戶):Catalog 可以是 Market(地區)、Company Location(B2B)等,PriceList 掛在 Catalog 上,Catalog 決定「誰看得到這個價」。

### Shopify Discount(折扣碼 vs 自動折扣、四類)
來源:https://shopify.dev/docs/apps/build/discounts(親抓,2026-07-25)

**兩種觸發方式**:
- **Automatic discount**(自動):符合條件在結帳/購物車自動套用,不需輸入碼。
- **Code discount**(折扣碼):客戶輸入代碼才套用。

**折扣類型(每種都有 Automatic 版跟 Code 版的 mutation)**:
1. Percentage or fixed-amount(百分比或固定金額折扣)—`discountAutomaticBasicCreate` / `discountCodeBasicCreate`
2. Buy X Get Y / Spend X Get Y(買X送Y / 滿額送)—`discountAutomaticBxgyCreate` / `discountCodeBxgyCreate`
3. Free shipping(免運)—`discountAutomaticFreeShippingCreate` / `discountCodeFreeShippingCreate`
4. App-defined(透過 Shopify Functions 自訂邏輯,例如量階折扣/組合折扣)—`discountAutomaticAppCreate` / `discountCodeAppCreate`

**適用範圍(discount classes,決定折扣作用在哪)**:Order(整筆訂單)/ Product(特定商品)/ Shipping(運費)。

**疊加規則**:官方文件本頁未直接列出疊加規則細節(未確認,需另查 `help.shopify.com/manual/discounts/combining-discounts`)。

**有效期**:`startsAt`/`endsAt` 型欄位(見 segment 範例中的 discountCodeBasicCreate 有 `startsAt`)。

**客群條件**:`customerSelection`(all / 特定 customer segments / 特定 customers)。

### Medusa Price List + Promotion Module
來源:https://docs.medusajs.com/resources/commerce-modules/pricing/concepts + https://docs.medusajs.com/resources/commerce-modules/promotion/concepts(親抓,2026-07-25)

**Price List**:
- 「一群只在條件滿足時才生效的價格,套用時可覆蓋 price set 裡的預設價」。
- 有 `start_date`/`end_date`(有效期)、`metadata`(自訂 key-value)。
- 支援 **Tiered Pricing**(量階定價):同一 variant 可設多筆價格,依 `min_quantity`/`max_quantity` 自動選價(例:預設 $10、買 10+ 變 $8、買 20+ 變 $6)——這是 Shopify PriceList 沒有的能力。
- 支援多幣別(`currency_code`)與多區域(`price_rules` 用 `region_id` 之類的 attribute/operator/value 三元組)。

**Promotion Module**(折扣機制的正式模組名):
- 兩種 type:`standard`(單一折扣,如 9 折碼)、`buyget`(買X送Y類邏輯)。
- 適用範圍:cart items / shipping methods / 整個 order。
- **PromotionRule**:用 `attribute` + `operator` + `values` 三元組限制折扣適用對象,例 `attribute: "customer.group.id"` 限定只有某 customer group 能用——**這正是 Medusa 版的「分級折扣」實作路徑**,直接對應 PCM 分級經銷價需求。
- **Campaign**:把多個 promotion 綁在同一起訖日期+預算配置下管理(Shopify 沒有對應的一站式「活動」概念,是加值項)。
- 官方案例:「VIP 客戶群自動折扣移除運費 10%」「消費滿 $100 免運」都是 Promotion + PromotionRule 組合。

### 對 PCM 的意義
PCM 分級經銷價最貼近 **Medusa Price List 的 tiered pricing + customer group 條件**,而非 Shopify PriceList(Shopify PriceList 本質是 B2B Catalog 專用、疊加邏輯較封閉)。若要做「滿額折扣」「特定商品自動折扣」則對應 Medusa Promotion + PromotionRule 或 Shopify Discount(Automatic + discount classes)。

---

## 3. 庫存管理

### Shopify Inventory
來源:https://help.shopify.com/en/manual/products/inventory/fundamentals/inventory-states(search snippet,2026-07-25;未逐字親抓全文,以下為摘要)

**庫存狀態(inventory states)**:
- **Available**(可售):未被任何訂單/草稿訂單佔用、且不含 Incoming 的庫存。
- **Committed**(已承諾):已成立訂單但尚未出貨的數量。**注意**:草稿訂單(draft order)裡的數量不算 Committed,要等草稿轉正式訂單才算——這是一個容易誤解的細節。
- **On Hand**(在手):某地點的總庫存,= Committed + Unavailable + Available 的總和。
- 另有 **Damaged**、**Reserved**、**Incoming** 狀態(來源:shopify.com/inventory-management 行銷頁提及「on hand, ready to sell... damaged, reserved, committed to orders, or incoming」,未逐字查證官方狀態定義頁對這些的精確定義,標記部分未確認)。
- 庫存以「地點(location)」為單位管理,一個商品可以在多地點各自設庫存,結帳時依 location 判斷可售性。

### Medusa Inventory Module
來源:https://docs.medusajs.com/resources/commerce-modules/inventory/concepts(親抓 json 抽取,2026-07-25)

**核心資料模型**:
- `InventoryItem`:代表一個「可管理庫存的東西」(通常對應一個 product variant)。
- `InventoryLevel`:某個 InventoryItem 在某個 `StockLocation` 的庫存細節,存 stocked / reserved / incoming 數量。
- `ReservationItem`:訂單成立時佔用掉的庫存量(對應 Shopify 的 Committed 概念)。
- `StockLocation`:庫存地點,與 InventoryLevel 關聯。
- 低庫存門檻:提示有 `lowStockThreshold` 概念存在(json 抽取回傳空殼值,實際欄位名稱與行為未逐字確認,標記待補;概念上 Medusa 有 low-stock 通知機制但需另查 `docs.medusajs.com` 是否為核心功能或外掛)。

**兩者比較**:Shopify 用「狀態」語意(Available/Committed/On Hand)描述同一份庫存的切面;Medusa 用「模型」語意(InventoryItem/InventoryLevel/ReservationItem)描述,概念上等價(Reserved≈Committed、Stocked≈On Hand 扣掉 unavailable),但 Medusa 把 reservation 拆成獨立可查詢的實體(ReservationItem),適合做庫存異動歷史追蹤。

**庫存異動歷史(adjustment log)**:兩邊文件都指向「有」但本次未親讀到逐欄位的異動歷史 schema(誰在何時調整、調整原因),**標記未確認**,需要另開頁面查證(Shopify: `help.shopify.com/en/manual/products/inventory/adjusting-inventory` 系列;Medusa: 需查 inventory workflows reference)。

---

## 4. 設定頁組織

### Shopify Settings(完整清單,逐字)
來源:https://help.shopify.com/en/manual/your-account/users/roles/permissions/settings-permissions + https://help.shopify.com/en/manual/your-account/users/roles/permissions/store-permissions(親抓,2026-07-25)

**Settings 頁面完整項目清單**(逐字保留,來自官方「Settings 頁面所需最低權限」表格的左欄):
Store settings、Plan、**Payments**、**Checkout and customer accounts**、**Shipping and delivery**、**Taxes and duties**、Locations、Gift cards、International sales tools、Apps and sales channels、Domains、Brand、**Notifications**、Custom data(含 metafields/metaobjects)、Languages、Policies。

**Admin 整體權限分類(比 Settings 頁更廣,涵蓋整個後台側欄)**:Home、Orders、Draft orders、Products、**Inventory**、Catalogs、Gift cards、Customers、Analytics、Marketing、**Discounts**、Content、Files、Online store、Checkout and customer accounts、**Companies**(B2B)、App development、Store settings、**Finance**。

**運費規則(Shipping and delivery)細節**(來自 `help.shopify.com/en/manual/fulfillment/setup`,search snippet):Shipping rates(flat rate / carrier-calculated / 免運門檻)、Shipping profiles(依商品/出貨地設不同費率)、Packages(包裹尺寸重量)、Locations、Order routing(依鄰近度/庫存決定哪個地點出貨)、Delivery methods(local delivery / pickup in store / pickup points)、Delivery expectations(預期到貨日)、Notifications、Order status page。

**通知 email 範本(Notifications)**:官方確認是獨立設定頁,管理「發給你自己」跟「發給客戶」的通知(下單確認、出貨通知等),細節模板清單本次未逐字親抓(標記未確認完整清單)。

**員工帳號與權限(role/permission 模型)**:Shopify 是**細顆粒度勾選式權限系統**,權限分區包括:Home / Orders / Draft orders / Products / Inventory / Catalogs / Gift cards / Customers / Analytics / Marketing / Discounts / Content / Files / Online store / Checkout and customer accounts / Companies / App development / Store settings / Finance,每區底下再細分單項權限(例如 Store settings 底下有 12+ 個獨立可勾選權限,含「Manage payments settings」「Manage locations」「Store credit」等)。部分權限標記為 **sensitive permission**(如查看稅務文件、管理付款設定)需要更高審核。**沒有「角色範本」以外的抽象層級,是純 checkbox 矩陣**。

### Medusa Settings(完整清單,逐字)
來源:https://docs.medusajs.com/user-guide/settings(親抓,2026-07-25)

**Settings 完整項目清單**(逐字):Manage Store、Manage Users、Manage Regions、Manage Tax Regions、Manage Return Reasons、Manage Refund Reasons、Manage Sales Channels、Manage Location & Shipping Settings、Manage Publishable API Keys。另有 Profile(個人資料/兩步驟驗證,獨立於主 Settings 選單、掛在側欄底部頭像選單)。

**運費規則對應**:Location & Shipping 底下含 Locations(庫存地點)、Shipping Profiles、**Shipping Option Types**(自訂運送方式類型)、Service Zones(地理範圍決定可用運送選項)。

**付款方式**:掛在 **Region** 底下(每個 Region 各自選擇 Payment Providers),不是獨立全域頁面——這跟 Shopify「Payments 是獨立全站設定」的模型不同,Medusa 是「地區決定付款方式」。

**通知 email 範本**:本次查證**未找到 Medusa 內建的 email 範本管理頁**(Settings 清單裡沒有 Notifications 項目)。Medusa 的 email 通知走 Notification Module(開發者用 code 訂閱 event 觸發,無後台可視化範本編輯器)——**這是 Medusa 相對 Shopify 明顯弱的一塊**,標記需另查 `docs.medusajs.com` Notification Module 是否有後台 UI(初步判斷:沒有,是純程式介面)。

**員工帳號與權限(role/permission 模型)**:Medusa 核心 **沒有** Shopify 那種細顆粒度後台勾選權限系統。官方行銷文案明講「Set up RBAC using metadata and the Auth Module」——代表 RBAC 是要開發者自己用 `metadata` + Auth Module 兜出來,不是後台可視化配置。User Module 本身只提供「邀請新使用者(email invite)」「管理現有使用者」,沒有角色矩陣 UI。**這是 PCM 若要做細顆粒度員工權限,兩邊都得自己蓋,Medusa 起點比 Shopify 低很多**。

---

## 5. 報表/儀表板

### Shopify Home + Analytics
來源:https://help.shopify.com/en/manual/shopify-admin/shopify-admin-overview + https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports(親抓+search,2026-07-25)

- **Home 頁**(登入後首頁):即時指標(銷售額、流量)+ 待辦提醒(如「有訂單還沒請款」)+ 成長建議,點擊提醒直接跳轉對應頁面。
- **Analytics 儀表板**(admin.shopify.com/analytics):**可自訂**的 metric card 集合(officially "customizable dashboard"),每張卡是一個獨立指標(如「Net sales by channel」「Sessions by device type」),可新增/移除/排序/分區/縮放;約 1 分鐘內更新一次。
- **Reports 頁**(admin.shopify.com/analytics/reports):比儀表板卡片更深的報表,含視覺化圖表+明細表,可另存為自訂 data exploration。
- **Live View**:即時流量/訂單監控(獨立子頁,未逐字查證細節)。
- 沒有查到官方文件明列「預設出廠就有哪幾張卡片」的完整清單(需要實際登入商店才看得到出廠預設,官方文件只講機制不講預設卡片內容),**標記未確認**「預設卡片清單」。

### Medusa Dashboard/Reports
來源:multi-search(2026-07-25,含 medusajs.com/integrations/agilo-analytics、medusajs.com/integrations/rsc-labs-medusa-store-analytics-v2)

**重大發現:Medusa 核心後台沒有內建報表/儀表板首頁**。官方 User Guide 的「Tour of Medusa Admin」只描述側欄導航、搜尋列、通知,**完全沒提到有指標卡片或首頁儀表板**;登入後直接進 Orders/Products 之類的清單頁,不是像 Shopify 那樣先看到彙總指標。

分析/報表功能要靠**第三方付費 plugin**補上,例如:
- `@agilo/medusa-analytics-plugin`(Agilo Analytics):加裝後在 Admin 側欄多一個 Analytics 頁,含 Orders Tab 的 Total Sales KPI 等圖表。
- `@rsc-labs/medusa-store-analytics-v2`:支援 Sales by time / Sales by currency / Sales chart / Refunds 等統計。

**這是 Medusa 相對 Shopify 最大的後台功能缺口之一**——PCM 若走「Medusa 對應」路線,報表儀表板等於要從零蓋(或裝外掛),不能假設 Medusa 有等價物。

---

## 6. 供應商/採購管理(Odoo,PCM 代購本質最需要的一塊)

親自用 `agent-browser` 真瀏覽器操作 Odoo 官方 demo(https://demo.odoo.com/ 自動導向 demo2/demo3.odoo.com,公開共享即時 demo、庫存/訊息數字會隨其他使用者操作變動,session 也會被伺服器不定期重置為 database selector——中途遇到一次重置,已重新開新 session 完成剩餘操作,不影響下列資料真實性)。截圖存 `scratchpad/shots2/`:`odoo-purchase-list.png`、`odoo-po-detail.png`、`odoo-vendor-pricelists-list.png`、`odoo-pricelist-detail.png`、`odoo-vendor-sales-purchase-tab.png`。

### 採購單(Purchase Order)列表版面
路徑:Purchase App → Orders(預設列表)

欄位(逐字):Priority(緊急旗標)、Reference(單號,如 P00014)、Vendor(供應商)、Company(公司,多公司架構用)、Buyer(採購負責人)、Order Deadline、Activities(待辦活動圖示)、Total(金額)、Status。

Status 值實際看到:`RFQ`(詢價中)、`RFQ Sent`(已送出詢價)、`Purchase Order`(已轉正式採購單)——推斷還有 Sent/Confirmed/其他中間態(未逐一點開驗證每個狀態,已看到的 3 種標記為確認,其餘未確認)。

側邊快篩 smart filters:`8 New`、`1 RFQ Sent`、`9 Late RFQ`、`5 Not Acknowledged`、`4 Late Receipt`。

### 採購單明細版面
路徑:點開任一 PO

**動作按鈕**:Receive(收貨)、Send PO、Acknowledge(供應商確認)、Print、Cancel、Upload Bill;智慧按鈕:Bill Matching、Price Comparison、N Receipt(收貨單關聯)。

**Products 分頁欄位**:Product、Quantity、Received(已收數量)、Billed(已請款數量)、Unit Price、Taxes、Amount,底部有 Add a product / Add a section / Add a note / **Catalog**(從供應商目錄挑商品)。

**Other Info 分頁欄位**:Buyer、Company、Promised Date、Fiscal Position、Incoterm、Incoterm Location、Source(來源單據)、Project。

**單頭欄位**:Vendor、Vendor Reference(供應商自己的單號)、Agreement(採購協議)、Payment Terms、Expected Arrival、Arrival Confirmation(checkbox)。

### 供應商欄位(res.partner,Vendor 身分)
路徑:Contacts App → 搜尋供應商(以 "Wood Corner" 為例)

**Contacts 分頁**(基本資料):Name、Email、Phone、Address(Street/Street2/City/State/ZIP/Country)、TIN(稅籍編號)、Job Position、Website、**Tags**(自由標籤,如 "Vendor / Desk Manufacturers"、"Vendor / Office Supplies" — 用 tag 做供應商分類而非獨立欄位)、關聯聯絡人(該公司底下的員工,各自有 email/phone/職稱)。

**Sales & Purchase 分頁**(逐字,eval 抽取 innerText 驗證):
```
SALES: Salesperson, Pricelist, Payment Terms, Payment Method, Delivery Method,
       Incoterm, Incoterm Location, Avalara Code, Contact, Avalara Partner Code,
       Avalara Exemption
PURCHASE: Group RFQ, Buyer, Payment Terms, Payment Method, 1099 Box,
       Receipt Reminder, Days Before Receipt
POINT OF SALE: Barcode
FISCAL INFORMATION: Fiscal Position
MISC: Company ID, Reference, Company, Website, Industry, SLA Policies
```
重點:PURCHASE 區塊獨立於 SALES 區塊,同一個 partner 可以同時是客戶也是供應商,兩邊的 Payment Terms/Payment Method 各自獨立設定——這對應 PCM「同一個對象可能既是客人又是代購上游」的潛在情境(目前 PCM 沒有這種雙重身分需求,先記錄不必馬上做)。

**其他分頁**:Accounting、Partner Assignment、Notes(未逐一點開驗證欄位,標記未確認)。

### 供應商商品價目表(Vendor Pricelist / supplierinfo)
路徑:Purchase App → Configuration → **Vendor Pricelists**(action-206)

**列表欄位**:Vendor、Product、Company、Unit Price、Lead Time(交期天數)。

**單筆明細欄位**(逐字,點開一筆驗證):Vendor(供應商)、Vendor Product Name(供應商端商品名,可能跟自家命名不同)、Vendor Product Code(供應商料號)、Lead Time、Product(對應到自家商品)、Product Variant、**Quantity**(最小採購量/量階門檻,tiered pricing 用)、Unit Price、**Validity**(有效期間,日期範圍)、Discount(%)、Company。

**重點**:同一個 Vendor + Product 組合可以有多筆 supplierinfo(如截圖中 "Ready Mat" 對 "Large Cabinet" 有兩筆不同 Unit Price:790.00 跟 785.00),用 Quantity 門檻或 Validity 日期區分——這是**量階折扣 + 供應商比價**的資料結構基礎,也是 Price Comparison 智慧按鈕的資料來源。

### 對 PCM 的意義
這是六題裡 Shopify 完全沒有、Medusa 也沒有原生模組的一塊。PCM 代購模式需要的「供應商」概念,結構上最貼近 Odoo 的 **res.partner(Vendor 身分)+ supplierinfo(Vendor Pricelist)+ Purchase Order** 三件套:
- 供應商主檔(含分類 tag、付款條件、Lead Time)
- 供應商商品價目表(多筆同商品不同供應商/不同量階/不同效期的成本價,用於比價與自動抓最新成本)
- 採購單(對供應商下單、追蹤 Received/Billed 進度、跟收貨單關聯)

---

## 未確認清單(查不到 / 未逐字驗證,禁止當事實使用)

1. Shopify CompanyLocation 完整欄位清單(僅從搜尋摘要取得部分,未親抓完整頁面)。
2. Shopify Discount 疊加規則細節(help.shopify.com/manual/discounts/combining-discounts 未親讀)。
3. Shopify Inventory 的 Reserved/Damaged/Incoming 狀態精確官方定義(僅行銷頁提及,未讀到 fundamentals 頁逐條定義)。
4. Medusa Inventory 的 low-stock threshold 實際欄位名稱與是否為核心功能(json 抽取回傳空殼,需另查 API reference 或 admin widget)。
5. Shopify/Medusa 兩邊「庫存異動歷史(誰在何時因何調整)」的完整 schema。
6. Shopify Notifications 設定頁底下的完整 email 範本清單(僅確認頁面存在)。
7. Shopify Analytics 儀表板「出廠預設」卡片清單(官方文件只講機制,不講預設內容)。
8. Odoo PO Status 除了 RFQ / RFQ Sent / Purchase Order 之外的完整狀態機(如 Done、Cancelled 等未逐一驗證)。
9. Odoo 供應商 Accounting / Partner Assignment / Notes 三個分頁的欄位內容(未點開)。
10. Medusa `resources/recipes/b2b` recipe 的完整內容(僅知道存在,未讀細節)。

---

## PCM 最該補的 5 個後台功能

1. **供應商主檔 + 供應商商品價目表(Vendor + Supplier Pricelist)**——PCM 是純代購,目前後台完全沒有這塊(對照 §6 Odoo:vendor tag 分類、payment terms、lead time、同商品多供應商比價、量階成本)。這是六題裡「PCM 業務本質最缺、兩個電商平台範本都沒有」的功能,直接決定「知道現在該跟哪家供應商用多少成本進貨」。

2. **依客戶分群自動套用分級價格的規則引擎**——現況(依 memory)是 tier enum 硬查,對照 §1/§2 的 Shopify Segment(查詢字串自動篩選)+ Medusa PromotionRule(`customer.group.id` 條件式套用)模型,PCM 缺的是「條件可設定、效期可設定」的彈性層,而非重寫整個定價邏輯。

3. **庫存異動歷史 + 低庫存警示**——§3 顯示兩大平台都有「Reserved/Committed vs Available」的即時狀態切面,PCM 目前(依 memory,經銷價/庫存相關拍板紀錄)未見這塊;代購模式下「供應商缺貨」是高頻業務事件,沒有異動歷史等於出問題查不出「哪張單、何時、誰改的庫存」。

4. **儀表板首頁(訂單/營收/待辦彙總卡片)**——§5 顯示 Shopify Home 頁把「待處理事項」直接攤在第一眼(未請款訂單等),Medusa 反而沒有(需外掛)。PCM 後台若讓 Sean 或未來員工每天一開後台就要自己點好幾頁才知道「今天要做什麼」,是明顯的操作摩擦;這項優先度可以參考 Shopify Home 而非 Medusa。

5. **員工帳號的細顆粒度權限(role/permission)**——§4 顯示 Shopify 有完整 checkbox 矩陣式權限、Medusa 核心完全沒有(要自己拿 metadata 兜)。PCM 目前後台權限模型未知(需回頭查 pcm-website-v2 現有 admin auth 實作,本次未查),但若未來要讓非 Sean 本人的員工碰後台(例如處理訂單但不能碰經銷價),這塊要及早設計,不然後補會牽動大量既有 code。
