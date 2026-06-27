// @vitest-environment jsdom
//
// CheckoutRedirecting test(M-3 3DS-6b)。驗:
// ① mount → window.location.assign(redirectUrl) 呼一次(整頁導向 TapPay payment_url)。
// ② 渲染 interstitial 文案;🔴 redirectUrl 原值(含 token)不出現在 DOM 文字(payment_url 零外露)。
// ③ #239 手動跳轉鈕(P2):文案「未自動跳轉?點此繼續付款」+ href=payment_url(導向用、非可見文字)。
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

  it('🟢 #239 手動跳轉鈕:文案 + href=payment_url(導向用、非可見文字、token 不外露)', () => {
    render(<CheckoutRedirecting redirectUrl={PAY_URL} />);
    const link = screen.getByRole('link', { name: /未自動跳轉/ });
    // payment_url 進 href(整頁導向用、同 auto assign 目的地)
    expect(link.getAttribute('href')).toBe(PAY_URL);
    // 🔴 同頁導向(無 target=_blank)→ 無 reverse tabnabbing(回歸護欄、釘死不變式)
    expect(link.getAttribute('target')).toBeNull();
    // 🔴 可見文字不含 payment_url / token(零外露;URL 僅在 href 屬性、非 textContent)
    expect(link.textContent).not.toContain(PAY_URL);
    expect(link.textContent).not.toContain('token=abc123secret');
  });
});
