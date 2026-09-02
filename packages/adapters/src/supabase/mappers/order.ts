import type {
  OrderListItem,
  MemberOrderDetail,
  MemberOrderDetailItem,
  PlaceOrderInput,
  PlaceOrderLine,
  PlaceOrderVehicle,
  OrderInvoice,
  AdminOrderDetail,
  AdminOrderDetailItem,
  AdminOrderDetailFullItem,
  AdminOrderPrintItem,
  AdminOrderItemQuantitySummary,
  AdminOrderLine,
  AdminOrderSummary,
  OrderItemVehicleSnapshot,
  InvoiceStatus,
  OrderSource,
  PaymentChannel,
} from '@pcm/domain';
import { toMoneyAmount, orderCancelKindOf } from '@pcm/domain';
import { narrowMemberTier } from './member-tier';
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
 * 對齊 migration create_order **9-param**(第 9 參數 p_notification_email)+ return DTO `{order_id, display_id}`。
 * 🔴 **M-4a B-4 起鍵無條件存在 ⇒ 實際送出的一律是 9 參**;~~flag-off 8 / flag-on 9~~ 是 B-2/B-3 的形狀,已不成立。
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

/** create_order RPC 入參(wire;🔴 B-4 起第 9 鍵無條件帶上 ⇒ 實際永遠是 9 參)。 */
/* ~~B-3 以 optional key 區分 flag-off 8 / flag-on 9 參數形狀~~ —— 型別上仍 optional(舊 caller 相容),
   而結帳這條唯一的建單路徑 `charge-actions.ts` 已無條件帶鍵。 */
