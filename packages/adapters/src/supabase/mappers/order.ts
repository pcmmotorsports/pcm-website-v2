import type {
  OrderListItem,
  PlaceOrderInput,
  PlaceOrderLine,
  PlaceOrderVehicle,
  OrderInvoice,
  AdminOrderDetail,
  AdminOrderDetailItem,
  AdminOrderPrintItem,
  AdminOrderItemQuantitySummary,
  AdminOrderLine,
  AdminOrderSummary,
  OrderItemVehicleSnapshot,
  InvoiceStatus,
  OrderSource,
  PaymentChannel,
} from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import type { Database } from '../database.types';
import {
  mapSupabaseOrderNoteRowsToProjection,
  type SupabaseOrderNoteRow,
} from './order-notes';
import {
  mapSupabaseProcurementRowsToProjection,
  type SupabaseOrderItemProcurementRow,
} from './order-procurement';
import {
  mapSupabaseOrderCancellationRowsToProjection,
  type SupabaseOrderCancellationRow,
} from './order-cancellations';

/**
 * @module @pcm/adapters/supabase/mappers/order — domain PlaceOrderInput → create_order RPC 入參(wire)
 *   + orders row(摘要投影)→ domain OrderListItem(讀路徑、M-3 OrdersTab)
 *
 * 🔴 鐵則 12(plan v6 §5 紅線 3 server 價權威):wire 邊界**逐欄顯式建構、只送白名單鍵**,即使 input
 * 帶意外欄也不洩到 RPC(型別層已無價/tier、此處 wire 縱深)。domain camelCase → RPC snake_case;
 * domain `quantity` → RPC `qty`(對齊 create_order RPC `v_line->>'qty'`)。
 *
 * (ADR-0003 §3.4:wire 字面只在 mapper 邊界、不 leak domain/ports/use-case。)
 * 對齊 migration create_order **flag-off 8 / flag-on 9-param**(B-2 第 9 參數 p_notification_email)+ return DTO `{order_id, display_id}`。
 *
 * 讀路徑「摘要」(orders row + 內嵌 order_items(quantity) → `OrderListItem`)= M-3 OrdersTab,見
 * `mapSupabaseOrderRowToListItem`(繞過 #217:摘要不含 items[])。完整 Order 重建
 * (`mapSupabaseOrderToDomain`、含 OrderItem[])仍延 stage ③(backlog #217:order_items 無 product_id)。
 */

/** create_order RPC line 的 optional vehicle(wire;V-3a、鏡像 domain PlaceOrderVehicle 逐 kind 隔離)。 */
type CreateOrderRpcVehicle =
  | { kind: 'dict'; brand: string; model: string; year?: number; source: 'search' | 'garage' | 'picker' }
  | { kind: 'free'; raw: string; year?: number; source: 'garage' | 'freetext' };

/** create_order RPC line(wire):variant_id XOR (supplier_slug, sku),皆帶 qty;V-3a 可帶 vehicle。 */
type CreateOrderRpcLine =
  | { variant_id: string; qty: number; vehicle?: CreateOrderRpcVehicle }
  | { supplier_slug: string; sku: string; qty: number; vehicle?: CreateOrderRpcVehicle };

/** create_order RPC invoice(wire):type 必、其餘選(RPC 逐鍵 ->> 主控 + jsonb_strip_nulls)。 */
type CreateOrderRpcInvoice = {
  type: 'personal' | 'company' | 'donate';
  carrier?: string;
  title?: string;
  taxId?: string;
  donateCode?: string;
};

/** create_order RPC 入參(wire；B-3 以 optional key 區分 flag-off 8 / flag-on 9 參數形狀)。 */
export type CreateOrderRpcArgs = {
  p_lines: CreateOrderRpcLine[];
  p_address_id: string;
  p_shipping_method: 'home' | 'store';
  p_invoice: CreateOrderRpcInvoice;
  p_cart_session_id: string; // 3DS-0b cart-instance key(uuid);RPC 入口 null fail-closed;非價/tier
  p_terms_version: string; // 🔴 #241 同意條款版本(server 注入);RPC NULL/空 fail-closed
  p_client_ip: string | null; // 🔴 #241 best-effort 同意來源 IP(可 null;RPC left 截 128);PII、非價
  p_client_ua: string | null; // 🔴 #241 best-effort User-Agent(可 null;RPC left 截 1024);PII、非價
  p_notification_email?: null; // B-3 flag-on 只允許 null marker；canonical 真值到 B-4 才擴型
};

/** create_order RPC return DTO(wire、對齊 RPC RETURNS jsonb `{order_id, display_id}`、零價結構)。 */
export type CreateOrderRpcResult = {
  order_id: string;
  display_id: string;
};

/** V-3a vehicle:逐欄顯式重建(逐 kind 隔離、不透傳整物件=不夾帶意外欄;year undefined 不外送)。
 *  🔴 純 metadata、無價/tier;RPC 端仍白名單重組(縱深、本層非最終閘)。 */
function mapVehicle(v: PlaceOrderVehicle): CreateOrderRpcVehicle {
  if (v.kind === 'dict') {
    return {
      kind: 'dict',
      brand: v.brand,
      model: v.model,
      ...(v.year !== undefined ? { year: v.year } : {}),
      source: v.source,
    };
  }
  return {
    kind: 'free',
    raw: v.raw,
    ...(v.year !== undefined ? { year: v.year } : {}),
    source: v.source,
  };
}

/** 單一 line:domain camelCase + quantity → RPC snake_case + qty(顯式白名單鍵、不夾帶意外欄)。 */
function mapLine(line: PlaceOrderLine): CreateOrderRpcLine {
  const vehicle = line.vehicle !== undefined ? { vehicle: mapVehicle(line.vehicle) } : {};
  if ('variantId' in line) {
    return { variant_id: line.variantId, qty: line.quantity, ...vehicle };
  }
  return { supplier_slug: line.supplierSlug, sku: line.sku, qty: line.quantity, ...vehicle };
}

/** invoice:顯式 5 鍵(type 必、其餘選);額外鍵不外送、RPC 亦逐鍵主控。 */
function mapInvoice(invoice: OrderInvoice): CreateOrderRpcInvoice {
  return {
    type: invoice.type,
    carrier: invoice.carrier,
    title: invoice.title,
    taxId: invoice.taxId,
    donateCode: invoice.donateCode,
  };
}

/**
 * domain PlaceOrderInput → create_order RPC 入參。
 *
 * 🔴 鐵則 12:逐欄顯式建構、**永不**夾帶 price / unitPrice / tier / priceByTier / priceStore / cost / userId
 * (型別層已無、wire 邊界再縱深);價 / 運費 / 歸屬 / tier 全 RPC server 權威算(plan §5 紅線 3)。
 * p_cart_session_id 是合法 server 必需鍵(cart-instance idempotency uuid、非價/tier/身分),屬白名單、非洩漏欄。
 */
export function mapPlaceOrderToCreateOrderArgs(input: PlaceOrderInput): CreateOrderRpcArgs {
  return {
    p_lines: input.lines.map(mapLine),
    p_address_id: input.addressId,
    p_shipping_method: input.shippingMethod,
    p_invoice: mapInvoice(input.invoice),
    p_cart_session_id: input.cartSessionId, // 3DS-0b;cart-instance key、非價/tier(白名單縱深)
    p_terms_version: input.termsVersion, // 🔴 #241 同意條款版本(server 注入 CURRENT_TERMS_VERSION)
    p_client_ip: input.clientIp ?? null, // 🔴 #241 best-effort PII(缺 → null;RPC 容忍)
    p_client_ua: input.clientUserAgent ?? null, // 🔴 #241 best-effort PII(缺 → null)
    ...(Object.prototype.hasOwnProperty.call(input, 'notificationEmail')
      ? { p_notification_email: null }
      : {}),
  };
}

