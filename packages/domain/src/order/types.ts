import type { Money, MemberTier, Paginated } from '../shared/types';
import type { ProductId } from '../catalog/types';
import type { CustomerId } from '../identity/types';

export type OrderId = string;

/**
 * DisplayId: 人類可讀訂單編號。🔴 **兩種格式永久並存**(Sean 2026-07-30 拍 Q1=A):
 * 新單 = 6 碼亂碼(28 字元字母表、無前綴、由 DB `pcm_generate_display_id()` 產);
 * 舊單 = `PCM-YYYY-NNNN`(2026-07-30 前建立的 30 張,不改號)。驗證見 order/display-id.ts。
 *
 * 型別為 string alias(對齊 OrderId 慣例);格式約定 / 驗證 / 組號 helper 見 `display-id.ts`。
 * 本片(M-3-S1)只定型別 + 格式約定 + 驗證 helper;**實際序號產生於後續 DB 片**
 * (orders 表序列 / create_order RPC、plan v6 §3.1)、本片不產真號。
 */
export type DisplayId = string;

/**
 * PaymentStatus: 付款狀態(domain enum、業務語意)。
 *
 * 對齊 ADR-0003 §3.2:
 * | domain | wire(Medusa) |
 * |---|---|
 * | paid | captured |
 * | unpaid | awaiting |
 * | partiallyPaid | partially_captured |
 * | refunded | refunded |
 * | partiallyRefunded | —(見下) |
 *
 * Medusa wire 字串困在 adapter 內、ports / use-case / storefront 只見 domain enum。
 * 合法轉移表見 `state-machine.ts`(Phase 1 主路徑 unpaid→paid;refunded/partiallyPaid 留型別)。
 *
 * 🔴 `partiallyRefunded`(M-3 RF2a、2026-07-25 新增,收 backlog #26):
 * 部分退款後的狀態(退了一部分、訂單仍有保留品項)。**wire 欄為 `—`**:ADR-0003 §3.2 原對照表
 * 未列此值,且 ADR-0005 已 pivot 為 custom Supabase direct、不再有 Medusa wire 對應需求
 * ——不憑記憶填 Medusa 字面。DB 對應 = `payment_status` enum 第 5 值(migration 20260725130000)。
 * 🔴 **允許自我轉移**(Sean 2026-07-25 Q1=A):同一單可多次部分退,每次都停在本狀態;
 * 這是全 5 值中**唯一**開此例外者,其餘值仍禁自我轉移(靠 `PAYMENT_TRANSITIONS` 不列自己達成)。
 */
export type PaymentStatus =
  | 'paid'
  | 'unpaid'
  | 'partiallyPaid'
  | 'refunded'
  | 'partiallyRefunded';

/**
 * FulfillmentStatus: 出貨狀態(domain enum、PCM 自家狀態機)。
 *
 * 對齊 ADR-0003 §3.2 + brainstorming Q9-10 拍板:
 * Medusa fulfillment_status 不夠用、PCM 自家 4 階段 enum 走 metadata。
 *
 * 業務含義(逐級線性、禁跳級 / 倒退、見 `state-machine.ts`):
 * - `notOrdered` 未跟廠商訂貨
 * - `ordered` 跟廠商訂貨中
 * - `inStock` 已現貨(到 PCM 倉庫或合作店家)
 * - `shipped` 已出貨給客人(或寄到合作店家)
 */
export type FulfillmentStatus = 'notOrdered' | 'ordered' | 'inStock' | 'shipped';

/**
 * ShippingMethod: 配送方式(domain enum、結帳當下凍結於 orders.shipping_method)。
 *
 * 對齊 design CheckoutPage + create_order RPC(20260604130000)p_shipping_method 白名單:
 * - `home`  宅配到府(運費依門檻、見 shipping.ts)
 * - `store` 合作店家自取(免運)
 *
 * (舊 4 種 home/cvs/store/express 已於 S2-a 作廢、Sean 拍 A 對齊 design;plan v6 §3.1。
 *  ~~超商取貨 fulfillment_method 留 Phase 2、plan v6 §3.3。~~
 *  🔴 2026-08-07 Sean 拍板 Q17=B「我不做超商取貨」⇒ **上面那句 Phase 2 之說作廢**,
 *  不要再依它規劃;同日已移除 ProductFAQ 對客顯示的「超商取貨 $60」字面。)
 */
export type ShippingMethod = 'home' | 'store';

/**
 * ProductSnapshot: 訂單品項商品快照(結帳當下凍結、逐欄白名單)。
 *
 * 🔴 鐵則 12 經銷價零滲入(plan v6 §5 紅線 4):型別層**只**允許 title / sku / spec 三欄、
 * 編譯期擋 `price_by_tier` / `price_store` / `cost` 進入 domain Order。任何「把整個 Product
 * 塞進快照」的企圖由 `createProductSnapshot()`(snapshot.ts)逐欄白名單複製於執行期攔截。
 *
 * - `title`:商品名稱(結帳當下、商品改名不影響歷史單)
 * - `sku`:商品主碼 productCode(對齊 catalog `Product.productCode`;與 `OrderItem.variantSku`
 *   變體個別料號語意分離)
 * - `spec`:變體規格 key-value 快照(例 `{ weave: '3K', finish: 'Glossy' }`);無變體商品為 `{}`
 */
export type ProductSnapshot = {
  title: string;
  sku: string;
  spec: Record<string, string>;
};

/**
 * OrderItem: 訂單品項(value-object、結帳當下凍結快照)。
 *
 * `unitPrice` / `lineTotal` 為「結帳當下」金額、與 `Product.priceByTier` 當前值無關
 * (商品改價不影響歷史訂單金額、plan v6 §5 紅線 4 歷史凍結)。
 * 建構走 `createOrderItem()` guard(order.ts):quantity 整數 ≥ 1、
 * lineTotal = unitPrice × quantity(整數)、productSnapshot 逐欄白名單。
 *
 * 🔴 型別層**無** price_by_tier / price_store / cost 欄(經銷價不滲 OrderItem)。
 */
export type OrderItem = {
  productId: ProductId;
  /** 訂購數量(整數 ≥ 1、createOrderItem guard 守) */
  quantity: number;
  /** 結帳當下單價(Money 整數、最小貨幣單位) */
  unitPrice: Money;
  /** 行小計 = unitPrice × quantity(Money 整數、createOrderItem 算 + 守) */
  lineTotal: Money;
  /** 變體個別料號快照(如 `DCC01-G-F`;無變體商品填商品主碼) */
  variantSku: string;
  /** 商品快照(逐欄白名單、禁經銷價 / cost) */
  productSnapshot: ProductSnapshot;
};

/**
 * OrderStatusFilter: admin 訂單列表雙維度篩選參數(value-object)。
 *
 * 對齊 PHASE-1-MILESTONES §7 M-4a-08(8 狀態雙維度篩選);
 * M-3 + M-4a-08 共用、抽出為共用 type。
 */
export type OrderStatusFilter = {
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
};

/**
 * Order: 訂單 entity(M-3-S1 補完整 entity + 雙軸狀態機 + 金額快照)。
 *
 * 對齊 plan v6 §5.4 快照欄 + §5 紅線(金額整數 / 歷史凍結 / 經銷價零滲入);
 * 建構走 `createOrder()` factory(order.ts):invariant `subtotal = Σ lineTotal`、
 * `total = subtotal + shippingFee − discountTotal`、全非負整數;狀態流轉走 `state-machine.ts`。
 *
 * 🔴 型別層**無** price_by_tier / price_store / cost 欄(經銷價不滲 domain Order、plan §5 紅線 4)。
 * `tierAtCheckout` 只記「結帳當下會員等級」、**不記任何 tier 價結構**(取價在 server-only 路徑、
 * 落地後 OrderItem.unitPrice 已是該 tier 的單一 effective 價)。
 *
 * 完整欄位(shippingAddress / fulfillmentMethod / createdAt / tappay_rec_trade_id / 物流單號 / 等)
 * 在後續 DB 片(orders migration、plan §3.1)補。
 */
export type Order = {
  id: OrderId;
  /** 人類可讀單號(6 碼亂碼 或 舊 `PCM-YYYY-NNNN`;display-id.ts **只驗不組** —— N2 起 TS 側無產號能力) */
  displayId: DisplayId;
  customerId: CustomerId;
  items: OrderItem[];
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** 結帳當下會員等級快照(凍結;事後改 tier 不影響歷史單) */
  tierAtCheckout: MemberTier;
  /** 商品小計 = Σ items.lineTotal(Money 整數) */
  subtotal: Money;
  /** 運費(Money 整數;calculate-shipping 後續片算、本片由 caller 帶入) */
  shippingFee: Money;
  /** 折扣總額(Money 整數;Phase 1 多為 0) */
  discountTotal: Money;
  /** 訂單總額 = subtotal + shippingFee − discountTotal(Money 整數、非負) */
  total: Money;
};

/**
 * OrderListItem: 會員訂單摘要投影(member order summary、泛用 read-model)。
 *
 * 用途:account OrdersTab 列表 / Overview「最近訂單」preview / 未來月結等只讀清單。
 * 刻意**不含** `items[]`:order_items 表無 `product_id`(backlog #217)、無法忠實重建
 * `OrderItem.productId`;列表只需摘要,故繞過 #217。
 * 🔴 ~~「明細頁未來 slice 才需完整 Order + 解 #217」~~ —— **那句話 2026-08-18 起是假的**(`#217` 裁定 D):
 * 明細頁**也**走唯讀投影,不解 `#217`。後台的 `AdminOrderDetailItem` 就是這樣做的
 * (它沒有 `productId`,而後台明細頁一直是好的)⇒ 不要照舊句去改 domain 型別。
 *
 * 🔴 鐵則 12:型別層**無** price_by_tier / price_store / cost(經銷價零滲入);`total` 為會員
 * 自己訂單的總額(RLS own-only、非經銷價)。`itemCount` = Σquantity(總數量、非 distinct 列數;
 * M-3 Sean 拍 Q4=B)、由 adapter 端彙總。`createdAt` 為 ISO 原樣(UI 端格式化、domain 不綁格式)。
 */
export type OrderListItem = {
  id: OrderId;
  /** 人類可讀單號(6 碼亂碼 或 舊 `PCM-YYYY-NNNN`,兩者並存) */
  displayId: DisplayId;
  /** 下單時間 ISO 字串(orders.created_at 原樣;UI formatOrderDate 格式化為 YYYY-MM-DD) */
  createdAt: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** 訂單總額(Money 整數、TWD;會員自己的單、非經銷價) */
  total: Money;
  /** 商品總數量 Σquantity(Q4=B、非 distinct 品項列數) */
  itemCount: number;
  /**
   * `itemCount` 可能**少算**(2026-08-16,`Q-EMBED-1` Sean 批)。
   *
   * 🔴 **與後台那個旗標的後果不同,不要當成同一件事**:
   *   後台 `AdminOrderSummary.itemsTruncated` ⇒ **整單狀態被算錯**(`.every()` 對子集單調)
   *   這裡                                    ⇒ **印一個少算的件數**
   * ⇒ **客人看到「3 件」而實際訂了 600 件,他不會知道、也不會回報**(沒有第二個來源可以對)。
   *
   * ⚠️ **`true` = 「不知道完不完整」,不是「一定被截了」** —— 剛好 N 個品項的單也會命中。
   * 🔴 顯示端**不得印 0、不得留空**;`itemCount` 那個數字本身**在旗標為真時不可信**。
   */
  itemCountTruncated: boolean;
};

// ── M-4a 訂單線:後台管理讀模型(order_source / payment_channel / admin 篩選 + 摘要)──

/**
 * OrderSource: 訂單來源(M-4a、orders.order_source;來源與金流管道拆兩軸)。
 *
 * 對齊 orders.order_source CHECK(migration 20260712203000):
 * - `web` 前台 create_order 建單(既有列預設回填)
 * - `manual_phone` / `manual_line` / `manual_other` 後台手動建單(散客單、來源電話/LINE/其他;手動建單片才寫入)
 *
 * 本片(訂單線第一片)純顯示既有 web 單、不做手動建單;此 enum 供列表「來源」次要篩選 + 顯示標籤用。
 */
export type OrderSource = 'web' | 'manual_phone' | 'manual_line' | 'manual_other';

/**
 * PaymentChannel: 金流管道(M-4a、orders.payment_channel;錢實際走哪條)。
 *
 * 對齊 orders.payment_channel CHECK(migration 20260712203000):`tappay` / `bank_transfer` / `cash` / `none`。
 *
 * 🔴 語意分界(migration COMMENT 釘死):`payment_channel` 是「管理/預期軸」、**算實收金額禁用**;
 * 對帳/實收一律走 `payment_method`(金流事實軸)+ `payment_status`。本片列表純顯示不算錢,標明防後續片誤用。
 */
export type PaymentChannel = 'tappay' | 'bank_transfer' | 'cash' | 'none';

