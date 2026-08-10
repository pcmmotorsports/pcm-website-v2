import 'server-only';

// order-shipments.ts — 訂單詳情頁「出貨」卡的資料源(片 2c)。
//
// 🔴 **這張卡有一個必然的怪處,不是 bug**:箱子掛在**客人**下、**沒有 order_id**
//    ⇒ 同一個箱子可能同時裝著**別張訂單**的東西,也就會同時出現在兩張訂單的詳情頁上。
//    本卡**只列本單的品項**,整箱內容要點箱號才看得到(C-3 線框上那句話講的就是這件事)。
//    ⚠️ 這代表「本卡列出的件數」**不等於**「這箱總共裝了幾件」—— 顯示時不要寫成整箱數量。
//
// 🔴 作廢的箱**仍然要列出來**(不是過濾掉):員工要看得到「這箱作廢了、貨回到可出貨池」,
//    否則畫面上會變成貨憑空消失。可作廢/可復原由 `voidedAt` 決定。

import type { ShipmentRow } from './shipment-repository';
import {
  listOrderCustomerUserIds,
  listShipmentItemsByOrderItemIds,
  listShipmentItemsByShipmentIds,
  listShipmentsByCustomer,
  listShipmentsByIds,
  SHIPMENT_ITEM_ROWS_LIMIT,
} from './shipment-repository';

/** 一箱 + 它裝了本單哪些品項。 */
export type OrderShipmentGroup = {
  shipment: ShipmentRow;
  /** **只有本單**的品項(見檔頭)。 */
  lines: { orderItemId: string; title: string | null; quantity: number }[];
};

/**
 * 給本單的品項(id → 品名),查出它們分別在哪些箱。
 *
 * ⚠️ 傳進來的是**已經去掉金額的**對照表 —— 呼叫端(server component)自己從
 * `AdminOrderDetail` 取 `id` 與 `title` 兩欄即可,不要把整包 detail 傳進來。
 */
export async function loadOrderShipments(
  titleByItemId: ReadonlyMap<string, string | null>,
): Promise<OrderShipmentGroup[]> {
  const ids = [...titleByItemId.keys()];
  if (ids.length === 0) return [];

  const items = await listShipmentItemsByOrderItemIds(ids);
  if (items.length === 0) return [];

  const shipments = await listShipmentsByIds([...new Set(items.map((i) => i.shipmentId))]);
  const byId = new Map(shipments.map((s) => [s.id, s]));

  const grouped = new Map<string, OrderShipmentGroup>();
  for (const it of items) {
    const shipment = byId.get(it.shipmentId);
    // 🔴 查不到箱就跳過,不要吐一個沒有箱資訊的空殼列 —— 那會讓畫面出現「?? 箱」。
    if (shipment === undefined) continue;
    const g = grouped.get(it.shipmentId) ?? { shipment, lines: [] };
    g.lines.push({
      orderItemId: it.orderItemId,
      title: titleByItemId.get(it.orderItemId) ?? null,
      quantity: it.shippedQuantity,
    });
    grouped.set(it.shipmentId, g);
  }
  return [...grouped.values()];
}