// ── 讀路徑(摘要):orders row + 內嵌 order_items(quantity) → domain OrderListItem ──

/**
 * 摘要讀 row 型別 —— **derive 自生成 Database 型別**(對齊 #106 vehicle/address mapper 慣例)。
 *
 * 只取 `ORDER_LIST_SELECT`(SupabaseOrderAdapter)投影的欄 + 內嵌 `order_items(quantity)`(to-many array)。
 * `payment_status` / `fulfillment_status` 生成 enum 型別字面與 domain `PaymentStatus`/`FulfillmentStatus`
 * 完全一致(直送、無需轉換);`total` integer 元位 → Money 走 `toMoneyAmount`。
 * 🔴 鐵則 12:**不含** unit_price / line_total / product_snapshot / 經銷價 / PII —— 投影白名單外的欄不在此型別。
 */
export type SupabaseOrderListRow = Pick<
  Database['public']['Tables']['orders']['Row'],
  'id' | 'display_id' | 'created_at' | 'payment_status' | 'fulfillment_status' | 'total'
> & {
  /** 內嵌 order_items(quantity)、to-many 非 null array(FK order_items_order_id_fkey、isOneToOne:false)。 */
  order_items: { quantity: number }[];
};

/**
 * wire orders 摘要 row → domain OrderListItem(snake_case → camelCase)。
 *
 * `itemCount = Σ order_items.quantity`(Q4=B 總數量、整數加總、非 distinct 列數;空 array → 0);
 * `total` integer → Money 走 `toMoneyAmount` 中央守門(整數/非負、絕不 `as MoneyAmount`、零浮點);
 * `paymentStatus`/`fulfillmentStatus`/`createdAt`/`displayId`/`id` 直送(生成 enum 字面 = domain 字面)。
 */
export function mapSupabaseOrderRowToListItem(row: SupabaseOrderListRow): OrderListItem {
  return {
    id: row.id,
    displayId: row.display_id,
    createdAt: row.created_at,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    total: { amount: toMoneyAmount(row.total), currency: 'TWD' },
    itemCount: row.order_items.reduce((sum, item) => sum + item.quantity, 0),
    // 🔴 **客人端的截斷旗標**(2026-08-16,`Q-EMBED-1` Sean 批)。
    //    這一面的後果與後台不同:後台是**算錯一個狀態**,這裡是**印一個少算的件數**。
    //    ⇒ 客人看到「3 件」而實際訂了 600 件 —— **他不會知道,也不會回報**(他沒有第二個來源可以對)。
    //    判法逐字沿用另外兩處:**要 N 筆、拿回剛好 N 筆就當作可能被切了**。
    itemCountTruncated: row.order_items.length >= ORDER_LIST_ITEMS_EMBED_LIMIT,
  };
}

// ── 讀路徑(admin 摘要):orders row + 內嵌 customers(name) → domain AdminOrderSummary(M-4a 訂單線第一片)──

/**
 * admin 摘要讀 row 型別 —— **derive 自生成 Database Row**(對齊 SupabaseOrderListRow 慣例)。
 *
 * 只取 `ADMIN_ORDER_LIST_SELECT`(SupabaseOrderAdapter)投影的欄 + 內嵌 `customers(name)`。
 * 🔴 鐵則 12:**不含** 任何成本欄(orders 表本身無 price_store / price_by_tier / cost);customers 只取
 * `name`(客人顯示、非經銷價 / tier / PII-heavy 欄)。`payment_status` / `fulfillment_status` 生成 enum
 * 字面 = domain enum(直送);`order_source` / `payment_channel` 生成為 text `string`(DB CHECK 約束、非 pg enum)
 * → mapper 端 narrow 成 domain enum(見下)。`total` integer 元位 → Money。
 */
/**
 * admin 列表品項內嵌 row 型別(M-4a Slice D-1a;每商品一列)——scalar 欄 derive 自生成 order_items Row,
 * brand 巢狀 embed 手型別(variant→product→brand;many-to-one 單物件、任一層缺 → null)。
 */
type AdminOrderListItemEmbed = Pick<
  Database['public']['Tables']['order_items']['Row'],
  | 'id'
  | 'variant_sku'
  | 'quantity'
  | 'unit_price'
  | 'line_total'
  | 'product_snapshot'
  | 'workflow_status'
  | 'version'
  | 'vehicle_snapshot'
> & {
  product_variants: { products: { brands: { name: string } | null } | null } | null;
  /**
   * A9c 三軸內嵌。形狀與明細側同一個內嵌一致(0/1 筆;物件與陣列**都吃** —— 理由見
   * `mapQuantitySummary` docstring 的「isOneToOne 三個回音不是實測」那段)。
   * 🔴 **缺列合法、不是錯誤**:`order_item_quantity_summary` 由 A4a trigger 惰性建列。
   */
  order_item_quantity_summary?:
    | SupabaseOrderItemQuantitySummaryRow[]
    | SupabaseOrderItemQuantitySummaryRow
    | null;
};

export type SupabaseAdminOrderRow = Pick<
  Database['public']['Tables']['orders']['Row'],
  | 'id'
  | 'display_id'
  | 'created_at'
  | 'payment_status'
  | 'fulfillment_status'
  | 'total'
  | 'order_source'
  | 'payment_channel'
  | 'display_position'
  | 'cancelled_at'
  | 'tier_at_checkout'
  | 'invoice_status' // A9c:開票紀錄三態(NOT NULL DEFAULT 'not_issued';CHECK 三值)
  | 'customer_user_id' // 2b-0:同客人閘的識別;非成本欄、orders 自己的欄位(理由見 AdminOrderSummary.customerUserId)
> & {
  /**
   * 內嵌 customers(name):orders.customer_user_id → customers(user_id) 為 forward FK(orders 持 FK 欄)=
   * many-to-one → PostgREST 回**單物件**(或 null);FK ON DELETE RESTRICT 保證客人存在,型別仍容 null 防禦。
   * 🔴 型別容單物件 / 陣列兩形狀:embed cardinality 本片無法本機實測(需 service_role 打真 PostgREST);
   *    PostgREST 語意 many-to-one = 單物件、但跨版本 / 生成器推斷有落差,mapper 端正規化吸收(見 customerNameFromEmbed)。
   */
  customers: { name: string } | { name: string }[] | null;
  /**
   * 內嵌 order_items(每商品一列;M-4a Slice D-1a)。orders→order_items = to-many → 陣列(或 null 防禦);
   * 每列 variant→product→brand = many-to-one → 單物件(或 null,variant_id 可為 null / join 缺)。
   * 成交價 unit_price/line_total = 該單實際賣價(非經銷價表);穿越的 product_variants/products 價格欄
   * **不投影**(見 ADMIN_ORDER_LIST_SELECT)。runtime cast `as unknown as SupabaseAdminOrderRow[]` 吸收 embed 型別落差。
   */
  order_items: AdminOrderListItemEmbed[] | null;
};