/**
 * 訂單層**貨品軸**四值(`#484a`)。
 *
 * 🔴 **這不是 `FulfillmentStatus`,兩者長得像但不是同一件事**:
 *    · `FulfillmentStatus` = `orders.fulfillment_status` 欄位(`inStock` 是**大寫 S**)。
 *      **`#488`:該欄 2026-08-14 正式站實查 13/13 全是 `notOrdered`、從沒被推進過。**
 *    · `OrderGoodsAxis` = **由品項數量彙總算出來**的軸(`instock` 全小寫)= 列表狀態膠囊顯示的那一份;
 *      `#484a` 起也是 DB 篩選用的那一份(view `admin_order_list_v.goods_axis`)。
 * ⚠️ **字面不同是刻意的**(`inStock` vs `instock`):兩個型別若字面相同,誤用時 tsc 不會叫。
 *    **不要為了「整齊」統一它們。**
 * 🔴 **這裡是「型別」的唯一權威**(不是「所有字面」的):`apps/admin/src/lib/orders/order-status-axes.ts` 已改成
 *    `export type { OrderGoodsAxis }` 真的 re-export(`#484a` 前它自己宣告了第二份)。
 * ✅ **A2 已收:`orders-table.test.tsx` 原本三處手寫四值,現已改吃 `ORDER_GOODS_AXIS_VALUES`**
 *    ⇒ 本檔常數少一個值,那三格會當場紅(實測:改常數 → 八值斷言紅)。
 * 🔴 **SQL 那一份仍然綁不住,而且 A2 沒有做到** —— migration `admin_order_list_v` 的 CASE 是另一份字面,
 *    TS 型別管不到它。**A1 當時說「守門要等 A2」,A2 評估後改判:那道守門要連線才驗得到、進不了 CI**
 *    ⇒ **不是做了,是改判成缺口並立案:`#499`**(裡面列了三條候選修法)。
 *    ⇒ 仍然**不要宣稱「三處同源」**,只能說 TS 兩處同源 + SQL 那份是人工比對過的(2026-08-14)。
 * ⚠️ **片 A1 當下這個型別還沒有消費端** —— 它先落地是為了讓 migration 的 `goods_axis` 四值
 *    在 TS 這一側有一個唯一權威。接上篩選軸(`AdminOrderFilter.goodsAxes`)是**片 A2**,
 *    那一片才會同時改 `buildOrderListHref` 的窮舉守門(A1 加欄位會讓它紅 —— 實測 TS2741,
 *    那道守門是刻意的,不要為了讓型別早點落地去繞過它)。
 */
/** 窮舉用(白名單守門 / `Record` 完整性)。順序 = 流程順序,**不是**判序。 */
export const ORDER_GOODS_AXIS_VALUES = ['none', 'ordered', 'instock', 'shipped'] as const;

/**
 * 🔴 **由上面那個常數推導,不另寫一份 union**(codex 關卡2 R2:union 與常數是兩份獨立字面、
 *    改一份不會讓另一份紅)。現在改常數,型別跟著動。
 */
export type OrderGoodsAxis = (typeof ORDER_GOODS_AXIS_VALUES)[number];

/**
 * AdminOrderFilter: 後台訂單列表雙軸 + 次要篩選(value-object;全欄可選、缺 = 不限)。
 *
 * 主雙軸 = `paymentStatus` × `goodsAxes`(營運最常查「已付未出」)。
 * ⚠️ **`#484a` A2 起第二軸不再是 `fulfillmentStatus`** —— 那個欄位已從本型別移除(見下方退場註記),
 *    寫在這裡是因為上一版 docstring 指著它,而讀的人會去找一個不存在的欄位。
 * 次要 = `orderSource` / `paymentChannel`。全部走 DB where 下推(server 端篩選、非前端過濾)。
 * (對比會員側 `OrderStatusFilter` 只有雙軸;admin 多來源/管道兩軸、故另立型別、不擴會員側。)
 */
export type AdminOrderFilter = {
  paymentStatus?: PaymentStatus;
  /**
   * 貨品軸多勾選(`#484a` 片 A2;undefined/空陣列=不限、多值=OR〔IN〕)。
   *
   * 🔴 **這一軸取代了 `fulfillmentStatus`,而那不是重構、是修一個正在騙人的篩選器**:
   *    `orders.fulfillment_status` 這一欄在正式站**13/13 全是 `notOrdered`、從來沒有被推進過**
   *    (`#488`)⇒ 員工選「已到貨」得到的零筆**不是「沒有這種單」,是那一欄沒人寫**。
   *    現在改篩 `admin_order_list_v.goods_axis` —— 由品項層的數量摘要在 SQL 內即時彙總,
   *    與畫面上狀態膠囊(`orderGoodsAxis()`)**同一套判序**。
   * 🔴 **值不是 `FulfillmentStatus`**:四值是 `none/ordered/instock/shipped`
   *    (對照舊軸 `notOrdered/ordered/inStock/shipped` —— 第一與第三個字面**不同**,
   *    照抄舊 URL 參數值會全部篩不到)。
   * ⚠️ 現行 producer(單選下拉)只會給 0 或 1 個值;複選是片 B 的 chip UI。
   *    型別先做成陣列是照 plan 的字面(`docs/specs/2026-08-14-484a-order-goods-axis-view-plan.md:59`
   *    的檔案表逐字「多值,與既有 `orderSources` 同形」;§7b 只說它**不在 A1**、沒說形狀),不是預留抽象。
   */
  goodsAxes?: readonly OrderGoodsAxis[];
  /**
   * `#1` 片1:**待收款/待訂貨** ——「還沒收錢 **或** 還沒跟供應商訂貨,只要有一件事沒做完就算」。
   * ⚠️ 這顆 chip 的**顯示字面** 2026-08-15 由「待處理」改為「待收款/待訂貨」(`#485` 片6,Sean 拍板);
   *    **本欄位名 `pendingOnly` 與 URL 參數 `pending=1` 一個字都沒動** —— 改的只有給人看的那一層。
   *
   * 🔴 **為什麼是一個獨立的布林,而不是「同時給 `paymentStatus` 和 `goodsAxes`」**:
   *    本值物件其餘每一欄疊上去都是 **AND**(adapter 逐條 `if` 疊 `.eq`/`.in`)
   *    ⇒ 同時給兩軸做出來的是**交集**,而**交集的畫面看起來完全正常,只是筆數少很多**。
   *    ⇒ 這是本值物件裡**第一個 OR 語意的欄**,故意跟其他軸長得不一樣。
   *
   * 🔴 **值域是拍板的,不是我挑的**(出處 commit `4ffda20b` / `a01457be`,兩顆都在 `origin/dev` 上、可達):
   *    **還沒收錢 = `unpaid` ∪ `partiallyPaid`**;**還沒訂貨 = `goods_axis = 'none'`**。
   *    **不含 `refunded` / `partiallyRefunded`** —— 那會讓已退款單跑進待處理,
   *    正是 `#494` 剛修掉的病。
   *    ⚠️ **實作時最容易發生的錯是「順手抄 `orderPayAxis()` 的收斂規則」** ——
   *    那支把 `refunded` 也判成 `unpaid`(`order-status-axes.ts:140-142` 自陳)
   *    ⇒ **那等於偷偷把拍板做成被否決的那個選項。**
   *    守門:`SupabaseOrderAdapter.test.ts` 有一格**負向**釘死已退款單不得被撈進來。
   *
   * `undefined` / `false` = 不限。
   */
  pendingOnly?: boolean;
  /** 來源多勾選(D-1b;undefined/空陣列=不限、多值=OR〔IN〕)。 */
  orderSources?: readonly OrderSource[];
  /** 管道多勾選(D-1b;同上)。 */
  paymentChannels?: readonly PaymentChannel[];
  // `#484a` 片 A2:`fulfillmentStatus` **已移除**(不是忘了列)—— 篩選改走上面的 `goodsAxes`。
  // 留著會讓「把某個舊 filter 物件塞回去」看起來仍然有效,而它篩的是那一欄從沒被寫過的值
  // ⇒ 症狀是**零筆**,而零筆與「真的沒有這種單」長得一模一樣(同下面兩條退場的理由)。
  // ⚠️ `orders.fulfillment_status` **欄位本身沒有動**:列表投影仍撈它、明細頁仍顯示它
  // (`order-detail.tsx` 的「出貨狀態」欄),本片只是**不再靠它篩**。要不要一起修/退場 = `#488`。
  // M-4b E10 A9w3(九碼契約收縮):`workflowStatuses` 已移除 —— 篩選 UI 與 URL 參數在 A9w2 下架
  // (零 producer),adapter 的 `order_items!inner` 下推同片一併移除(零 consumer)。
  // 型別留著會讓「把某個舊 filter 物件塞回去」看起來仍然有效,而實際上不會篩到任何東西。
  // #347-B(Sean 拍板 Q-347-B1=B):`orderNumber` 與 `supplierOrderNo` 兩個**專用搜尋軸已移除**
  // —— 兩者的能力併入下面的 `keyword`(`admin_search_orders` 的 #1 訂單編號 / #12 舊訂單編號 / #11 供應商單號分支)。
  // 型別留著會讓「把某個舊 filter 物件塞回去」看起來仍然有效,而實際上不會篩到任何東西
  // (與上面 `workflowStatuses` 退場時的同一條理由)。
  /**
   * 是否**連刷卡未付款的單一起顯示**(M-4b 生命週期 L6;Sean 2026-08-09 逐字
   * 「我覺得刷卡單失敗直接不顯示在後台就好」,經主視窗 P-233-A 轉達)。
   *
   * - `undefined` / `false`(**預設**)= 隱藏 `payment_channel='tappay' AND payment_status='unpaid'`;
   * - `true` = 全部顯示(篩選列上的切換,員工要查得到時打得開)。
   *
   * 🔴 **這是顯示層,不是資料層**:被隱藏的單一個都沒有被改動或刪除,轉成 paid 會自動再出現;
   *    與件①(1 天寫 `cancelled_at`)是**兩件獨立的事**,不要互相推論。
   * 🔴 **原本的兩個豁免已退場(#347-B;Sean 拍板 Q-347-B1=B)**:舊合約是「單號搜尋 /
   *    供應商單號搜尋啟用時隱藏規則一律不套用」(D-385-A「豁免綁精準鍵」),而它的實作
   *    掛在那兩個專用搜尋軸上、隨它們一起消失。**現在本欄是唯一的開關**,沒有任何隱含豁免。
   *    「精準查一張單卻查不到比看到它更困惑」這個顧慮由**查無時的提示**承接
   *    (`apps/admin/src/app/orders/page.tsx` 的 `UNPAID_CARD_HIDDEN_HINT`),不是由豁免承接。
   * 🔴 **邊界寫死(P-233-A ④)**:規則只認 `payment_channel='tappay'`。
   *    未來開匯款(後台第 15 項)時,`bank_transfer` 的未付款單**不在**隱藏規則內 ——
   *    那種單「未付款」是正常待辦、不是失敗,藏起來會讓員工漏掉要對帳的匯款。
   */
  includeUnpaidCardOrders?: boolean;
  /**
   * 八維度「關鍵字」搜尋(M-4b #347-2a;Sean 拍板 #347「八維度一框」)。
   *
   * 命中面 = 訂單編號 / 會員姓名 / 會員電話 / 收件快照 name-phone-line / 料號 / 品名 / 品牌 /
   * 供應商單號,由 `public.admin_search_orders` 在 **SQL 內**比對
   * (現行簽章 = 四參數版,`supabase/migrations/20260810120000_…`,已 apply 正式站;
   *  ⚠️ #347-3c-3 更正:原本這裡寫 `(text, integer)` 與 `20260809180000`,而那個簽章已被 3a `DROP`)。
   *
   * - `undefined` / 空字串 = 不篩;
   * - 值由 `normalizeOrderKeywordSearch` 正規化後才可進 adapter;
   * - 🔴 **不合法時 adapter 回零筆、不得退化成不篩選**(同上面兩欄的理由:fail-open 是本族的病)。
   *
   * 🔴🔴 **為什麼它是 RPC 而不是多幾個 filter 欄**:命中面裡有 `shipping_address_snapshot`,
   * 而那一欄**就在鐵則 12 的 forbidden 清單裡**(`SupabaseOrderAdapter.test.ts` 的 forbidden 陣列)。
   * 走 RPC 之後 **PII 只在 SQL 內被比對,一個字都不進讀模型、不進 RSC payload** —— 函式只吐 `orders.id`。
   * ⇒ 任何「把這些欄加進列表投影去前端過濾」的修法都是**親手拆掉那道守門**,不要走。
   *
   * 🔴 **與另外兩欄最大的差異:本欄沒有字元集限制**。那兩欄擋字元是因為值會被內插進
   * PostgREST 的 GET query string;本欄走 `.rpc()` = POST + JSON body ⇒ 中文、`%`、`,` 全合法
   * (完整理由在 `keyword-search.ts` 檔頭;照抄那兩欄的守門會把功能廢掉一半)。
   *
   * 🔴 **上限 100 筆、超過只回前 100 並回報截斷**:見 {@link AdminOrderListResult.keywordTruncated}。
   */
  keyword?: string;
  /**
   * 建立日期範圍(M-4b #347-3b;Sean Q14=A「搜尋加日期範圍」)。**絕對時刻的 ISO 字串**,
   * 半開區間 `[createdFrom, createdTo)` —— `createdFrom` 含、`createdTo` **不含**。
   *
   * 🔴 **值必須由 `taipeiDayStartIso` / `taipeiDayEndExclusiveIso` 算出來**,不要自己拼:
   *    列表日期欄是**固定 Asia/Taipei 曆面**,而 `new Date('2026-08-10')` 是 UTC 午夜、差 8 小時
   *    ⇒ 畫面顯示 `08/10` 的單會被 UTC 起點的篩選排除,員工選了那天卻看不到它。
   *    逐條理由與「為什麼 `to` 是下一個午夜而不是 23:59:59」在 `date-range.ts` 檔頭。
   * 🔴 **兩處都要下推**:①列表查詢的 `created_at` ②關鍵字 RPC 的 `p_from`/`p_to`。
   *    只推列表的話,RPC 仍然是「**全歷史**最新 100 筆命中」再與日期取交集
   *    ⇒ 要找的單可能整張落在那 100 筆之外、畫面顯示 0 筆(#347-1 的取樣順序,plan §1 逐字)。
   * 🔴 `from > to` ⇒ 回零筆、**不擲錯**(員工打得出這種輸入;RPC 側同語意)。
   * ⚠️ **本欄沒有 server 端預設**:UI 沒送就是不限期間(#347-3b 刻意只鋪管線)。
   *    「未選預設近半年」是 **3c 下拉選單的預設值**(看得見的選單狀態),不是隱形過濾
   *    —— 主視窗 2026-08-10 核:那樣才符合 Q14=A 的原意。
   */
  createdFrom?: string;
  createdTo?: string;
};

