import type {
  Order,
  OrderId,
  OrderStatusFilter,
  CustomerId,
  PlaceOrderInput,
  PlaceOrderResult,
} from '@pcm/domain';

/**
 * IOrderRepository: 訂單建立(寫)+ 查詢(讀)port。
 *
 * 對齊 ADR-0003 §3.3。雙軸 8 狀態流轉(brainstorming Q9-10 拍板)走 use-case + entity method;
 * repo 介面只負責「建單 + 查詢」、不直接出現狀態流轉方法(對比反例:`markPaid`)。
 *
 * 實作:M-3-S2-b2 `SupabaseOrderAdapter` —— 建單走 `create_order` SECURITY DEFINER RPC
 * (server 權威算價 / 歸屬以 `auth.uid()` 重查 / client 永不送價·tier / 零 service_role);
 * 讀走 orders / order_items RLS own-only 投影 + `assertOrderInvariant` 防 DB 腐壞。
 * (去 Medusa:舊 docstring「M-3-04 Medusa cart/order adapter」wire 字面作廢,對齊
 *  `ports/index.ts` 鐵則「介面字面只出現 domain 命名、不 leak wire 字串」。)
 */
export interface IOrderRepository {
  /**
   * 建單(寫路徑):走 `create_order` SECURITY DEFINER RPC、server 權威。
   *
   * client 只送 lines(variant + qty)+ addressId + shippingMethod + invoice、**永不送價 / tier / userId**;
   * 單價 / 小計 / 運費 / total / 快照 / 防撞 / 下架·缺貨檢查全在 RPC server 端算;回 `{orderId, displayId}`
   * (🔴 鐵則 12:零價結構回傳)。
   *
   * (取代舊 `save(order: Order)`:save 收完整 Order 含 client 可塞的自算金額 = 違反 server 價權威;
   *  建單改走薄 `placeOrder(input)`。狀態流轉 method〔unpaid→paid 等〕留 M-3 confirm-payment〔階段②〕
   *  依 RPC 契約定窄型別。)
   */
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;

  /** 查單筆(RLS own-only;查無回 null 不 throw)。 */
  findById(id: OrderId): Promise<Order | null>;
  /** 列出某會員訂單。TODO M-4a-08: 補分頁 + 排序。 */
  listByCustomer(customerId: CustomerId): Promise<Order[]>;
  /** admin 訂單列表(雙軸狀態篩選)。TODO M-4a-08: 補分頁 + 排序。 */
  listByStatus(filter: OrderStatusFilter): Promise<Order[]>;

  // TODO M-4a-XX: 補 listByDateRange — 月結統計用
}
