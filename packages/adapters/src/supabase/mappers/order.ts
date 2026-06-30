import type { OrderListItem, PlaceOrderInput, PlaceOrderLine, OrderInvoice } from '@pcm/domain';
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

/** create_order RPC line(wire):variant_id XOR (supplier_slug, sku),皆帶 qty。 */
type CreateOrderRpcLine =
  | { variant_id: string; qty: number }
  | { supplier_slug: string; sku: string; qty: number };

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

/** 單一 line:domain camelCase + quantity → RPC snake_case + qty(顯式白名單鍵、不夾帶意外欄)。 */
function mapLine(line: PlaceOrderLine): CreateOrderRpcLine {
  if ('variantId' in line) {
    return { variant_id: line.variantId, qty: line.quantity };
  }
  return { supplier_slug: line.supplierSlug, sku: line.sku, qty: line.quantity };
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