/**
 * AdminOrderListResult: `listOrderSummariesForAdmin` 的回傳(M-4b #347-2a)。
 *
 * = `Paginated<AdminOrderSummary>` **加上關鍵字搜尋的兩個訊號**。
 *
 * 🔴 **為什麼不直接加寬 `Paginated<T>`**:那會為了一個少數分支去加寬**所有**消費端都看得到的共用型別
 * (這條判準原本記在 `supplier-order-no-search.ts`,該檔已隨 #347-B 刪除)。這裡加寬的是**這一支方法的回傳**,
 * 會員側 / 客戶列表的 `Paginated` 一個字不動。
 */
export type AdminOrderListResult = Paginated<AdminOrderSummary> & {
  /**
   * 🔴 **精確語意:「關鍵字_自己_命中的訂單超過上限,RPC 只回了最新的 100 筆」** ——
   * **不是**「畫面上這個結果集被截斷」。兩者不同,因為 RPC 先取全域前 100,
   * 才在第二段與其他篩選條件取交集:
   *
   * - `false` ⇒ 關鍵字命中集合**完整** ⇒ 交集與 `total` 精確,無歧義。
   * - `true`  ⇒ **第 101 筆之後的命中看不到**。此時若同時套了其他篩選,真正符合的單可能
   *   **整張落在那 100 筆之外** ⇒ 畫面可能顯示 0 筆,而 `total` 只代表
   *   「前 100 筆再套其他篩選後的數量」,不是完整命中數。
   *
   * 🔴 **所以 UI 必須在 `true` 時_一律_顯示「結果太多,請輸入更精確的關鍵字」,包含 0 筆的情況** ——
   * 0 筆 + 沒有提示 = 員工得到「查無此單」的錯誤結論,那正是 migration `:130-136` 合約要禁的形狀。
   * ⚠️ 型別上的必填只約束**產出者**;真正防靜默截斷的守門是 2b 的畫面測試(plan §1-2)。
   *
   * 🔴 **不能靠把其他篩選下推進 RPC 解決** —— 那要動 RPC 簽章,而 Sean Q14=A 已拍板
   * 日期等參數隨 **347-3**。本片的正確作法是把語意寫死、讓提示無條件出現。
   */
  keywordTruncated: boolean;
  /**
   * 關鍵字命中的訂單筆數(RPC 回的 `ids` 長度)。
   * **`null` = 從來沒打過 RPC**(沒給關鍵字、或搜尋詞不合法在正規化階段就被擋下);
   * **`0` = 打過了、DB 回零筆**。兩者**不可互換** —— 那正是這個欄位存在的理由。
   *
   * 🔴 **存在的唯一理由是「災難當天查得出來」**:三個月後員工說「搜料號 X 查無此單」時,
   * 下面三種成因在畫面上**完全同形**(都是 0 筆):
   * ① RPC 零命中 ② 有命中但被 L6 / 付款狀態等其他篩選軸砍光。
   * ⚠️ codex R2 nit:原本這裡還列了「與供應商單號的 ids 交集砍光」當成因之一 ——
   *    **那條交集鏈已隨 #347-B 退場**(供應商維度收掉);片 B-2 接回來時要同批加回這張清單。
   * 而**搜尋詞禁止落 log**(migration `:50-74`,那是 PII)⇒ 唯一合法的觀測物就是**非 PII 的計數**。
   * `ids.length` 在 adapter 手上,不帶出來就等於自願把診斷能力丟掉。
   * ⇒ 2b 可以據此對員工說人話(「找到 3 筆,但都被目前的篩選條件排除了」),
   * **而一個字的搜尋詞都不必記錄**。
   */
  keywordMatchCount: number | null;
  /**
   * 供應商單號搜尋**命中了哪幾家供應商**(#338;已去重、順序不保證)。
   *
   * 🔴🔴 **本片起恆 `null`,producer 待片 B-2**(#347-B;Sean 拍板 Q-347-B1=B + Q-347-B2=C)。
   *    唯一的 producer 是 adapter 的供應商單號兩段式探測,它隨兩個專用搜尋欄一起退場;
   *    Q-347-B2=C 已拍板「供應商那兩項能力在**片 B-2** 重建」⇒ 本欄**不是死碼、是待接的契約**,
   *    刻意保留以免片 B-2 又要把它從 port 契約加回來。
   *    ⚠️ 在片 B-2 接回 producer 之前,**任何依賴本欄有值的邏輯都是恆假分支** ——
   *      消費端請走「值自己的形狀」判斷(見 `describeSupplierMatch`:`null` ⇒ `none` ⇒ 整塊不渲染),
   *      不要改寫成「因為現在恆 null 所以可以刪掉那個分支」。
   *
   * **`null` = 這次沒有真的去查供應商**;`[]` = **查過了、但一家都認不出來**。兩者**不可互換**。
   * 🔴 片 B-2 接回 producer 之後,`null` 會有多個成因(沒給單號 / 給了但不合法 / 給了合法值但
   *    關鍵字先零命中而提早回傳)⇒ **屆時不可照契約推導「null = 沒搜單號」**。
   *
   * 🔴 **存在的理由是「員工手上只有一張單號」**:`supplier_order_no` 在 DB 層沒有跨供應商唯一性
   * (A2 `20260729020000:70` 的業務鍵是 `(order_item_id, supplier_canonical_key)`)⇒ 兩家用同一組
   * 單號時結果會一起列出。而員工**正是因為不知道是哪一家才來搜**,叫他「點進訂單核對」
   * 等於把唯一能回答問題的那筆資料藏起來。⇒ 一家就具名、多家就示警並列名。
   *
   * 🔴 `label` 可為 `null`(內嵌沒回來 / 投影退版)⇒ **UI 不得假裝知道**,要退回
   * 「此搜尋不區分供應商」那句警語。與 `procurement-suppliers.ts` 對同一情況的處置同向。
   */
  supplierOrderNoMatchedSuppliers: { id: string; label: string | null }[] | null;
};

/**
 * AdminOrderLine: 後台訂單列表「每商品一列」品項投影(M-4a Slice D-1a;order_items 內嵌展開)。
 *
 * 🔴 鐵則 12:`unitPrice`/`lineTotal` = 該單**成交價**(下單當下實際賣價、integer 元位 → Money),
 * 非經銷價表 —— brand join 只取 `brands.name`,穿越的 product_variants/products 價格欄(price_store /
 * price_by_tier)絕不投影(見 `ADMIN_ORDER_LIST_SELECT` byte-lock + forbidden-token 測試縱深)。
 * `brand`:order_items.variant_id → product_variants → products → brands.name;variant_id 為 null
 * (supplier_slug+sku 型 line)或 join 缺 → null(顯示端「—」)。
 */
export type AdminOrderLine = {
  /** 品項 id(order_items.id;D-2 起 per-item 改狀態表單的 target) */
  id: string;
  /** 料號(order_items.variant_sku) */
  variantSku: string;
  /** 品名(product_snapshot.title;缺 → null 防禦) */
  title: string | null;
  /** 商品品牌(join brands.name;缺 → null) */
  brand: string | null;
  quantity: number;
  /** 成交單價(整數元位;非經銷價表) */
  unitPrice: Money;
  /** 小計 line_total(下單當下 server 算、不重算) */
  lineTotal: Money;
  /**
   * per-item 訂單處理狀態(M-4a D-2、order_items.workflow_status;soft-ref order_status_options.code)。
   * NULL=未設定。item 層=唯一操作真相(Sean 2026-07-15 拍板 Q-A=A)。
   * 🔴 ~~整單狀態=顯示端彙總~~ **A11a-1(2026-08-06)起該彙總已移除**(同 `:331`/`:710` 註記);
   *    P3 九碼退場後**本欄零 production 讀寫端**、僅存歷史值,欄位凍結不 DROP(撤權見 A9v)。
   * 🔴 純操作/顯示軸:金流真相恆為 order 的 paymentStatus,本欄絕不進金流/對帳/退款判斷。
   */
  workflowStatus: string | null;
  /** 樂觀鎖版本(M-4a D-2;per-item 改狀態表單 hidden 帶此值當 WHERE version 條件)。 */
  version: number;
  /**
   * 該品項「給哪台車用」快照(M-4a V-3b、order_items.vehicle_snapshot;client 下單凍結、admin 列表直出)。
   * NULL=下單未帶車款。🔴 純顯示 metadata、無價/tier 面;mapper 防禦解析壞形狀 → null。
   */
  vehicle: OrderItemVehicleSnapshot | null;
  /**
   * 品項三軸數量摘要(M-4b E10 **A9c**;列表投影 nested left embed `order_item_quantity_summary`)。
   *
   * 🔴 **非 nullable、缺列已由 mapper 正規化成三個 0** —— 母 plan 計數器摘要列 `:335` 逐字
   * 「由 mapper 在 TS 層正規化成三個 0」+「**A11a-c 只接非 nullable 型別**(正規化在 A9c 的 mapper
   * 完成,UI 片**不做 join、不做 COALESCE**)」⇒ **UI 端不得寫 `?? 0`**(A11a plan V9 的突變靶)。
   *
   * 🔴🔴 **與明細側 `AdminOrderDetailItem.quantitySummary`(`| null`)刻意不同型,不是筆誤**:
   * 依該欄 docstring 的分用途裁定 —— **純顯示**(本欄:列表只看數字)補 0 可接受;
   * **守門 / 上限 / 可否取消的判斷**(明細側)絕不可補 0、必須 fail-closed。
   * ⇒ **本欄不得餵給任何取消或上限判斷**(列表取消入口 = A13,那片要走明細那支、不吃本欄)。
   * 代價講明白:補 0 之後「資料損壞」與「真的 0」在列表上**長得一樣**。
   */
  quantitySummary: AdminOrderItemQuantitySummary;
};

/**
 * OrderItemVehicleSnapshot: order_items.vehicle_snapshot 讀模型(M-4a V-3b;admin 列表車款欄直出)。
 * 形狀鏡像 PlaceOrderVehicle(create_order 白名單寫入);read 端 `source` 放寬為 string(相容凍結快照/
 * 舊資料多來源);缺/壞形狀 → null(mapper parseVehicleSnapshot 防禦解析、不炸頁)。
 */
export type OrderItemVehicleSnapshot =
  | { kind: 'dict'; brand: string; model: string; year?: number; source: string }
  | { kind: 'free'; raw: string; year?: number; source: string };

/**
 * AdminOrderSummary: 後台訂單列表摘要投影(admin read-model、server 分頁)。
 *
 * 用途:後台 /orders 列表(找單 / 看狀態)。M-4a Slice D-1a 起攜 `lines[]`(每商品一列展開、brand join)+ tierAtCheckout;
 * 比 `OrderListItem` 多攜:客人顯示名(join customers)、order_source、payment_channel、display_position、
 * cancelled_at(取消軸,非 null = 已取消,本片純顯示、取消功能留取消片)。
 *
 * 🔴 鐵則 12:型別層**無** price_by_tier / price_store / cost(orders 表本身無成本欄、天生守;投影仍具名白名單)。
 * `total` 為該單總額(整數元位 → Money);`customerName` 可為 null(防禦:FK ON DELETE RESTRICT 保證客人存在,
 * 但 join 邊界仍容 null)。`createdAt` / `cancelledAt` ISO 原樣(UI 端格式化)。
 */