/** customers embed → 客人顯示名:容單物件 / 陣列兩形狀(防 PostgREST embed cardinality 落差)、缺 → null。 */
function customerNameFromEmbed(embed: SupabaseAdminOrderRow['customers']): string | null {
  if (embed == null) return null;
  const record = Array.isArray(embed) ? embed[0] : embed;
  return record?.name ?? null;
}

/**
 * vehicle_snapshot jsonb 防禦解析 → OrderItemVehicleSnapshot(V-3b;壞形狀/缺/非法 → null,不炸頁)。
 * dict 需 brand+model 非空;free 需 raw 非空;year 整數選填;source 放寬為 string(相容凍結快照多來源)。
 */
function parseVehicleSnapshot(raw: unknown): OrderItemVehicleSnapshot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const year = typeof o.year === 'number' && Number.isInteger(o.year) ? o.year : undefined;
  const source = typeof o.source === 'string' ? o.source : '';
  if (o.kind === 'dict') {
    if (typeof o.brand !== 'string' || o.brand === '' || typeof o.model !== 'string' || o.model === '') return null;
    return { kind: 'dict', brand: o.brand, model: o.model, ...(year !== undefined ? { year } : {}), source };
  }
  if (o.kind === 'free') {
    if (typeof o.raw !== 'string' || o.raw === '') return null;
    return { kind: 'free', raw: o.raw, ...(year !== undefined ? { year } : {}), source };
  }
  return null;
}

/**
 * 三軸摘要 → **列表側**非 nullable 形狀(M-4b E10 A9c)。
 *
 * 🔴 **刻意複用 `mapQuantitySummary` 再補 0,不另寫第二個 parser**:那支已經硬化過兩層
 * (MF1 四欄逐一驗、`{}`/`NaN` 當作沒讀到;MF2 C7 不變式違反回 `null` 而非夾成 0)。
 * 另寫一支等於把那兩層防禦重寫一次、且兩份會漂。
 *
 * 🔴🔴 **這裡補 0 是有授權的,但只在「純顯示」成立** —— `AdminOrderDetailItem.quantitySummary`
 * 的 docstring 逐字分用途:「純顯示…補 0 可接受,最壞只是少顯示一點資訊」/「任何守門、上限、
 * 可否取消的判斷:**絕不可**補 0」,並直接交代「開 A9c 的人:照 A1 字面補 0 只在列表顯示成立,
 * **不要**把同一個 `?? 0` 帶進取消流程的任何判斷」。
 * ⇒ 代價要講明白:補 0 之後,**「缺列 / 資料損壞」與「真的是 0」在列表上長得一模一樣**。
 * 列表本身沒有取消動作(入口 = A13);**A13 進來時必須走明細那支 `| null` 的讀法、不得吃本函式。**
 */
function mapListQuantitySummary(
  rows:
    | SupabaseOrderItemQuantitySummaryRow[]
    | SupabaseOrderItemQuantitySummaryRow
    | null
    | undefined,
  itemQuantity: number,
): AdminOrderItemQuantitySummary {
  return (
    mapQuantitySummary(rows) ?? {
      // 🔴 **`quantity` 補的是該品項自己的數量、不是 0** —— 母 plan row 26 逐字是「無列 = **三個** 0」,
      //    三個指的是**軸**(ordered / instock / cancelled);`quantity` 是 `order_items.quantity` 的
      //    去正規化副本(型別 docstring 逐字「由複合 FK 物理保證等於 order_items.quantity」)。
      //    補 0 會讓列表顯示「訂貨 0/**0**」而不是「訂貨 0/3」= 分母憑空消失。
      quantity: itemQuantity,
      orderedQuantity: 0,
      instockQuantity: 0,
      cancelledQuantity: 0,
      // 🔴 L0:補 0 在這裡**不是猜,是被資料結構蘊含的** —— 缺列 = A4a trigger 從沒為這個品項建過列
      //    = 從沒被採購也沒被取消過;而 `shipped ⊆ instock`、`instock` 同樣來自這張表
      //    ⇒ 沒有那一列就**不可能有已出貨的量**。⇒ 0 是事實不是預設值。
      //    ⚠️ 這條推論若哪天不成立(例如出貨改成可跳過到貨),這裡要跟著改成 fail-closed。
      shippedQuantity: 0,
      cancellableQuantity: itemQuantity, // = quantity − 0 − 0,與 mapQuantitySummary 的算式一致
    }
  );
}

/** order_items 內嵌 → domain AdminOrderLine:brand 走 variant→product→brand(任一層缺 → null);成交價整數 → Money。 */
function mapAdminOrderLine(item: AdminOrderListItemEmbed): AdminOrderLine {
  return {
    id: item.id,
    variantSku: item.variant_sku,
    title: pickString(item.product_snapshot, 'title'),
    brand: item.product_variants?.products?.brands?.name ?? null,
    quantity: item.quantity,
    unitPrice: { amount: toMoneyAmount(item.unit_price), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(item.line_total), currency: 'TWD' },
    workflowStatus: item.workflow_status, // M-4a D-2:per-item 真相;NULL=未設定
    version: item.version, // per-item 改狀態表單樂觀鎖
    vehicle: parseVehicleSnapshot(item.vehicle_snapshot), // V-3b:車款快照直出(NULL=未帶;純顯示)
    // A9c:三軸。缺列 → 三個軸補 0、分母用本品項 quantity(僅限列表這個純顯示用途,見該函式 docstring)
    quantitySummary: mapListQuantitySummary(item.order_item_quantity_summary, item.quantity),
  };
}

/**
 * wire orders admin 摘要 row → domain AdminOrderSummary(snake_case → camelCase)。
 *
 * `customerName = customers?.name ?? null`(join 缺 → null 防禦);`total` integer → Money 走 `toMoneyAmount`
 * 中央守門(整數 / 非負、絕不 `as MoneyAmount`);`orderSource` / `paymentChannel` 由 text narrow 成 domain enum
 * (🔴 DB CHECK 約束已保證值域合法、非任意字串,此 cast 是 text-column↔domain-enum 邊界的正當投射,非繞型別);
 * `paymentStatus` / `fulfillmentStatus` / `createdAt` / `displayPosition` / `cancelledAt` / `displayId` / `id` 直送。
 */
