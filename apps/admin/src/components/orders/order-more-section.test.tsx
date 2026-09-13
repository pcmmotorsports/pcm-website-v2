// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { AdminOrderDetail } from '@pcm/domain';
import { OrderMoreSection } from './order-more-section';

vi.mock('server-only', () => ({}));

const money = (amount: number) => ({ amount, currency: 'TWD' as const });
const U = '11111111-2222-4333-8444-555555555555';
function detail(over: Partial<AdminOrderDetail> = {}): AdminOrderDetail {
  return {
    id: U,
    displayId: 'PCM-2099-0001',
    version: 3,
    cancelledAt: null,
    discountTotal: money(0),
    taxTotal: money(0),
    items: [
      { id: 'a', variantSku: 'BS299B', brand: 'Rizoma', title: '端子鏡', spec: null, quantity: 1, unitPrice: money(6000), lineTotal: money(6000), quantitySummary: null, procurements: [], procurementTruncated: false },
    ],
    ...over,
  } as unknown as AdminOrderDetail;
}
const ok = { status: 'ok' as const, rows: [] };
const emailLog = { status: 'ok' as const, rows: [] };
const box = (id: string, voidedAt: string | null = null) => ({ shipment: { id, voidedAt, shippedAt: null, shipmentReference: 'R' } }) as never;

afterEach(() => cleanup());

describe('OrderMoreSection — 列印那兩顆的三態 + 改金額閘', () => {
  it('沒箱(空陣列)⇒ 出貨明細單 disabled、理由是「先建箱」', () => {
    const { container } = render(<OrderMoreSection detail={detail()} payments={ok} emailLog={emailLog} shipmentGroups={[]} returnTo='/orders?open=x' />);
    const b = container.querySelector('[data-testid="print-shipping-disabled"]') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toContain('建箱');
  });
  it('出貨資料讀不到(null)⇒ disabled、理由是「讀不到」—— 不能說成「還沒建箱」', () => {
    const { container } = render(<OrderMoreSection detail={detail()} payments={ok} emailLog={emailLog} shipmentGroups={null} returnTo='/orders?open=x' />);
    const b = container.querySelector('[data-testid="print-shipping-disabled"]') as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.title).toContain('讀不到');
    expect(b.title).not.toContain('建箱');
  });
  it('🔴 有箱 ⇒ 每一箱一顆連結(作廢的箱不算);兩箱以上帶箱號', () => {
    const { container } = render(
      <OrderMoreSection detail={detail()} payments={ok} emailLog={emailLog} shipmentGroups={[box('s1'), box('s2'), box('s3', '2026-09-01T00:00:00Z')]} returnTo='/orders?open=x' />,
    );
    const links = [...container.querySelectorAll('a')].filter((a) => a.textContent!.startsWith('出貨明細單'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([`/print/orders/${U}/shipping/s1`, `/print/orders/${U}/shipping/s2`]);
    expect(links.map((a) => a.textContent)).toEqual(['出貨明細單(箱 1)', '出貨明細單(箱 2)']);
    expect(container.querySelector('[data-testid="print-shipping-disabled"]')).toBeNull();
  });
  it('改金額:已收款 ⇒ 整表換成一句理由、零表單;沒收款 ⇒ 每樣一張表單', () => {
    const paid = { status: 'ok' as const, rows: [{ id: 'p' } as never] };
    const blocked = render(<OrderMoreSection detail={detail()} payments={paid} emailLog={emailLog} shipmentGroups={[]} returnTo='/orders?open=x' />);
    expect(blocked.container.querySelector('[data-testid="amount-edit-blocked"]')).not.toBeNull();
    expect(blocked.container.querySelectorAll('tr[data-more-item] form')).toHaveLength(0);
    cleanup();
    const open = render(<OrderMoreSection detail={detail()} payments={ok} emailLog={emailLog} shipmentGroups={[]} returnTo='/orders?open=x' />);
    expect(open.container.querySelectorAll('tr[data-more-item] form')).toHaveLength(1);
  });
});