export type AdminOrderSummary = {
  id: OrderId;
  /** 人類可讀單號(6 碼亂碼 或 舊 `PCM-YYYY-NNNN`,兩者並存) */
  displayId: DisplayId;
  /**
   * 下單時間 ISO(orders.created_at 原樣)。UI 走 `formatOrderListDate`(同年 `07/25` / 跨年 `2025/06/27`)——
   * 🔴 原註寫的 `formatOrderDate` 是 admin 那支,A11a-2 接走呼叫端、**A9c 已刪除**(storefront 的同名
   * 函式是另一份、不受影響;本型別是 admin 讀模型,別再指到它)。
   */
  createdAt: string;
  /**
   * 客人 id(`orders.customer_user_id` 原樣)。**2b-0 為了出貨動線的「同一箱只能裝同一位客人」閘而加。**
   *
   * 🔴 **不能用 `customerName` 代替**:①姓名不唯一(同名的兩個人會被判成同一位客人 ⇒ 讓員工把兩個人的
   * 東西裝進同一箱、再被 DB `pcm_b2_w3b2_item_not_customers` 退件)②`customerName` 可為 null,
   * 而 `null === null` 為真 ⇒ 兩張無名單被判成同一人,**這個 bug 零症狀**直到有人按下去。
   * 另:`admin_create_shipment` 的 `p_customer_user_id` 本來就要它。
   *
   * 🔴 非成本欄、不新增 join ——`orders` 自己的欄位;`ADMIN_ORDER_LIST_SELECT` 的 forbidden 清單
   * (price_store / price_by_tier / price_general / cost / address_id …)逐字比對零碰撞。
   *
   * ⚠️🔴 **已知缺陷,待修(2026-08-13 R2 抓,OD 片 2 未修、已請主視窗立案)**:
   *    這裡宣告非 nullable、mapper `mappers/order.ts:352` 直送,但 DB 的 `uuid NOT NULL`
   *    保證的是「**列裡**有值」、不是「**wire row 裡**有這個鍵」——**投影退版時整個鍵會消失**,
   *    此時本欄實際值是 `undefined`,而型別說它是 `string`。
   *    ⇒ 上面 `:452-456` 自己警告的那個 bug 會**真的發生**:同客人閘
   *    (`apps/admin/src/components/shipping/shipping-selection.tsx`)比對兩個 `undefined`
   *    得到相等 ⇒ **兩位不同客人的訂單裝進同一箱**,而且如該段所寫「零症狀直到有人按下去」。
   *    對照修法見 `AdminOrderDetail.customerUserId`(本檔下方,已收斂成 `string | null`)。
   *    本片不修的理由:非本片造成,動它會碰出貨閘的活路徑、超出 OD 片 2 的片界。**backlog #457**。
   */
  customerUserId: string;
  /** 客人顯示名(join customers.name;缺 → null) */
  customerName: string | null;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  orderSource: OrderSource;
  paymentChannel: PaymentChannel;
  /** 訂單總額(Money 整數、TWD) */
  total: Money;
  /** 後台工作排序鍵(NULL = 未手動排過);本片顯示排序值、拖曳排序留訂單線-03 */
  displayPosition: number | null;
  /** 取消時間 ISO(非 null = 已取消;本片純顯示,取消功能留取消片) */
  cancelledAt: string | null;
  // (M-4a D-2 起本讀模型**不再攜** orders.workflow_status / orders.version:per-item 真相移至
  //  lines[].workflowStatus/version;~~整單狀態=顯示端由 lines 彙總~~(**A11a-1 已移除該彙總**);
  //  列表 order 層 inline 改單退場 → 不需 orders.version。明細頁改 shipping/invoice 仍用
  //  AdminOrderDetail.version。)
  /**
   * 會員等級(orders.tier_at_checkout、下單當下等級快照)。general=一般、store/premiumStore=車行。
   * 🔴 鐵則 12:tier + 品項成交價同列 = 經銷價脈絡,僅 admin server-render(SSO 閘後)消費、
   * 絕不進非 admin client bundle(本讀模型只由 server component 用)。
   */
  tierAtCheckout: MemberTier;
  /**
   * 開票紀錄狀態(M-4b E10 **A9c**;`orders.invoice_status`,DB CHECK 三值 + NOT NULL DEFAULT
   * `'not_issued'`,migration `20260714120000_m4a_order_workflow_status.sql:108,117`)。
   *
   * 🔴 **列表只帶這一欄、不帶載具別**(Sean 2026-08-06 Q2b=A):母 plan §5.1a「新增 | 發票」那列
   * 原字面是「列表只顯示**載具別**與開立與否」,Q2b=A **砍掉載具別**、只留三態(該列字面已同批更正)。
   * 理由=載具別在 `orders.invoice` jsonb(`carrier`/`type`),把它拉進列表會破壞
   * 「列表投影零 PII、兩白名單刻意分立」那條邊界;而 `invoice_status` 是 enum、非 PII。
   *
   * 🔴 三態是 `not_issued` / `issued` / `voided`,**沒有「不需開立」** —— 「客人沒填開票需求」與
   * 「有需求但還沒開」在本欄都是 `not_issued`,要分只能推論 `invoice` jsonb 是否為空(推論、非欄位)。
   * Q2b=A 明文不分。
   */
  invoiceStatus: InvoiceStatus;
  /** 該單品項展開(M-4a Slice D-1a「每商品一列」、同單分組顯示;空陣列顯示端兜一列「—」)。 */
  lines: AdminOrderLine[];
  /**
   * `lines` 觸及內嵌上限 ⇒ **可能不完整**(2026-08-16,`Q-EMBED-1` Sean 批)。
   *
   * 🔴🔴 **它守的不是「少幾列」,是【整單狀態被算錯】。**
   * `orderStatusView` → `orderGoodsAxis` → `goodsAxisOfLines(lines)` 三條判定都是 `.every(...)`,
   * 而 `.every()` 對子集**單調**(全集為真 ⇒ 子集必真,反之不然)
   * ⇒ **子集算出來的階段恆 ≥ 真實階段** ⇒ **看得見的全出貨了就答「出貨完成」。**
   * ⇒ 員工看到「出貨完成」**就不會再動作**,而那張單其實還有貨沒出。
   *
   * 🔴 **為什麼需要一個【我方自己算】的旗標,而不是讀伺服器的訊號**:
   * PostgREST 的 `db-max-rows` **會**套用到內嵌陣列,而**內嵌被截斷時它不給任何訊號**
   * —— 仍回 HTTP 200、`Content-Range` 不反映(`docs/specs/2026-08-16-postgrest-max-rows-embed-finding.md`;
   * ⚠️ 該檔明載出處是官方 repo issue **作者的敘述**、非 maintainer 聲明 ⇒ 當高可信不當定案)。
   * ⇒ **不自己算的話,這件事偵測不到。**
   *
   * ⚠️ **`true` 的意思是「不知道完不完整」,不是「一定被截了」** —— 判法是
   * 「要 N 筆、拿回剛好 N 筆」,而一張**剛好 N 個品項**的單也會命中。
   * **顯示端一律照「不知道」處理**(`Q-EMBED-2` = 甲:整格印「未知」+ 一行說明)。
   * 🔴 **不得顯示成 0、不得留空** —— 那兩者都會被讀成「就是沒有」,而這裡的語意是「我們不知道」。
   */
  itemsTruncated: boolean;
};

/** 開票紀錄狀態(orders.invoice_status;DB CHECK 三值,v1 簡單欄位、不串電子發票 API)。 */
export type InvoiceStatus = 'not_issued' | 'issued' | 'voided';

/**
 * AdminOrderWorkflowPatch: 後台改單 patch(M-4a Slice C;admin_update_order_workflow RPC 入參)。
 *
 * 🔴「未提供 ≠ 清空」語意(對齊 RPC jsonb key 存在性):
 * - 欄位**省略(undefined)** = 不動該欄;
 * - `invoiceNumber`/`invoiceAmount` 明給 `null` = 清空;
 * - `shippingMethod`/`invoiceStatus` 不可為 null(DB NOT NULL)。
 * 🔴 型別層**無** payment/fulfillment/金額 total 欄(金流紅線:改單絕不碰金流真相軸)。
 * 🔴 D-2 起型別層**亦無 workflowStatus**(orders.workflow_status 停寫=雙層強制:TS 層關死
 * 〔Codex R1 must-fix 1〕+ DB 層 RPC 白名單收窄、送到即 RAISE〔Fable 關卡1 REQUIRED-2、
 * 20260716130000 §4〕;~~狀態唯一寫入面=item 層 updateAdminOrderItemWorkflow~~ —— 🔴 **A9w4c 後半
 * (2026-08-06)已把該 port/adapter 方法移除,admin 應用層與 adapter 皆無 workflow_status 寫入面**;
 * DB 端 RPC 與 EXECUTE 權仍在、撤權歸 A9v)。
 */
export type AdminOrderWorkflowPatch = {
  shippingMethod?: string;
  invoiceNumber?: string | null;
  invoiceAmount?: number | null;
  invoiceStatus?: InvoiceStatus;
};

/** 後台改單結果碼(RPC 回傳;UI 分流:成功 / 版本衝突重載 / 無變更)。 */
export type AdminOrderWorkflowResult = 'UPDATED' | 'CONFLICT' | 'NOOP';

/**
 * AdminOrderItemAmountPatch: 後台改品項金額 patch(M-4b E10 #13 片1b;
 * `admin_update_order_item_amount` RPC 入參)。
 *
 * 🔴 與 {@link AdminOrderWorkflowPatch} 的語意**不同**:那支是「未提供 ≠ 清空」的多欄 patch,
 * 本型別**三個欄全部必填**——它描述的是一次「把某一品項的單價改成 X」的完整意圖,
 * 沒有「這欄不動」這種狀態。省略任何一欄都不是合法的改價。
 *
 * - `unitPrice`:**整數元位、非負**。不做任何浮點運算(RPC 端 `:362` 再驗一次非負整數,
 *   `:423` 驗 line_total 不溢位 integer)。
 * - 🔴 `zeroPriceReason` 是**必填鍵、型別 `string | null`,不是 optional**:
 *   RPC 兩道互斥閘 —— `:366` 單價 = 0 而原因為 NULL/空白 ⇒ RAISE;
 *   `:371` 單價 > 0 而原因非 NULL ⇒ RAISE。
 *   ⇒ 兩種情形都必須**明確表態**,「忘了帶」必須是編譯錯誤而不是靜默送 undefined。
 *   (同 `admin_search_orders` 的 p_from/p_to 先例:一律帶鍵、沒有值就送顯式 null、不用 spread。)
 */
export type AdminOrderItemAmountPatch = {
  orderItemId: string;
  unitPrice: number;
  zeroPriceReason: string | null;
};

/**
 * 後台改品項金額結果碼(RPC 回傳)。
 *
 * 🔴 **是 `'OK'` 不是 `'UPDATED'`** —— 與 {@link AdminOrderWorkflowResult} 刻意不同字面,
 * 照 RPC 本體 `20260815040000_…:482` / `:383` / `:416` 逐字。抄錯字面會讓成功被判成非預期碼。
 * UI 分流(逐字對 RPC 的三條 `RETURN`,不是從語意推的):
 * - `OK` = 寫入成功(`:482`)
 * - `CONFLICT` = **只有一種情形:`v_ord.version <> p_expected_version`**(`:382-383`)⇒ UI 重載
 * - `NOOP` = 新單價與現值相同(`:414-416`);不 bump version、不寫稽核
 *
 * 🔴 **`CONFLICT` 不包含「訂單查無」** —— 查無走 `:379-381` `RAISE EXCEPTION`,
 * 到 adapter 是 `throw`、不是回傳碼。(2026-08-15 codex 關卡2 R1 must-fix:
 * 原本這裡寫「版本不符**或訂單查無**」,而那是我從語意推的、不是從 RPC 讀的。
 * consumer 若照那句把查無當成可重載的版本衝突,錯誤分流會與實際行為不一致。)
 */
export type AdminOrderItemAmountResult = 'OK' | 'CONFLICT' | 'NOOP';

/**
 * 供應商回覆狀態(M-4b E10 A9a-2;`order_item_procurement_reply_status_check`
 * `supabase/migrations/20260729020000_m4b_e10_a2_order_item_procurement.sql:86-87` 五值)。
 * no_reply 未回 / confirmed 已確認 / price_changed 改價 / out_of_stock 缺貨 / partial 部分出貨。
 */
export type AdminProcurementReplyStatus =
  | 'no_reply'
  | 'confirmed'
  | 'price_changed'
  | 'out_of_stock'
  | 'partial';

/**
 * AdminOrderItemProcurement: 單一品項的**一筆採購**(M-4b E10 A9a-2;`order_item_procurement` 讀投影)。
 * 一個品項可以有多筆 = 拆給多家供應商(建表檔 `:13` 的 1:N 理由)。
 *
 * 🔴 **內部資料,絕不對客**:供應商身分、單號、異常原因一個 byte 都不能走上客人看得到的投影
 * (建表檔 `:16-18`;`orders`/`order_items` 對登入客人整表開放 SELECT)。本型別只走 admin service_role 路徑。
 * 🔴 **全欄都在,是刻意的**:A5a 在 `p_preserve_optional_fields = false`(明細頁單列表單走的分支)
 * 下是**全量 payload**(非 patch),選填欄送 NULL = 寫成 NULL
 * ⇒ 呼叫端契約 = 表單必「全欄 hydrate 自最新列、先讀後送」
 * (🔴 A9h 批次走 `true`:那四個選填欄的 NULL 是**保留現值**、不是清空 —— A9h-M `20260806200000`。
 *  批次沒有那四欄的入口,所以它不需要、也不該做全欄 hydrate。)
 * (`20260803160000_m4b_e10_a5a_admin_upsert_item_procurement.sql:20-24`)。少投影一欄 = A10b 表單
 * 會用 undefined 覆蓋掉那一欄的既有值。
 */
