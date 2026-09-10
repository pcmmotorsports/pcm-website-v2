import 'server-only';
import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { listShipmentItemsByShipmentIds } from './shipment-repository';
import type { ShipmentListRow } from './shipment-list-view';

// shipment-list-read.ts —— 出貨清單那一頁的**唯讀取數層**。
//
// 🛑 **只讀。本檔沒有任何 writer,也不得長出 writer。**
//
// ══ 🔴🔴 為什麼是四次平凡的 `.in()`,而不是一發內嵌 join ═══════════════════
// `shipments` 表上**沒有 `order_id`** —— 關聯是三跳:
// ```
// shipments → shipment_items.shipment_id → order_items.id → order_items.order_id → orders.display_id
// ```
// 而**分開查是這支檔家族的家規**,不是我的偏好。`shipment-repository.ts:772-776` 逐字:
//   「**刻意分兩次查、不用內嵌 join** —— 內嵌層的過濾/展開語意押在**本機測不到**的
//     PostgREST 行為上(本機是裸 PG、沒有 PostgREST)。兩次平凡的 `.in()` 查詢沒有這個
//     不確定性,而這條路徑上的筆數是個位數。」
// ⇒ ✅ 照它。**四次往返不是 N+1** —— 每一跳都是一次 `.in()`,不是逐列查。
//
// ══ 🔵 四跳逐跳的出處(沒有一跳是新發明)═════════════════════════════════
// ```
// ① 撈箱     .from('shipments').select(…)          同檔家族已有 5 處(:326 :368 :429 :477 …)
// ② 箱→品項  listShipmentItemsByShipmentIds()      ✅【已經存在】shipment-repository.ts:838
//                                                   (它自帶 N+1 截斷訊號)
// ③ 品項→單  .from('order_items').select('id, order_id').in('id', …)
//                                                   逐字既有:同檔 :791-794
// ④ 單→單號  .from('orders').select('id, display_id').in('id', …)
//                                                   同形既有:同檔 :752-755(只差欄名)
// ```
// 🟢 **而「客人」那一欄一跳都不用** —— `shipments.recipient_snapshot` 裡就有 `name`
//    ⇒ 不用 join `customers`,也不碰任何 PII 白名單。
//
// ══ 🔴 刻意【不選】 `hct_raw_response` ═════════════════════════════════════
// 貨號在 `hct_request_id` 那個普通小欄位裡就拿得到(`shipment-list-view.ts` 有實測出處)。
// 而 `shipment-repository.ts:460-467` 逐字拒絕過把 raw 拉進頁面:每箱 ~20KB、而這一頁不印圖。
// ⇒ 📌 **那句話的形狀逐字命中這一頁。**

/**
 * 一次撈回來的箱數上限 + 1。
 *
 * 🔴 **N+1 是刻意的**:回傳剛好 N 是「正好這麼多」,回傳 N+1 才代表**可能還有更多**。
 *    形狀與常數的用法沿用同檔家族的 `SHIPMENT_ITEM_ROWS_LIMIT`,**不自創第二套**。
 * 🔵 200 的來源:這一頁一次只看一天(日期篩選是必填的預設值)⇒ 一天 200 箱是很寬的餘裕。
 *    ⚠️ 而它**不是**「一天不會超過 200」的保證 —— 超過時 `truncated` 會是 `true`,
 *    畫面必須把那件事講出來。**靜靜地只列前 200 筆是這一頁最糟的失敗方式**
 *    (Sean 要的正是「看得到全部紀錄」)。
 */
export const SHIPMENT_LIST_LIMIT = 200;

export type ShipmentListResult = {
  rows: ShipmentListRow[];
  /** 撈滿上限 ⇒ `true`。畫面要講出來,不得靜靜地只列前 N 筆。 */
  truncated: boolean;
};

function nameOf(snapshot: unknown): string | null {
  // 🔴 不 trim、不補值 —— 與 `shipment-repository.ts` 的 `toRecipientSnapshot` 同一個立場:
  //    在這裡 trim 會讓「只打了幾個空白」與「真的填了」在上層分不出來。
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const n = (snapshot as Record<string, unknown>)['name'];
  return typeof n === 'string' ? n : null;
}