export function mapSupabaseAdminOrderRowToSummary(row: SupabaseAdminOrderRow): AdminOrderSummary {
  return {
    id: row.id,
    displayId: row.display_id,
    createdAt: row.created_at,
    customerUserId: row.customer_user_id,
    customerName: customerNameFromEmbed(row.customers),
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    orderSource: row.order_source as OrderSource, // DB orders_order_source_check 保證值域
    paymentChannel: row.payment_channel as PaymentChannel, // DB orders_payment_channel_check 保證值域
    total: { amount: toMoneyAmount(row.total), currency: 'TWD' },
    displayPosition: row.display_position,
    cancelledAt: row.cancelled_at,
    // (D-2 起不攜 orders.workflow_status/version:per-item 真相在 lines[]、整單=顯示端彙總。)
    tierAtCheckout: row.tier_at_checkout, // M-4a Slice D-1a:會員等級(member_tier enum;顯示端映射一般/車行)
    // A9c:開票紀錄三態。🔴 **走 `narrowInvoiceStatus`、不是裸 `as`**(關卡2 抓到):同一欄在明細側
    // (`:710`)本來就用這支,裸 `as` 會讓同檔同欄出現兩種硬度。generated type 是 `string`
    // ⇒ CHECK 日後放寬或出現第四值時,裸 `as` 會把界外字串當成 enum 傳給 A11a-5 的查表(取到 undefined)。
    invoiceStatus: narrowInvoiceStatus(row.invoice_status),
    lines: (row.order_items ?? []).map(mapAdminOrderLine), // 每商品一列展開(order_items 缺 → 空陣列、顯示端兜「—」)
    // 🔴 **列表側的截斷旗標(2026-08-16,`Q-EMBED-1` Sean 批)。**
    //    判法與明細那條逐字相同:**要 N 筆、拿回剛好 N 筆就當作可能被切了**
    //    (不是 N+1 —— 沿用 `itemsTruncated: row.order_items.length >= ORDER_ITEMS_EMBED_LIMIT` 的既有形狀,
    //     不在同一個 repo 裡放兩種判法)。
    // 🔴🔴 **為什麼列表需要它**:`orderStatusView` → `orderGoodsAxis` → `goodsAxisOfLines(lines)`
    //    三條判定都是 `.every(...)` ⇒ **子集全出貨就答「出貨完成」**,而沒載進來的可能一件都沒出。
    //    ⇒ 員工看到「出貨完成」就不再動作 —— **他做對了,但結果是錯的。**
    // ⚠️ `?? []` 那半:缺鍵(投影退版)⇒ 空陣列 ⇒ 長度 0 ⇒ 旗標 false。
    //    **那是對的** —— 缺鍵不是「被截斷」,它是另一件事(顯示端兜「—」)。
    //    兩者混成同一個旗標會讓「投影壞了」被讀成「品項太多」。
    itemsTruncated: (row.order_items ?? []).length >= ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT,
  };
}

// ── 讀路徑(admin 明細):orders row + 內嵌 customers / order_items → AdminOrderDetail(M-4a Slice B)──

/**
 * 內嵌 `order_items` 的請求上限(A9a-2 補;關卡2 codex MF2)。
 *
 * 🔴 **為什麼現在才需要**:A9a-1 起明細就沒給 `order_items` 上限,邊界一直握在伺服器 `max-rows`
 * (~~production 實測 1000~~ ⇒ **2026-08-18 起是 `2000`**:Sean 親手調、V 窗實測
 * REST `206` / `content-range 0-1999/19777`;**我未自驗**)手上。
 * ⚠️ **數字換了,這一段的論證沒換** —— 它講的是「邊界握在【遠端設定】手上」,而那件事沒變。
 * A9a-2 在品項底下掛了 per-item 的 `procurementTruncated` ——
 * 而**品項自己被切掉時,那個旗標連同品項一起消失**,呼叫端看到的每個旗標都還是 false。
 * ⇒ 邊界必須由我們的常數擁有,觸及時翻成 `AdminOrderDetail.itemsTruncated`。
 *
 * 值 = 200:PCM 一張單的品項數是個位數到數十(月 100-300 單、代購零件),200 給了一個數量級餘裕,
 * 又**嚴格低於**實測的伺服器上限。⚠️ 若專案 `max-rows` 日後被設到低於本值,截斷會發生在那個更低的
 * 數字上而本判定看不見(同 `ORDER_ITEM_PROCUREMENT_EMBED_LIMIT` 的殘餘風險,治本要 `count: 'exact'`)。
 */
export const ORDER_ITEMS_EMBED_LIMIT = 200;

/**
 * **列表**側內嵌 `order_items` 的請求上限(2026-08-16,`Q-EMBED-1` Sean 批)。
 *
 * 🔴 **為什麼與明細那個分開一個常數,而不是共用 200**:兩者的用途不同 ——
 *    明細要**逐列顯示**品項(200 是「畫得出來的量」);
 *    列表只拿它**算彙總**(件數、貨品軸),不逐列畫 ⇒ 上限可以更高、代價只是傳輸量。
 *    **共用一個常數會讓「調整其中一邊」變成「同時調整另一邊」,而那兩件事沒有理由綁在一起。**
 *
 * 🔴🔴 **這個上限存在的理由【不是】「避免傳太多」,是【把邊界從伺服器手上拿回來】。**
 *    `db-max-rows` **會**套用到內嵌陣列,而**內嵌被截斷時 PostgREST 不給任何訊號**
 *    (仍回 HTTP 200、`Content-Range` 不反映)⇒ **不設上限 = 一個偵測不到的懸崖。**
 *    證據與層級寫在 `docs/specs/2026-08-16-postgrest-max-rows-embed-finding.md`
 *    (⚠️ 該檔明載:出處是官方 repo issue 作者的敘述、**不是 maintainer 聲明**,當高可信不當定案)。
 *
 * 值 = 500:**嚴格低於**實測的伺服器上限(1000),又遠高於明細的 200
 * ⇒ 一張單的品項數在 200~500 之間時,**明細會說「未知」而列表仍算得出正確的軸** —— 那是刻意的。
 * ⚠️ 與明細那條共用同一個殘餘風險:若專案 `max-rows` 日後被設到低於本值,
 *    截斷會發生在那個更低的數字上而本判定看不見(治本要 `count: 'exact'`)。
 */
export const ADMIN_ORDER_LIST_ITEMS_EMBED_LIMIT = 500;

/**
 * **前台(客人)訂單列表**內嵌 `order_items` 的請求上限(2026-08-16,`Q-EMBED-1` Sean 批)。
 *
 * 🔴 **與後台那個分開一個常數,理由同前**:這一面只拿它 `reduce` 出 `itemCount`,
 *    連品項欄位都只投影 `quantity`(`ORDER_LIST_SELECT` 逐字)⇒ 傳輸成本最低、上限可以最寬。
 * 值 = 500:與後台列表同值,**而那是巧合不是耦合** —— 兩者各自可調,改一個不必動另一個。
 * ⚠️ 同一組殘餘風險:若專案 `max-rows` 被設到低於本值,截斷發生在更低的數字上而本判定看不見。
 */
export const ORDER_LIST_ITEMS_EMBED_LIMIT = 500;

/**
 * 內嵌 `payment_charge_attempts` 的請求上限(M-4b E10 A9g-2)。
 *
 * 🔴 50 的理由:單張訂單的扣款嘗試實務上是個位數(一次結帳一筆、失敗重試再一筆);
 * 50 遠高於任何合理值,又低於伺服器 `max-rows`
 * (~~production 實測 1000~~ ⇒ **2026-08-18 起是 `2000`**:Sean 親手調、V 窗實測;**我未自驗**)——
 * 讓截斷邊界由我們的常數擁有(理由同 `ORDER_NOTES_EMBED_LIMIT`)。
 * ⚠️ **這一處的結論【變得更成立】,不是被推翻**:`50 < 1000` 本來就成立,`50 < 2000` 更寬。
 * 🔴 而下面那條「只在 `max-rows > 50` 時成立」的限定**照舊要留著** ——
 * 它防的是**設定被調小**,而那個風險與現值是 1000 還是 2000 無關。
 * 🔴 **「與專案設定脫鉤」只在 `max-rows > 50` 時成立**(關卡2 codex MF3 更正原本說太滿的字面):
 * 若日後把 `max-rows` 調到 50 以下,伺服器會先截斷、回傳筆數永遠 < 50 ⇒ 本檔判不出截斷、
 * 閘會靜默變 `'clear'`。單元測試看不見伺服器設定 ⇒ 只能由常數的範圍守門
 * (`order.test.ts` 的 `toBeLessThan(1000)` 那組)+ 本段字面把前提釘住。
 * 🔴 觸及上限時**不是**「就這 50 筆」而是「可能被切了」⇒ 閘翻成 `'unknown'`、呼叫端 fail-closed
 * (見 `AdminOrderDetail.chargeAttemptGate`)。
 */
