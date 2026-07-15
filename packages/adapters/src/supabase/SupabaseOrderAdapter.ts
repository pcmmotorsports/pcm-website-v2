import type { SupabaseClient } from '@supabase/supabase-js';
import type { IOrderRepository } from '@pcm/ports';
import type {
  CustomerId,
  Money,
  Order,
  OrderListItem,
  PlaceOrderInput,
  PlaceOrderResult,
  AdminOrderDetail,
  AdminOrderFilter,
  AdminOrderSummary,
  AdminOrderWorkflowPatch,
  AdminOrderWorkflowResult,
  Paginated,
  PaginationParams,
} from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import type { Database, Json } from './database.types';
import {
  mapPlaceOrderToCreateOrderArgs,
  mapSupabaseOrderRowToListItem,
  mapSupabaseAdminOrderRowToSummary,
  mapSupabaseAdminOrderDetailRowToDetail,
  type CreateOrderRpcResult,
  type SupabaseAdminOrderRow,
  type SupabaseAdminOrderDetailRow,
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
 * admin orders 列表投影白名單(M-4a 訂單線;後台 /orders「每商品一列」列表;service_role 全表)。
 *
 * 🔴 鐵則 12:具名白名單、**禁** `select('*')`。
 * - orders 層:客人顯示 `customers(name)` + `tier_at_checkout`(會員等級;M-4a Slice D-1a 起投影)。
 * - 品項層:內嵌 `order_items(variant_sku, quantity, unit_price, line_total, product_snapshot, …)`——
 *   `unit_price`/`line_total` = 該單**成交價**(下單實際賣價、非經銷價表,同明細投影先例);
 *   `product_snapshot` 供品名 title(mapper 防禦容缺)。
 * - brand join:`product_variants(products(brands(name)))`——🔴 穿越帶 `price_store`/`price_by_tier` 的
 *   product_variants/products,但**只取 `brands.name`**;forbidden-token 測試守 price_store/price_by_tier/cost
 *   永不入投影 = 縱深防線。
 * 🔴 tier_at_checkout / 成交價由 forbidden 移 allowed = **有意識鬆綁**(依據 docs/specs/2026-07-15-m4a-
 *   order-list-redesign-slice-d-plan.md §0 經銷價護欄①;admin server-render、SSO 閘後、絕不進非 admin client bundle);
 *   SupabaseOrderAdapter.test.ts 同步改 byte-equal 快照 + 保留真禁 token 斷言。
 * - M-4a D-2:orders 層 workflow_status / version **退出投影**(per-item 真相移 order_items;
 *   orders.workflow_status 停寫停讀、整單狀態=顯示端彙總);order_items 內嵌加 `id, workflow_status,
 *   version`(per-item 改狀態表單 target + 樂觀鎖)。
 * module-level `export const` → 測試 byte-equal + forbidden-token + spy 守門。
 */
export const ADMIN_ORDER_LIST_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, total, order_source, payment_channel, display_position, cancelled_at, tier_at_checkout, customers(name), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, workflow_status, version, product_variants(products(brands(name))))';

/**
 * admin orders 列表投影 — **item 狀態篩選版**(M-4a D-2;僅 `filter.workflowStatus` 有值時使用)。
 *
 * 與 `ADMIN_ORDER_LIST_SELECT` **唯一差異** = `order_items!inner(...)`:PostgREST 對內嵌資源的
 * filter(`.eq('order_items.workflow_status', code)` / `.is(..., null)`)只濾內嵌列、父列仍全回;
 * `!inner` 讓「無任何品項命中」的訂單整列消失 = 篩選語意「該單至少一品項為此狀態、且只顯示命中品項列」。
 * 🔴 orders.workflow_status 停寫(D-2)→ 篩選**必須**走 item 層,打舊欄=篩到 stale 值。
 * 🔴 鐵則 12 白名單與主常數逐欄相同(測試 byte-equal 斷言兩常數僅差 `!inner`)。
 */
export const ADMIN_ORDER_LIST_SELECT_ITEM_STATUS_FILTERED = ADMIN_ORDER_LIST_SELECT.replace(
  'order_items(',
  'order_items!inner(',
);