/**
 * 某一天(當地時區的 00:00 ~ 隔日 00:00)建立的箱。
 *
 * 🔴 **用 `created_at` 挑日期,不是 `shipped_at`** —— 而這一格是承重的:
 *    正式庫實測,Sean 說「已經送出去」的那一箱 `shipped_at` 是**空的**
 *    ⇒ 📌 **拿 `shipped_at` 當篩選鍵, 他要看的那一箱【任何一天都篩不到】。**
 *    而 `created_at` 是 `NOT NULL` ⇒ 每一箱都落得進某一天。
 * ⚠️ **代價明寫**:一個「今天建、明天才出貨」的箱,會出現在**建箱那一天**。
 *    這一頁的日期欄也會把那件事講出來(見 `shipmentListDate`)。
 */
export async function listShipmentsByDay(
  dayStartIso: string,
  dayEndIso: string,
): Promise<ShipmentListResult> {
  const client = createSupabaseServiceClient();

  // ── ① 撈箱 ────────────────────────────────────────────────────────────
  // ⚠️ `.select()` 必須是**單一字串常值** —— 拆成變數拼接會讓產生的型別塌成
  //    `GenericStringError`(同檔家族 `:352` 逐字記過)。
  const { data: shipData, error: shipErr } = await client
    .from('shipments')
    .select(
      'id, shipment_reference, carrier_code, hct_status, tracking_number, hct_request_id, shipped_at, deleted_at, created_at, recipient_snapshot',
    )
    .gte('created_at', dayStartIso)
    .lt('created_at', dayEndIso)
    .order('created_at', { ascending: false })
    .limit(SHIPMENT_LIST_LIMIT + 1);
  if (shipErr) throw shipErr;
  const ship = shipData ?? [];
  const truncated = ship.length > SHIPMENT_LIST_LIMIT;
  const page = truncated ? ship.slice(0, SHIPMENT_LIST_LIMIT) : ship;
  if (page.length === 0) return { rows: [], truncated: false };

  // ── ② 箱 → 品項(既有函式,自帶截斷訊號)──────────────────────────────
  const items = await listShipmentItemsByShipmentIds(page.map((s) => s.id));

  // ── ③ 品項 → 訂單 ─────────────────────────────────────────────────────
  const orderItemIds = [...new Set(items.map((i) => i.orderItemId))];
  const orderIdByItemId = new Map<string, string>();
  if (orderItemIds.length > 0) {
    const { data, error } = await client
      .from('order_items')
      .select('id, order_id')
      .in('id', orderItemIds);
    if (error) throw error;
    for (const r of data ?? []) orderIdByItemId.set(r.id, r.order_id);
  }

  // ── ④ 訂單 → 單號 ─────────────────────────────────────────────────────
  const orderIds = [...new Set([...orderIdByItemId.values()])];
  const displayIdByOrderId = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data, error } = await client.from('orders').select('id, display_id').in('id', orderIds);
    if (error) throw error;
    for (const r of data ?? []) displayIdByOrderId.set(r.id, r.display_id);
  }

  // ── 組裝 ──────────────────────────────────────────────────────────────
  const ordersByShipment = new Map<string, Map<string, string>>();
  for (const it of items) {
    const orderId = orderIdByItemId.get(it.orderItemId);
    if (orderId === undefined) continue; // 查不到就不掛 —— 不編一個假單號上去。
    const displayId = displayIdByOrderId.get(orderId);
    if (displayId === undefined) continue;
    let m = ordersByShipment.get(it.shipmentId);
    if (m === undefined) {
      m = new Map();
      ordersByShipment.set(it.shipmentId, m);
    }
    m.set(orderId, displayId);
  }

  const rows: ShipmentListRow[] = page.map((s) => ({
    shipmentId: s.id,
    shipmentReference: s.shipment_reference,
    carrierCode: s.carrier_code,
    hctStatus: s.hct_status,
    trackingNumber: s.tracking_number,
    hctRequestId: s.hct_request_id,
    shippedAt: s.shipped_at,
    voidedAt: s.deleted_at,
    createdAt: s.created_at,
    recipientName: nameOf(s.recipient_snapshot),
    // 🔴 **依 displayId 排序**:列印連結挑的是 `orders[0]`,而那一格必須**穩定**
    //    —— 不排序的話它會跟著查詢回來的順序漂,而**同一箱在兩次重新整理之間換一張單**
    //    是那顆鈕 404 的第二種成因,而且更難查。
    orders: [...(ordersByShipment.get(s.id) ?? new Map<string, string>())]
      .map(([orderId, displayId]) => ({ orderId, displayId }))
      .sort((a, b) => a.displayId.localeCompare(b.displayId)),
  }));

  return { rows, truncated };
}
