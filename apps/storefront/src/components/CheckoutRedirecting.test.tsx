// @vitest-environment jsdom
//
// CheckoutRedirecting test(M-3 3DS-6b)。驗:
// ① mount → window.location.assign(redirectUrl) 呼一次(整頁導向 TapPay payment_url)。
// ② 渲染 interstitial 文案;🔴 redirectUrl 原值(含 token)不出現在 DOM 文字(payment_url 零外露)。
// Header/HomeFooter stub(隔離、不拉 router/SDK 依賴);window.location 以 mock 取代(jsdom 不可導航)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/components/Header', () => ({ Header: () => <header data-testid="hdr" /> }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => <footer data-testid="ftr" /> }));

import { CheckoutRedirecting } from './CheckoutRedirecting';

const assignMock = vi.fn();
const ORIGINAL_LOCATION = window.location;

beforeEach(() => {
  assignMock.mockReset();
  // jsdom 的 window.location.assign 預設「Not implemented」→ 以 mock location 取代(只需 assign)。
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { assign: assignMock },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe('CheckoutRedirecting', () => {
  const PAY_URL = 'https://sandbox.tappaysdk.com/tpc/3ds/pay?token=abc123secret';

  it('mount → window.location.assign(redirectUrl) 呼一次', () => {
    render(<CheckoutRedirecting redirectUrl={PAY_URL} />);
    expect(assignMock).toHaveBeenCalledTimes(1);
    expect(assignMock).toHaveBeenCalledWith(PAY_URL);
  });

  it('渲染 interstitial 文案;🔴 redirectUrl 原值 / token 不出現在 DOM(payment_url 零外露)', () => {
    const { container } = render(<CheckoutRedirecting redirectUrl={PAY_URL} />);
    expect(screen.getByText('正在前往安全付款頁面')).toBeTruthy();
    expect(container.textContent).not.toContain(PAY_URL);
    expect(container.textContent).not.toContain('token=abc123secret');
  });
});
