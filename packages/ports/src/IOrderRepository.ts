import type {
  Money,
  Order,
  OrderId,
  OrderListItem,
  OrderStatusFilter,
  AdminOrderDetail,
  AdminOrderFilter,
  AdminOrderSummary,
  Paginated,
  PaginationParams,
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
   * 單價 / 小計 / 運費 / total / 快照 / 防撞 / 下架檢查全在 RPC server 端算(🔴 #214a:缺貨改快照不擋);回 `{orderId, displayId}`
   * (🔴 鐵則 12:零價結構回傳)。
   *
   * (取代舊 `save(order: Order)`:save 收完整 Order 含 client 可塞的自算金額 = 違反 server 價權威;
   *  建單改走薄 `placeOrder(input)`。狀態流轉 method〔unpaid→paid 等〕留 M-3 confirm-payment〔階段②〕
   *  依 RPC 契約定窄型別。)
   */
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;

  /**
   * 付款編排窄讀(M-3 ②-③c-1、plan v6 §4):回該單 `orders.total`(server read-back、
   * 🔴 鐵則 12 單一金額來源 —— 同時餵 charge amount 與 confirm p_amount、client 永不送價)。
   *
   * RLS own-only:查無 / 非本人 → `null`(caller fail-closed 拒、不 throw);整數元位 → Money、
   * 零浮點。**限付款編排用**(完整訂單讀路徑仍延 stage ③、#217 不受本方法影響)。
   */
  findTotal(id: OrderId): Promise<Money | null>;

  /** 查單筆(RLS own-only;查無回 null 不 throw)。 */
  findById(id: OrderId): Promise<Order | null>;
  /**
   * 列出某會員訂單「摘要」(account OrdersTab / Overview 最近訂單;RLS own-only、created_at desc)。
   *
   * 回 `OrderListItem[]`(摘要投影、不含 items[]):繞過 #217(order_items 無 product_id 無法重建
   * 完整 `Order.items[]`)、列表只需單號 / 日期 / 件數 / 金額 / 狀態。M-3 Sean 拍 Q6=A:與完整
   * `listByCustomer` 分離,後者維持 deferred(待 #217 + 明細頁 slice、本片不啟用)。
   */
  listSummariesByCustomer(customerId: CustomerId): Promise<OrderListItem[]>;
  /** 列出某會員訂單(完整 Order)。⚠️ deferred:待 #217(order_items 無 product_id);M-3 不啟用、用 listSummariesByCustomer。TODO M-4a-08: 補分頁 + 排序。 */
  listByCustomer(customerId: CustomerId): Promise<Order[]>;
  /** admin 訂單列表(雙軸狀態篩選,完整 Order)。⚠️ deferred stub(撞 #217、同 listByCustomer);後台列表改走 `listOrderSummariesForAdmin` 摘要投影。 */
  listByStatus(filter: OrderStatusFilter): Promise<Order[]>;

  /**
   * admin 訂單列表「摘要」(M-4a 訂單線第一片;後台營運找單 / 看狀態)。
   *
   * 回 `Paginated<AdminOrderSummary>`(摘要投影、不含 items[]):繞過 #217、比照 `listByCustomer` vs
   * `listSummariesByCustomer` 分離先例 —— **新增** admin 專用摘要方法、不動既有 `listByStatus` stub /
   * `listByCustomer` / `listSummariesByCustomer`(會員側零影響)。
   *
   * - service_role 全表(非 RLS own-only);雙軸 + 次要篩選走 DB where 下推(payment/fulfillment/source/channel);
   * - server 端分頁(`.range(offset, offset+limit-1)`)+ 排序 created_at DESC(新到舊)+ 總筆數 count;
   * - 🔴 鐵則 12:投影具名白名單、零成本欄、禁 `select('*')`(orders 表本身無成本欄、天生守,白名單守慣例縱深)。
   */
  listOrderSummariesForAdmin(
    filter: AdminOrderFilter,
    pagination: PaginationParams,
  ): Promise<Paginated<AdminOrderSummary>>;

  /**
   * admin 訂單明細(M-4a Slice B;/orders/[id] 明細頁)。
   *
   * 回 `AdminOrderDetail` **讀模型投影**(非 domain `Order` 重建 → 繞過 #217,同摘要方法先例;
   * `findById` deferred stub 不動)。查無 → null(caller 404、不 throw)。
   *
   * 🔴 PII 邊界:明細才攜客人姓名/電話/email+收件快照(service_role、`ADMIN_ORDER_DETAIL_SELECT`
   * 另立具名白名單);🔴 鐵則 12:仍零成本/經銷價欄、零 tappay_rec_trade_id。
   */
  findAdminOrderDetail(id: OrderId): Promise<AdminOrderDetail | null>;

  // TODO M-4a-XX: 補 listByDateRange — 月結統計用
}
