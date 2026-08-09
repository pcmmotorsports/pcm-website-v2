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
import { listShipmentItemsByOrderItemIds, listShipmentsByIds } from './shipment-repository';

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
