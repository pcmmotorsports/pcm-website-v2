import type {
  Order,
  OrderId,
  OrderStatusFilter,
  CustomerId,
} from '@pcm/domain';

/**
 * IOrderRepository: 訂單 CRUD + 列表查詢 port。
 *
 * 對齊 ADR-0003 §3.3。
 * 8 狀態雙維度狀態流轉(brainstorming Q9-10 拍板)走 use-case + entity method;
 * repo 介面只負責 persist + 查詢、不直接出現狀態流轉方法(對比反例:`markPaid`)。
 *
 * 實作:M-3-04 Medusa cart/order adapter;
 * `listByStatus` 在 M-4a-08 admin 訂單列表用。
 */
export interface IOrderRepository {
  findById(id: OrderId): Promise<Order | null>;
  save(order: Order): Promise<Order>;
  /** TODO M-4a-08: 補分頁 + 排序 — admin 訂單列表用 */
  listByCustomer(customerId: CustomerId): Promise<Order[]>;
  /** TODO M-4a-08: 補分頁 + 排序 — admin 訂單列表用 */
  listByStatus(filter: OrderStatusFilter): Promise<Order[]>;

  // TODO M-4a-XX: 補 listByDateRange — 月結統計用
}
