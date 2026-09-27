// @vitest-environment jsdom
// 訂單列表勾多張單「只建箱(N 張單, 各一箱)」(2026-09-27 出貨流程乙第 7 項;Sean 答 Q1 甲)。
// 一張單的邏輯在 lib/shipping/bulk-box.ts(有自己的測試);這裡守畫面:要先確認、逐張依序送、結果印出來、做完重新整理。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({ fetch: vi.fn(), submit: vi.fn(), refresh: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('../../lib/shipping/shipment-actions', () => ({ fetchShipmentCandidates: h.fetch, submitShipment: h.submit }));
vi.mock('next/navigation', async () => ({
  ...(await vi.importActual<typeof import('next/navigation')>('next/navigation')),
  useRouter: () => ({ refresh: h.refresh }),
}));

import { BatchActionBar, OrderItemCheckbox, ShippingSelectionProvider } from './shipping-selection';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
});

const candidatesOf = (orderId: string, itemId: string) => ({
  items: [{ orderId, orderItemId: itemId, orderDisplayId: orderId.toUpperCase(), variantSku: 'S', title: 't', remaining: 1, blockedReason: null }],
  customerUserId: 'cu',
  recipient: { name: '收件人', phone: '0912', line: '地址' },
  balanceWarning: null,
});

function renderTwoOrders() {
  return render(
    <ShippingSelectionProvider>
      <BatchActionBar nextBase='/orders' />
      <OrderItemCheckbox orderId='o1' itemId='i1' />
      <OrderItemCheckbox orderId='o2' itemId='i3' />
    </ShippingSelectionProvider>,
  );
}

describe('只建箱(N 張單, 各一箱)', () => {
  it('🔴 勾兩張單 ⇒ 出現鈕;按下去先確認;確認後逐張各建一箱(各自的品項), 印結果, 重新整理', async () => {
    h.fetch.mockImplementation(async ([orderId]: string[]) => candidatesOf(orderId!, orderId === 'o1' ? 'i1' : 'i3'));
    h.submit.mockImplementation(async (input: { items: { orderItemId: string }[] }) => ({
      ok: true,
      shipmentReference: input.items[0]!.orderItemId === 'i1' ? 'BOX001' : 'BOX003',
      shipmentId: 's',
      shipped: false,
    }));
    renderTwoOrders();
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: '只建箱(2 張單，各一箱)' }));
    expect(screen.getByText('將為 2 張單各建一箱（新竹物流），先不出貨。')).toBeTruthy();
    expect(h.submit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('bulk-box-confirm'));
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
    expect(h.submit.mock.calls.map((c) => (c[0] as { items: { orderItemId: string }[] }).items)).toEqual([
      [{ orderItemId: 'i1', quantity: 1 }],
      [{ orderItemId: 'i3', quantity: 1 }],
    ]);
    const keys = h.submit.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(new Set(keys).size, '兩張單要各自一把鍵').toBe(2);
    expect(screen.getByTestId('bulk-box-results').textContent).toContain('已建箱 BOX001');
    expect(screen.getByTestId('bulk-box-results').textContent).toContain('已建箱 BOX003');
    expect(h.refresh).toHaveBeenCalled();
  });

  it('只勾一張單 ⇒ 不出現這顆(一張單走一般的出貨)', () => {
    renderTwoOrders();
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(screen.queryByRole('button', { name: /只建箱\(/ })).toBeNull();
  });
});