export const PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT = 50;

/**
 * A8a2 判定「在途扣款」的字面(`20260805100000:362` 逐字 `a.status <> 'failed'`)。
 *
 * 🔴 語意是**否定式**:任何**不等於** `failed` 的狀態都算在途,而不是列舉在途狀態的白名單。
 * 這樣 DB 端日後新增狀態值時,呼叫端會自動偏保守(當成在途、不給取消),
 * 而不是漏判成「可取消」—— 後者是動到錢的方向。
 */
export const CHARGE_ATTEMPT_TERMINAL_FAILED = 'failed';

/**
 * admin 明細讀 row 型別 —— derive 自生成 Database Row(對齊 SupabaseAdminOrderRow 慣例)。
 * 只取 `ADMIN_ORDER_DETAIL_SELECT` 投影欄。🔴 PII 欄(shipping_address_snapshot / invoice /
 * customers email·phone)只在明細投影;仍零成本欄、零 tappay_rec_trade_id。
 */
/**
 * 三軸數量摘要內嵌 row(M-4b E10 A9g-1)——欄位對齊 `ADMIN_ORDER_DETAIL_SELECT` 內嵌的四欄。
 *
 * 🔴 **derive 自生成 Row**(關卡2 MF3 更正):我原本手寫四個 `number`,理由寫成
 * 「derive 會多帶投影裡沒有的 `order_item_id`」—— 那個理由是**錯的**,`Pick` 本來就只挑指定欄。
 * 手寫的真正代價是:生成型別哪天把某欄改成 nullable 或換型別,這裡**不會有任何地方轉紅**。
 * 用 `Pick` 就與 `SupabaseOrderListRow` / `SupabaseAdminOrderDetailRow` 的既有慣例一致。
 */
export type SupabaseOrderItemQuantitySummaryRow = Pick<
  Database['public']['Tables']['order_item_quantity_summary']['Row'],
  | 'quantity'
  | 'ordered_quantity'
  | 'instock_quantity'
  | 'cancelled_quantity'
  // 🔴 L0(2026-08-13):第四軸。DB 早就有這欄(B2-S2b `20260806180000` 已接 trigger + backfill),
  //    只是 TS 這側沒撈 —— 缺它會讓「已出貨」判不出來,見 `AdminOrderItemQuantitySummary` 的 docstring。
  | 'shipped_quantity'
>;

export type SupabaseAdminOrderDetailRow = Pick<
  Database['public']['Tables']['orders']['Row'],
  | 'id'
  | 'display_id'
  | 'created_at'
  | 'payment_status'
  | 'fulfillment_status'
  | 'order_source'
  | 'payment_channel'
  | 'payment_method'
  | 'paid_at'
  | 'subtotal'
  | 'shipping_fee'
  | 'discount_total'
  | 'total'
  | 'shipping_method'
  | 'shipping_address_snapshot'
  | 'invoice'
  | 'invoice_number'
  | 'invoice_amount'
  | 'invoice_status'
  | 'cancelled_at'
  | 'cancelled_reason'
  | 'version'
  // OD 片 2(需求檔 §0-J J-4):詳情頁「客人明細入口」要連 `/customers/[id]`,得先有 id。
  // 非成本欄、orders 自己的欄位 —— 同 `SupabaseAdminOrderRow` 那條的理由(見 `:239`)。
  | 'customer_user_id'
> & {
  /** 同 SupabaseAdminOrderRow.customers:many-to-one 單物件、防禦容陣列/null。 */
  customers:
    | { name: string | null; email: string | null; phone: string | null }
    | { name: string | null; email: string | null; phone: string | null }[]
    | null;
  order_items: {
    id: string;
    variant_sku: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    product_snapshot: unknown; // jsonb;{sku,spec,title} 由 create_order 寫入,防禦解析
    /**
     * M-4b E10 A9a-2:採購內嵌列(順序不保證、筆數被請求端上限夾住 → 兩者都在 mapper 處理)。
     * 🔴 optional + nullable 的理由同 `order_notes`:投影退版或舊 row 會整個沒有這個鍵。
     */
    order_item_procurement?: SupabaseOrderItemProcurementRow[] | null;
    /**
     * M-4b E10 A9g-1:三軸數量摘要內嵌。
     * 🔴 **陣列或單物件都收**:generated types 的 `isOneToOne: false`(FK 為複合鍵
     * `(order_item_id, quantity)`,而 `order_item_id` 單獨是 PK)指向 to-many = 陣列,
     * 但那是規則推導、**不是實測到的 wire 回應** ⇒ 不賭邊(理由詳 `mapQuantitySummary` docstring)。
     * 🔴 optional + nullable 理由同上面兩個內嵌:投影退版會整個沒有這個鍵。
     * 🔴 **空陣列與缺鍵在這裡是同一件事**(都代表「讀不到摘要」)——
     * 與 `order_item_procurement` 不同,那邊空陣列是「真的沒訂過貨」的**事實**;
     * 這邊 A4a 惰性建列,沒有列只代表**不知道**,不能翻成 0。
     */
    order_item_quantity_summary?:
      | SupabaseOrderItemQuantitySummaryRow[]
      | SupabaseOrderItemQuantitySummaryRow
      | null;
  }[];
  /**
   * M-4b E10 A9a-1:備註/聯絡紀錄內嵌列(順序不保證、筆數被請求端上限夾住 → 兩者都在 mapper 處理)。
   * 🔴 optional + nullable 是**刻意的**:投影退版或舊 row 會整個沒有這個鍵,mapper 端 `?? []` 承接;
   * 宣告成必填會讓型別對呼叫端說謊(實際餵得進 undefined、且有守門測試在測)。
   */
  order_notes?: SupabaseOrderNoteRow[] | null;
  /**
   * M-4b E10 A9g-2:扣款嘗試內嵌。🔴 **只取 `status` 一欄** —— 本表帶大量金流敏感欄
   * (`rec_trade_id` / `bank_transaction_id` / `fallback_token_hash`),取消 UI 只需要
   * 「有沒有非 failed 的」這個布林事實,多取一個欄都是白給的洩漏面。
   * 🔴 optional + nullable 理由同 `order_notes`:投影退版會整個沒有這個鍵。
   */
  payment_charge_attempts?: { status: string }[] | { status: string } | null;
  /**
   * M-4b E10 A9g-3:取消歷程內嵌(含兩層 `order_cancellation_items`)。
   * 🔴 optional + nullable 理由同 `order_notes`:投影退版會整個沒有這個鍵,
   * 而「沒讀到」與「這張單沒被取消過」必須分得出來(見 `AdminOrderDetail.cancellationsTruncated`)。
   */
  order_cancellations?: SupabaseOrderCancellationRow[] | null;
};

