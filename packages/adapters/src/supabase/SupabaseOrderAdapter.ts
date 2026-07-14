import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderRepository } from '@pcm/ports';
import type {
  CustomerId,
  Money,
  Order,
  OrderListItem,
  PlaceOrderInput,
  PlaceOrderResult,
  AdminOrderFilter,
  AdminOrderSummary,
  Paginated,
  PaginationParams,
} from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import type { Database } from './database.types';
import {
  mapPlaceOrderToCreateOrderArgs,
  mapSupabaseOrderRowToListItem,
  mapSupabaseAdminOrderRowToSummary,
  type CreateOrderRpcResult,
  type SupabaseAdminOrderRow,
} from './mappers/order';

/**
 * orders 摘要投影白名單(account OrdersTab / Overview 最近訂單)。
 *
 * 🔴 鐵則 12:**只**摘要欄 + 內嵌 `order_items(quantity)`(只算件數);**禁** unit_price / line_total /
 * product_snapshot / 經銷價 / PII(shipping_address_snapshot / invoice / tappay_rec_trade_id / tier_at_checkout)。
 * module-level `export const` → SupabaseOrderAdapter.test.ts byte-equal + spy 守門(codex C1/N2)。
 */
export const ORDER_LIST_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, total, order_items(quantity)';

/**
 * admin orders 摘要投影白名單(M-4a 訂單線第一片、後台 /orders 列表;service_role 全表)。
 *
 * 🔴 鐵則 12:具名白名單 + 內嵌 `customers(name)`(客人顯示);**禁** `select('*')`、**零**成本欄
 * (orders 表本身無 price_store / price_by_tier / cost、天生守;白名單守慣例縱深、防未來加欄靜默洩漏)、
 * **不含** unit_price / line_total / product_snapshot / tappay_rec_trade_id / invoice / shipping_address_snapshot / tier_at_checkout。
 * module-level `export const` → SupabaseOrderAdapter.test.ts byte-equal + 無成本欄名 + 無 `*` + spy 守門。
 */
export const ADMIN_ORDER_LIST_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, workflow_status, total, order_source, payment_channel, display_position, cancelled_at, customers(name)';

/**
 * SupabaseOrderAdapter:Supabase 真實 IOrderRepository 實作(M-3-S2-b2-b2)。
 *
 * **單一 authenticated client + 建單走 RPC(零 service_role)**:
 * - 建單 `placeOrder` 呼 `create_order` SECURITY DEFINER RPC(migration 20260604130000):
 *   authenticated 對 orders/order_items 僅 SELECT、無直接 INSERT → 建單只能走本 RPC;
 *   價 / 運費 / tier / 歸屬全 RPC server 端 `auth.uid()` + product_variants 權威算,
 *   client 永不送價 / tier / userId;return DTO 只 `{order_id, display_id}`(🔴 鐵則 12 零價結構)。
 * - **不持 service_role**:client 由 wire-up 層(composition `getOrderRepo`)注入 cookie-aware
 *   request-scoped authenticated client(能讀 session cookie 拿 auth.uid());本 adapter 不建 client。
 *
 * **server-only**:從 `@pcm/adapters` root export(來源 client.ts 頂層 `import 'server-only'` 約束整條
 * chain);鏡像 SupabaseAddressAdapter/Customer/Vehicle(authenticated 零 service_role → root barrel、
 * 非 /server 受控小門〔那是 Wallet service_role / Auth 專用〕)。
 *
 * **讀路徑延 stage ③**:findById / listByCustomer / listByStatus 重建 domain Order 需從 order_items
 * 還原 OrderItem,但 order_items **無 product_id**(只有 variant_id)→ domain OrderItem.productId 必填
 * 無法忠實重建(backlog #217、傾向改 productId optional);故本片讀方法明確 deferred-stub、延 stage ③
 * 訂單查詢(plan §7)。
 *
 * #106:client 注入 `SupabaseClient<Database>` generic、findTotal 欄位 compile 期檢。`.rpc('create_order', args)`
 * 入參走 typed Args(3DS-0b db push 已落地、database.types.ts 已重 gen 5-param、原 db-push-pending 窄 cast 已移、
 * 恢復少鍵 drift 偵測);`data as unknown as CreateOrderRpcResult` **保留**(create_order RPC generated
 * `Returns: Json`、wire 為 narrowed `{order_id, display_id}` DTO、Json→DTO 須 cast;非 type-safety 漏洞、
 * 是 RPC jsonb scalar 邊界的正當投射)。RPC `RETURNS jsonb` scalar → data 即該物件、不需 `.single()`。
 */
