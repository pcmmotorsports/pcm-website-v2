// shipment-repository.ts — 出貨線(B2)五支 writer RPC 的唯一呼叫面 + 兩個讀取面。
//
// 片 2a(D-347-A / D-349-A;Sean 拍 S1=A C 版 + S2=A 含作廢)。UI 兩片(2b 勾選+彈窗、2c 詳情卡)都吃這支。
//
// 🔴 **寫入一律走既有 RPC,本檔零自寫 SQL**(D-347-A 工程紅線)。真正的正確性層在 DB:
//    CHECK / FK / 冪等層 / 死結重試都在 migration 裡,本檔只是型別安全的傳話筒。
//    ⇒ 這裡**不重複實作任何業務驗證**(例如「carrier 是 other 才可填 note」),那會變成第二個真相源;
//      UI 端擋是為了不讓員工按了才看到錯誤(體驗),DB 擋才是正確性。
//
// 🔴 **冪等鍵由呼叫端給、本檔不自己產**。理由:重試必須沿用**同一把鍵**才叫冪等;
//    若在這裡 `randomUUID()`,每次重試都是新鍵 ⇒ 冪等層完全失效而且零症狀
//    (對齊 memory `feedback_idempotency-key-must-be-verified-not-just-present`)。
//
// ⚠️ **本檔沒有實跑驗證過**:本 worktree 無 DB(無 `.env.local`、不碰 `.env*`)⇒ 下面所有形狀
//    都是**讀 migration 原始檔**得到的合約,不是打過 RPC 的觀察。真 DB smoke 由收割端補。

// 🔴 走 `/server` 子路徑,與 `customer-repository.ts:7` 同一個進入點 —— 從 `@pcm/adapters`
//    根路徑 import 會拿不到這個 export(typecheck 當場紅),而且那條路徑是給 client 用的。
import { createSupabaseServiceClient } from '@pcm/adapters/server';

/**
 * 五支 writer 的共同回傳信封。
 *
 * 🔴 形狀是**單一產生處**決定的:`pcm_b2_shipping_idem_response()`
 * (`20260807160000_…w2_shipping_idempotency_layer.sql`)回
 * `snapshot || {shipment_id, idempotent}`,而 snapshot 的鍵被
 * `pcm_b2_shipping_idem_bad_snapshot_cols()` 限制成**恰好** `id / shipment_reference / customer_user_id`。
 * ⇒ 恆為這五個鍵,首次成功與重放**逐鍵相同、只差 `idempotent`**。
 */
export type ShipmentWriteResult = {
  shipmentId: string;
  shipmentReference: string;
  customerUserId: string;
  /** true = 這次呼叫是**重放**(同鍵同 payload),DB 沒有再動一次。 */
  idempotent: boolean;
};

/** 快遞商三選。字面與 `shipments_carrier_domain` CHECK 同源。 */
export type CarrierCode = 'hct' | 'sf' | 'other';

/** 收件快照。DB 要求**恰好**這三個欄位(`pcm_b2_w3a_recipient_shape`),多一個少一個都退件。 */
export type RecipientSnapshot = { name: string; phone: string; line: string };

/** 掛品項的單筆。同一次呼叫裡 `orderItemId` 不得重複(DB 會退件並要求合併數量)。 */
export type ShipmentItemInput = { orderItemId: string; quantity: number };

/**
 * 把 RPC 的 `Json` 回傳收斂成 `ShipmentWriteResult`。
 *
 * 🔴 **不用 `as` 硬轉**:RPC 宣告的回傳型別是 `Json`,硬轉等於把「DB 真的回了這些鍵」
 *    這件事變成一個沒人驗的假設。少一個鍵時我們要當場炸,而不是讓 `undefined`
 *    一路流進畫面變成空白的箱號。
 */