export type AdminOrderItemProcurement = {
  /** 採購列 id(order_item_procurement.id) */
  id: string;
  /** 供應商 id(NOT NULL FK → suppliers.id;A5a upsert 業務鍵的另一半,A10b 送這個值) */
  supplierId: string;
  /**
   * 供應商顯示名(join suppliers.label;本表**不存**供應商名稱文字,S1b 換軸後唯一顯示來源)。
   * 🔴 `null` = **內嵌沒回來**(投影退版 / 權限變動),不是「這家沒有名字」——
   * `suppliers.label` 是 NOT NULL + UNIQUE。顯示端必須誠實顯示缺、不得當空字串。
   */
  supplierLabel: string | null;
  /**
   * 供應商是否仍啟用(join suppliers.is_active)。`null` = 內嵌沒回來 = **不知道**。
   * 🔴 停用的供應商**照常出現在既有採購列**(S1b `:183`:本鍵不阻止採購指向已停用者);
   * 被擋的只有 A5a 的「新建」與「調升 allocated」(Sean 2026-08-03 晚拍 Q1=A)。
   * ⇒ A10b 用它顯示「此供應商已停用」提示,**不得**用它把整列藏起來;`null` 時不得靜默當 true。
   */
  supplierIsActive: boolean | null;
  /** 這筆採購負責幾件(DB CHECK 1..100000) */
  allocatedQuantity: number;
  /**
   * 這筆採購實際到貨幾件(累計;DB CHECK 0..allocated)。
   * 🔴 真相來源 = `order_item_procurement_receipts` 逐批明細的 SUM,由 A4a 重算 trigger 維護
   * (建表檔 `:118-119`)。本讀模型**不投影逐批明細**(批次到貨 UI 排第 2 批);要顯示「哪一批何時到」
   * 得另外加投影,不能拿本欄硬湊。
   */
  receivedQuantity: number;
  replyStatus: AdminProcurementReplyStatus;
  /** 聯絡管道(自由文字;DB 只擋空白) */
  contactChannel: string | null;
  /** 送出採購的時間 */
  submittedAt: string | null;
  /** 供應商單號(DB 擋前後空白與零寬字元 —— A9b2 的跨單搜尋靠等值比對) */
  supplierOrderNo: string | null;
  /** 採購異常原因(U6「為什麼要等」的內部依據;🔴 對客告知另走 order_notes) */
  exceptionReason: string | null;
  /** 預計到貨日(date,無時間部分) */
  expectedArrivalDate: string | null;
  /** 首次送出時間(A5a 只在首寫時填) */
  firstOrderedAt: string | null;
  /** 最後一次更新時間(A5a 每次更新填) */
  statusChangedAt: string | null;
  createdAt: string;
  /**
   * 作廢時間。`null` = **這筆採購還生效中**;非 null = 已作廢(#452 片 2a-1)。
   *
   * 🔴 **DB 早就照它分流了,應用層一直沒有**(`#476` 的病根):建表檔
   * `20260813120000_m4b_e10_452_procurement_void_schema.sql:495` 在 A4a 的 **ordered 軸**
   * 加了 `AND p.voided_at IS NULL`(行內註解逐字「**本片唯一改動**」)
   * ⇒ 畫面列得出 3 件、`orderedQuantity` 卻說 0 件,兩個數字互相矛盾而沒有一行字解釋。
   *
   * 🔴 ⚠️ **不要照抄同檔 `:355` 那句 COLUMN COMMENT**(我片1 抄了,片4 被審查抓到):
   * 它逐字寫「A2b1 跨列總量守門與 **A4a 三軸重算都**只 SUM `voided_at IS NULL` 的列」——
   * **對 `instock` 軸為假**:同檔 `:497-500` 的 receipts JOIN 沒有任何 voided 述詞
   * ⇒ **掛在作廢採購上的到貨仍然算進 `instockQuantity`**。
   * 那句 COMMENT 與它自己下面的「本片唯一改動」互相矛盾;以**算式**為準,不以 COMMENT 為準。
   *
   * 🔴 **同一個 `(order_item_id, supplier_id)` 可以有兩列**:business key 是 partial unique
   * (`WHERE voided_at IS NULL`,同檔 `:379-381`)+ Sean `Q-S1=A` 允許對同一家重下單
   * ⇒ **任何 `find`/`some`/`length` 只要不帶 `voidedAt === null` 就可能命中作廢那列**。
   * 表單 hydrate 命中它 = 舊值寫進生效列(`#476` 的靜默資料損壞)。
   *
   * ⚠️ 語意是**邏輯刪除**、可 unvoid(清回 NULL,需同時清 `voidReason`)⇒ 讀取端不得把它
   * 整個濾掉當「不存在」;顯示端要標示它(樣板 = shipments 線
   * `apps/admin/src/lib/shipping/order-shipments.ts:11` 逐字「否則畫面上會變成貨憑空消失」)。
   */
  voidedAt: string | null;
  /**
   * 作廢理由(與 `voidedAt` 由 DB `order_item_procurement_void_pair` 雙向配對:
   * 同進同出、不得純空白 —— 建表檔 `:347-350`)。
   *
   * 🔴 **「誰撤的」不在本型別也不在本表**(Sean 2026-08-13「不要增加太多欄位」⇒ DB 只加兩欄),
   * 走 `admin_audit_log` ⇒ 顯示端**不得**寫「由 XXX 作廢」這種它證明不了的話。
   * ⚠️ 建表檔 `:356` 逐字:`void_reason` + 稽核是唯一事後追溯手段,**不得宣稱「作廢有防呆」**。
   */
  voidReason: string | null;
};

/**
 * AdminOrderDetailItem: 後台訂單明細單一品項(M-4a Slice B;order_items 投影)。
 *
 * `title`/`spec` 來自 `product_snapshot` jsonb(create_order RPC 寫入 {sku,spec,title};防禦容缺 → null)。
 * 🔴 鐵則 12:`unitPrice`/`lineTotal` = 該單**成交價**(下單當下實際賣價、integer 元位 → Money),
 * **非**經銷價表(price_store / price_by_tier / cost 零滲入;snapshot 本身無價格欄)。
 */
export type AdminOrderDetailItem = {
  /** 品項 id(order_items.id;D-2 起明細頁 per-item 改狀態表單的 target) */
  id: string;
  variantSku: string;
  /** 品名(product_snapshot.title;缺 → null 防禦) */
  title: string | null;
  /** 規格 kv(product_snapshot.spec;缺/非物件 → null 防禦) */
  spec: Record<string, string> | null;
  quantity: number;
  /** 成交單價(整數元位;非經銷價表) */
  unitPrice: Money;
  /** 小計 = 下單當下 server 算的 line_total(不重算) */
  lineTotal: Money;
  // M-4b E10 A9w3(九碼契約收縮):`workflowStatus` 與 `version` 已從**明細**品項移除 ——
  // 兩者的唯一消費端是 A9w1 下架的明細頁九碼下拉(version = 該表單的樂觀鎖 hidden)。
  // 🔴 **列表**的 `AdminOrderLine` 仍有這兩欄(列表 cell 隨 A11a-c 退場),不要一起砍。
  /**
   * 本品項的採購列(M-4b E10 A9a-2)。排序 = `createdAt` ASC,三層全序
   * (權威實作 = `mappers/created-at-order.ts` 的 `compareByCreatedAtThenId`)。
   *
   * 🔴 **`#646`(2026-08-18)起 `null` 有意義,而它與 `[]` 是兩件相反的事**:
   * ```
   * null  = 【讀不到】一列都沒讀到（內嵌鍵沒回來／投影退版／本項不在內嵌那份裡）
   * []    = 問過了，答案是零筆（這個品項沒訂過貨）⇒ 這是**正常狀態**，不是錯誤
   * ```
   * ⚠️ **`null` 【不】告訴你「重整會不會好」——那是另一個問題,而本欄沒有答案。**
   *    本 repo 內對這件事有**兩個相反的說法**,兩個都沒有量測:
   *    · 本欄第一版(我寫的)寫「投影退版 ⇒ 重整真的可能會好」
   *    · `apps/admin/src/lib/orders/cancel-view.ts` 的 `charge_attempt_unknown` 逐字
   *      「成因之一是投影退版 / 內嵌鍵沒回來,那種情況**重新整理不會好**」
   *    ⇒ **標未確認,兩種都當可能** ⇒ 顯示端一律用條件句(可以先重整看看／還是這樣就是固定限制),
   *      不得往任一邊斷言。(`#646` 關卡2 code-reviewer 抓到這個矛盾。)
   * ~~原註「沒訂過貨 = 空陣列(**不是** null)」~~ 那句**仍然成立**(沒訂過貨依舊回 `[]`),
   * 但它當時的言下之意「本欄不會是 null」**從 `#646` 起是假的**。
   * ⇒ 顯示端與寫入端都**必須先分辨 `null`**(型別會逼你);`null` 時走 fail-closed,
   *   而給員工的話要說「**重新整理**」—— 那是這一種**真的會好**的世界。
   */
  procurements: AdminOrderItemProcurement[] | null;
  /**
   * 🔴 `procurements` **可能不完整** —— `#646` 起**只剩一個來源**:
   * 觸及請求端上限 `ORDER_ITEM_PROCUREMENT_EMBED_LIMIT`(剛好等於上限時分不出「就這麼多」與
   * 「被切了」⇒ 一律當可能不完整)。**這個世界重整不會好,文案不得叫員工重整。**
   * ~~②內嵌鍵整個沒回來(投影退版)~~ **已移出本旗標**,改由 `procurements === null` 表示
   * (`#646`:一個旗標兩個世界 ⇒ 消費端分不出自己在哪一個)。
   * 背景同 A9a-1 的 `notesTruncated`:PostgREST `max-rows` 對內嵌列同樣生效
   * (~~production 實測 1000~~ ⇒ **2026-08-18 實測 2000**,V 窗量、本檔改動者未自驗)
   * ⇒ adapter 自己夾一個更低的上限,讓邊界與專案設定脫鉤。
   * 🔴 **A10b(寫入端)必讀**:true 時**不得送出採購表單** —— A5a 是全量 payload,
   * 拿一份不可信的 hydrate 去送 = 用空白/舊值覆蓋真實採購事實。畫面要說「讀取不完整、請重新整理」。
   * 🔴 顯示端也不得把它當完整的 —— 「這個品項總共訂了幾件」在不完整時算不出來
   * (三軸數量的權威是 `order_item_quantity_summary`、由 A4a trigger 維護,**不是**把本清單加總)。
   */
  procurementTruncated: boolean;
  /**
   * 本品項的三軸數量摘要(M-4b E10 A9g-1;上一行講的那個「權威」就是它)。
   *
   * 🔴🔴 **`null` 的意思是「不知道」,不是「都是 0」** —— 這是本欄最容易被寫壞的地方。
   * `order_item_quantity_summary` 由 A4a trigger **惰性建立**:品項從未被採購也從未被取消時
   * **根本沒有那一列**。呼叫端若寫 `summary?.instockQuantity ?? 0`,就是把「不知道」翻成
   * 「到貨 0」,而那正好會讓可取消量被算大 ⇒ 畫面允許取消超量、送出必被 RPC 拒。
   * (母 plan `docs/specs/2026-07-28-e10-order-closure-master-plan-v2.md:384` row 37 逐字記這個坑:
   *  摘要列缺失時 `COALESCE` 成 0 會放行超量取消。)
   *
   * ⇒ 契約:**`null` 時一律 fail-closed** —— 顯示「數量資料尚未就緒」並停用該品項的取消,
   *   不得自行補 0。A8a2 RPC 對「**已到貨或已取消非零**、卻沒有摘要列」RAISE
   *   (`supabase/migrations/20260805100000_m4b_e10_a8a2_partial_cancel.sql:377-387`);
   *   ⚠️ 措辭要準(關卡2 nit):那個閘**不含**「只有採購配置(allocated)但尚未到貨」的情況 ——
   *   它只數 receipts 與 cancellation_items 兩個和。呼叫端仍與它保持同一立場:讀不到就不放行。
   *
   * 🔴🔴 **與 A1 建表 COMMENT 的字面衝突,先看這裡再動手**(A9g-1 實查):
   *   A1(`20260730150000`)的表 COMMENT 與 `order_item_quantity_summary_item_fk` 約束 COMMENT
   *   逐字寫「無列 = 三個 0,讀取端**必須** LEFT JOIN + COALESCE(…, 0)」,而且**點名 A9c/A11a-c**。
   *   那是 2026-07-30 的字面,已被 2026-07-31 的 master plan `:384` row 37 部分推翻
   *   (R3 抓:摘要列缺失時 COALESCE 成 0 會**放行超量取消**)。
   *   正確口徑是**分用途**(memory `feedback_guard-reads-non-authoritative-cache` 逐字「COALESCE 只准顯示用」):
   *   - **純顯示**(列表上顯示「已到貨幾件」):補 0 可接受,最壞只是少顯示一點資訊。
   *   - **任何守門/上限/可否取消的判斷**:**絕不可**補 0,必須 fail-closed。本欄屬後者。
   *   ⇒ 開 A9c(列表投影加三軸欄)的人:照 A1 字面補 0 只在列表顯示成立,**不要**把同一個
   *     `?? 0` 帶進取消流程的任何判斷。
   */
  quantitySummary: AdminOrderItemQuantitySummary | null;
};

/**
 * **列印用**的品項投影(`Q-C18` 甲,2026-08-17)。
 *
 * 🔴 **為什麼要一個比 `AdminOrderDetailItem` 窄的型別 —— 這不是風格選擇。**
 * 明細那份是**內嵌**在訂單查詢裡撈的,而內嵌撈得到幾列由請求端上限
 * (`ORDER_ITEMS_EMBED_LIMIT = 200`)決定 ⇒ 一張 200 品項的單就會被截,而**紙看起來完全正常**。
 * 治本是改走**頂層分頁查詢**(`SupabaseOrderAdapter.listOrderItemsForPrint`)。
 *
 * 而頂層那支刻意不取四個欄,而**它們被排除的理由是兩種,不要合在一起讀**
 * (V 窗 2026-08-17 打回我第一版:合在一起會讓下一個人拿結構性理由拒絕一個 YAGNI 的東西):
 *
 * - **排除 `procurements` / `procurementTruncated` —— 結構性理由,永久成立**:
 *   它是**內嵌陣列**,受 `ORDER_ITEM_PROCUREMENT_EMBED_LIMIT` 管
 *   ⇒ 取它進來**等於把我們正在拆的那道牆換個位置裝回來**。
 * - **排除 `unitPrice` / `lineTotal` —— 只是 YAGNI,會過期**:現行紙上零金額,現在不需要。
 *   🔴 **金額片要加這兩個欄時【不受上面那條約束】** —— 它們是**同列 scalar**,
 *   **取它們不產生任何截斷面**。看到上面那條就以為金額欄也不能加的人,請讀完這一段。
 *
 * ⇒ 型別對不上有兩種解法,而其中一種(把 `procurements` 一起取)會把病帶進來;選窄的這條。
 *
 * **這 6 欄是量出來的,不是列的**:對 `apps/admin/src/components/print/shipping-doc.tsx`
 * 與 `apps/admin/src/lib/shipping/shipping-doc-quantities.ts` 掃品項欄位用法後逐處分類
 * (量法與分類表寫在 `docs/specs/2026-08-17-shipping-doc-truncation-exit-plan.md` §2)。
 * ⚠️ **金額片落地時會需要 `unitPrice` / `lineTotal`** —— 那時再加,**不要順手先加**。
 *
 * 用 `Pick` 而不是重打一遍:欄位語意(尤其 `quantitySummary` 的 `null` = 「不知道」不是 0)
 * 只有一份權威,**兩份會漂**(同 backlog `#602` 的病)。
 */
export type AdminOrderPrintItem = Pick<
  AdminOrderDetailItem,
  'id' | 'variantSku' | 'title' | 'spec' | 'quantity' | 'quantitySummary'
>;