export class SupabaseOrderAdapter implements IOrderRepository {
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * 建單:呼 create_order RPC(server 權威)。
   * client 只送 lines(variant+qty)+ addressId + shippingMethod + invoice、永不送價/tier/userId;
   * RPC 錯誤(RAISE / 網路)原樣上拋不吞(對齊既有 adapter 裸 throw 慣例);回 `{orderId, displayId}`。
   */
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    // 3DS-0b:db push 已落地(2026-06-17 整 bundle)、database.types.ts 已重 gen 為 5-param create_order,
    // 故移除原 db-push-pending 窄 cast → mapper 輸出直接賦值 typed Args,恢復「少必填鍵」正向 drift 偵測
    // (mapper 漏鍵 → typecheck 即紅;配 mapper test 鎖輸出恰 5 鍵雙層守門)。
    const { data, error } = await this.supabase.rpc(
      'create_order',
      mapPlaceOrderToCreateOrderArgs(input),
    );
    if (error) {
      throw error;
    }
    const result = data as unknown as CreateOrderRpcResult | null;
    if (
      !result ||
      typeof result.order_id !== 'string' ||
      typeof result.display_id !== 'string'
    ) {
      throw new Error('create_order RPC 回傳格式非預期(缺 order_id / display_id)');
    }
    return { orderId: result.order_id, displayId: result.display_id };
  }

  /**
   * 付款編排窄讀(②-③c-1、plan v6 §4):`select total`(單欄、RLS own-only)→ Money。
   * - 查無 / 非本人(RLS 濾掉)→ null(caller fail-closed 拒付款、不 throw)。
   * - DB `total integer` 元位 → `toMoneyAmount` 中央守門(整數/非負;絕不 `as MoneyAmount`)。
   * - 🔴 鐵則 12:此值為 charge 與 confirm p_amount 的單一金額來源(client 永不送價、零浮點)。
   */
  async findTotal(id: string): Promise<Money | null> {
    const { data, error } = await this.supabase
      .from('orders')
      .select('total')
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw error; // 裸 throw(對齊 placeOrder 慣例);caller(action)吞通用字面
    }
    // #106:typed client → data 為 `{ total: number } | null`,消除舊 `(data as {...}).total` inline cast;
    // typeof number 檢保留(runtime fail-closed 縱深、防 RLS/邊界回非預期)。
    if (!data || typeof data.total !== 'number') {
      return null; // 查無/非本人(RLS)→ fail-closed
    }
    return { amount: toMoneyAmount(data.total), currency: 'TWD' };
  }

  /**
   * 列出某會員訂單摘要(account OrdersTab / Overview 最近訂單;created_at desc 新到舊)。
   *
   * 🔴 鐵則 12 / IDOR 縱深:
   * - RLS `orders_select_own`(auth.uid() = customer_user_id)資料層強制 own-only;
   * - 顯式 `.eq('customer_user_id', customerId)` 應用層歸屬縱深(任一層失效另一層仍擋);
   * - 走注入的 authenticated/RLS client(零 service_role);
   * - 投影 `ORDER_LIST_SELECT` 白名單 + 內嵌 `order_items(quantity)`(只算件數、零價格/PII 欄)。
   * - **隱藏 unpaid 孤兒單(#249 治標)**:`.neq('payment_status','unpaid')` 濾掉客人放棄付款後停留
   *   unpaid 的孤兒單(對齊 Shopify 客人端:未付成不進訂單列表);orderCount(account/page 同源 `orders.length`)天然跟著對齊。
   *   ⚠️ 前提=絕大多數 unpaid 皆「沒付成的孤兒」(PCM 現僅 TapPay 即時刷卡、無線下待付款單);未來加線下付款方式須重審。
   *   ⚠️ 已知短暫窗:3DS 付成後到 settleCharge 翻 paid 之間,在途單短暫仍 unpaid 會被暫藏、對帳收斂(秒~分鐘)後自然顯示 —— 顯示層治標的可接受延遲、非孤兒、非本改引入的回歸。
   *   治本(reuse / 學 Shopify 付成才建單)見 backlog #249。
   * 繞過 #217(摘要不含 items[])。error → throw(對齊 placeOrder/findTotal 慣例;caller try/catch 退空陣列、頁面不 500)。
   */
  async listSummariesByCustomer(customerId: CustomerId): Promise<OrderListItem[]> {
    const { data, error } = await this.supabase
      .from('orders')
      .select(ORDER_LIST_SELECT)
      .eq('customer_user_id', customerId)
      .neq('payment_status', 'unpaid') // #249 治標:藏放棄付款的 unpaid 孤兒單(前提=無線下待付款單)
      .order('created_at', { ascending: false });
    if (error) {
      throw error;
    }
    return data.map(mapSupabaseOrderRowToListItem);
  }

  /**
   * admin 訂單列表摘要(M-4a 訂單線第一片;後台營運找單 / 看狀態;service_role 全表、非 RLS own-only)。
   *
   * - 投影 `ADMIN_ORDER_LIST_SELECT` 具名白名單(禁 `select('*')`、零成本欄、內嵌 customers(name));
   * - 雙軸 + 次要篩選走 **DB where 下推**(payment_status / fulfillment_status / order_source / payment_channel、
   *   缺欄 = 不限;全在 FilterBuilder 階段套用、避免 order/range 後改鏈型別);
   * - **server 端分頁** `.range(offset, offset+limit-1)`(offset 預設 0)+ 排序 `created_at` DESC(新到舊)+
   *   `count: 'exact'` 取符合條件總筆數(供 UI「共 N 筆」+ 分頁控制);
   * - error → 裸 throw(對齊 placeOrder / listSummariesByCustomer 慣例;caller〔admin 頁〕try/catch 退錯誤態、頁面不 500)。
   *
   * 🔴 鐵則 12:service_role 讀 orders 已於 20260611120000「admin 唯讀」保留 SELECT;orders 表無成本欄(天生守)+
   * 白名單投影縱深。data 走 `as unknown as SupabaseAdminOrderRow[]`(customers forward FK = many-to-one 單物件、
   * 生成型別對 embed 推斷不穩,以 runtime 真相 cast、同 SupabaseProductAdapter 慣例)。
   */
  async listOrderSummariesForAdmin(
    filter: AdminOrderFilter,
    pagination: PaginationParams,
  ): Promise<Paginated<AdminOrderSummary>> {
    const offset = pagination.offset ?? 0;

    let query = this.supabase
      .from('orders')
      .select(ADMIN_ORDER_LIST_SELECT, { count: 'exact' });
    if (filter.paymentStatus) query = query.eq('payment_status', filter.paymentStatus);
    if (filter.fulfillmentStatus) query = query.eq('fulfillment_status', filter.fulfillmentStatus);
    if (filter.orderSource) query = query.eq('order_source', filter.orderSource);
    if (filter.paymentChannel) query = query.eq('payment_channel', filter.paymentChannel);
    // workflow_status 三態(M-4a Slice A):undefined=不篩 / null=只看未設定(IS NULL)/ string=指定 code。
    // 用 `!== undefined` 判別(truthy 判別會把 null 吞成不篩);對齊 AdminOrderFilter docstring。
    if (filter.workflowStatus !== undefined) {
      query =
        filter.workflowStatus === null
          ? query.is('workflow_status', null)
          : query.eq('workflow_status', filter.workflowStatus);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + pagination.limit - 1);
    if (error) {
      throw error;
    }
    const items = (data as unknown as SupabaseAdminOrderRow[]).map(
      mapSupabaseAdminOrderRowToSummary,
    );
    return { items, total: count ?? 0 };
  }

  // ── 讀路徑(完整 Order):延 stage ③ 訂單查詢(deferred-stub、Q6=A 本片不啟用)──
  // order_items 無 product_id → domain OrderItem.productId 無法忠實重建(backlog #217);
  // stage ③ 開工前拍 #217 解法(傾向 domain OrderItem.productId 改 optional)後再實作重建 mapper。
  findById(): Promise<Order | null> {
    return Promise.reject(
      new Error(
        'SupabaseOrderAdapter.findById 未實作:訂單讀路徑延 stage ③ 訂單查詢(backlog #217、order_items 無 product_id)',
      ),
    );
  }

  listByCustomer(): Promise<Order[]> {
    return Promise.reject(
      new Error(
        'SupabaseOrderAdapter.listByCustomer 未實作:訂單讀路徑延 stage ③ 訂單查詢(backlog #217)',
      ),
    );
  }

  listByStatus(): Promise<Order[]> {
    return Promise.reject(
      new Error('SupabaseOrderAdapter.listByStatus 未實作:admin 訂單列表延 M-4a-08'),
    );
  }
}