/**
 * 三軸數量摘要內嵌(0/1 筆陣列)→ domain(M-4b E10 A9g-1)。
 *
 * 🔴🔴 **缺列一律回 `null`,絕不補 0** —— 本函式存在的唯一理由就是守住這件事。
 * `order_item_quantity_summary` 由 A4a trigger 惰性建立,沒被採購也沒被取消過的品項沒有那一列。
 * 把缺列當成「到貨 0、取消 0」會讓 `cancellableQuantity` 被算成 `quantity`(算大)
 * ⇒ 畫面放行超量取消、送出必被 A8a2 拒(母 plan `:384` row 37 逐字記這個坑)。
 * 缺列時下游看到 `null`,契約是 fail-closed(停用該品項的取消),不是自己補值。
 *
 * 🔴 **四欄逐一驗過才算讀到**(關卡2 MF1):`{}` 或缺欄的單物件會讓 `row` truthy 卻算出 `NaN`,
 * 而 adapter 的 `as unknown as` 強轉讓型別層完全擋不住這條路。⇒ 任一欄不是有限數 = **當作沒讀到**,
 * 回 `null` 走 fail-closed;不回一個帶 `NaN` 的物件(`NaN` 進表單 max 屬性 = 行為未定義)。
 *
 * 🔴🔴 **不變式被違反時也回 `null`,不夾成 0**(關卡2 MF2 推翻本函式的前一版):
 * C7 `oiqs_instock_cancelled_le_quantity`(A1 `20260730150000:123-124`)保證
 * `instock + cancelled <= quantity`。前一版用 `Math.max(0, …)` 把違規資料夾成「可取消 0」——
 * 那**不是防禦,是偽裝**:「可取消 0」在畫面上與「全部到貨了、本來就不能取消」**長得一模一樣**,
 * 員工永遠不會知道這筆資料壞了。而且我還寫了一條測試把這個行為鎖成規格,等於把偽裝寫進契約。
 * ⇒ 改成:違反 C7 = 資料已損壞 = **回 `null`**(與「讀不到」同一個 fail-closed 出口,
 *   下游顯示「數量資料尚未就緒」並停用取消)。與 memory `feedback_guard-reads-non-authoritative-cache`
 *   同一條精神:不可以把「不知道」或「壞掉」翻譯成一個看起來正常的數字。
 *
 * 🔴 **同時吃物件與陣列是刻意的**(R1 I-1):原本只宣告陣列,依據是 generated types 的
 * `isOneToOne: false`、postgres-meta 的 O2O 判定規則、`postgrest-js` 依該旗標決定回傳形狀 ——
 * 但這三者是**同一條規則的三個回音**,不是「觀察到的 wire 回應」;而本 repo 對內嵌形狀立過
 * 「實測過才寫死」的標準(見 `SupabaseOrderAdapter.ts` 兩層深路徑那段 docstring 的 production 實測)。
 * 在沒真打一次 PostgREST 之前不賭邊:若它其實回物件,只認陣列的寫法會**靜默回 `null`**
 * = 功能全死而測試全綠(最壞的失敗形狀)。兩種形狀都吃,fail-closed 語意不變。
 */
function mapQuantitySummary(
  rows:
    | SupabaseOrderItemQuantitySummaryRow[]
    | SupabaseOrderItemQuantitySummaryRow
    | null
    | undefined,
): AdminOrderItemQuantitySummary | null {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null; // 🔴 缺鍵/空陣列/null = 不知道。不是 0。

  const { quantity, ordered_quantity, instock_quantity, cancelled_quantity, shipped_quantity } = row;
  // 🔴 MF1:**五**欄逐一驗;`{}` / 缺欄 / 非數 一律當作沒讀到(型別層擋不住,見 docstring)。
  //    L0 加入 `shipped_quantity` 時**同步加進這個檢查** —— 漏加的話它會是 `undefined`,
  //    而 `undefined` 進下游的比較(`shipped >= quantity`)恆為 false ⇒ 「已出貨」永遠判不出來,
  //    **零錯誤訊息**。這正是本函式 docstring 說的「型別層擋不住」那條路。
  if (
    !Number.isFinite(quantity) ||
    !Number.isFinite(ordered_quantity) ||
    !Number.isFinite(instock_quantity) ||
    !Number.isFinite(cancelled_quantity) ||
    !Number.isFinite(shipped_quantity)
  ) {
    return null;
  }
  // 🔴 MF2:C7 不變式被違反 = 資料已損壞,走同一個 fail-closed 出口,**不夾成 0 假裝正常**。
  if (instock_quantity + cancelled_quantity > quantity) return null;
  // 🔴 L0:C9 `oiqs_shipped_le_instock` 同型處置 —— Sean 2026-08-05 拍板「出貨必先到貨、無直送」
  //    ⇒ `shipped <= instock` 由 DB CHECK 保證。違反 = 資料已損壞 ⇒ 同一個 fail-closed 出口。
  //    ⚠️ 與 C7 那條一樣**不夾值**:夾成合法值會讓壞資料看起來正常,員工永遠不知道。
  if (shipped_quantity > instock_quantity) return null;

  return {
    quantity,
    orderedQuantity: ordered_quantity,
    instockQuantity: instock_quantity,
    cancelledQuantity: cancelled_quantity,
    shippedQuantity: shipped_quantity,
    // 🔴🔴 **`cancellableQuantity` 的算式刻意不減 `shipped`**(Sean 2026-08-05 拍 Q1=A/Q2=A 終案)。
    //    理由:`shipped ⊆ instock` ⇒ 已出貨的量**本來就含在 instock 裡**,再減一次 = **重複扣**,
    //    會把可取消量算得比實際少。⚠️ L0 把 `shippedQuantity` 帶進來之後,
    //    「看到有 shipped 就順手減一下」變成一個**新的、看起來很合理的**改壞方式 ⇒ 這段留著擋它。
    cancellableQuantity: quantity - instock_quantity - cancelled_quantity,
  };
}