/**
 * **明細頁用**的品項投影(`D2` 的 C 條,2026-08-18)。
 *
 * = `AdminOrderPrintItem` 的六欄 **+ `unitPrice` / `lineTotal`**。
 *
 * 🔴 **為什麼是「加兩個 scalar」而不是「直接用 `AdminOrderDetailItem`」** ——
 * 這個區分是本片存在的理由,不是風格選擇:
 * ```
 * unitPrice / lineTotal  同列 scalar ⇒ 取它們【不產生任何截斷面】
 *                        AdminOrderPrintItem 當初排除它們只是 YAGNI（紙上零金額）
 *                        ⇒ 加回來不會把病帶進來
 * procurements /         【內嵌陣列】，受 ORDER_ITEM_PROCUREMENT_EMBED_LIMIT = 50 管
 * procurementTruncated   （mappers/order-procurement.ts:44）
 *                        ⇒ 🔴 取它進來 ＝ 把我們正在拆的那道牆【換個位置裝回來】
 *                        ⇒ 而 50 比品項的 200 低【四倍】，且那是【單一品項】的量
 *                           ⇒ 採購那一層截斷得更早
 * ```
 * ⇒ **本型別刻意【沒有】採購那兩欄。** 採購區維持吃內嵌那份,並把自己的射程講白
 * (`item-procurement-section.tsx`)。**那是「明說不全」,不是「做完了」** ——
 * 而 🔴 **明說不全是一個合格的終點**,判準同 Sean `Q-C16` 甲:
 * **「少印沒人會發現,多印客人會打電話」** ⇒ 先讓它會叫。
 *
 * ⚠️ **想把 `procurements` 加進來的人**:那不是加一個欄位,那是把 C 條整片的前提推翻
 * ⇒ 先讀 `docs/specs/2026-08-18-m4b-order-detail-items-exhaustive-plan.md` §3 與 §4 甲案的代價。
 *
 * 用 `Pick` 不重打:欄位語意(尤其 `quantitySummary` 的 `null` = 「不知道」不是 0)
 * 只有一份權威,**兩份會漂**。
 */
export type AdminOrderDetailFullItem = Pick<
  AdminOrderDetailItem,
  | 'id'
  | 'variantSku'
  | 'title'
  | 'spec'
  | 'quantity'
  | 'quantitySummary'
  | 'unitPrice'
  | 'lineTotal'
>;

/**
 * 品項三軸數量摘要(M-4b E10 A9g-1)——**衍生快取** `order_item_quantity_summary`
 * (建表 `supabase/migrations/20260730150000_m4b_e10_a1_order_item_summary_columns.sql:79`;
 * `order_item_id` 為 PRIMARY KEY、值由 A4a trigger 重算並由 CHECK 釘死)。
 *
 * 🔴 **不是「真相表」**(關卡2 MF4 更正):A1 表 COMMENT `:141` 逐字「衍生值,非真相 ——
 * 真相在 A2 採購表與 A7 取消明細」。A8a2 的可取消量守門是**從真相明細重算**
 * (`20260805100000:395-406`),只驗本表在不在場、不讀它的值。
 * ⇒ 本型別的用途是**顯示與輸入上限**,不是任何權限或可否取消的判斷依據。
 */
export type AdminOrderItemQuantitySummary = {
  /** 客人買的數量(去正規化欄,由複合 FK 物理保證等於 `order_items.quantity`) */
  quantity: number;
  /** 已向供應商訂的數量 */
  orderedQuantity: number;
  /** 已到貨數量 */
  instockQuantity: number;
  /** 已取消數量(歷次累計) */
  cancelledQuantity: number;
  /**
   * 已出貨數量(M-4b OD 改版 **L0**,2026-08-13)。
   *
   * 🔴 **為什麼現在才加**:欄位在 DB 早就有(B2-S2b `20260806180000` 已接重算 trigger + backfill),
   * 但 TS 這側一直沒撈 ⇒ 顯示端判不出「已出貨」。後果不是「少一個狀態」而是**顯示成錯的**:
   * 因為 Sean 2026-08-05 拍板「出貨必先到貨、無直送」⇒ `shipped ⊆ instock` ⇒ 已出貨的單
   * `instock >= quantity` 恆成立 ⇒ 會被判成「在庫」。其中 **`未收出貨` 會顯示成 `未收現貨`** ——
   * 那是需求檔 §0-H 點名**唯一真的會賠錢**的格子(錢沒收、貨已出去),**名字是反的**。
   *
   * 🔴🔴 **純顯示欄,絕不進任何可取消 / 上限 / 權限判斷**:
   * `cancellableQuantity` 的算式是 `quantity − instock − cancelled`,**刻意不減 shipped**
   * (`shipped ⊆ instock`,再減一次 = 重複扣、把可取消量算小)。
   * ⚠️ 本欄存在之後,「看到 shipped 就順手減一下」變成一個**看起來很合理的**改壞方式 —— 別做。
   * 出處與拍板:本檔 `cancellableQuantity` 的 docstring、`docs/specs/2026-08-05-shipped-enforcement-analysis.md` §10。
   *
   * 🔴 **上面那條禁令的邊界(2026-08-15 `#10` 片1 補;R2 nit-7)**:它管的是
   * **「可取消 / 上限 / 權限」那一類判斷**,**不是**禁止任何地方出現 `instock − shipped`。
   * 合法用途至少兩處,兩處問的都是「倉庫裡現在還剩幾件」而不是「還能取消幾件」:
   *   · `apps/admin/src/components/print/picking-doc.tsx` 的 `pickableQuantity()`(揀貨單應揀量)
   *   · `apps/admin/src/lib/orders/order-status-axes.ts` 用
   *     `shippedQuantity >= quantity − cancelledQuantity` 判「已出貨」軸
   *     (🔴 `#522` 2026-08-16 改的:原本分母是 `quantity`,而那讓**任何部分取消的單
   *      貨品軸永遠停在「未訂購」** —— 那正是本段這條判準句在講的事,只是當時沒照做。)
   * ⇒ **判準一句話:算「還能不能取消」就不准減 shipped;算「倉庫還剩什麼」就必須減。**
   * (完整推導在 `picking-doc.tsx` 的 `pickableQuantity` docstring。DB 側硬約束
   *  C7 `instock + cancelled <= quantity`、C9 `shipped <= instock` 保證這個差恆非負 ——
   *  這兩條是 R2 reviewer 查出來的,不是我推的。)
   */
  shippedQuantity: number;
  /**
   * 尚可取消量 = `quantity − instock − cancelled`。
   *
   * 🔴 公式逐字對齊 A8a2 的可取消量守門(`20260805100000:395-406`);集中算一次是為了避免
   * 每個顯示端各算一遍、各錯一種。**但權威永遠是 RPC**:本值取自惰性快取,且讀取與送出之間
   * 單子可能已被別人動過 ⇒ 只可當輸入上限與顯示用,**不可用來宣稱「一定取消得掉」**。
   *
   * 🏁 **`shipped_quantity` 契約債 —— 2026-08-05 Sean 拍板 Q1=A/Q2=A 終案:本式不改。**
   * ~~母 plan `:384` row 37 原立「第 2 批要把本式改成 `quantity − instock − cancelled − shipped`」~~
   * 🔴 **那個字面是錯的**:Sean 2026-08-05 拍板「出貨必先到貨、無直送」⇒ `shipped ⊆ instock`
   * ⇒ 已出貨的量**本來就含在 `instock` 裡**,再減一次 shipped = **重複扣**,會把可取消量算得比實際少。
   * ⇒ **本欄公式永久維持 `quantity − instock − cancelled`**;`shipped ≤ instock` 改由摘要表
   * CHECK `oiqs_shipped_le_instock`(C9)承重,出貨 RPC 只做訊息層前緣拒絕。
   * 出處:memory `project_m4b-b2-shipments-db-decisions`(08-05 追加段)、
   * `docs/specs/2026-08-05-shipped-enforcement-analysis.md` §10(Q1=A/Q2=A)。
   *
   * 🔴🔴 **A13a 必讀:`cancellableQuantity > 0` 不等於「這張單可以取消」**。
   * 它只回答「**這個品項**還有幾件在數量上可取消」,完全不含 A8a2 的**單層**閘:
   * `payment_status <> 'unpaid'`、或存在任何非 `failed` 的 `payment_charge_attempts`
   * ⇒ 整張單一律拒(`20260805100000:360-364`)。
   * 畫面的可否取消要**兩層都看**,只看本欄會做出「按鈕亮著、按下去必失敗」的 UI。
   */
  cancellableQuantity: number;
};

/**
 * 備註型別(M-4b E10 A9a-1;`order_notes_type_check`
 * `supabase/migrations/20260729030000_m4b_e10_a3_order_notes.sql:87-88` 三值)。
 */
export type AdminOrderNoteType = 'internal' | 'contact_log' | 'customer_notified';

/**
 * 聯絡管道(同上檔 `order_notes_channel_check` `:129-130` 五值;internal 恆 null —— 配對規則
 * CHECK `:116-127` 強制「非 internal ⇒ channel/occurredAt 皆非 null、internal ⇒ 皆 null」)。
 */
export type AdminOrderNoteChannel = 'line' | 'phone' | 'email' | 'in_person' | 'other';

/**
 * AdminOrderNote: 訂單備註/聯絡紀錄單列(M-4b E10 A9a-1;append-only 表的讀投影)。
 *
 * 🔴 `corrected` = 「本列被**別的列直接指向**」(`corrects_note_id` 指到我)⇒ 時間軸標「已更正」、
 * **不是不顯示**(建表檔 `:171-172` 合約)。U6 告知義務只認未被更正的 `customer_notified`。
 * 🔴 **更正不可撤回**(`:179-184`):`A ← B ← C` 裡 C 更正 B **不會**讓 A 復活(只看直接指向)。
 * ⚠️ `author` 現階段是自陳身分(picker cookie、非驗證身分;E8-B 前不得當「真的是誰寫的」)。
 */
export type AdminOrderNote = {
  id: string;
  noteType: AdminOrderNoteType;
  body: string;
  /** internal 恆 null;contact_log / customer_notified 必有值(DB 配對規則 CHECK) */
  channel: AdminOrderNoteChannel | null;
  /** 聯絡實際發生時間(同上;與 createdAt 分離 —— 補登時兩者不同) */
  occurredAt: string | null;
  author: string;
  /** 非 null = 本列是用來更正它指到的那一筆 */
  correctsNoteId: string | null;
  createdAt: string;
  /** 本列已被更正(被別列直接指向);一筆最多被更正一次(partial unique `:156-158`) */
  corrected: boolean;
};

/**
 * 取消原因七值 allowlist(M-4b E10 A9g-3)。
 *
 * 🔴 權威 = 建表 CHECK 的字面(`supabase/migrations/20260730130000_m4b_e10_a7_order_cancellations.sql:131-139`,
 * Sean 2026-07-28 拍 Q18「照這份」),**不是**這裡的 union —— 這裡只是它的 TS 複本。
 * ⚠️ mapper 用 `as` 轉型(慣例逐字同 `AdminOrderNoteType`,`mappers/order-notes.ts:80`)
 * ⇒ 若 DB 端日後加值,**型別會說謊**、顯示端拿到不在 union 裡的字串。
 * ⇒ 把 code 對到中文標籤的那張表(片 4)**必須容忍未知值**,不得寫成只認這七個的 `Record` 直接索引
 * (那會畫出空白;同族坑見 memory `reference_js-index-lookup-hits-prototype-chain`)。
 */
export type AdminOrderCancellationReasonCode =
  | 'customer_request'
  | 'out_of_stock'
  | 'long_leadtime'
  | 'price_change'
  | 'duplicate_order'
  | 'internal_error'
  | 'other';

/** 一次取消裡被取消的單一品項(M-4b E10 A9g-3)。 */
export type AdminOrderCancellationItem = {
  id: string;
  /**
   * 對應 `AdminOrderDetailItem.id`。**兩道**複合 FK 合力強制「明細品項 ∈ header 的訂單」
   * (建表檔 `20260730130000:233-238`;單靠兩個獨立單欄 FK 做不到 —— A 的 header 掛 B 的品項時
   * 兩個單欄 FK 各自都合法)。
   */
  orderItemId: string;
  /** DB CHECK 保證 > 0、**無上限**(建表檔 `:246-247`;上限來自跨列不變式,不在本表) */
  cancelledQuantity: number;
};

/**
 * 一次取消事件(M-4b E10 A9g-3)。整單取消與部分取消都是這張表的一列;
 * 同一張單可以有多列(部分取消可分次累積)。
 */
