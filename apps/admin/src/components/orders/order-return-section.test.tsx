// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../lib/orders/return-actions', () => ({
  registerReturnAction: '/submit-register',
  receiveReturnAction: '/submit-receive',
  voidReturnAction: '/submit-void',
}));

import { OrderReturnSection } from './order-return-section';
import type { OrderReturnRow } from '../../lib/orders/return-view';

afterEach(cleanup);

const ORDER = '11111111-2222-3333-4444-555555555555';
const I1 = '33333333-4444-5555-6666-777777777777';
const item = (shipped: number) => ({
  id: I1,
  title: '尾段排氣管',
  variantSku: 'SKU-1',
  spec: { 款式: 'GP2' },
  quantity: 2,
  quantitySummary: { shippedQuantity: shipped },
});
const ret = (over: Partial<OrderReturnRow>): OrderReturnRow => ({
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  status: 'registered',
  reasonCode: 'defective',
  reasonDetail: null,
  note: null,
  trackingNumber: null,
  registeredBy: 'staff_01',
  registeredAt: '2026-09-27T01:00:00Z',
  receivedBy: null,
  receivedAt: null,
  receiveNote: null,
  voidedBy: null,
  voidedAt: null,
  voidReason: null,
  items: [{ orderItemId: I1, quantity: 1, receivedQuantity: null, condition: null }],
  ...over,
});
const tokens = { register: 'tok-r', perReturn: { 'aaaaaaaa-0000-0000-0000-000000000001': { receive: 'tok-c', void: 'tok-v' } } };

describe('OrderReturnSection', () => {
  it('還沒出貨:不顯示登記表單, 說明出貨後才能登記', () => {
    render(<OrderReturnSection orderId={ORDER} returnTo='/orders' items={[item(0)]} returns={[]} tokens={tokens} />);
    expect(screen.queryByRole('button', { name: '登記退貨' })).toBeNull();
    expect(screen.getByText('這張訂單還沒有已出貨的品項，出貨後才能登記退貨。')).toBeTruthy();
  });

  it('有已出貨可退:顯示登記表單, 數量上限 = 可退數量', () => {
    render(<OrderReturnSection orderId={ORDER} returnTo='/orders' items={[item(2)]} returns={[]} tokens={tokens} />);
    expect(screen.getByRole('button', { name: '登記退貨' })).toBeTruthy();
    expect((screen.getByLabelText('尾段排氣管 這次退貨數量') as HTMLInputElement).max).toBe('2');
  });

  it('審查 C1:已登記退貨多於已出貨 ⇒ 標出這個品項', () => {
    render(<OrderReturnSection orderId={ORDER} returnTo='/orders' items={[item(0)]} returns={[ret({})]} tokens={tokens} />);
    expect(screen.getByRole('alert').textContent).toContain('尾段排氣管');
    expect(screen.getByRole('alert').textContent).toContain('已出貨 0 件、已登記退貨 1 件');
    // 已收回的不能作廢 ⇒ 不能叫員工一律去作廢
    expect(screen.getByRole('alert').textContent).toContain('已收回的無法作廢');
  });

  it('退貨中的紀錄有「確認收到退貨」與「作廢退貨登記」;已收回的沒有', () => {
    const { rerender } = render(
      <OrderReturnSection orderId={ORDER} returnTo='/orders' items={[item(2)]} returns={[ret({})]} tokens={tokens} />,
    );
    expect(screen.getByText('退貨中（等商品寄回）')).toBeTruthy();
    expect(screen.getByRole('button', { name: '確認收到退貨' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '作廢退貨登記' })).toBeTruthy();
    rerender(
      <OrderReturnSection
        orderId={ORDER}
        returnTo='/orders'
        items={[item(2)]}
        returns={[ret({ status: 'received', receivedBy: 'staff_02', receivedAt: '2026-09-28T01:00:00Z', items: [{ orderItemId: I1, quantity: 1, receivedQuantity: 1, condition: 'damaged' }] })]}
        tokens={tokens}
      />,
    );
    expect(screen.getByText('已收回')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '確認收到退貨' })).toBeNull();
    expect(screen.getByText('有損傷')).toBeTruthy();
  });

  it('退貨紀錄載入失敗:說明失敗, 不顯示任何表單(可退數量算不出來)', () => {
    render(<OrderReturnSection orderId={ORDER} returnTo='/orders' items={[item(2)]} returns={null} tokens={tokens} />);
    expect(screen.getByText('退貨紀錄載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '登記退貨' })).toBeNull();
  });
});