/**
 * 扣款嘗試內嵌 → 取消 UI 的在途扣款閘三態(M-4b E10 A9g-2)。
 *
 * 🔴🔴 **「沒讀到」必須翻成 `'unknown'`,不能翻成「沒有在途扣款」** —— 本函式存在的唯一理由。
 * 缺鍵(投影退版)與 null 都代表「不知道」;把它當成零筆 = 畫面放行取消、送出必被 A8a2 拒,
 * 而那是動到錢的路徑。
 *
 * 🔴 判定序:**`'blocked'` 壓過 `'unknown'`** —— 已經看到一筆在途的,清單完不完整都不影響結論
 * (兩者都不給按,但文案不同,不能互相吃掉)。
 *
 * 🔴 判定用**否定式** `!== 'failed'`(逐字對齊 `20260805100000:362` 的 `a.status <> 'failed'`),
 * 不是列舉在途白名單:`status` CHECK 現為四值 pending/charged/failed/released
 * (`20260624120000:45-46`),DB 端日後新增值時否定式會自動偏保守(當成在途、不給取消),
 * 白名單則會漏判成「可取消」—— 後者是動到錢的方向。
 *
 * 🔴 **陣列與單物件都吃**(R1 F3;與同檔 `mapQuantitySummary` 同一條紀律)。
 * ⚠️ **原本寫的理由是錯的,關卡2 codex nit1 打掉**:我寫「partial UNIQUE index
 * `(order_id) WHERE status IN ('pending','charged','released')`(`20260624120000:62-64`)
 * 可能讓 PostgREST 判成 to-one」—— **不成立**,同一單可以有任意多筆 `failed`,
 * partial index 蓋不住整條關聯。生成型別也逐字寫著 `isOneToOne: false`
 * (數法=`grep -n -A 2 "payment_charge_attempts_order_id_fkey" packages/adapters/src/supabase/database.types.ts`
 * ⇒ 該關聯逐字 `isOneToOne: false`,落筆當下 `:1684-1686`)⇒ **規則上必為陣列**。
 * 仍然兩種都吃的理由只剩一條(與 `mapQuantitySummary` 同):那是規則推導、**不是實測到的 wire 回應**,
 * 而賭錯的代價不對稱 —— 只認陣列卻回物件時 `.some` 直接 TypeError = 整個明細頁炸掉。
 * 一行正規化買一個不會炸的下限,留著;但它是**防禦**,不是「DB 會這樣送」的宣稱。
 *
 * 🔴 **本閘只在 service_role 之下成立**(R1 F1)。本表三道授權事實:RLS enable + 零 policy
 * (`20260612150000:115`)、`REVOKE ALL FROM PUBLIC, anon, authenticated`(`:118`)、
 * **全庫唯一一筆 SELECT 授給 service_role**(`:121`;2026-08-05 grep 全 migrations 只此一筆)。
 * ⇒ 今天真正擋住外人的是「**沒有 grant**」,不是 RLS:
 *   ①service_role(BYPASSRLS + SELECT)⇒ 讀得到,本閘才有意義;
 *   ②anon/authenticated(零 grant)⇒ 請求被拒或內嵌鍵不回來,兩條都落在 fail-closed
 *     (前者 adapter throw、後者缺鍵 → `'unknown'`);
 *   ③🔴 **日後若把 SELECT 授給任何不 BYPASSRLS 的角色** ⇒ 零 policy 讓它讀到空陣列、**不報錯**
 *     ⇒ 本閘變 `'clear'` = 假裝「沒有在途扣款」。本片唯一一條真 fail-open 只會從這裡出生
 *     ⇒ 已上機制守門 `scripts/a9g2-charge-attempts-grant-guard.test.ts`(關卡2 codex MF2:
 *       只寫註解攔不住,新增 grant 的那筆 migration 必須當場紅)。
 * ⇒ `ADMIN_ORDER_DETAIL_SELECT` **只准 service_role client 使用**。
 *
 * 🔴 `>=` 而非「取 limit+1 再 `>`」(關卡2 codex nit2,**評估後不改**):恰好 50 筆會被判成
 * `'unknown'`、該單在 UI 上永遠不給取消。方向是 fail-closed、且扣款嘗試實務上個位數;
 * 換成 limit+1 要讓本檔的邊界語意與 `ORDER_ITEMS_EMBED_LIMIT` 等兄弟常數分家,不划算。
 */
function mapChargeAttemptGate(
  attempts?: { status: string }[] | { status: string } | null,
): 'clear' | 'blocked' | 'unknown' {
  // 缺鍵(投影退版)/ null = 不知道 ⇒ fail-closed。
  if (!attempts) return 'unknown';
  // 🔴 單物件 = **我們沒預期的形狀**(規則上必為陣列,見上)⇒ 它證明不了「沒有其他在途筆」。
  //    看到非 failed 就 `'blocked'`;是 failed 也只能回 `'unknown'`,**絕不回 `'clear'`**
  //    (關卡2 R2 codex MF1:原本把它當成「長度 1 的完整清單」⇒ 只有一筆 failed 時會誤放行)。
  if (!Array.isArray(attempts)) {
    return attempts.status !== CHARGE_ATTEMPT_TERMINAL_FAILED ? 'blocked' : 'unknown';
  }
  // 看到在途的就結案:清單完不完整都改不了「必被 A8a2 拒」。
  if (attempts.some((a) => a.status !== CHARGE_ATTEMPT_TERMINAL_FAILED)) return 'blocked';
  return attempts.length >= PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT ? 'unknown' : 'clear';
}

