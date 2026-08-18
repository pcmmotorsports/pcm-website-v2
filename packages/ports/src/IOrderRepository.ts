import type {
  Money,
  Order,
  OrderId,
  OrderListItem,
  OrderStatusFilter,
  AdminOrderDetail,
  AdminOrderFilter,
  AdminOrderListResult,
  AdminOrderSummary,
  AdminOrderWorkflowPatch,
  AdminOrderWorkflowResult,
  AdminOrderItemAmountPatch,
  AdminOrderItemAmountResult,
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

  /**
   * 查單筆(RLS own-only;查無回 null 不 throw)。
   *
   * 🔴 **deferred stub,而且是【刻意不提供】,不是「待 #217」**(2026-08-18 `#217` 裁定 D):
   * 訂單明細一律走**唯讀投影**,同 `listSummariesByCustomer`(清單)與 `AdminOrderDetail`(後台明細)——
   * 後者**沒有 `productId` 而後台明細頁一直是好的** ⇒ 畫一張明細不需要重建 domain `Order`。
   * ⚠️ **若日後真的需要 domain `Order`,對的解是【`order_items` 加 `product_id` 欄】(`#217` B),
   *    不是把 `OrderItem.productId` 改成選填(`#217` A)** —— A 等於為了這條沒有呼叫端的讀路徑,
   *    去弱化 `domain/order/order.ts` 那道還在用的**寫路徑** `typeof` loud-reject。
   */
  findById(id: OrderId): Promise<Order | null>;
  /**
   * 列出某會員訂單「摘要」(account OrdersTab / Overview 最近訂單;RLS own-only、created_at desc)。
   *
   * 回 `OrderListItem[]`(摘要投影、不含 items[]):繞過 #217(order_items 無 product_id 無法重建
   * 完整 `Order.items[]`)、列表只需單號 / 日期 / 件數 / 金額 / 狀態。M-3 Sean 拍 Q6=A:與完整
   * `listByCustomer` 分離,後者維持 deferred(2026-08-18 `#217` 裁定 D ⇒ **刻意不提供**,見 `findById` 的註解)。
   */
  listSummariesByCustomer(customerId: CustomerId): Promise<OrderListItem[]>;
  /** 列出某會員訂單(完整 Order)。⚠️ deferred stub、**刻意不提供**(2026-08-18 `#217` 裁定 D,理由見 `findById`);用 `listSummariesByCustomer`。 */
  listByCustomer(customerId: CustomerId): Promise<Order[]>;
  /** admin 訂單列表(雙軸狀態篩選,完整 Order)。⚠️ deferred stub、**刻意不提供**(同 `listByCustomer`,`#217` 裁定 D);後台列表走 `listOrderSummariesForAdmin` 摘要投影。 */
  listByStatus(filter: OrderStatusFilter): Promise<Order[]>;

  /**
   * admin 訂單列表「摘要」(M-4a 訂單線第一片;後台營運找單 / 看狀態)。
   *
   * 回 `Paginated<AdminOrderSummary>`(M-4a Slice D-1a 起每商品一列、攜 `lines[]` 品項展開 + tier + brand join):繞過 #217、比照 `listByCustomer` vs
   * `listSummariesByCustomer` 分離先例 —— **新增** admin 專用摘要方法、不動既有 `listByStatus` stub /
   * `listByCustomer` / `listSummariesByCustomer`(會員側零影響)。
   *
   * - service_role 全表(非 RLS own-only);雙軸 + 次要篩選走 DB where 下推(payment/fulfillment/source/channel);
   * - server 端分頁(`.range(offset, offset+limit-1)`)+ 排序 created_at DESC(新到舊)+ 總筆數 count;
   * - 🔴 鐵則 12:投影具名白名單、零成本欄、禁 `select('*')`(orders 表本身無成本欄、天生守,白名單守慣例縱深)。
   *
   * 🔴 **回傳是 {@link AdminOrderListResult}、不是裸 `Paginated`**(M-4b #347-2a):關鍵字搜尋多帶**三個**
   * 訊號 —— `keywordTruncated`(命中超過上限、只回前 100)、`keywordMatchCount`(非 PII 的命中計數),
   * 以及 `supplierOrderNoMatchedSuppliers`(#338:供應商單號命中了哪幾家)。
   * 三者都是**必填**:adapter 的每一條 return 路徑都必須明確表態,
   * 不能讓「忘了填」變成合法寫法 —— 那正好等於靜默截斷。語意全文見該型別的 docstring。
   *
   * 🔴🔴 **`supplierOrderNoMatchedSuppliers` 本片起恆 `null`,producer 待片 B-2**
   *    (#347-B;Sean 拍板 Q-347-B1=B 收掉兩個專用搜尋欄 + Q-347-B2=C 供應商能力挪片 B-2 重建)。
   *    它的唯一 producer 是 adapter 的供應商單號兩段式探測,已隨那兩個欄一起退場。
   *    **契約本身刻意不動** —— 片 B-2 要接回來的就是這一欄,刪掉再加回是白工。
   *    ⚠️ 在那之前,拿本欄推導任何事情都會得到「一律沒有」;消費端請依值自己的形狀分支。
   *
   * ⚠️ return 路徑條數:原本 **7 條**(6 早退 + 1 正常)。#347-B 拿掉訂單編號與供應商單號兩個
   *    維度之後,它們各自的 fail-closed 早退與零命中早退一併消失 ⇒ **條數已變**,
   *    要引用請現數 `SupabaseOrderAdapter.listOrderSummariesForAdmin` 的 `return`,不要照抄這行。
   *    不變的是分類:「正規化就判定不可能有結果」那類 `keywordMatchCount` 必為 `null`,
   *    「查過了但零筆」那類必須帶真實計數。**兩者不可混用**。
   */
  listOrderSummariesForAdmin(
    filter: AdminOrderFilter,
    pagination: PaginationParams,
  ): Promise<AdminOrderListResult>;

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

  /**
   * 後台改單(M-4a Slice C;D-2 起 admin 路徑只映射 shipping_method / 發票紀錄三欄=4 欄,
   * workflow_status 的 item 層寫入面已於 A9w4c 後半移除(見下方註);order 層 RPC 白名單已收窄
   * =送該 key 即 RAISE、20260716130000 §4)。
   *
   * 🔴 走 owner SECURITY DEFINER RPC `admin_update_order_workflow`(orders 對 service_role 已 REVOKE
   * 直寫〔20260611120000 §4〕→ 唯一寫入車道):RPC 內鎖列 + 樂觀鎖 `version=expectedVersion` +
   * 讀 before → UPDATE(SET 字面恰 4 業務欄+version+updated_at、🔴 金流欄一律不動)→ 同交易寫 admin_audit_log。
   *
   * - `patch` 語意見 `AdminOrderWorkflowPatch`(未提供 ≠ 清空);`actor`/`requestId` 由 server session
   *   /correlation 提供(client 不可信、RPC 端亦驗非空);
   * - 回 `'UPDATED'`(成功)/ `'CONFLICT'`(版本不符或查無 → UI 重載)/ `'NOOP'`(空 patch 或無實際差異);
   * - RPC 端輸入非法(未知 code / 金流欄 key / 越界)→ throw(caller 收斂成固定錯誤碼、不外洩 DB error)。
   */
  updateAdminOrderWorkflow(
    id: OrderId,
    expectedVersion: number,
    patch: AdminOrderWorkflowPatch,
    actor: string,
    requestId: string,
  ): Promise<AdminOrderWorkflowResult>;

  /**
   * 後台改品項金額(M-4b E10 `#13` 片1b;`/orders/[id]` 明細頁「改金額」)。
   *
   * 🔴 走 owner SECURITY DEFINER RPC `admin_update_order_item_amount`
   * (`supabase/migrations/20260815040000_m4b_e10_13_slice1_admin_update_order_item_amount.sql`,
   * 2026-08-15 已 apply 正式庫):RPC 內鎖列 + 樂觀鎖 `version = expectedVersion` →
   * 改 `order_items.unit_price` / `line_total` → 重算 `orders.subtotal` / `total` →
   * 同交易寫 admin_audit_log。
   *
   * 🔴🔴 **跨表金額不變式由兩支 `DEFERRABLE INITIALLY DEFERRED` constraint trigger 在 COMMIT 時守**
   * (同片 migration):`orders.subtotal` 必須等於該單 `order_items.line_total` 的總和。
   * ⇒ 本方法**不是唯一寫入者**這件事已被 DB 端接手,應用層不得自己另算一份金額補寫。
   *
   * - `patch` 三欄全必填,語意見 {@link AdminOrderItemAmountPatch}
   *   (🔴 `zeroPriceReason` 必須明確表態:0 元必填原因、非 0 元必須送 null);
   * - `actor` / `requestId` 由 server session / correlation 提供(client 不可信、RPC 端亦驗非空);
   * - 回傳碼**恰三個**,逐字對 RPC 的三條 `RETURN`(不是從語意推的):
   *   `'OK'` 寫入成功(`:482`)/ `'CONFLICT'` **只有** `version <> expectedVersion` 這一種(`:382-383`)
   *   / `'NOOP'` 新單價與現值相同(`:414-416`,不 bump version、不寫稽核)。
   *   🔴 成功碼是 `'OK'` 不是 `'UPDATED'`,與 {@link updateAdminOrderWorkflow} 刻意不同字面。
   * - 🔴 **其餘每一種失敗都是 `RAISE EXCEPTION` ⇒ adapter `throw`,不是回傳碼。**
   *   逐條(RPC 行號):缺 actor / requestId / orderId / orderItemId / expectedVersion(`:349-357`)、
   *   expectedVersion 越界(`:358`)、unitPrice 為 NULL 或負(`:361`)、
   *   0 元未附原因(`:366`)、非 0 元卻帶原因(`:371`)、
   *   **訂單查無(`:379`)**、已有任何一列收款(`:388`)、該單有折扣(`:398`)、
   *   **品項查無(`:407`)**、**品項不屬於這張訂單(`:410`)**、
   *   line_total 溢位(`:422`)、改後 total 為負(`:436`)、subtotal/total 溢位(`:440`)、
   *   更新列數異常(`:452`)。
   *   (caller server action 收斂成固定錯誤碼、不外洩 DB error 到瀏覽器。)
   * 🔴 **2026-08-15 codex 關卡2 R1 must-fix 的修法**:原本這裡寫「`CONFLICT`(版本不符**或訂單查無**)」
   *   而查無實際上是 throw ⇒ **docstring 說的事情 code 不做**。同族已一併掃過:
   *   上面那條 throw 清單原本只寫「輸入非法 / 已收過款 / 溢位 / 改後總額為負」四類,
   *   **漏了折扣閘、品項查無、品項不屬於本單、訂單查無** ⇒ 已改成逐條列舉 + 行號。
   *
   * ⚠️ **本片(1b)只鋪管線** —— server action 與 UI 在 1c/1d,尚無 consumer。
   */
  updateAdminOrderItemAmount(
    id: OrderId,
    expectedVersion: number,
    patch: AdminOrderItemAmountPatch,
    actor: string,
    requestId: string,
  ): Promise<AdminOrderItemAmountResult>;

  // 🔴 **`updateAdminOrderItemWorkflow` 已於 A9w4c 後半(2026-08-06)具名移除** ——
  //    九碼 writer 鏈退場的最後一段應用層契約。前置:A9w4a 拆了 server action、A11a 列表重建完成
  //    ⇒ 本 port 方法零 consumer。
  //    ⚠️ **正確讀法 = 「admin 應用層與 port/adapter 都沒有 item workflow 寫入介面」,不是
  //    「九碼寫不進去」**:DB 端 `admin_update_order_item_workflow` RPC 仍在(**REVOKE 非 DROP**),
  //    其 EXECUTE 權由 **A9v `20260807120000`** 撤除(apply 後生效),
  //    撤權歸 **A9v**(前置=A11b/c 等全 consumer 清零)。

  // TODO M-4a-XX: 補 listByDateRange — 月結統計用
}
