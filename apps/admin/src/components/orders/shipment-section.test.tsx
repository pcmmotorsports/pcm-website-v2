// @vitest-environment jsdom
// shipment-section.test.tsx — 出貨卡的**畫面**守門(#351④,2026-08-10 新建)。
//
// 🔴 **為什麼非要有這一檔**:資料層(`order-shipments.test.ts`)只證得了「空箱算得出來」。
//    把 `shipment-section.tsx` 裡整個空箱區刪掉,那一整檔照樣全綠,而員工看到的東西就沒了 ——
//    這正是「管線每一跳都要有自己的守門」那條:資料備妥 ≠ 畫面畫出來。
//    #351④ 要修的失敗形狀本身就是「東西在 DB 裡但畫面上找不到」,只守資料層等於沒守到點子上。
//
// 🔴 `ShipmentSection` 是 **async server component** ⇒ 先 `await` 它拿到 JSX 再交給 RTL,
//    不能直接 `render(<ShipmentSection …/>)`(其他檔的做法是整支 mock 掉,那守不到本片)。
//
// ⚠️ 它擋不住什麼:jsdom 不是真瀏覽器,量不到版面;作廢鈕本身的行為在它自己的檔守。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';

// 🔴 `vi.hoisted`:`vi.mock` 的工廠被提升到檔頭,直接引用上面宣告的 `const` 會炸
//    (`Cannot access 'loadOrderShipments' before initialization`)——同 shipment-dialog.test.tsx 那條。
const { loadOrderShipments, loadEmptyShipments } = vi.hoisted(() => ({
  loadOrderShipments: vi.fn(),
  loadEmptyShipments: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/shipping/order-shipments', () => ({ loadOrderShipments, loadEmptyShipments }));
// 兩顆 client island 各自有守門檔;這裡換成佔位,讓斷言只針對本卡的結構。
vi.mock('./shipment-launcher', () => ({ OrderShipButton: () => <button type='button'>建立包裹</button> }));
vi.mock('./shipment-void-button', () => ({
  ShipmentVoidButton: ({ shipmentReference }: { shipmentReference: string }) => (
    <button type='button'>作廢 {shipmentReference}</button>
  ),
}));

import { ShipmentSection } from './shipment-section';

const detail = { id: 'o1', items: [{ id: 'oi-1', title: '鈦合金頭段' }] } as unknown as AdminOrderDetail;

const emptyBox = (reference: string) => ({
  id: `sh-${reference}`,
  shipmentReference: reference,
  customerUserId: 'cu-1',
  carrierCode: 'hct',
  carrierNote: null,
  trackingNumber: null,
  shippedAt: null,
  voidedAt: null,
  voidReason: null,
});

beforeEach(() => {
  loadOrderShipments.mockReset();
  loadEmptyShipments.mockReset();
  loadOrderShipments.mockResolvedValue([]);
  loadEmptyShipments.mockResolvedValue([]);
});
afterEach(cleanup);

describe('#351④ 空箱區', () => {
  it('🔴 有空箱時:箱號畫出來 + 標「空箱」+ 有作廢鈕', async () => {
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1')]);
    render(await ShipmentSection({ detail }));
    expect(
      screen.queryByText('EMPTY1'),
      '空箱的箱號沒畫出來 ⇒ 員工還是「找不到那個箱子在哪裡」(Sean 08-09 逐字),#351④ 等於沒做。',
    ).not.toBeNull();
    expect(screen.queryByText('空箱'), '沒標「空箱」⇒ 員工分不出它跟正常包裹的差別').not.toBeNull();
    expect(
      screen.queryByText('作廢 EMPTY1'),
      '沒有作廢鈕 ⇒ 看得到卻處理不掉,只完成了一半。',
    ).not.toBeNull();
  });

  it('🔴 文案要講實話:這區是**客人層**、可能來自別張訂單', async () => {
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1')]);
    render(await ShipmentSection({ detail }));
    expect(
      screen.queryByText(/可能來自他的別張訂單/),
      'shipments 沒有 order_id(Sean 08-05 Q1=B 併箱同客人 ⇒ 本來就不該加)⇒ 這區列的箱' +
        '可能屬於這位客人的其他訂單。不講明就是假裝它是本單的。',
    ).not.toBeNull();
  });

  it('🔴 沒有空箱時整區不出現(常態是沒有,長期掛一句話會讓真的出現時不顯眼)', async () => {
    render(await ShipmentSection({ detail }));
    expect(screen.queryByText(/未收尾的空箱/), '沒有空箱卻掛著空箱區').toBeNull();
  });

  // 🔴 R1 抓到的洞:原本 5 格全部沿用 `loadOrderShipments → []`,**沒有一格同時有包裹與空箱**
  //    ⇒ 把空箱區搬進「這張訂單還沒有任何包裹」那個真分支裡,5 格照樣全綠,
  //    而空箱在「這位客人**別張**有包裹的訂單頁」上全部消失 —— 那正是這區跨單語意的主場景。
  it('🔴 本單已有包裹時,空箱區**仍然要出現**(它不是「沒有包裹」時才顯示的替代畫面)', async () => {
    loadOrderShipments.mockResolvedValue([
      {
        shipment: { ...emptyBox('FULL1'), trackingNumber: '6412345678' },
        lines: [{ orderItemId: 'oi-1', title: '鈦合金頭段', quantity: 1 }],
      },
    ]);
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1')]);
    render(await ShipmentSection({ detail }));
    expect(screen.queryByText('FULL1'), '本單的包裹不見了').not.toBeNull();
    expect(
      screen.queryByText('EMPTY1'),
      '本單有包裹時空箱區就消失 ⇒ 這位客人的空箱只在他「沒有包裹」的訂單頁才看得到,' +
        '而空箱是**客人層**的、應該每一張都看得到。',
    ).not.toBeNull();
  });

  it('多個空箱各自一列、各自一顆作廢鈕(不是只畫第一個)', async () => {
    loadEmptyShipments.mockResolvedValue([emptyBox('EMPTY1'), emptyBox('EMPTY2')]);
    render(await ShipmentSection({ detail }));
    expect(screen.queryByText('作廢 EMPTY1')).not.toBeNull();
    expect(screen.queryByText('作廢 EMPTY2'), '第二個空箱沒畫 ⇒ 實作可能只取了第一筆').not.toBeNull();
  });

  it('前提 — 空箱查詢只吃訂單 id(不把帶成交價與 PII 的 detail 交給資料層)', async () => {
    render(await ShipmentSection({ detail }));
    expect(loadEmptyShipments).toHaveBeenCalledWith('o1');
  });
});