/** jsonb 防禦取 string 欄:非物件/非字串/空字串 → null(DB 腐壞不炸頁、誠實顯示缺)。 */
function pickString(obj: unknown, key: string): string | null {
  if (obj === null || typeof obj !== 'object') return null;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * **列印用**品項投影的 wire 形狀(`Q-C18` 甲,2026-08-17)。
 *
 * 🔴 與 `SupabaseAdminOrderDetailRow['order_items'][number]` 是**同一張表的兩個投影,刻意不同**:
 * 明細那份是**內嵌**撈的(筆數被 `ORDER_ITEMS_EMBED_LIMIT` 夾住);這份是**頂層分頁**撈的,
 * 用途是讓「這張單有哪些品項」不再被上限截斷。
 * ⚠️ **刻意沒有 `order_item_procurement`** —— 它自己就是另一道內嵌上限
 * (`ORDER_ITEM_PROCUREMENT_EMBED_LIMIT`),取了等於把同一個病帶進新的查詢。
 * **看到這裡覺得「漏了採購」而順手補上去的人,請先讀 `AdminOrderPrintItem` 的 docstring。**
 * ⚠️ **`unit_price` / `line_total` 是【另一個理由】,不要跟上面那條混**:它們是同列 scalar、
 * **取了不產生任何截斷面**,現在沒取純粹因為紙上零金額 ⇒ **金額片可以直接加,不受上面那條約束。**
 */
export type SupabaseOrderItemPrintRow = {
  id: string;
  variant_sku: string;
  quantity: number;
  product_snapshot: unknown;
  /** 形狀(陣列 or 單物件 or 缺鍵)與明細那份逐字相同 —— 理由見 `mapQuantitySummary` docstring。 */
  order_item_quantity_summary?:
    | SupabaseOrderItemQuantitySummaryRow[]
    | SupabaseOrderItemQuantitySummaryRow
    | null;
};

/**
 * `SupabaseOrderItemPrintRow` → `AdminOrderPrintItem`。
 *
 * 🔴 **重用 `pickString` / `pickSpec` / `mapQuantitySummary` 三支私有函式,而那正是本函式住在這裡
 * 而不是住在 `apps/admin` 的理由** —— 那三支沒有 `export`,放 admin 就得抄一份,
 * 而「同一份資料兩份實作」正是 backlog `#602` 登記的病。
 */
export function mapSupabaseOrderItemPrintRow(row: SupabaseOrderItemPrintRow): AdminOrderPrintItem {
  return {
    id: row.id,
    variantSku: row.variant_sku,
    title: pickString(row.product_snapshot, 'title'),
    spec: pickSpec(row.product_snapshot),
    quantity: row.quantity,
    quantitySummary: mapQuantitySummary(row.order_item_quantity_summary),
  };
}

/** product_snapshot.spec 防禦解析:物件且值全轉字串;缺/非物件 → null。 */
function pickSpec(snapshot: unknown): Record<string, string> | null {
  if (snapshot === null || typeof snapshot !== 'object') return null;
  const spec = (snapshot as Record<string, unknown>).spec;
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec as Record<string, unknown>)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** invoice_status 防禦 narrow:DB CHECK 三值;意外值 fail-safe 當 'not_issued' 顯示、不炸頁。 */
function narrowInvoiceStatus(raw: string): InvoiceStatus {
  return raw === 'issued' || raw === 'voided' ? raw : 'not_issued';
}

/**
 * wire orders 明細 row → domain AdminOrderDetail(snake_case → camelCase;M-4a Slice B)。
 *
 * 金額全走 `toMoneyAmount` 中央守門(整數/非負;絕不 `as MoneyAmount`);jsonb(收件快照/開票需求/
 * 品項 snapshot)逐欄防禦解析(缺/形狀不對 → null,頁面顯示「—」、不 500);
 * `orderSource`/`paymentChannel` text→enum narrow 同摘要慣例(DB CHECK 保證值域)。
 */
export function mapSupabaseAdminOrderDetailRowToDetail(
  row: SupabaseAdminOrderDetailRow,
): AdminOrderDetail {
  const customer = row.customers == null ? null : Array.isArray(row.customers) ? row.customers[0] : row.customers;
  // M-4b E10 A9a-1:排序 + U6 告知義務都在 mapper(PostgREST 不保證內嵌列順序、投影不支援子查詢)
  // 🔴 **#328 已修:這裡不再補 `?? []`**(2026-08-11)。缺鍵原樣傳進 mapper,由它翻成
  //    「無法判定」。舊寫法把「沒讀到」翻成「讀到了、零筆」⇒ 畫面說「尚未告知客人」= 假資料上的 U6 判斷。
  //    ⚠️ **不要好心把它加回來** —— 加回 `?? []` 的那一刻,守門會紅在 `order-notes.test.ts`
  //    的「缺鍵 ⇒ customerNotified 為 null」那格,那不是測試壞了。
  const notesProjection = mapSupabaseOrderNoteRowsToProjection(row.order_notes);
  // 🔴 A9g-3:**不加 `?? []`** —— 缺鍵必須原樣傳進 mapper,才翻得成
  //    `cancellations: null`(= 沒讀到)。加了 `?? []` 就會變成「讀到了、真的沒取消過」。
  //    (#328 之後 notes 與本行**同一個方向**了;原本兩行語意不一致的那段記載已隨修法移除。)
  const cancellationProjection = mapSupabaseOrderCancellationRowsToProjection(
    row.order_cancellations,
  );
  return {
    id: row.id,
    displayId: row.display_id,
    createdAt: row.created_at,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    // (D-2 起不攜 orders.workflow_status;A9w3 起連 items[].workflow_status 與 items[].version
    //  都退出明細投影 —— 明細頁的九碼下拉已在 A9w1 下架,那兩欄的唯一用途就是它。)
    orderSource: row.order_source as OrderSource, // DB orders_order_source_check 保證值域
    paymentChannel: row.payment_channel as PaymentChannel, // DB orders_payment_channel_check 保證值域
    paymentMethod: row.payment_method,
    paidAt: row.paid_at,
    subtotal: { amount: toMoneyAmount(row.subtotal), currency: 'TWD' },
    shippingFee: { amount: toMoneyAmount(row.shipping_fee), currency: 'TWD' },
    discountTotal: { amount: toMoneyAmount(row.discount_total), currency: 'TWD' },
    total: { amount: toMoneyAmount(row.total), currency: 'TWD' },
    shippingMethod: row.shipping_method,
    shippingAddress: {
      name: pickString(row.shipping_address_snapshot, 'name'),
      phone: pickString(row.shipping_address_snapshot, 'phone'),
      line: pickString(row.shipping_address_snapshot, 'line'),
    },
    /**
     * OD 片 2:客人明細入口的 id。
     *
     * 🔴 **不能直送**(codex 關卡2 important 抓到):DB 端是 `uuid NOT NULL`
     * (建表 `20260604120000:95`),但那保證的是**列裡有值**、不是**wire row 裡有這個鍵**——
     * 投影退版時整個鍵會消失,直送就產出一個型別說 `string`、實際 `undefined` 的值,
     * 下游拼成 `/customers/undefined`,**沒有任何一步會失敗**。
     * 🔴 也**不寫 `?? ''`**:空字串會拼成 `/customers/`,同樣是「看起來合法的壞路徑」。
     * ⇒ 缺鍵/非字串/空字串一律收斂成 `null` = 「沒讀到」,由型別逼消費端 fail-closed。
     */
    customerUserId:
      typeof row.customer_user_id === 'string' && row.customer_user_id !== ''
        ? row.customer_user_id
        : null,
    customer: {
      name: customer?.name ?? null,
      email: customer?.email ?? null,
      phone: customer?.phone ?? null,
    },
    invoiceRequest: {
      type: pickString(row.invoice, 'type'),
      taxId: pickString(row.invoice, 'taxId'),
      title: pickString(row.invoice, 'title'),
      carrier: pickString(row.invoice, 'carrier'),
      donateCode: pickString(row.invoice, 'donateCode'),
    },
    invoiceNumber: row.invoice_number,
    invoiceAmount:
      row.invoice_amount === null
        ? null
        : { amount: toMoneyAmount(row.invoice_amount), currency: 'TWD' },
    invoiceStatus: narrowInvoiceStatus(row.invoice_status),
    cancelledAt: row.cancelled_at,
    cancelledReason: row.cancelled_reason,
    version: row.version, // M-4a Slice C:明細頁改單表單帶此值當樂觀鎖條件
    items: row.order_items.map((item): AdminOrderDetailItem => {
      // M-4b E10 A9a-2:排序與「清單可信嗎」都在 mapper(PostgREST 不保證內嵌列順序)。
      // 🔴 **不加 `?? []`**:缺鍵與空陣列在下游是兩件事(前者不可信、後者是真的沒訂過貨),
      //    由 mapper 分辨、翻成 `procurementTruncated`(關卡2 codex MF1)。
      const procurementProjection = mapSupabaseProcurementRowsToProjection(
        item.order_item_procurement,
      );
      return {
        id: item.id,
        variantSku: item.variant_sku,
        title: pickString(item.product_snapshot, 'title'),
        spec: pickSpec(item.product_snapshot),
        quantity: item.quantity,
        unitPrice: { amount: toMoneyAmount(item.unit_price), currency: 'TWD' },
        lineTotal: { amount: toMoneyAmount(item.line_total), currency: 'TWD' },
        procurements: procurementProjection.procurements,
        procurementTruncated: procurementProjection.procurementTruncated,
        quantitySummary: mapQuantitySummary(item.order_item_quantity_summary),
      };
    }),
    notes: notesProjection.notes,
    customerNotified: notesProjection.customerNotified,
    notesTruncated: notesProjection.notesTruncated,
    // 🔴 A9a-2:品項自己被切掉時,per-item 的 procurementTruncated 會連同品項一起消失
    //    ⇒ 這一層的旗標是它的前提,兩者要一起讀(關卡2 codex MF2)。
    itemsTruncated: row.order_items.length >= ORDER_ITEMS_EMBED_LIMIT,
    // 🔴 A9g-2:**不加 `?? []`** —— 缺鍵(投影退版)在這裡不是「零筆嘗試」而是「不知道」,
    //    必須翻成 `'unknown'` 走 fail-closed,不能靜默變成「沒有在途扣款 ⇒ 可以取消」。
    chargeAttemptGate: mapChargeAttemptGate(row.payment_charge_attempts),
    // 🔴 A9g-3:同樣**不加 `?? []`** —— 缺鍵是「沒讀到」不是「沒被取消過」,
    //    由 mapper 翻成 cancellationsTruncated=true(見該函式 docstring)。
    // 🔴 **逐欄取出、不用 spread**(R1 nit 10;慣例同上面 notes 那組):spread 放在物件字面最後一格時,
    //    投影型別日後多一個與上方同名的鍵會**靜默覆蓋**已賦的值,且 spread 不受 excess property check 保護。
    cancellations: cancellationProjection.cancellations,
    cancellationsTruncated: cancellationProjection.cancellationsTruncated,
  };
}
