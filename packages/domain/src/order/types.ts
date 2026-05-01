import type { Money } from '../shared/types';
import type { ProductId } from '../catalog/types';
import type { CustomerId } from '../identity/types';

export type OrderId = string;

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
 */
export type PaymentStatus = 'paid' | 'unpaid' | 'partiallyPaid' | 'refunded';

/**
 * FulfillmentStatus: 出貨狀態(domain enum、PCM 自家狀態機)。
 *
 * 對齊 ADR-0003 §3.2 + brainstorming Q9-10 拍板:
 * Medusa fulfillment_status 不夠用、PCM 自家 4 階段 enum 走 metadata。
 *
 * 業務含義:
 * - `notOrdered` 未跟廠商訂貨
 * - `ordered` 跟廠商訂貨中
 * - `inStock` 已現貨(到 PCM 倉庫或合作店家)
 * - `shipped` 已出貨給客人(或寄到合作店家)
 */
export type FulfillmentStatus = 'notOrdered' | 'ordered' | 'inStock' | 'shipped';

/**
 * OrderItem: 訂單品項(value-object)。
 *
 * `unitPrice` 為「結帳當下」價格、與 Product.priceByTier 當前值無關
 * (商品改價不影響歷史訂單金額)。
 */
export type OrderItem = {
  productId: ProductId;
  /** 數量、整數 ≥ 1 */
  quantity: number;
  /** 結帳當下單價(整數、最小貨幣單位) */
  unitPrice: Money;
};

/**
 * OrderStatusFilter: admin 訂單列表雙維度篩選參數(value-object)。
 *
 * 對齊 PHASE-1-MILESTONES §7 M-4a-08(8 狀態雙維度篩選);
 * M-3-04 + M-4a-08 共用、抽出為共用 type。
 */
export type OrderStatusFilter = {
  paymentStatus?: PaymentStatus;
  fulfillmentStatus?: FulfillmentStatus;
};

/**
 * Order: 訂單 entity(M-0-04 type stub、最小欄位集)。
 *
 * 對齊 ADR-0003 §3.1 + brainstorming Q9-10(8 狀態雙維度);
 * 完整欄位(shippingAddress / fulfillmentMethod / createdAt / 物流單號 / 等)在 M-3-02 補。
 */
export type Order = {
  id: OrderId;
  customerId: CustomerId;
  items: OrderItem[];
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** 訂單總金額(items + 運費、結帳當下計算、後續退款另計) */
  total: Money;
};
