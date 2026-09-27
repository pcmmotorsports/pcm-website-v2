import 'server-only';

import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { listShipmentItemsByOrderItemIds } from '../shipping/shipment-repository';
import { pendingBox, type BoxProgressRow, type PendingBox } from '../shipping/box-progress';

// 訂單列表「下一步」要看的箱子進度(2026-09-27 出貨流程甲)。只讀。
// 🔴 讀不到 ⇒ 回空 Map, 下一步照舊印「出貨」—— 這是顯示用的提示, 不可以因為它把整張列表弄壞。
// 箱子掛客人不掛訂單(shipment-repository.ts `listShipmentItemsByOrderItemIds` 註解)⇒ 先由品項查到箱, 再回推是哪張單。

/** `.in()` 一次最多帶幾個 id —— 網址長度的上限, 不是資料量的上限。 */
const CHUNK = 100;

function chunks<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
}

export async function loadPendingBoxes(
  orders: readonly { id: string; lines: readonly { id: string }[] }[],
): Promise<Map<string, PendingBox>> {
  try {
    const orderOfItem = new Map(orders.flatMap((o) => o.lines.map((l) => [l.id, o.id] as const)));
    if (orderOfItem.size === 0) return new Map();
    const items = (await Promise.all(chunks([...orderOfItem.keys()]).map((ids) => listShipmentItemsByOrderItemIds(ids)))).flat();
    const ordersOfBox = new Map<string, Set<string>>();
    for (const it of items) {
      const orderId = orderOfItem.get(it.orderItemId);
      if (orderId !== undefined) ordersOfBox.set(it.shipmentId, (ordersOfBox.get(it.shipmentId) ?? new Set()).add(orderId));
    }
    if (ordersOfBox.size === 0) return new Map();
    const client = createSupabaseServiceClient();
    const rows = (
      await Promise.all(
        chunks([...ordersOfBox.keys()]).map(async (ids) => {
          const { data, error } = await client
            .from('shipments')
            .select('id, carrier_code, hct_status, hct_dispatch_attempted_at, hct_dispatched_at, shipped_at, deleted_at, created_at')
            .in('id', ids);
          if (error) throw error;
          return data ?? [];
        }),
      )
    ).flat();
    const boxesOfOrder = new Map<string, BoxProgressRow[]>();
    for (const r of rows) {
      const box: BoxProgressRow = {
        shipmentId: r.id,
        carrierCode: r.carrier_code,
        hctStatus: r.hct_status,
        hctDispatchAttemptedAt: r.hct_dispatch_attempted_at,
        hctDispatchedAt: r.hct_dispatched_at,
        shippedAt: r.shipped_at,
        voidedAt: r.deleted_at,
        createdAt: r.created_at,
      };
      for (const orderId of ordersOfBox.get(r.id) ?? []) boxesOfOrder.set(orderId, [...(boxesOfOrder.get(orderId) ?? []), box]);
    }
    const out = new Map<string, PendingBox>();
    for (const [orderId, boxes] of boxesOfOrder) {
      const p = pendingBox(boxes);
      if (p !== null) out.set(orderId, p);
    }
    return out;
  } catch (e) {
    console.error('[admin/orders] 讀箱子進度失敗, 下一步照舊印「出貨」', e);
    return new Map();
  }
}
