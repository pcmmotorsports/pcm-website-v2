// @vitest-environment jsdom
// 出貨清單對稿 v22 §4(2026-09-14 C3):頂列 h1 + 挑日期 + 右上角「新竹物流叫車」;表 8 欄;列印兩顆小鈕;叫車走既有 action 逐箱。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ShipmentListRow } from '../../lib/shipping/shipment-list-view';

const mocks = vi.hoisted(() => ({ list: vi.fn(), dispatch: vi.fn(), refresh: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/shipping/shipment-list-read', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/shipping/shipment-list-read')>()),
  listShipmentsByDay: mocks.list,
}));
vi.mock('@/lib/shipping/shipment-dispatch-hct-action', () => ({ dispatchShipmentAction: mocks.dispatch }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: mocks.refresh, replace: vi.fn(), push: vi.fn() }),
}));

import ShipmentsPage from './page';

// 「託運單在新竹建好了、還沒叫車」= 既有 dispatchButton 唯一 enabled 的形狀(submitted + 有貨號 + 沒叫過 + 30 天內)。
const BASE: ShipmentListRow = {
  shipmentId: 's-draft',
  shipmentReference: 'QTK2WT',
  carrierCode: 'hct',
  hctStatus: 'submitted',
  trackingNumber: 'HCT-2026091200099',
  hctRequestId: 'HCT-2026091200099',
  hctDispatchAttemptedAt: null,
  hctDispatchedAt: null,
  shippedAt: null,
  voidedAt: null,
  createdAt: new Date().toISOString(),
  recipientName: '荃盛機車行-黃荃盛',
  orders: [{ orderId: 'o-1', displayId: 'QTK2WT' }],
};
const DISPATCHED: ShipmentListRow = {
  ...BASE,
  shipmentId: 's-done',
  shipmentReference: 'X7YGDB',
  hctStatus: 'submitted',
  trackingNumber: 'HCT-2026091200421',
  hctRequestId: 'HCT-2026091200421',
  hctDispatchAttemptedAt: '2026-09-13T02:10:00.000Z',
  hctDispatchedAt: '2026-09-13T02:10:00.000Z',
  recipientName: '永信二輪-周郁閔',
};

async function renderPage() {
  const ui = await ShipmentsPage({ searchParams: Promise.resolve({ day: '2026-09-13' }) });
  return render(ui);
}

beforeEach(() => {
  mocks.list.mockResolvedValue({ rows: [DISPATCHED, BASE], truncated: false });
  mocks.dispatch.mockReset();
  mocks.refresh.mockReset();
});
afterEach(() => cleanup());

describe('出貨清單 · 稿 v22 §4', () => {
  it('🔴 頂列:h1「出貨清單」+「挑日期」date + 右上角「新竹物流叫車」;整頁在 .pcm-plist 裡', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('.pcm-plist .pcm-head h1')!.textContent).toBe('出貨清單');
    expect(container.querySelector('.pcm-head input[type="date"]')!.getAttribute('value')).toBe('2026-09-13');
    expect(container.querySelector('.pcm-head')!.textContent).toContain('挑日期');
    const btn = [...container.querySelectorAll('.pcm-head button')].find((b) => b.textContent === '新竹物流叫車') as HTMLButtonElement;
    expect(btn, '右上角叫車鈕不在').toBeTruthy();
    expect(btn.disabled, '沒勾任何箱時要 disabled、不藏').toBe(true);
  });

  it('🔴 表 8 欄,字面照稿;列印兩顆小鈕(明細單 / 標籤)、每列一個勾', async () => {
    const { container } = await renderPage();
    expect([...container.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual(['', '日期', '箱號', '訂單', '客人', '貨運單號', '狀態', '列印']);
    const rows = [...container.querySelectorAll('tbody tr')];
    expect(rows.length).toBe(2);
    for (const tr of rows) {
      expect(tr.querySelectorAll('td').length).toBe(8);
      expect(tr.querySelector('td input[type="checkbox"]')).not.toBeNull();
      const print = tr.querySelectorAll('td')[7]!;
      expect([...print.querySelectorAll('a,span[aria-disabled]')].map((e) => e.textContent)).toEqual(['明細單', '標籤']);
    }
    expect(container.textContent, '「訂單明細」那張紙從這一頁退場').not.toContain('訂單明細');
  });

  it('🔴 能不能勾 = 既有 dispatchButton 的規則:已叫車的箱勾不了、建好託運單還沒叫的可以', async () => {
    const { container } = await renderPage();
    const boxes = [...container.querySelectorAll('tbody input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes[0]!.disabled, '已叫車那箱還能勾').toBe(true);
    expect(boxes[1]!.disabled).toBe(false);
  });

  it('🔴 勾一箱 → 右上角鈕亮 → 按下去呼叫既有 dispatchShipmentAction({shipmentId}),結果印在那一列', async () => {
    mocks.dispatch.mockResolvedValue({ ok: true, kind: 'dispatched', edelno: 'E-1' });
    const { container } = await renderPage();
    const box = [...container.querySelectorAll('tbody input[type="checkbox"]')][1] as HTMLInputElement;
    fireEvent.click(box);
    const btn = [...container.querySelectorAll('.pcm-head button')].find((b) => b.textContent?.startsWith('新竹物流叫車')) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe('新竹物流叫車(1 箱)');
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.dispatch).toHaveBeenCalledWith({ shipmentId: 's-draft' });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('叫到車了(E-1)');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('🔴 沒箱子那天:空狀態一句話;頂列照舊', async () => {
    mocks.list.mockResolvedValue({ rows: [], truncated: false });
    const { container } = await renderPage();
    expect(container.textContent).toContain('沒有建立任何箱子');
    expect(container.querySelector('.pcm-head h1')).not.toBeNull();
  });
});