export type AdminOrderCancellation = {
  id: string;
  reasonCode: AdminOrderCancellationReasonCode;
  /** `other` 必有值、其餘恆 null(建表檔 `:157-166` 的配對 CHECK) */
  reasonDetail: string | null;
  /** 操作者 staff id。🔴 內部資料,**永不得**進 storefront 投影 */
  actor: string;
  /**
   * 這次取消的冪等鍵(`order_cancellations.idempotency_key`,uuid NOT NULL,
   * 建表檔 `20260730130000_m4b_e10_a7_order_cancellations.sql:86`)。
   *
   * 🔴 **片 3 當時判定它是內部機制、刻意未投影;依 `A-203-STOP` ③ 主視窗裁示 A 改判**
   * (裁示本體不在 repo 內,在視窗信箱:`/Users/sean_1/pcm-mailbox/A-109-A.md` §①③,
   *  問題面在 `/Users/sean_1/pcm-mailbox/A-203-STOP.md` ③;其餘引用本裁示處只寫代號):
   * 取消表單一開啟,員工手上就握著這顆 token。
   * 🔴 **資料流已隨 A13b PRG 換路改變**(D2b 更新;原文寫的 `CancelActionState.requestToken` 已刪除):
   *   **D4 的表單在 server render 時鑄** `generateCancelRequestToken()` → 放進 hidden `request_token` 欄
   *   → action 解析後交給 repository 當 `p_idempotency_key` 送進 `admin_cancel_order`
   *   → 失敗/成功都由 action 把同一顆放進導頁 URL 的 `rt`
   *   → **D3 的 classifier 拿 `rt` 對本欄位、D5 的面板顯示結果**。
   * ⇒ 它的「內部性」在**有那個畫面**之後已經不成立。缺了它,員工重新整理看歷程時
   * **手上的 token 與歷程列對不起來** —— 併發或舊紀錄會被誤認成本次
   * ⇒ 可能重複取消,或該補的沒補。這是災難當天唯一能一眼對上的鍵。
   * 🔴 **「災難當天」精確指哪幾支**(關卡2 R3 → R4 兩次更正):真的可能已 commit 卻回失敗的是
   * `rejected`(hash 不符 = 前一次其實成功了)、`error`(未知),以及 `bug` 的
   * **「payload 形狀不符」**那一支(RPC 成功回傳之後才驗失敗 ⇒ 已 commit)。
   * `retry` 與 `bug` 的其餘五碼全部中止交易或根本沒進到函式 ——
   * 逐支依據見 `apps/admin/src/lib/orders/cancel-action-state.ts:110-117`(失敗碼 docstring 的「⚠️ 精確版」那段),別繞過它自己歸納。
   *
   * 🔴 **進得了後台不代表進得了 storefront**:同表的 `payload_hash` 照舊不投影,
   * 而本欄對客投影**永遠**不得出現 —— 守門在 `scripts/storefront-projection-leak-guard.test.ts`
   * (表名 + 欄名兩層)。
   */
  idempotencyKey: string;
  createdAt: string;
  /**
   * 🔴 **`null` = 沒讀到**(內嵌鍵沒回來 / 回了空陣列)—— 不是「這次取消沒動到品項」。
   * 後者在 DB 端不存在:A8a1 逐品項寫入後有筆數守
   * (`20260804180000_m4b_e10_a8a1_admin_cancel_order.sql:231-240`)、A8a2 全零增量拒。
   * ⇒ 型別逼消費端先處理 `null`,不能直接 `.map()` 畫成「這次取消沒有品項」。
   * 慣例與同型別的 `AdminOrderDetailItem.quantitySummary` / `customerNotified` 一致。
   */
  items: AdminOrderCancellationItem[] | null;
  /**
   * 🔴 **只表示「觸及請求上限 `ORDER_CANCELLATION_ITEMS_EMBED_LIMIT`」**(R3 M2 拆分後語意收窄):
   * `items` 非 null 但本旗標 true = 讀到了、但看到的是子集。
   * 「沒讀到」不再擠進本旗標,它由 `items === null` 表達 —— 兩者對員工的意義不同:
   * 前者重新整理沒用(資料就是這麼多),後者是部署/程式問題。
   *
   * 🔴 它與外層 `cancellationsTruncated` 是**前提關係**:外層被截掉的那些取消列,
   * 連同它們的這個旗標一起消失、看得到的每個都還是 false ⇒ 兩個要一起讀。
   */
  itemsTruncated: boolean;
};

/**
 * AdminOrderDetail: 後台訂單明細讀模型(M-4a Slice B;/orders/[id] 明細頁、admin-only)。
 *
 * 🔴 PII 邊界(設計檔 2026-07-13):明細**才**攜 客戶姓名/電話/email + 收件快照(姓名/電話/地址)——
 * 走 service_role、`ADMIN_ORDER_DETAIL_SELECT` 另立具名白名單,**不進列表投影**(列表維持精簡)。
 * 🔴 鐵則 12:**仍零**成本/經銷價欄(price_store / price_by_tier / cost)、**零** tappay_rec_trade_id
 * (金流對帳識別碼不進後台顯示層;對帳走 #250/W1 管線)。
 * `invoiceRequest` = 既有 orders.invoice jsonb(客人結帳開票**需求**:個人/統編/載具);
 * `invoiceNumber/Amount/Status` = 開票**紀錄**三欄(Sean 手填;兩者語意分離)。
 * `paymentMethod` = 金流事實軸(金流 RPC 寫入;報表算錢用它)、`paymentChannel` = 管理/預期軸。
 */
export type AdminOrderDetail = {
  id: OrderId;
  displayId: DisplayId;
  createdAt: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  // (M-4a D-2 起不攜 orders.workflow_status;A9w1/A9w3 起明細鏈九碼全退場,items[].workflowStatus 彙總已拆。)
  orderSource: OrderSource;
  paymentChannel: PaymentChannel;
  /** 金流事實軸(付款成功才有值;null=尚無成功請款) */
  paymentMethod: string | null;
  paidAt: string | null;
  subtotal: Money;
  shippingFee: Money;
  discountTotal: Money;
  total: Money;
  /** 出貨方式(既有欄、結帳寫入;現值 'home',Slice C 起 admin 可改) */
  shippingMethod: string;
  /** 收件快照 PII(orders.shipping_address_snapshot jsonb {name,phone,line};防禦容缺) */
  shippingAddress: { name: string | null; phone: string | null; line: string | null };
  /**
   * 客人 id(`orders.customer_user_id` 原樣)。**OD 片 2 為了詳情頁的「客人明細入口」而加**
   * (按 1 下開既有客戶明細,需求檔 §0-J J-4;入口要連 `/customers/[id]` 就得先有這個 id)。
   *
   * 🔴 **不能用 `customer.name` 代替**,理由與 `AdminOrderSummary.customerUserId` 同一條:
   *    姓名不唯一、且可為 null ⇒ 拿名字當識別會把兩個人指到同一頁,而這個錯**零症狀**。
   * 🔴 非成本欄、不新增 join —— `orders` 自己的欄位,與 `AdminOrderSummary` 同款先例
   *    (`mappers/order.ts:239` 逐字寫過理由);不動 schema / RLS / RPC。
   *
   * 🔴 **`| null` 的理由(codex 關卡2 important:原本宣告 `string` 是型別謊言)**:
   *    DB 端這一欄是 `uuid NOT NULL`(建表 `20260604120000:95`、生成型別 `database.types.ts:1503`),
   *    但那保證的是「**列裡**有值」、不是「**wire row 裡**有這個鍵」——**投影退版**時整個鍵會消失,
   *    直送就產出一個型別說 `string`、實際 `undefined` 的值。
   *
   * ⚠️ **更正(R2 important①,2026-08-13):我原本在這裡寫「型別留 null 是為了讓 TS 逼消費端處理」——
   *    那句實測不成立。** TS 的樣板字串**接受 `null`**,且本 repo 的 eslint 未開
   *    `@typescript-eslint/restrict-template-expressions` ⇒ `` `/customers/${x}` `` 在 `x=null` 時
   *    typecheck 綠、lint 綠,只是把 `/customers/undefined` **改名**成 `/customers/null`。
   *    ⇒ 這個型別**只表達事實**(讀不到就是讀不到),**不是防護**。
   *    真正的防護是機制:拼網址收斂在 `apps/admin/src/lib/orders/order-detail-view.ts`
   *    的 `customerDetailHref()` 一處,拼不出來回 `null`,消費端只能選擇不渲染入口。
   *
   * 🔴 **同病未修、有活的消費端(pre-existing,本片不修)**:`AdminOrderSummary.customerUserId`
   *    (`:459`)仍宣告非 nullable、mapper `mappers/order.ts:352` 仍直送 ——
   *    上面那段「NOT NULL 不保證 wire row 有鍵」的推論**逐字適用於它**。
   *    而它有活的消費端 `apps/admin/src/components/shipping/shipping-selection.tsx`
   *    的同客人閘:兩邊都 `undefined` 時 `undefined === undefined` 為真
   *    ⇒ **兩位不同客人的訂單會被判成同一位**(該型別 `:452-456` 自己就警告過這個 bug 零症狀)。
   *    不在本片修的理由:非本片造成,且動它會碰出貨閘的活路徑、超出片界。**已立案 backlog #457。**
   */
  customerUserId: string | null;
  /** 客人資訊 PII(join customers;姓名/email/電話) */
  customer: { name: string | null; email: string | null; phone: string | null };
  /** 結帳開票需求(orders.invoice jsonb;type/taxId/title/carrier/donateCode,防禦容缺) */
  invoiceRequest: {
    type: string | null;
    taxId: string | null;
    title: string | null;
    carrier: string | null;
    donateCode: string | null;
  };
  /** 開票紀錄三欄(M-4a;Sean 手填) */
  invoiceNumber: string | null;
  invoiceAmount: Money | null;
  invoiceStatus: InvoiceStatus;
  cancelledAt: string | null;
  /** 取消原因=可對客文案(會員可見自己單此欄;內部原因在 admin_audit_log) */
  cancelledReason: string | null;
  /** 樂觀鎖版本(M-4a Slice C;明細頁表單 hidden 帶此值當寫入條件) */
  version: number;
  items: AdminOrderDetailItem[];
  /**
   * 備註/聯絡紀錄時間軸(M-4b E10 A9a-1)。排序 = `createdAt` ASC,三層全序:
   * 毫秒 → 同毫秒比時間字面(`Date.parse` 只到毫秒、DB 是微秒)→ `id` 字典序。
   * 🔴 排序合約的權威實作與前提在 `mappers/created-at-order.ts` 的 `compareByCreatedAtThenId`
   * (A9a-2 起與採購時間軸共用;`order-notes.ts` 的 `compareNotes` 只是它的別名),改那裡要同步改這裡。
   */
  notes: AdminOrderNote[];
  /**
   * U6 告知義務:本單有「未被更正的 `customer_notified`」。
   * 🔴 **不得**寫成「有 customer_notified」—— 被更正掉的誤選要排除(建表檔 `:160-177` 合約)。
   * 🔴 **`null` = 無法判定**:兩個方向都可能錯,顯示端必須說「無法判定」而**不得**當 false 用。
   * 型別留 null 是為了讓 TS 逼消費端處理,不是靠註解提醒。
   * 🔴 **`null` 有兩個成因,不可只記得第一個**(#328 補;漏了它的人會把 `?? []` 寫回 mapper):
   *   ①**時間軸被截斷**(`notesTruncated === true`)—— 讀到了,但只有最新 N 筆;
   *   ②**整段沒讀到**(`notesTruncated === false`)—— 投影退版 / 內嵌鍵缺,= 讀取失敗。
   *   ⇒ **`null` ⟺ 截斷 是錯的**。兩者對員工的處置不同(①看更早紀錄 ②重新整理/通知維護),
   *   文案不可共用;判別式**唯一具名處** = admin `lib/orders/note-timeline.ts` 的 `isNotesUnreadable`。
   */
  customerNotified: boolean | null;
  /**
   * 🔴 notes 觸及請求端上限(`ORDER_NOTES_EMBED_LIMIT`)⇒ 時間軸**不完整**、`customerNotified` 為 null。
   * 背景:PostgREST `max-rows` 對內嵌列同樣生效
   * (~~2026-08-02 production 實測 = 1000:`brands?select=id,products(id)&id=eq.05be10ec-…` 的 4566 筆子列只回 1000~~
   *  ⇒ **2026-08-18 頂層實測 2000**,V 窗量、本檔改動者未自驗。
   *  🔴 **而【對內嵌列】的新值沒有人重量過** —— 上面那筆 2000 是【頂層】的。
   *  內嵌那一面最後一次實量是 B 窗 2026-08-17 的**本機**探針(`db-max-rows=100` 自設),
   *  **不是 production**。⇒ 這裡只能說「對內嵌同樣生效」,**值標未確認**)
   * ⇒ adapter 改為自己夾一個更低的上限,讓邊界與專案設定脫鉤(理由與殘餘風險見 `mappers/order-notes.ts`)。
   */
  notesTruncated: boolean;
  /**
   * 🔴 `items` 觸及請求端上限(`ORDER_ITEMS_EMBED_LIMIT`)⇒ 品項清單**可能不完整**(A9a-2 補)。
   * 它是 `AdminOrderDetailItem.procurementTruncated` 的**前提**:品項自己被切掉時,那個 per-item
   * 旗標會連同品項一起消失、呼叫端看到的每個旗標都還是 false ⇒ 兩個要一起讀。
   */
  itemsTruncated: boolean;
  /**
   * 取消 UI 的**在途扣款閘**(M-4b E10 A9g-2)。三態、不是兩個 boolean —— 理由見下。
   *
   * - `'clear'`:**觀察完整**且該單扣款嘗試全為終態 `failed`(或零筆)⇒ 落在 A8a2 允許集合。
   * - `'blocked'`:**明確觀察到**至少一筆非 `failed` 的扣款嘗試 ⇒ RPC 必拒。
   * - `'unknown'`:**沒讀到或只讀到子集**(內嵌鍵沒回來 / 觸及 `PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT`)
   *   ⇒ 沒看到的那些**可能就有一筆在途**,不得當成 `'clear'`。
   *
   * 🔴 為什麼取消 UI 需要它:A8a2 只在 `payment_status='unpaid'` **且**該單
   * `payment_charge_attempts` 全為終態 `failed`(或零筆)時才放行
   * (`supabase/migrations/20260805100000_m4b_e10_a8a2_partial_cancel.sql:360-364`,
   *  判定字面逐字 `status <> 'failed'`)。
   * 只看 `paymentStatus === 'unpaid'` 會漏掉「已扣款但尚未回填」的單 ⇒ 畫面給按、送出必拒。
   *
   * ⇒ 呼叫端規則:可以顯示取消入口 ⟺ `paymentStatus === 'unpaid'` **且** 本欄 `=== 'clear'`。
   *   🔴 `'clear'` 是 **advisory、不是保證**(R3 Fable N4):讀到它與員工按下去之間,
   *   隨時可能新增一筆扣款嘗試。**權威永遠是 A8a2 在交易內的重查**(`20260805100000:362`)——
   *   所以 RPC 回拒是**正常路徑**、要當一般結果顯示,不是「不該發生」的例外。
   *   反過來說也成立:本欄判錯的代價封頂在 UX(按鈕誤亮 → 送出被拒),動不到錢。
   *   `'blocked'` 與 `'unknown'` 都不給按,但**該給員工的文案不同**
   *   (「有在途扣款」vs「付款狀態讀取不完整,請重新整理」)⇒ 兩者必須分得出來。
   *
   * 🔴🔴 **為什麼是三態而不是 `blocking` + `truncated` 兩個 boolean**(關卡2 codex MF1):
   *   兩個 boolean 的形狀讓呼叫端可以**只讀一半** —— 只讀 `blocking===false` 就放行,
   *   而「沒讀到」時它恰好也是 `false` ⇒ 把「不知道」靜默翻成「沒有在途扣款」,
   *   那是**動到錢的路徑**上的 fail-open,且註解攔不住(型別才攔得住)。
   *   收成一個三態欄位後「半讀」在型別上不存在,而原本要分開的兩種文案仍分得出來。
   *   這是片 1 那條教訓(不可把「不知道」偽裝成一個看起來正常的值)的同族。
   *
   * 🔴 **本欄只在 service_role 之下有意義**:`payment_charge_attempts` 全庫唯一一筆 SELECT 授給
   *   service_role(`20260612150000:121`),anon/authenticated 零 grant(`:118`)⇒ 它們讀不到、
   *   落在 fail-closed。真正的 fail-open 只會在**日後把 SELECT 授給不 BYPASSRLS 的角色**時出生:
   *   RLS enable 零 policy(`:115`)會讓那個角色讀到空陣列、不報錯 ⇒ 本欄變成 `'clear'`
   *   = 假裝「沒有在途扣款」。該情境由 `scripts/a9g2-charge-attempts-grant-guard.test.ts` 守。
   */
  chargeAttemptGate: 'clear' | 'blocked' | 'unknown';
  /**
   * 取消歷程(M-4b E10 A9g-3)。排序 = `createdAt` ASC 三層全序,與 `notes` 共用
   * `mappers/created-at-order.ts` 的 `compareByCreatedAtThenId`。
   *
   * 🔴 **`null` = 沒讀到**(內嵌鍵沒回來 / client 讀不到那兩張表),**不是**「這張單沒被取消過」。
   * 真的沒取消過是 `[]`。R3 打掉原本的兩 boolean 形狀:`[]` + `truncated=true` 讓呼叫端可以只寫
   * `detail.cancellations.map(render)`,投影退版時就靜默畫成「本單從未取消」而 TS 零報錯 ——
   * 那與 `chargeAttemptGate` 那條(兩 boolean 可半讀)是同一個形狀,而同一個型別裡已經有兩處
   * 用 `X | null` 表達「不知道」(`quantitySummary`、`customerNotified`)⇒ 照 house idiom 收斂。
   *
   * ⇒ **呼叫端怎麼用才對**(三個東西各管一件事,不要混):
   *   ① `cancellations === null` → 說「取消歷程讀取失敗」,**不要**畫空清單;
   *   ② `cancellations.length === 0` → 說「本單沒有取消紀錄」(這是真事實);
   *   ③ 有內容 → 畫清單;`cancellationsTruncated === true` 再加一句「只顯示最近 N 筆」;
   *      逐列另看 `items === null`(該列品項沒讀到)與 `itemsTruncated`(該列品項只顯示子集)。
   *
   * 🔴🔴 **不要拿這份歷程加總算「已取消幾件」** —— 權威是
   * `AdminOrderDetailItem.quantitySummary.cancelledQuantity`(A9g-1,由 A4a 重算 trigger 維護)。
   * 本清單會被截斷、每列的 `items` 也會被截斷或讀不到,兩層任一被切,加總就會**少算**,
   * 而少算的方向是「看起來還能取消更多」= 動到錢的方向。
   * 這份資料的用途只有一個:**給員工看發生過什麼**。
   */
  cancellations: AdminOrderCancellation[] | null;
  /**
   * 🔴 **只表示「觸及請求端上限 `ORDER_CANCELLATIONS_EMBED_LIMIT`」**(R3 M2 拆分後語意收窄):
   * `cancellations` 非 null 但本旗標 true = 讀到了、但看到的是**最新的 N 筆**、更舊的沒回來。
   * 「沒讀到」不再擠進本旗標,它由 `cancellations === null` 表達。
   * ⚠️ 兩者刻意分開的理由 = **員工能做的事不同**:觸及上限時重新整理沒用(資料就是這麼多、
   *   要往前翻得等分頁那一片);讀不到時是部署/程式問題,重新整理才可能有救。
   *   壓成一個 boolean 會讓畫面對前者給出一條永遠不會消失的「請重新整理」(R3 C2)。
   * 🔴 授權面的精確說法(R1 nit 6):兩張表 `REVOKE ALL` 後只 `GRANT SELECT TO service_role`
   * (`20260730130000:202-203`、`:267-268`)⇒ 零 grant 的角色讀會 **42501 直接 throw**,不是靜默回空。
   * **靜默回空的前提是「被授了 SELECT 但不 BYPASSRLS」**(RLS enable 零 policy `:200`、`:265`),
   * 那條路由 `scripts/a9g2-charge-attempts-grant-guard.test.ts` 守(A9g-3 起已含這兩張表)。
   *
   * 🔴 與 orders 層 `cancelledAt` / `cancelledReason` 的關係(R1 nit 12):兩者是**不同軸**——
   * 那兩欄只在**整單關閉**時才寫(A8a1 / A8a2 累積到全量時),而本歷程**每次取消都有一列**。
   * ⇒ 「`cancelledAt` 是 null 但 `cancellations` 非空」= 部分取消,**正常**、不是矛盾;
   *   反過來「`cancelledAt` 有值但 `cancellations` 是 `[]`」**曾經**一律當資料矛盾(該單關過但零歷程列)。
   *   🔴🔴 **2026-08-09 起這句話有例外、不得再一律當異常**(P 窗生命週期線 L3,Sean 拍 Q1=A;
   *   主視窗裁示 `E-003-A` §4.2):未付款逾時的**自動失效**會寫
   *   `cancelled_at` + `cancelled_reason = 'payment_expired'` 而**完全不碰取消帳本**
   *   ⇒ 那種單的 `cancellations` 本來就是 `[]`,**正常**。
   *   ⇒ 判別法:先看 `cancelledReason`,是 `'payment_expired'` ⇒「未付款自動失效」;
   *     其餘才是「關過卻零歷程列」的真異常。落地在
   *     `apps/admin/src/lib/orders/cancel-view.ts` 的 `PAYMENT_EXPIRED_CANCEL_REASON`
   *     (該檔把兩者分成 `payment_expired` / `already_cancelled` 兩個碼、文案不同)。
   *   ⚠️ L3 施工中、尚未 apply ⇒ 現階段正式庫還看不到那個值;先接住是為了它上線那天不用回頭改。
   */
  cancellationsTruncated: boolean;
};

