import type { Money, MemberTier } from '../shared/types';
import type { ProductId } from '../catalog/types';
import type { CustomerId } from '../identity/types';

export type OrderId = string;

/**
 * DisplayId: 人類可讀訂單編號(格式 `PCM-YYYY-NNNN`)。
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
 *
 * Medusa wire 字串困在 adapter 內、ports / use-case / storefront 只見 domain enum。
 * 合法轉移表見 `state-machine.ts`(Phase 1 主路徑 unpaid→paid;refunded/partiallyPaid 留型別)。
 */
export type PaymentStatus = 'paid' | 'unpaid' | 'partiallyPaid' | 'refunded';

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
 *  超商取貨 fulfillment_method 留 Phase 2、plan v6 §3.3。)
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
  /** 人類可讀單號 `PCM-YYYY-NNNN`(display-id.ts 組 / 驗) */
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
