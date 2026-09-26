// @vitest-environment jsdom
// 退貨收回第 3 片:「為這筆退貨登記退款」的預填 —— 網址參數、轉回網址、兩個退款表單的初值。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../lib/payment/manual-refund-actions', () => ({ recordManualRefundAction: '/submit-manual' }));
vi.mock('../../lib/payment/refund-actions', () => ({ initiateRefundAction: '/submit-card' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ManualRefundEntrySection } from './manual-refund-entry-section';
import { RefundSection } from './refund-section';
import { readReturnRefundPrefill, returnRefundHref } from '../../lib/orders/return-action-state';
import { parseOrderReturnTo } from '../../lib/orders/order-return-to';

afterEach(cleanup);

const ORDER = '11111111-2222-3333-4444-555555555555';
const params = (q: string) => new URLSearchParams(q);

describe('預填參數', () => {
  it('讀得到正整數金額與原因;格式不對一律當作沒有', () => {
    expect(readReturnRefundPrefill(params('refund_amount=1200&refund_reason=退貨退款'))).toEqual({ amount: '1200', reason: '退貨退款' });
    expect(readReturnRefundPrefill(params('refund_amount=0'))).toBeNull();
    expect(readReturnRefundPrefill(params('refund_amount=12.5'))).toBeNull();
    expect(readReturnRefundPrefill(params('refund_amount=-3'))).toBeNull();
    expect(readReturnRefundPrefill(params(`refund_amount=1&refund_reason=${'字'.repeat(201)}`))).toBeNull();
    expect(readReturnRefundPrefill(params(''))).toBeNull();
  });

  it('連結:保留頁面原本的參數、換掉舊的預填、丟掉上一次的結果碼, 最後跳到 #refund', () => {
    const href = returnRefundHref(`/orders/${ORDER}?refund_amount=99&r=return_received&tab=x`, 1200, '退貨退款：A 1 件');
    const url = new URL(href, 'http://x');
    expect(url.searchParams.getAll('refund_amount')).toEqual(['1200']);
    expect(url.searchParams.has('r')).toBe(false);
    expect(url.searchParams.get('tab')).toBe('x');
    expect(url.hash).toBe('#refund');
  });

  it('退款送出後轉回的網址不帶預填 ⇒ 成功回來表單不會又被填一次', () => {
    expect(parseOrderReturnTo(`/orders/${ORDER}?refund_amount=1200&refund_reason=abc`, ORDER)).toBe(`/orders/${ORDER}`);
  });
});

describe('兩個退款表單的初值', () => {
  const prefill = { amount: '1200', reason: '退貨退款：A 1 件' };

  it('現金 / 匯款登記:帶入金額與原因', () => {
    const { container } = render(
      <ManualRefundEntrySection orderId={ORDER} returnTo={`/orders/${ORDER}`} serverToken='tok' ledgerSettled={false} prefill={prefill} />,
    );
    expect((container.querySelector('input[name="amount"]') as HTMLInputElement).value).toBe('1200');
    expect((container.querySelector('input[name="reason"]') as HTMLInputElement).value).toBe('退貨退款：A 1 件');
  });

  it('沒有預填:照舊空白', () => {
    const { container } = render(
      <ManualRefundEntrySection orderId={ORDER} returnTo={`/orders/${ORDER}`} serverToken='tok' ledgerSettled={false} />,
    );
    expect((container.querySelector('input[name="amount"]') as HTMLInputElement).value).toBe('');
  });

  it('線上退款:切成部分退款並帶入金額;部分退款被停用時維持全額、只帶原因', () => {
    const { container, unmount } = render(
      <RefundSection orderId={ORDER} returnTo={`/orders/${ORDER}`} serverToken='tok' prefill={prefill} />,
    );
    expect((container.querySelector('input[name="amount"]') as HTMLInputElement | null)?.value).toBe('1200');
    unmount();
    const blocked = render(
      <RefundSection orderId={ORDER} returnTo={`/orders/${ORDER}`} serverToken='tok' prefill={prefill} partialBlockedReason='還沒請款' />,
    );
    expect(blocked.container.querySelector('input[name="amount"]')).toBeNull();
    expect(blocked.container.textContent).not.toContain('1200');
  });
});