function toWriteResult(raw: unknown, fn: string): ShipmentWriteResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${fn}:回傳不是 JSON 物件(實得 ${Array.isArray(raw) ? 'array' : typeof raw})`);
  }
  const o = raw as Record<string, unknown>;
  const need = (k: string): string => {
    const v = o[k];
    if (typeof v !== 'string' || v === '') {
      throw new Error(`${fn}:回傳缺少字串欄位 ${k}(實得 ${JSON.stringify(v)})`);
    }
    return v;
  };
  if (typeof o.idempotent !== 'boolean') {
    // 🔴 這個旗標是「這次到底有沒有真的動到資料」的唯一訊號,缺了它就分不出成功與重放。
    throw new Error(`${fn}:回傳缺少 boolean 欄位 idempotent(實得 ${JSON.stringify(o.idempotent)})`);
  }
  return {
    shipmentId: need('shipment_id'),
    shipmentReference: need('shipment_reference'),
    customerUserId: need('customer_user_id'),
    idempotent: o.idempotent,
  };
}

/**
 * 建箱(W3-1)。
 *
 * ⚠️ 箱子掛在**客人**下、**沒有 order_id** —— 一箱可跨同一位客人的多張訂單(C 版動線的根據)。
 * DB 會擋:carrier 三選 / `other` 與說明欄雙向配對 / 收件快照恰好三欄 / 客人必須存在。
 */
export async function createShipment(args: {
  idempotencyKey: string;
  customerUserId: string;
  recipient: RecipientSnapshot;
  carrierCode: CarrierCode;
  /** 只有 `carrierCode === 'other'` 時可(且必須)給。 */
  carrierNote?: string;
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_create_shipment', {
    p_idempotency_key: args.idempotencyKey,
    p_customer_user_id: args.customerUserId,
    p_recipient_snapshot: args.recipient,
    p_carrier_code: args.carrierCode,
    ...(args.carrierNote === undefined ? {} : { p_carrier_note: args.carrierNote }),
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_create_shipment');
}

/**
 * 掛品項(W3-2)。
 *
 * ⚠️ 同一次呼叫裡 `orderItemId` **不得重複**(DB 退件並要求合併數量)⇒ UI 用數量框、不要「再加一次」。
 * 箱子已作廢或已出貨都不能再掛。品項必須屬於這箱的同一位客人。
 */
export async function addShipmentItems(args: {
  idempotencyKey: string;
  shipmentId: string;
  items: readonly ShipmentItemInput[];
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_add_shipment_items', {
    p_idempotency_key: args.idempotencyKey,
    p_shipment_id: args.shipmentId,
    p_items: args.items.map((i) => ({ order_item_id: i.orderItemId, quantity: i.quantity })),
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_add_shipment_items');
}

/**
 * 標已出貨(W3-3)。
 *
 * ⚠️ 三閘:箱子存在且未作廢 / 至少 1 個品項 / 填了單號(只有 `carrier_code = 'other'` 可免)。
 */
export async function markShipmentShipped(args: {
  idempotencyKey: string;
  shipmentId: string;
  /** `carrier_code = 'other'` 以外都必填。 */
  trackingNumber?: string;
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_mark_shipment_shipped', {
    p_idempotency_key: args.idempotencyKey,
    p_shipment_id: args.shipmentId,
    ...(args.trackingNumber === undefined ? {} : { p_tracking_number: args.trackingNumber }),
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_mark_shipment_shipped');
}

/** 作廢這箱(W3-c1)。原因必填。作廢後不可再掛品項、不可出貨;要重出得開新的一箱。 */
export async function voidShipment(args: {
  idempotencyKey: string;
  shipmentId: string;
  voidReason: string;
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_void_shipment', {
    p_idempotency_key: args.idempotencyKey,
    p_shipment_id: args.shipmentId,
    p_void_reason: args.voidReason,
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_void_shipment');
}

/** 復原作廢(W3-c2)。 */
export async function unvoidShipment(args: {
  idempotencyKey: string;
  shipmentId: string;
}): Promise<ShipmentWriteResult> {
  const { data, error } = await createSupabaseServiceClient().rpc('admin_unvoid_shipment', {
    p_idempotency_key: args.idempotencyKey,
    p_shipment_id: args.shipmentId,
  });
  if (error) throw error;
  return toWriteResult(data, 'admin_unvoid_shipment');
}

// ── 讀取面 ─────────────────────────────────────────────────
// 🔴 讀**不走 RPC**:`shipments` / `shipment_items` 都有 `GRANT SELECT … TO service_role`
//    (s1a1:277 / s1b:254)⇒ 直接 SELECT。不為了對稱而多包一層沒有的 RPC。

/** 畫面用的一箱。`voidedAt` 非 null = 已作廢;`shippedAt` 非 null = 已出貨。 */
export type ShipmentRow = {
  id: string;
  shipmentReference: string;
  customerUserId: string;
  carrierCode: string;
  carrierNote: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
};

/** 一箱裡的一個品項。 */
export type ShipmentItemRow = {
  id: string;
  shipmentId: string;
  orderItemId: string;
  shippedQuantity: number;
};

/**
 * 依箱 id 取箱(訂單詳情頁的出貨卡用:先由品項查到箱 id,再查箱本身)。
 *
 * ⚠️ 不走 `listShipmentsByCustomer` 的原因:`AdminOrderDetail` **沒有 customer id**
 * (見 `shipment-candidates.ts` 檔頭那段),詳情頁拿不到客人身分。
 */
export async function listShipmentsByIds(ids: readonly string[]): Promise<ShipmentRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await createSupabaseServiceClient()
    .from('shipments')
    .select('id, shipment_reference, customer_user_id, carrier_code, carrier_note, tracking_number, shipped_at, deleted_at, void_reason')
    .in('id', [...ids])
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    shipmentReference: r.shipment_reference,
    customerUserId: r.customer_user_id,
    carrierCode: r.carrier_code,
    carrierNote: r.carrier_note,
    trackingNumber: r.tracking_number,
    shippedAt: r.shipped_at,
    voidedAt: r.deleted_at,
    voidReason: r.void_reason,
  }));
}

/** 某位客人的所有包裹(建箱動線用:看他還有哪些箱在路上)。 */
export async function listShipmentsByCustomer(customerUserId: string): Promise<ShipmentRow[]> {
  const { data, error } = await createSupabaseServiceClient()
    .from('shipments')
    .select('id, shipment_reference, customer_user_id, carrier_code, carrier_note, tracking_number, shipped_at, deleted_at, void_reason')
    .eq('customer_user_id', customerUserId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    shipmentReference: r.shipment_reference,
    customerUserId: r.customer_user_id,
    carrierCode: r.carrier_code,
    carrierNote: r.carrier_note,
    trackingNumber: r.tracking_number,
    shippedAt: r.shipped_at,
    voidedAt: r.deleted_at,
    voidReason: r.void_reason,
  }));
}

/**
 * 給一組訂單品項 id,算出**每個品項已經被配進箱子的數量**(排除已作廢的箱)。
 *
 * 🔴 **這不是 `order_item_quantity_summary.shipped_quantity`,而且刻意不是。**
 * 那一欄算的是「**已寄出**」(`shipments.shipped_at` 有值);而建箱畫面要排除的是
 * 「**已經被裝進任何一個沒作廢的箱**」—— 包含**還沒寄出的草稿箱**。
 * 用 `shipped_quantity` 的話,已經放進草稿箱的品項仍會顯示成可選 ⇒ **同一件被裝進第二個箱子**。
 * 兩個是不同的問題,不是同一個數字的兩種取法。
 *
 * 🔴 作廢的箱要排除:`admin_void_shipment` 之後那些品項應該**回到可出貨池**
 * (合約:「要重新出這批貨請開一張新的包裹」)。漏了這個過濾,作廢一箱等於把貨永久鎖住。
 *
 * ⚠️ 本函式**沒有實跑驗證**(本 worktree 無 DB)。`!inner` + 巢狀 `.is()` 的過濾語意
 * 是照 PostgREST 文件寫的,真行為要收割端的 smoke 驗。
 */
export async function listAssignedQuantitiesByOrderItemIds(
  orderItemIds: readonly string[],
): Promise<Map<string, number>> {
  if (orderItemIds.length === 0) return new Map();
  const { data, error } = await createSupabaseServiceClient()
    .from('shipment_items')
    .select('order_item_id, shipped_quantity, shipments!inner(deleted_at)')
    .in('order_item_id', [...orderItemIds])
    .is('shipments.deleted_at', null);
  if (error) throw error;
  const out = new Map<string, number>();
  for (const r of data ?? []) {
    out.set(r.order_item_id, (out.get(r.order_item_id) ?? 0) + r.shipped_quantity);
  }
  return out;
}

/**
 * 給一組訂單品項 id,查出它們分別裝在哪些箱(訂單詳情頁的出貨卡用)。
 *
 * ⚠️ 回傳的箱子**可能還裝著別單的品項** —— 箱子掛客人不掛訂單。
 * 呼叫端要自己決定只列本單的品項(C-3 線框上那句話講的就是這件事)。
 */
export async function listShipmentItemsByOrderItemIds(
  orderItemIds: readonly string[],
): Promise<ShipmentItemRow[]> {
  // 🔴 空陣列直接短路:`.in('col', [])` 在 PostgREST 會產生 `in.()`,行為不保證 ——
  //    與其賭它回空,不如根本不發這個請求(而且空輸入本來就沒有答案要查)。
  if (orderItemIds.length === 0) return [];
  const { data, error } = await createSupabaseServiceClient()
    .from('shipment_items')
    .select('id, shipment_id, order_item_id, shipped_quantity')
    .in('order_item_id', [...orderItemIds]);
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id,
    shipmentId: r.shipment_id,
    orderItemId: r.order_item_id,
    shippedQuantity: r.shipped_quantity,
  }));
}
