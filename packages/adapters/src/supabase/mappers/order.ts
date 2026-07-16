import type {
  OrderListItem,
  PlaceOrderInput,
  PlaceOrderLine,
  PlaceOrderVehicle,
  OrderInvoice,
  AdminOrderDetail,
  AdminOrderDetailItem,
  AdminOrderLine,
  AdminOrderSummary,
  OrderItemVehicleSnapshot,
  InvoiceStatus,
  OrderSource,
  PaymentChannel,
} from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import type { Database } from '../database.types';

/**
 * @module @pcm/adapters/supabase/mappers/order — domain PlaceOrderInput → create_order RPC 入參(wire)
 *   + orders row(摘要投影)→ domain OrderListItem(讀路徑、M-3 OrdersTab)
 *
 * 🔴 鐵則 12(plan v6 §5 紅線 3 server 價權威):wire 邊界**逐欄顯式建構、只送白名單鍵**,即使 input
 * 帶意外欄也不洩到 RPC(型別層已無價/tier、此處 wire 縱深)。domain camelCase → RPC snake_case;
 * domain `quantity` → RPC `qty`(對齊 create_order RPC `v_line->>'qty'`)。
 *
 * (ADR-0003 §3.4:wire 字面只在 mapper 邊界、不 leak domain/ports/use-case。)
 * 對齊 migration create_order **8-param**(#241 `20260630120000` 加 p_terms_version/p_client_ip/p_client_ua)+ return DTO `{order_id, display_id}`。
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

/** create_order RPC 入參(wire、對齊 #241 8-param:0b 5-param + p_terms_version / p_client_ip / p_client_ua)。 */
export type CreateOrderRpcArgs = {
  p_lines: CreateOrderRpcLine[];
  p_address_id: string;
  p_shipping_method: 'home' | 'store';
  p_invoice: CreateOrderRpcInvoice;
  p_cart_session_id: string; // 3DS-0b cart-instance key(uuid);RPC 入口 null fail-closed;非價/tier
  p_terms_version: string; // 🔴 #241 同意條款版本(server 注入);RPC NULL/空 fail-closed
  p_client_ip: string | null; // 🔴 #241 best-effort 同意來源 IP(可 null;RPC left 截 128);PII、非價
  p_client_ua: string | null; // 🔴 #241 best-effort User-Agent(可 null;RPC left 截 1024);PII、非價
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
    lines: (row.order_items ?? []).map(mapAdminOrderLine), // 每商品一列展開(order_items 缺 → 空陣列、顯示端兜「—」)
  };
}

// ── 讀路徑(admin 明細):orders row + 內嵌 customers / order_items → AdminOrderDetail(M-4a Slice B)──

/**
 * admin 明細讀 row 型別 —— derive 自生成 Database Row(對齊 SupabaseAdminOrderRow 慣例)。
 * 只取 `ADMIN_ORDER_DETAIL_SELECT` 投影欄。🔴 PII 欄(shipping_address_snapshot / invoice /
 * customers email·phone)只在明細投影;仍零成本欄、零 tappay_rec_trade_id。
 */
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
    workflow_status: string | null; // M-4a D-2:per-item 狀態(NULL=未設定)
    version: number; // M-4a D-2:per-item 樂觀鎖
  }[];
};

/** jsonb 防禦取 string 欄:非物件/非字串/空字串 → null(DB 腐壞不炸頁、誠實顯示缺)。 */
function pickString(obj: unknown, key: string): string | null {
  if (obj === null || typeof obj !== 'object') return null;
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' && value !== '' ? value : null;
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
  return {
    id: row.id,
    displayId: row.display_id,
    createdAt: row.created_at,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    // (D-2 起不攜 orders.workflow_status:明細「訂單狀態」=顯示端由 items[].workflowStatus 彙總。)
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
    items: row.order_items.map(
      (item): AdminOrderDetailItem => ({
        id: item.id,
        variantSku: item.variant_sku,
        title: pickString(item.product_snapshot, 'title'),
        spec: pickSpec(item.product_snapshot),
        quantity: item.quantity,
        unitPrice: { amount: toMoneyAmount(item.unit_price), currency: 'TWD' },
        lineTotal: { amount: toMoneyAmount(item.line_total), currency: 'TWD' },
        workflowStatus: item.workflow_status, // M-4a D-2:per-item 真相
        version: item.version, // per-item 改狀態表單樂觀鎖
      }),
    ),
  };
}