export type CreateOrderRpcArgs = {
  p_lines: CreateOrderRpcLine[];
  p_address_id: string;
  p_shipping_method: 'home' | 'store';
  p_invoice: CreateOrderRpcInvoice;
  p_cart_session_id: string; // 3DS-0b cart-instance key(uuid);RPC 入口 null fail-closed;非價/tier
  p_terms_version: string; // 🔴 #241 同意條款版本(server 注入);RPC NULL/空 fail-closed
  p_client_ip: string | null; // 🔴 #241 best-effort 同意來源 IP(可 null;RPC left 截 128);PII、非價
  p_client_ua: string | null; // 🔴 #241 best-effort User-Agent(可 null;RPC left 截 1024);PII、非價
  p_notification_email?: string | null; // 🔴 B-4 起送 canonical 真值(解不出 ⇒ null);~~B-3 只允許 null marker~~
  /**
   * 🔴 券片3:**優惠券碼**(不是金額)。**選填** —— 見 mapper 裡那段「有值才送」的理由。
   * DB 那一側 `p_coupon_code text DEFAULT NULL`(`20260901003000`), 金額由 DB 呼 `redeem_coupon` 算。
   */
  p_coupon_code?: string;
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
    // 🔴 B-4:鍵存在就送【真值】(input 解不出收件人時本來就是 null)。
    //    ~~B-3:鍵存在也只送 null marker~~ —— 那一版的前提是「flag 決定送不送第 9 參」,
    //    而 B-4 把持久化拿出 flag 之外(plan §4.1),鍵從此無條件存在。
    ...(Object.prototype.hasOwnProperty.call(input, 'notificationEmail')
      ? { p_notification_email: input.notificationEmail ?? null }
      : {}),
    // 🔴 券片3(2026-09-01):**券碼**, 不是金額。**有值才送**, 照上面那個鍵的慣例。
    //    ⛔ ~~原本送 `p_discount_total`(一個算好的金額)~~ ⇒ 那是**客人可控的**
    //    (create_order 是 SECURITY DEFINER 且 GRANT TO authenticated, PostgREST 自動暴露)
    //    ⇒ 📌 而那正是本檔上面那條紅線禁的東西:「價 / 運費 / 歸屬 / tier 全 RPC server 權威算」。
    // ✅ 改送券碼 ⇒ 金額在 DB 那一側由 `redeem_coupon` 試算出來, 呼叫端說了不算。
    // 🛑 而「有值才送」是上線順序的安全帶:先 DB 後 TS, 窗口期多送一個參數會讓 RPC 整個打不中。
    ...(typeof input.couponCode === 'string' && input.couponCode.trim() !== ''
      ? { p_coupon_code: input.couponCode.trim() }
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
 * 🔴 鐵則 12:**不含** 經銷價 / cost / tier / PII —— 投影白名單外的欄不在此型別。
 *   ⚠️ ~~原句寫「不含 unit_price / line_total / product_snapshot」~~ ⇒ **2026-08-29 起那半是假的**:
 *   Sean 拍板訂單記錄卡片要列出每件商品(有圖有品名)⇒ `line_total` / `product_snapshot` /
 *   `product_variants(images, products(images, brands(name)))` 進了投影(`unit_price` **仍然不取**:
 *   稿印的是小計 ⇒ 取 `line_total` 就夠,最小權限)。
 *   **放行理由逐欄在 `SupabaseOrderAdapter.ts` 的 `ORDER_LIST_SELECT` docstring**;一句話版:
 *   `product_snapshot` 的安全性是 **DB CHECK 保證**(exact key set + 價格鍵 blacklist),
 *   而巢狀那段與 `MEMBER_ORDER_DETAIL_SELECT`(`#240` 已審、已上線)**逐字相同**。
 *   🔴 **留原句在這裡是刻意的** —— 掃「這一面沒有 product_snapshot」的人會撞到它,
 *      而它現在自己說得出【我什麼時候、為什麼不再成立】。
 *
 * 🔵 **真權威是那個 `toBe()`,不是這段散文**(2026-08-31 `-15` 加):
 *    `packages/adapters/src/supabase/SupabaseOrderAdapter.test.ts:216`
 *    `expect(ORDER_LIST_SELECT).toBe(…)` —— **逐字完全相等**,任何一次擴欄都會紅
 *    (同檔 `:240` 逐個掃禁用欄、`:249` 自帶正對照)。**實測:偷加 `dealer_price` ⇒ 1 failed。**
 *    📌 **⇒ 這段字會過期,那一格不會 —— 兩者不一致時以那一格為準。**
 */
export type SupabaseOrderListRow = Pick<
  Database['public']['Tables']['orders']['Row'],
  | 'id'
  | 'display_id'
  | 'created_at'
  | 'payment_status'
  | 'fulfillment_status'
  | 'total'
  // 🔴 `#249`(2026-08-24):取消軸。**取消不動 `payment_status`** ⇒ 少了這兩欄,
  //    已取消單在列表上與「還付得了的單」逐欄相同、一律印「待付款」。
  | 'cancelled_at'
  | 'cancelled_reason'
> & {
  /**
   * 內嵌 `order_items`、to-many 非 null array(FK order_items_order_id_fkey、isOneToOne:false)。
   * 🔴 2026-08-29 起多帶三樣(卡片商品列):`line_total` / `product_snapshot` /
   *    `product_variants(images, products(images, brands(name)))`。
   * ⚠️ 巢狀那段的**型別形狀刻意與明細側同款**(`images: unknown` + 一路可 null)——
   *    join 任一層缺就是 `null`,而那是**合法的**(變體被刪 `ON DELETE SET NULL`)、不是錯誤。
   */
  order_items: {
    quantity: number;
    line_total: number;
    product_snapshot: unknown; // jsonb;DB CHECK 保證 exact key set {title,sku,spec} 且 spec 無價格鍵
    product_variants: {
      images: unknown;
      products: { images: unknown; brands: { name: string } | null } | null;
    } | null;
  }[];
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
    // 🔴🔴 `#249` + codex must-fix(2026-08-24):**原文在這裡就停住,不往下游走。**
    //    `cancelled_reason` 在 `p_reason_code = 'other'` 時裝的是【員工當場打的字】
    //    (`20260804180000_..._admin_cancel_order.sql:135-136`)⇒ 帶下去就進了客人的瀏覽器。
    //    ⇒ **這一行是那道邊界**:算成枚舉、丟掉原文。理由全文在 `orderCancelKindOf`。
    cancelledAt: row.cancelled_at,
    cancelKind: orderCancelKindOf({
      cancelledAt: row.cancelled_at,
      cancelledReason: row.cancelled_reason,
    }),
    itemCount: row.order_items.reduce((sum, item) => sum + item.quantity, 0),
    // 🔴 **客人端的截斷旗標**(2026-08-16,`Q-EMBED-1` Sean 批)。
    //    這一面的後果與後台不同:後台是**算錯一個狀態**,這裡是**印一個少算的件數**。
    //    ⇒ 客人看到「3 件」而實際訂了 600 件 —— **他不會知道,也不會回報**(他沒有第二個來源可以對)。
    //    判法逐字沿用另外兩處:**要 N 筆、拿回剛好 N 筆就當作可能被切了**。
    itemCountTruncated: row.order_items.length >= ORDER_LIST_ITEMS_EMBED_LIMIT,
    // 🔴 卡片商品列(2026-08-29,Sean 拍板「列出每件商品,有圖有品名」)。
    //    ⚠️ **與 `itemCount` 是兩個不同的東西,不要用 `items.length` 取代它**:
    //       `itemCount` = Σquantity(Q4=B 總數量),而 `items.length` = 列數。
    //       一張「同一個品項買 3 個」的單:itemCount=3、items.length=1。
    //    🔴 **而 `itemCountTruncated` 為真時 `items` 也是被切過的** —— 兩者同一個成因
    //       (內嵌上限),所以顯示端印「?」的那張卡,商品列也不完整。
    //       ⇒ 顯示端要嘛一起處理、要嘛明說只列出部分,不得讓客人以為那就是全部。
    items: row.order_items.map((item) => ({
      title: pickString(item.product_snapshot, 'title'),
      // brand / image 走 variant→product 兩段 fallback,**與明細側逐字同款**(不自己另寫一套)。
      brand: item.product_variants?.products?.brands?.name ?? null,
      imageUrl:
        pickFirstImage(item.product_variants?.images) ??
        pickFirstImage(item.product_variants?.products?.images),
      quantity: item.quantity,
      lineTotal: { amount: toMoneyAmount(item.line_total), currency: 'TWD' as const },
    })),
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
  // 🔴 `#24`(2026-08-26):收件人快照。**這一欄原本【刻意】不在列表投影裡** ——
  //    `SupabaseOrderAdapter.test.ts` 的 forbidden 清單擋著它,而 Sean 2026-08-26 拍板拿掉那道屏障
  //    (他選「甲」;選項字面的作者是線1)。代價他看過:「拿掉之後它每次開訂單列表都會進去。」
  //    ⇒ 值由 `pickShippingAddress` 防禦式解析(jsonb 可能壞掉 ⇒ 要 null 不要整頁炸掉)。
  | 'shipping_address_snapshot'
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
    /* `#24`(2026-08-26):收件人三格進**列表**讀模型。
       🔴 **這一欄原本【刻意】不在列表側** —— `SupabaseOrderAdapter.test.ts` 的 forbidden 清單
          擋著它, 而 Sean 2026-08-26 拍板拿掉那道屏障(他選「甲」;選項字面的作者是線1)。
          代價他看過:「拿掉之後它每次開訂單列表都會進去。」
       ✅ 走**明細側同一支** `pickShippingAddress`(本檔下方,`function pickShippingAddress` 一處,grep 得到), 不另寫一份解析 ——
          它是「三欄逐一取字串, 缺就 null」的防禦式解析, 而 snapshot 是 jsonb
          ⇒ 資料壞掉時要的是 null 不是整頁炸掉。 */
    shippingAddress: pickShippingAddress(row.shipping_address_snapshot),
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    orderSource: row.order_source as OrderSource, // DB orders_order_source_check 保證值域
    paymentChannel: row.payment_channel as PaymentChannel, // DB orders_payment_channel_check 保證值域
    total: { amount: toMoneyAmount(row.total), currency: 'TWD' },
    displayPosition: row.display_position,
    cancelledAt: row.cancelled_at,
    // (D-2 起不攜 orders.workflow_status/version:per-item 真相在 lines[]、整單=顯示端彙總。)
    // 🔴 `#879`:runtime 收窄。⚠️ **正下方那句拍板(走 narrowInvoiceStatus、不是裸 as)講的正是這件事**,
    //    而這一行在它旁邊躺了一段時間 —— 「同檔同欄兩種硬度」的第二個實例。
    tierAtCheckout: narrowMemberTier(row.tier_at_checkout, 'mappers/order.tierAtCheckout'), // M-4a Slice D-1a:會員等級
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
 * (~~production 實測 1000~~ ⇒ **2026-08-18 實測 `2000`**:Sean 親手調;
 *  V 窗量法 `products?select=id&limit=5000` ⇒ HTTP `206`、`content-range 0-1999/19777`。
 *  🔴 **本段兩位改動者(I 窗、B 窗)均未自驗,都是轉錄 V 窗量測**)——
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

/**
 * 內嵌回來的一筆扣款嘗試(`#808`/`#387` gate 拆四態,2026-08-21)。
 *
 * 🔴 **兩欄都綁生成型別**(R1 F3 + R2 nit-2):手寫欄名在 DB 改名時不會紅,而 PostgREST 會回 400
 * ⇒ **整頁明細掛掉**,不是只掉這個閘。`needs_manual_review` 用 indexed access 綁,
 * 因為它要保住 `?`(投影退版時整欄缺席)—— 理由見它自己的註解。
 * `mapChargeAttemptGate` 只認 `=== true`,缺欄時落回拆分前 `'blocked'` 的同一個世界(`'in_flight'`),
 * 不會憑空宣稱「系統放棄了」。
 */
export type SupabaseChargeAttemptRow = Pick<
  Database['public']['Tables']['payment_charge_attempts']['Row'],
  'status'
> & {
  /**
   * 🔴 **optional + nullable 是刻意的,而它與 DB 的形狀不同**(DB 端是 `boolean NOT NULL DEFAULT false`):
   * 投影退版時這一欄會整個不見,而**「沒讀到」不可以被靜默讀成 `false`(= 系統沒舉手)**。
   *
   * 🔴 ~~第一版這裡寫「**不能**直接 `Pick` 那一欄,`Pick` 會把缺席這個世界從型別上抹掉」~~
   * —— **那句話是假的**(關卡2 R2 nit-2 抓到)。用 indexed access 就同時做得到兩件事:
   * 綁住欄名(DB 改名 ⇒ `tsc` 紅)、又保住 `?` 與 `| null`。下面就是那個寫法。
   * ⚠️ 留著這段刪節號是因為那句假話**會誤導下一個人**把手寫欄名複製到下一個投影型別。
   */
  needs_manual_review?:
    | Database['public']['Tables']['payment_charge_attempts']['Row']['needs_manual_review']
    | null;
};

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
     * 片16(2026-08-19):品牌 join(`variant → product → brand`,many-to-one 單物件)。
     * 🔴 **型別與列表側逐字相同**(`SupabaseOrderItemBrandEmbed`)—— 兩條路的 wire 形狀是同一個,
     *    各自寫一份手型別就是白名單有兩份副本的老病。
     * 🔴 optional + nullable 的理由同其餘內嵌:投影退版或舊 row 會整個沒有這個鍵。
     */
    product_variants?: { products: { brands: { name: string } | null } | null } | null;
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
   * M-4b E10 A9g-2:扣款嘗試內嵌。🔴 **只取 `status` 與 `needs_manual_review` 兩欄** —— 本表帶大量金流敏感欄
   * (`rec_trade_id` / `bank_transaction_id` / `fallback_token_hash`),取消 UI 只需要
   * 「有沒有非 failed 的」與「系統有沒有對它舉手」這兩個布林事實,多取一個欄都是白給的洩漏面。
   * 🔴 `needs_manual_review`(`#808`,2026-08-21)**是布林、不是金流值** —— 它只說
   * 「`expire_stuck_attempts_at_ceiling` 有沒有把這筆標成要人工處理」,不含任何金額或卡號面。
   * 🔴 optional + nullable 理由同 `order_notes`:投影退版會整個沒有這個鍵。
   */
  payment_charge_attempts?: SupabaseChargeAttemptRow[] | SupabaseChargeAttemptRow | null;
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
 * 扣款嘗試內嵌 → 取消 UI 的在途扣款閘**四態**(M-4b E10 A9g-2;`#808` 2026-08-21 起,
 * ~~原三態~~ `'blocked'` 拆成 `'in_flight'` / `'stuck'`,拆的軸是 `needs_manual_review`)。
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
  attempts?: SupabaseChargeAttemptRow[] | SupabaseChargeAttemptRow | null,
): 'clear' | 'in_flight' | 'stuck' | 'unknown' {
  // 缺鍵(投影退版)/ null = 不知道 ⇒ fail-closed。
  if (!attempts) return 'unknown';
  // 🔴 單物件 = **我們沒預期的形狀**(規則上必為陣列,見上)⇒ 它證明不了「沒有其他在途筆」。
  //    看到非 failed 就走 `liveGate`(拆分前是 `'blocked'`);是 failed 也只能回 `'unknown'`,
  //    **絕不回 `'clear'`**(關卡2 R2 codex MF1:原本把它當成「長度 1 的完整清單」⇒
  //    只有一筆 failed 時會誤放行)。
  if (!Array.isArray(attempts)) {
    // 🔴 單物件是**沒預期的形狀** ⇒ `complete: false`(關卡2 codex C2):它證明不了
    //    「沒有其他被舉手的 sibling」,所以只能說「有在途的」,說不出是哪一種在途。
    return attempts.status !== CHARGE_ATTEMPT_TERMINAL_FAILED
      ? liveGate([attempts], false)
      : 'unknown';
  }
  // 看到在途的就結案:清單完不完整都改不了「必被 A8a2 拒」。
  const live = attempts.filter((a) => a.status !== CHARGE_ATTEMPT_TERMINAL_FAILED);
  // 🔴 觸及上限 = 看到的是子集(關卡2 codex C1)⇒ 沒看到的那幾筆可能就帶著舉手旗標。
  //    **擋不擋**不受影響(有在途的就是擋),受影響的是**說得出哪一種在途**。
  const complete = attempts.length < PAYMENT_CHARGE_ATTEMPTS_EMBED_LIMIT;
  if (live.length > 0) return liveGate(live, complete);
  return complete ? 'clear' : 'unknown';
}

/**
 * 非 failed 的那幾筆,再分「還在跑」與「系統已經放棄」(`#808`/`#387`,Sean 2026-08-21 答甲)。
 *
 * 🔴 **`=== true` 而非 truthy,而且缺欄時回 `'in_flight'` 不是 `'stuck'`** —— 兩件事都是刻意的:
 *   · `needs_manual_review` 讀不到(投影退版 / 舊 client)⇒ `undefined` ⇒ 回 `'in_flight'`
 *     = **與拆分前的 `'blocked'` 逐字同一個世界**。四態對三態是純增量,不改任何既有行為。
 *   · 反過來把缺欄當 `'stuck'` 會讓「我沒讀到」長成「系統已經放棄自動重試」這句**斷言**,
 *     而那句話是要叫員工去 TapPay 後台跑一趟的 ⇒ 沒量到的東西不許長成祈使句。
 * ⚠️ 兩態的**擋不擋**完全相同(都不給取消)⇒ 判錯的代價封頂在文案,動不到錢;
 *   權威永遠是 A8a2 在交易內的重查(同 `AdminOrderDetail.chargeAttemptGate` 的立場)。
 * 🔴 只要**任一筆**在途的被舉手就算 `'stuck'`:那張單已經需要人介入,而「另外還有一筆在跑」
 *   不會讓被舉手的那筆自己好起來。
 */
function liveGate(
  live: SupabaseChargeAttemptRow[],
  complete: boolean,
): 'in_flight' | 'stuck' | 'unknown' {
  // ① 看到旗標就結案 —— **看到的事實不會被沒看到的東西推翻**,清單完不完整都一樣。
  if (live.some((a) => a.needs_manual_review === true)) return 'stuck';
  // ② 值不是布林也不是缺席 = wire shape 壞了(關卡2 codex C3:`'true'` 字串 / `1`)
  //    ⇒ 我們讀不懂它 ⇒ **不可以說成「還在跑」**。DB 端是 `boolean NOT NULL`,
  //    規則上到不了這裡;留著的理由與單物件那條同源:賭錯的代價是對員工說一句假話。
  const unreadable = live.some(
    (a) =>
      a.needs_manual_review !== undefined &&
      a.needs_manual_review !== null &&
      typeof a.needs_manual_review !== 'boolean',
  );
  if (unreadable) return 'unknown';
  // ③ 沒看到旗標,而清單只是子集 ⇒ **「沒看到」不等於「沒有」**(關卡2 codex C1/C2)。
  //    這是本片唯一一處會回 `'unknown'` 的新路徑,方向是 fail-closed:
  //    寧可說「讀不完整」,不說一句會叫員工坐著等的「還在跑」。
  return complete ? 'in_flight' : 'unknown';
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

/**
 * **明細頁**的品項列(`D2` C 條,2026-08-18)= 列印那份 **+ 兩個同列 scalar**。
 *
 * 🔴 用交集型別而不是重打一份:兩者的共同欄只有一個定義處,**漂不了**。
 * ⚠️ 而 `unit_price` / `line_total` 是**成交價**(該單實際賣價,非經銷價表)——
 * 見本檔 `:257` 那段既有註解。**它們只走後台明細,不進任何 client DTO。**
 */
export type SupabaseOrderItemDetailRow = SupabaseOrderItemPrintRow & {
  unit_price: number;
  line_total: number;
};

/**
 * `SupabaseOrderItemDetailRow` → `AdminOrderDetailFullItem`。
 *
 * 🔴 **金額走 `toMoneyAmount` 中央守門,不 `as MoneyAmount`** —— 與本檔 `:340-341`
 * 既有兩處逐字同源(整數/非負、零浮點)。**第三份實作不可以有自己的規則。**
 */
export function mapSupabaseOrderItemDetailRow(
  row: SupabaseOrderItemDetailRow,
): AdminOrderDetailFullItem {
  return {
    ...mapSupabaseOrderItemPrintRow(row),
    unitPrice: { amount: toMoneyAmount(row.unit_price), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(row.line_total), currency: 'TWD' },
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
        // 片16:取法與列表側 `:345` 逐字相同(任一層缺 → null)。
        brand: item.product_variants?.products?.brands?.name ?? null,
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

// ── 讀路徑(會員明細):orders row + 內嵌 order_items → domain MemberOrderDetail(#240)──

/**
 * **會員(客人)訂單明細**內嵌 `order_items` 的請求上限(`#240`)。
 *
 * 🔴 **這個上限存在的理由不是「避免傳太多」,是【把邊界從伺服器手上拿回來】**
 * (逐字沿用 `ORDER_ITEMS_EMBED_LIMIT` 的理由):`db-max-rows` **會**套用到內嵌陣列,
 * 而**內嵌被截斷時 PostgREST 不給任何訊號**(仍回 HTTP 200、`Content-Range` 不反映)
 * ⇒ **不設上限 = 一個偵測不到的懸崖**,而懸崖那頭是「客人看到一張少了品項的訂單」。
 *
 * 🔴 **與既有三個常數各自獨立、刻意不共用** —— 照 `ORDER_LIST_ITEMS_EMBED_LIMIT` docstring
 * (`:441-446`)立下的先例逐字:「與後台列表同值,**而那是巧合不是耦合** —— 兩者各自可調」。
 *
 * 值 = 200:與 admin 明細同值(PCM 一張單的品項數是個位數到數十),又**嚴格低於**實測的
 * 伺服器上限(2026-08-18 V 窗對正式站頂層實測 2000)。
 * ⚠️ 同一組殘餘風險:若專案 `max-rows` 日後被設到低於本值,截斷會發生在那個更低的數字上
 *    而本判定看不見(治本要 `count: 'exact'`)。
 */
export const MEMBER_ORDER_DETAIL_ITEMS_EMBED_LIMIT = 200;

/**
 * 會員明細讀 row 型別 —— **derive 自生成 Database Row**(對齊 `SupabaseOrderListRow` 慣例)。
 *
 * 只取 `MEMBER_ORDER_DETAIL_SELECT`(SupabaseOrderAdapter)投影的欄。
 * 🔴 鐵則 12:**不含** `tappay_rec_trade_id` / `tier_at_checkout` / 任何成本或經銷價欄;
 * 品項的 brand / images join 穿越 `product_variants` / `products`,而**只取 `brands(name)` 與 `images`**。
 */
export type SupabaseMemberOrderDetailRow = Pick<
  Database['public']['Tables']['orders']['Row'],
  | 'id'
  | 'display_id'
  | 'created_at'
  | 'payment_status'
  | 'fulfillment_status'
  | 'payment_method'
  | 'paid_at'
  | 'subtotal'
  | 'shipping_fee'
  | 'discount_total'
  | 'total'
  | 'shipping_method'
  | 'cancelled_at'
  | 'cancelled_reason'
> & {
  /** jsonb `{name,phone,line}`(DDL CHECK 硬鎖 exact key set);防禦解析、不信形狀 */
  shipping_address_snapshot: unknown;
  order_items: {
    id: string;
    variant_sku: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    /** jsonb;{sku,spec,title} 由 create_order 寫入,防禦解析 */
    product_snapshot: unknown;
    /** jsonb;V-3a 車款快照,可為 null */
    vehicle_snapshot: unknown;
    /** 🔴 商品下架時整個 embed 為 null(products_select_public qual = delisted_at IS NULL) */
    product_variants?: {
      images: unknown;
      products: { images: unknown; brands: { name: string } | null } | null;
    } | null;
  }[];
};

/** `orders.shipping_address_snapshot` 防禦解析:三欄逐一取字串,缺/非物件/非字串 → null。 */
function pickShippingAddress(raw: unknown): MemberOrderDetail['shippingAddress'] {
  return {
    name: pickString(raw, 'name'),
    phone: pickString(raw, 'phone'),
    line: pickString(raw, 'line'),
  };
}

/**
 * jsonb string array 的第一個元素(正式庫實查:`products.images` / `product_variants.images`
 * 皆為 `array` of `string`)。非陣列 / 空 / 首元素非字串 / 空字串 → null。
 */
function pickFirstImage(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const first = raw[0];
  return typeof first === 'string' && first !== '' ? first : null;
}

/**
 * wire orders 明細 row → domain `MemberOrderDetail`(`#240`)。
 *
 * - 金額四欄 integer → Money 走 `toMoneyAmount` 中央守門(整數/非負、零浮點、絕不 `as MoneyAmount`);
 * - `title` / `spec` / `vehicle` / 收件三欄**全部走既有的防禦解析器**,不另寫第二套;
 * - `imageUrl` **變體圖優先、退母商品圖**(變體有自己的圖時它比母商品圖精準);
 * - 🔴 `itemCount` 從**實際撈到的** `items[]` reduce,**不是** `OrderListItem.itemCount`;
 * - 🔴 `itemsTruncated` 判法逐字沿用另外三處:**要 N 筆、拿回剛好 N 筆就當作可能被切了**。
 */
export function mapSupabaseMemberOrderDetailRow(
  row: SupabaseMemberOrderDetailRow,
): MemberOrderDetail {
  const items = row.order_items.map((item): MemberOrderDetailItem => ({
    id: item.id,
    variantSku: item.variant_sku,
    // 🔴 任一層缺 → null。**而「商品已下架」正是會讓整個 embed 變 null 的成因之一**
    //    (RLS qual delisted_at IS NULL)⇒ 顯示端對 null 的處置寫在 domain docstring 上。
    brand: item.product_variants?.products?.brands?.name ?? null,
    title: pickString(item.product_snapshot, 'title'),
    spec: pickSpec(item.product_snapshot),
    imageUrl:
      pickFirstImage(item.product_variants?.images) ??
      pickFirstImage(item.product_variants?.products?.images),
    vehicle: parseVehicleSnapshot(item.vehicle_snapshot),
    quantity: item.quantity,
    unitPrice: { amount: toMoneyAmount(item.unit_price), currency: 'TWD' },
    lineTotal: { amount: toMoneyAmount(item.line_total), currency: 'TWD' },
  }));
  return {
    id: row.id,
    displayId: row.display_id,
    createdAt: row.created_at,
    paymentStatus: row.payment_status,
    fulfillmentStatus: row.fulfillment_status,
    paymentMethod: row.payment_method,
    paidAt: row.paid_at,
    subtotal: { amount: toMoneyAmount(row.subtotal), currency: 'TWD' },
    shippingFee: { amount: toMoneyAmount(row.shipping_fee), currency: 'TWD' },
    discountTotal: { amount: toMoneyAmount(row.discount_total), currency: 'TWD' },
    total: { amount: toMoneyAmount(row.total), currency: 'TWD' },
    shippingMethod: row.shipping_method,
    shippingAddress: pickShippingAddress(row.shipping_address_snapshot),
    // 🔴🔴 codex must-fix(2026-08-24):**與客人列表同一道邊界** —— 原文停在這裡。
    //    ⚠️ 這一頁**在 `#249` 之前對取消單不可達**(取消單恆 unpaid、被濾掉)⇒
    //       這一行原本每天都在跑,而它送出去的東西從來沒有人看得到。**路一開,它就成立了。**
    cancelledAt: row.cancelled_at,
    cancelKind: orderCancelKindOf({
      cancelledAt: row.cancelled_at,
      cancelledReason: row.cancelled_reason,
    }),
    items,
    itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    itemsTruncated: row.order_items.length >= MEMBER_ORDER_DETAIL_ITEMS_EMBED_LIMIT,
  };
}