// M-4b E10 A9w4c:九碼狀態**詞彙表**的 domain 型別已全數移除
// (⚠️ 不是「九碼欄位全沒了」:`AdminOrderLine.workflowStatus` 那個欄位仍在,那是**值**、不是詞彙表)。
// - 前半:`OrderStatusOptionUpdate`(唯二引用=port/adapter 的 `updateOrderStatusOption` 簽章)。
// - 後半收尾:`OrderStatusOption`(讀模型)—— A11a-1 列表重建後零引用,`order_status_options`
//   讀取鏈(port / adapter / admin getter / 其測試)同片整條退場(A11a plan §3.1 裁定)。
// 🔴 DB 端 `order_status_options` 表與資料都還在;service_role 的**寫**權由
// A9v `20260807120000` 撤除(INSERT + 五個欄級 UPDATE;**SELECT 保留**),apply 後生效
//    ⇒ 這裡是「應用層沒有這張表的型別與讀取介面」,不等於「資料庫沒有這張表」。

/**
 * PlaceOrderVehicle: 品項「給哪台車用」(M-4a V-3a;client → server 線契約、選填)。
 *
 * 形狀=storefront CartItemVehicle(V-2a 判別式)的 wire 鏡像:kind:'dict'=字典字面(picker/typeahead/
 * 搜尋帶入/車庫 dict 對)、kind:'free'=自由輸入(§7 恆人工確認路)。逐 kind 隔離(dict 無 raw、
 * free 無 brand/model=值班台 REQUIRED-3)。create_order RPC 端白名單重組後存 order_items.vehicle_snapshot
 * (字面凍結、車種鐵律零猜);非法形狀=RPC 端 NULL、不擋單(選填)。
 *
 * 🔴 純 metadata:不進取價/數量/變體解析任何路徑;無 price / tier 欄(鐵則 12)。
 */
export type PlaceOrderVehicle =
  | { kind: 'dict'; brand: string; model: string; year?: number; source: 'search' | 'garage' | 'picker' }
  | { kind: 'free'; raw: string; year?: number; source: 'garage' | 'freetext' };

/**
 * PlaceOrderLine: 結帳送出的單一購物車品項(client → server 線契約)。
 *
 * 對齊 create_order RPC(20260604130000)p_lines:`variantId` XOR `(supplierSlug + sku)`、皆帶 qty。
 * S3a 後 sku 非全域唯一 → 優先 variantId;無 variantId 時用 (supplierSlug, sku) 複合鍵防撞錯變體/錯價。
 * V-3a:每 line 可帶 optional `vehicle`(PlaceOrderVehicle;→ order_items.vehicle_snapshot)。
 *
 * 🔴 鐵則 12(plan v6 §5 紅線 3 server 價權威):**型別層無** price / unitPrice / tier / priceByTier /
 * priceStore / cost 欄。client 只送「買什麼變體、買幾個」、**永不送價/tier**;單價 / 小計 / 運費 / total
 * 全由 create_order RPC server 自算、client 送的任何金額一律忽略。
 */
export type PlaceOrderLine =
  | { variantId: string; quantity: number; vehicle?: PlaceOrderVehicle }
  | { supplierSlug: string; sku: string; quantity: number; vehicle?: PlaceOrderVehicle };

/**
 * OrderInvoice: 結帳發票資訊(對齊 create_order RPC p_invoice + design CheckoutPage)。
 *
 * type ∈ personal(手機載具選填)/ company(抬頭 + 8 碼統編)/ donate(愛心碼);
 * 跨欄位必填驗證在 @pcm/schemas `CheckoutInput`(delivery 層)+ RPC 收乾淨白名單 jsonb。
 */
export type OrderInvoice = {
  type: 'personal' | 'company' | 'donate';
  carrier?: string;
  title?: string;
  taxId?: string;
  donateCode?: string;
};

/**
 * PlaceOrderInput: 建單 use-case / repo 寫入 input(client → server 線契約、value-object)。
 *
 * 對齊 create_order RPC 簽名(p_lines / p_address_id / p_shipping_method / p_invoice / p_cart_session_id
 * / p_terms_version / p_client_ip / p_client_ua + B-2 p_notification_email、flag-off 8 / flag-on 9-param):
 * - `lines`:購物車品項(1..200、每筆 qty 1..10000、上限 RPC 驗)
 * - `addressId`:收件地址 id(RPC 以 auth.uid() 驗本人歸屬、防 IDOR)
 * - `shippingMethod`:配送方式(運費 RPC §7 自算、見 shipping.ts)
 * - `invoice`:發票
 * - `cartSessionId`:cart-instance idempotency key(uuid;3DS 跨分頁雙扣去重、對齊 0b p_cart_session_id
 *   null fail-closed)。**非價/非身分/非 tier**。現行(3DS-7、已上線)= client CartContext 持有的穩定 key
 *   經 charge-actions chargePaymentAction 送 server(server 局部 UUID_RE 驗、非空 fail-closed;per-cart-instance 去重)。
 * - `termsVersion` / `clientIp` / `clientUserAgent`:🔴 #241 同意紀錄(**server 注入、非 client→server 線契約**;見各欄)。
 *
 * 🔴 鐵則 12:**無** customerId / tier / 任何價欄 —— 身分由 RPC server 端 `auth.uid()` 重查(零信任)、
 * 價 server 權威。client 永不送 userId / 價 / tier。
 */
export type PlaceOrderInput = {
  lines: PlaceOrderLine[];
  addressId: string;
  shippingMethod: ShippingMethod;
  invoice: OrderInvoice;
  cartSessionId: string;
  /**
   * 🔴 #241 同意條款版本(server 注入 `CURRENT_TERMS_VERSION`、**非 client 送**;對齊 create_order
   * 舊 8 鍵路徑的 `p_terms_version`)。create_order 路徑必填(NULL/空 → RPC RAISE「無 consent 不生 order」、
   * 同 transaction 原子寫 order_legal_consents)。
   */
  termsVersion: string;
  /** 🔴 #241 best-effort 同意來源 IP(server 由 request headers 抓、可 null;爭議舉證、**非強身分證據**)。 */
  clientIp?: string | null;
  /** 🔴 #241 best-effort 同意來源 User-Agent(server 抓、可 null)。 */
  clientUserAgent?: string | null;
  /**
   * B-3 RPC shape marker：屬性不存在=flag off、維持精確 8 參數；屬性存在=flag on、送第 9 參數。
   * B-3 刻意只送 null，不寫入客人 Email；canonical 真值接線保留 B-4。
   */
  notificationEmail?: null;
};

/**
 * PlaceOrderResult: 建單回傳(對齊 create_order RPC return DTO `{order_id, display_id}`)。
 *
 * 🔴 鐵則 12(plan §5 紅線 4 + RPC L266-267「禁回原 row / 禁帶價結構」):建單**只**回訂單 id +
 * 人類可讀單號、**不帶任何價 / tier / 明細結構**;需要明細另走只讀路徑(findById、stage ③ 訂單查詢)。
 */
export type PlaceOrderResult = {
  orderId: OrderId;
  displayId: DisplayId;
};