/**
 * admin 訂單「明細」投影白名單(M-4a Slice B、後台 /orders/[id] 明細頁;service_role 全表)。
 *
 * 🔴 PII 邊界(設計檔 2026-07-13):明細**才**攜 customers(name, email, phone)+
 * shipping_address_snapshot(收件姓名/電話/地址)+ invoice(結帳開票需求)——列表投影
 * `ADMIN_ORDER_LIST_SELECT` 維持精簡零 PII、兩白名單**刻意分立**。
 * 🔴 鐵則 12:**仍禁** `select('*')`、零成本欄(price_store / price_by_tier / cost)、
 * **零 tappay_rec_trade_id**(金流對帳識別碼不進顯示層)、零 cart_session_id / address_id /
 * tier_at_checkout。order_items 內嵌成交價欄(unit_price / line_total)=該單實際賣價、非經銷價表;
 * product_snapshot = create_order 寫入的 {sku, spec, title}、無價格欄(mapper 防禦容缺)。
 * module-level `export const` → SupabaseOrderAdapter.test.ts byte-equal + forbidden-token 守門。
 */
export const ADMIN_ORDER_DETAIL_SELECT =
  'id, display_id, created_at, payment_status, fulfillment_status, order_source, payment_channel, payment_method, paid_at, subtotal, shipping_fee, discount_total, total, shipping_method, shipping_address_snapshot, invoice, invoice_number, invoice_amount, invoice_status, cancelled_at, cancelled_reason, version, customers(name, email, phone), order_items(id, variant_sku, quantity, unit_price, line_total, product_snapshot, workflow_status, version)';

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
   * - 投影 `ADMIN_ORDER_LIST_SELECT` 具名白名單(禁 `select('*')`;內嵌 customers(name) + tier_at_checkout(會員等級)
   *   + order_items 成交價/品名 + brand join〔穿越 product_variants/products 只取 brands(name)、經銷價成本欄零投影,
   *   縱深防線見 const docstring〕;M-4a Slice D-1a「每商品一列」);
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

    // workflow 篩選(M-4a D-2 起走 **item 層**):orders.workflow_status 停寫=stale、絕不再打;
    // 有篩 → `order_items!inner` 版投影(無命中品項的訂單整列消失、命中品項才顯示),
    // filter 打內嵌欄 `order_items.workflow_status`。undefined=不篩 / null=未設定(IS NULL)/ code。
    const itemStatusFilter = filter.workflowStatus; // local 供 TS narrowing(undefined=不篩)
    let query = this.supabase
      .from('orders')
      .select(
        itemStatusFilter !== undefined
          ? ADMIN_ORDER_LIST_SELECT_ITEM_STATUS_FILTERED
          : ADMIN_ORDER_LIST_SELECT,
        { count: 'exact' },
      );
    if (filter.paymentStatus) query = query.eq('payment_status', filter.paymentStatus);
    if (filter.fulfillmentStatus) query = query.eq('fulfillment_status', filter.fulfillmentStatus);
    if (filter.orderSource) query = query.eq('order_source', filter.orderSource);
    if (filter.paymentChannel) query = query.eq('payment_channel', filter.paymentChannel);
    if (itemStatusFilter !== undefined) {
      query =
        itemStatusFilter === null
          ? query.is('order_items.workflow_status', null)
          : query.eq('order_items.workflow_status', itemStatusFilter);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false }) // 次鍵防同秒單分頁跨頁重複/漏單(Fable D-2 verdict n1)
      .range(offset, offset + pagination.limit - 1);
    if (error) {
      throw error;
    }
    const items = (data as unknown as SupabaseAdminOrderRow[]).map(
      mapSupabaseAdminOrderRowToSummary,
    );
    return { items, total: count ?? 0 };
  }

  /**
   * admin 訂單明細(M-4a Slice B;/orders/[id];service_role 全表、讀模型投影繞 #217)。
   *
   * - 投影 `ADMIN_ORDER_DETAIL_SELECT`(明細專用白名單:含 PII、零成本/經銷/rec_trade_id);
   * - `.maybeSingle()`:查無 → null(caller 404、不 throw);error → 裸 throw(caller 退錯誤態);
   * - embed cast 同 list 慣例(customers many-to-one 生成型別不穩、以 runtime 真相 cast + mapper 正規化)。
   */
  async findAdminOrderDetail(id: string): Promise<AdminOrderDetail | null> {
    const { data, error } = await this.supabase
      .from('orders')
      .select(ADMIN_ORDER_DETAIL_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }
    return mapSupabaseAdminOrderDetailRowToDetail(data as unknown as SupabaseAdminOrderDetailRow);
  }

  /**
   * 後台改單(M-4a Slice C;走 admin_update_order_workflow owner RPC)。
   *
   * 🔴 patch → jsonb wire:**只放呼叫端明確提供的 key**(未提供 = 省略 = RPC 端「不動該欄」;
   * 明給 null = 清空)。逐欄顯式建構(同 mapPlaceOrderToCreateOrderArgs 白名單縱深),
   * 即使 patch 帶意外欄也不洩到 RPC。金流欄型別層已無,此處 wire 再縱深。
   *
   * RPC 回文字碼 'UPDATED'/'CONFLICT'/'NOOP';error(輸入非法 / DB)→ 裸 throw
   * (caller server action 收斂成固定錯誤碼、不外洩 DB error 到瀏覽器)。
   */
  async updateAdminOrderWorkflow(
    id: string,
    expectedVersion: number,
    patch: AdminOrderWorkflowPatch,
    actor: string,
    requestId: string,
  ): Promise<AdminOrderWorkflowResult> {
    // 逐欄:key 存在且值非 undefined 才進 wire(null=清空、透傳);undefined=視同未提供、不進 wire。
    // 🔴 D-2:workflow_status 不再映射(型別層已無;orders 層停寫、狀態唯一寫入面=item 層 RPC)。
    const p: Record<string, string | number | null> = {};
    if ('shippingMethod' in patch && patch.shippingMethod !== undefined) {
      p.shipping_method = patch.shippingMethod;
    }
    if ('invoiceNumber' in patch && patch.invoiceNumber !== undefined) {
      p.invoice_number = patch.invoiceNumber;
    }
    if ('invoiceAmount' in patch && patch.invoiceAmount !== undefined) {
      p.invoice_amount = patch.invoiceAmount;
    }
    if ('invoiceStatus' in patch && patch.invoiceStatus !== undefined) {
      p.invoice_status = patch.invoiceStatus;
    }

    const { data, error } = await this.supabase.rpc('admin_update_order_workflow', {
      p_order_id: id,
      p_expected_version: expectedVersion,
      p_patch: p as Json,
      p_actor: actor,
      p_request_id: requestId,
    });
    if (error) {
      throw error;
    }
    // RPC RETURNS text scalar → data 即 'UPDATED'/'CONFLICT'/'NOOP';防腐壞收斂。
    if (data === 'UPDATED' || data === 'CONFLICT' || data === 'NOOP') {
      return data;
    }
    throw new Error('admin_update_order_workflow RPC 回傳非預期碼');
  }

  /**
   * 後台 per-item 改狀態(M-4a Slice D-2;走 admin_update_order_item_workflow owner RPC、鏡像 Slice C)。
   *
   * 🔴 wire 縱深:patch jsonb **只**建 `workflow_status` 單鍵(RPC 端白名單亦僅此鍵;
   * 品項凍結欄 quantity/unit_price/line_total/variant_* 型別層+wire 層+RPC 白名單三層皆無路可進)。
   * null=清空(回未設定)、code=設定(RPC 端驗 is_active)。
   * 回 'UPDATED'/'CONFLICT'/'NOOP';error → 裸 throw(caller server action 收斂固定碼)。
   */
  async updateAdminOrderItemWorkflow(
    itemId: string,
    expectedVersion: number,
    workflowStatus: string | null,
    actor: string,
    requestId: string,
  ): Promise<AdminOrderWorkflowResult> {
    const { data, error } = await this.supabase.rpc('admin_update_order_item_workflow', {
      p_item_id: itemId,
      p_expected_version: expectedVersion,
      p_patch: { workflow_status: workflowStatus } as Json,
      p_actor: actor,
      p_request_id: requestId,
    });
    if (error) {
      throw error;
    }
    if (data === 'UPDATED' || data === 'CONFLICT' || data === 'NOOP') {
      return data;
    }
    throw new Error('admin_update_order_item_workflow RPC 回傳非預期碼');
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