/**
 * 這位客人**還沒收尾的空箱**(#351④)。
 *
 * 🔴 **為什麼需要一支獨立的查法**:上面那支 `loadOrderShipments` 是**從品項反查箱**,
 * 而空箱沒有品項 ⇒ 它在那條路徑上**不可能出現**。Sean 2026-08-09 實測撞到
 * 「建箱成功、掛品項失敗」留下一個箱,逐字「我也找不到那個箱子在哪裡」——
 * 找不到不是他不會找,是那張卡在結構上畫不出來。
 *
 * 🔴 **這是客人層、不是訂單層,而且做不到訂單層**:`shipments` **沒有 `order_id`**
 * (只有 `customer_user_id`),而且 Sean 2026-08-05 Q1=B 拍「併箱同客人」⇒ 一箱可裝多張單的品項,
 * `order_id` 本來就不該加。⇒ 這裡列出來的空箱**可能來自這位客人的別張訂單**,
 * 而同一個空箱也會**同時出現在他每一張訂單頁上**。呼叫端的文案必須講這件事,不可假裝是本單的。
 *
 * 🔴 **只是可見化,不是止血**:源頭(建箱與掛品項不是同一個原子單位)是 **#359**,不在本片。
 * 空箱會繼續產生,本區只讓它們找得到、作廢得掉。
 *
 * ⚠️ **「空」在 JS 端算**:PostgREST 表達「無子列」要押在內嵌語意上,而本專案對內嵌立過
 * 「實測過才寫死」的標準(本機是裸 PG、沒有 PostgREST)。兩次平凡查詢做集合差沒有那個不確定性,
 * 而筆數是「單一客人的未出貨箱」= 個位到十位數。
 *
 * 🔴 **兩條截斷天花板,方向相反,只有一條需要守**(`shipment-repository.ts:341-344`
 * 已就另一支記過同一族的事):
 *   · **品項那支被截斷 = 危險**:被截掉的箱不進 `withItems` ⇒ **裝著貨的箱被吐成「空箱」**
 *     ⇒ 畫面叫員工去作廢一個真的有貨的箱。⇒ 下面對 `SHIPMENT_ITEM_ROWS_LIMIT` **fail-closed**:
 *     一旦回傳超過我們自夾的上限就整區不顯示,寧可少一區也不要指著錯的箱。
 *     🔴 上限**由查詢端 `.limit(N+1)` 自己送**、不是伺服器 max-rows 的複本 —— 抄伺服器設定的話,
 *     它被調低時判定恆假、守門靜默變 no-op(A9a-1 R1 判過的同型 must-fix)。
 *   · **箱那支被截斷 = 安全**:`listShipmentsByCustomer` 無 `.limit()`、`created_at desc`
 *     ⇒ 箱數超過伺服器上限的客人只會**漏掉最老的空箱**(少列,不會多列錯的)⇒ 不加守門。
 * ⇒ 這兩者的差別是「誤判 vs 漏判」,不是機率大小。同一族的兩條上限要分開判。
 * ⚠️ 已知未守的第三條:`open` 很多時 `.in('shipment_id', …)` 的 URL 可能過長而 throw
 * ⇒ `Promise.all` 會連坐整張出貨卡。可達性極低(要同一客人幾百個未出貨箱),記在這裡不假裝沒有。
 */
export async function loadEmptyShipments(orderId: string): Promise<ShipmentRow[]> {
  const byOrder = await listOrderCustomerUserIds([orderId]);
  const customerUserId = byOrder.get(orderId);
  // 查不到客人 ⇒ 什麼都不列(fail-closed):寧可少一區,也不要列出**別人的**箱。
  if (customerUserId === undefined) return [];

  // 🔴 未出貨**且**未作廢才算「還沒收尾」:已出貨的箱不是問題;
  //    已作廢的箱是**已經處理過**的,再列一次等於叫員工重做一件他做完的事。
  const open = (await listShipmentsByCustomer(customerUserId)).filter(
    (s) => s.shippedAt === null && s.voidedAt === null,
  );
  if (open.length === 0) return [];

  const itemRows = await listShipmentItemsByShipmentIds(open.map((s) => s.id));
  // 🔴 拿到 N+1 筆 ⇒ 這份清單**可能**不完整,而不完整的分母會把有貨的箱算成空箱(見上方 JSDoc)。
  //    ⇒ 整區不顯示。**不要**改成「就用手上這些算」——那正好是危險的那個方向。
  if (itemRows.length > SHIPMENT_ITEM_ROWS_LIMIT) return [];

  const withItems = new Set(itemRows.map((i) => i.shipmentId));
  return open.filter((s) => !withItems.has(s.id));
}
