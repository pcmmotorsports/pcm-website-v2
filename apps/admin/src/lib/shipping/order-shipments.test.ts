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
const listItemsByShipment = vi.fn();
const listByCustomer = vi.fn();
const listOrderCustomers = vi.fn();
vi.mock('server-only', () => ({}));
vi.mock('./shipment-repository', () => ({
  listShipmentItemsByOrderItemIds: listItems,
  listShipmentsByIds: listShipments,
  listShipmentItemsByShipmentIds: listItemsByShipment,
  listShipmentsByCustomer: listByCustomer,
  listOrderCustomerUserIds: listOrderCustomers,
  // 🔴 `vi.mock` 換掉整個模組 ⇒ 常數也要在這裡給,否則受測碼拿到 `undefined`。
  //    這是複本,**真值與查詢實際送出的 `.limit(N+1)` 由 `shipment-repository.test.ts` 釘住**;
  //    真值改了而這裡沒改,下面那兩格會紅(不是靜默通過)。
  SHIPMENT_ITEM_ROWS_LIMIT: 500,
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
  listItemsByShipment.mockReset();
  listByCustomer.mockReset();
  listOrderCustomers.mockReset();
  // 空箱區的預設:查得到客人,但**一個箱都沒有**(⇒ 預設就是「沒有空箱」)。
  // 🔴 每一格要測什麼就自己把箱餵進去,不要以為預設已經有一個箱在那裡。
  listOrderCustomers.mockResolvedValue(new Map([['o1', 'cu-1']]));
  listByCustomer.mockResolvedValue([]);
  listItemsByShipment.mockResolvedValue([]);
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

// ─────────────────────────────────────────────────────────────
// #351④ 客人層空箱區(2026-08-10)。
//
// 🔴 這一區存在的理由是**上面那支在結構上做不到**:`loadOrderShipments` 從品項反查箱,
//    而空箱沒有品項 ⇒ 它永遠不會出現在那條路徑上。Sean 08-09 逐字「我也找不到那個箱子在哪裡」。
// ⚠️ 全 mock ⇒ 證不了真 DB 的關聯;真行為併入肉眼驗收。
// ─────────────────────────────────────────────────────────────
describe('#351④ loadEmptyShipments — 這位客人還沒收尾的空箱', () => {
  it('🔴 沒裝任何品項的未出貨箱 → 列出來(這正是出貨卡看不到的那種箱)', async () => {
    listByCustomer.mockResolvedValue([box({ id: 'sh-empty', shipmentReference: 'EMPTY1', shippedAt: null })]);
    listItemsByShipment.mockResolvedValue([]); // 一件都沒裝
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(
      (await loadEmptyShipments('o1')).map((s) => s.shipmentReference),
      '空箱沒被列出來 ⇒ 員工還是找不到它、作廢不了,#351④ 等於沒做。',
    ).toEqual(['EMPTY1']);
  });

  it('🔴 裝了東西的箱**不算空箱**(那種箱出貨卡本來就看得到,重複列只會混淆)', async () => {
    listByCustomer.mockResolvedValue([box({ id: 'sh-full', shippedAt: null })]);
    listItemsByShipment.mockResolvedValue([
      { id: 'si-1', shipmentId: 'sh-full', orderItemId: 'oi-1', shippedQuantity: 1 },
    ]);
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(await loadEmptyShipments('o1'), '有品項的箱被當成空箱').toEqual([]);
  });

  it('🔴 已出貨的箱不算(它不是待收尾的問題)', async () => {
    listByCustomer.mockResolvedValue([box({ id: 'sh-shipped', shippedAt: '2026-08-09T00:00:00Z' })]);
    listItemsByShipment.mockResolvedValue([]);
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(
      await loadEmptyShipments('o1'),
      '已出貨的箱被列進待收尾 ⇒ 員工會去作廢一個已經寄出去的箱。',
    ).toEqual([]);
  });

  it('🔴 已作廢的箱不算(那是**已經處理過**的,再列一次等於叫他重做)', async () => {
    listByCustomer.mockResolvedValue([
      box({ id: 'sh-void', shippedAt: null, voidedAt: '2026-08-10T00:00:00Z' }),
    ]);
    listItemsByShipment.mockResolvedValue([]);
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(await loadEmptyShipments('o1'), '已作廢的空箱又被列出來').toEqual([]);
  });

  it('🔴 查不到這張單的客人 → 一個都不列(fail-closed,寧可少一區也不列到別人的箱)', async () => {
    listOrderCustomers.mockResolvedValue(new Map()); // 查無
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(await loadEmptyShipments('o1'), '查不到客人卻照樣列箱').toEqual([]);
    expect(
      listByCustomer,
      '查不到客人還去查箱 ⇒ 不是多打一次 DB 的問題,是根本不知道要查誰的箱。',
    ).not.toHaveBeenCalled();
  });

  it('沒有未出貨的箱 → 不去查品項(少打一次沒有意義的 DB)', async () => {
    listByCustomer.mockResolvedValue([box({ shippedAt: '2026-08-09T00:00:00Z' })]);
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(await loadEmptyShipments('o1')).toEqual([]);
    expect(listItemsByShipment).not.toHaveBeenCalled();
  });

  it('🔴 混合:同一位客人的空箱與有貨箱並存時,只吐空的那個', async () => {
    listByCustomer.mockResolvedValue([
      box({ id: 'sh-full', shipmentReference: 'FULL1', shippedAt: null }),
      box({ id: 'sh-empty', shipmentReference: 'EMPTY1', shippedAt: null }),
    ]);
    listItemsByShipment.mockResolvedValue([
      { id: 'si-1', shipmentId: 'sh-full', orderItemId: 'oi-1', shippedQuantity: 2 },
    ]);
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(
      (await loadEmptyShipments('o1')).map((s) => s.shipmentReference),
      '集合差算錯 ⇒ 要嘛漏掉空箱、要嘛把有貨的箱標成空箱叫員工去作廢。',
    ).toEqual(['EMPTY1']);
  });
  it('🔴 品項清單回傳超過自夾上限 → 整區不顯示(fail-closed)', async () => {
    const { SHIPMENT_ITEM_ROWS_LIMIT } = await import('./shipment-repository');
    listByCustomer.mockResolvedValue([
      box({ id: 'sh-full', shipmentReference: 'FULL1', shippedAt: null }),
      box({ id: 'sh-empty', shipmentReference: 'EMPTY1', shippedAt: null }),
    ]);
    // 🔴 N+1:查詢送 `.limit(N+1)`,拿到 N+1 筆就代表「可能還有更多」⇒ 這份分母不可信。
    //    數量從 repository 的常數推出來,**不在這裡抄一個字面** —— 抄字面的話常數改了測試不會紅。
    listItemsByShipment.mockResolvedValue(
      Array.from({ length: SHIPMENT_ITEM_ROWS_LIMIT + 1 }, (_, n) => ({
        id: `si-${n}`,
        shipmentId: 'sh-full',
        orderItemId: `oi-${n}`,
        shippedQuantity: 1,
      })),
    );
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(
      await loadEmptyShipments('o1'),
      '截斷時照樣算集合差 ⇒ 被截掉的箱進不了 withItems ⇒ **裝著貨的箱被吐成空箱**,' +
        '畫面會叫員工去作廢一個真的有貨的箱。方向是誤判不是漏判,所以這裡必須 fail-closed。',
    ).toEqual([]);
  });

  it('剛好等於上限(沒有第 N+1 筆)⇒ 正常算,不誤擋', async () => {
    const { SHIPMENT_ITEM_ROWS_LIMIT } = await import('./shipment-repository');
    listByCustomer.mockResolvedValue([
      box({ id: 'sh-full', shipmentReference: 'FULL1', shippedAt: null }),
      box({ id: 'sh-empty', shipmentReference: 'EMPTY1', shippedAt: null }),
    ]);
    listItemsByShipment.mockResolvedValue(
      Array.from({ length: SHIPMENT_ITEM_ROWS_LIMIT }, (_, n) => ({
        id: `si-${n}`,
        shipmentId: 'sh-full',
        orderItemId: `oi-${n}`,
        shippedQuantity: 1,
      })),
    );
    const { loadEmptyShipments } = await import('./order-shipments');
    expect(
      (await loadEmptyShipments('o1')).map((s) => s.shipmentReference),
      '把 `>` 寫成 `>=` ⇒ 剛好取滿(但沒被截斷)的合法情況被誤擋,空箱區平白消失。',
    ).toEqual(['EMPTY1']);
  });
});
