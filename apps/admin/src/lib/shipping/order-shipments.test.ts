// order-shipments.test.ts — 訂單詳情頁出貨卡的資料源守門(片 2c)。
//
// 🔴 主守三件:
//   ① **作廢的箱要留著**(作廢 = 品項回到可出貨池,不是消失)。過濾掉會讓員工以為貨不見了。
//   ② **只列本單品項**,但箱子可能還裝著別單的東西 ⇒ 顯示的件數不等於整箱件數。
//   ③ **查不到箱的品項要跳過**,不要吐一個沒有箱資訊的空殼列。
//
// ⚠️ 全 mock ⇒ 證不了真 DB 的關聯對不對。真行為併入 Sean 的 C 版整條肉眼驗收。

import { describe, expect, it, vi, beforeEach } from 'vitest';

const listItems = vi.fn();
const listShipments = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('./shipment-repository', () => ({
  listShipmentItemsByOrderItemIds: listItems,
  listShipmentsByIds: listShipments,
}));

const box = (over: Record<string, unknown> = {}) => ({
  id: 'sh-1',
  shipmentReference: 'K7X2MP',
  customerUserId: 'cu-1',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: '6412345678',
  shippedAt: '2026-08-09T00:00:00Z',
  voidedAt: null,
  voidReason: null,
  ...over,
});

beforeEach(() => {
  listItems.mockReset();
  listShipments.mockReset();
});

const titles = new Map([
  ['oi-1', 'Akrapovic 鈦合金頭段'],
  ['oi-2', 'Bonamici 腳踏後移'],
]);

describe('出貨卡資料源', () => {
  it('🔴 作廢的箱**仍然列出來**(作廢=貨回到可出貨池,不是消失)', async () => {
    listItems.mockResolvedValue([{ id: 'si-1', shipmentId: 'sh-1', orderItemId: 'oi-1', shippedQuantity: 1 }]);
    listShipments.mockResolvedValue([box({ voidedAt: '2026-08-09T01:00:00Z', voidReason: '客人改地址' })]);
    const { loadOrderShipments } = await import('./order-shipments');
    const g = await loadOrderShipments(titles);
    expect(g.length, '作廢的箱被過濾掉了 ⇒ 員工會以為那些貨憑空消失').toBe(1);
    expect(g[0]!.shipment.voidReason).toBe('客人改地址');
  });

  it('同一箱裝多件 → 收斂成一組;不同箱 → 分開', async () => {
    listItems.mockResolvedValue([
      { id: 'si-1', shipmentId: 'sh-1', orderItemId: 'oi-1', shippedQuantity: 1 },
      { id: 'si-2', shipmentId: 'sh-1', orderItemId: 'oi-2', shippedQuantity: 2 },
      { id: 'si-3', shipmentId: 'sh-2', orderItemId: 'oi-2', shippedQuantity: 1 },
    ]);
    listShipments.mockResolvedValue([box(), box({ id: 'sh-2', shipmentReference: 'B9Q4RT' })]);
    const { loadOrderShipments } = await import('./order-shipments');
    const g = await loadOrderShipments(titles);
    expect(g.length).toBe(2);
    expect(g.find((x) => x.shipment.id === 'sh-1')!.lines.length).toBe(2);
  });

  it('🔴 查不到箱的品項跳過(不吐沒有箱資訊的空殼列)', async () => {
    listItems.mockResolvedValue([
      { id: 'si-1', shipmentId: 'sh-1', orderItemId: 'oi-1', shippedQuantity: 1 },
      { id: 'si-9', shipmentId: 'sh-missing', orderItemId: 'oi-2', shippedQuantity: 1 },
    ]);
    listShipments.mockResolvedValue([box()]);
    const { loadOrderShipments } = await import('./order-shipments');
    const g = await loadOrderShipments(titles);
    expect(g.length, '查不到的箱被吐成一組 ⇒ 畫面會出現沒有箱號的列').toBe(1);
  });

  it('品名由呼叫端的對照表帶入(資料層不碰 detail、更不碰金額)', async () => {
    listItems.mockResolvedValue([{ id: 'si-1', shipmentId: 'sh-1', orderItemId: 'oi-1', shippedQuantity: 1 }]);
    listShipments.mockResolvedValue([box()]);
    const { loadOrderShipments } = await import('./order-shipments');
    const g = await loadOrderShipments(titles);
    expect(g[0]!.lines[0]!.title).toBe('Akrapovic 鈦合金頭段');
  });

  it('沒有品項 / 沒有出貨紀錄 → 空陣列,且不打第二次查詢', async () => {
    const { loadOrderShipments } = await import('./order-shipments');
    expect(await loadOrderShipments(new Map())).toEqual([]);
    expect(listItems).not.toHaveBeenCalled();

    listItems.mockResolvedValue([]);
    expect(await loadOrderShipments(titles)).toEqual([]);
    expect(listShipments, '沒有 shipment_items 還去查箱 ⇒ 多打一次無意義的 DB').not.toHaveBeenCalled();
  });
});
