// @vitest-environment jsdom
//
// CheckoutTerminalScreen 守門測試(M-3 兩步結帳 Slice U4a-0)。
//
// 本片是**純外移、零行為變更**,所以這裡守的是「搬過來之後四態各自還是對的」+
// 🔴 **`isTerminalChargeState` 對非終態必須回 false** —— 後者直接把 codex 關卡1 R1 抓到的
//    真 bug(把 JSX 元素當 truthy 旗標 → 非終態整頁結帳表單消失)做成負向測試。

import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChargeState } from '@/hooks/useChargePayment';
import {
  CheckoutTerminalScreen,
  isTerminalChargeState,
  type TerminalChargeState,
} from '@/components/CheckoutTerminalScreen';

// CheckoutRedirecting 內含 window.location 整頁導向副作用(jsdom 不可導航)→ stub;
// 真導向行為在 CheckoutRedirecting.test.tsx 驗。
vi.mock('@/components/CheckoutRedirecting', () => ({
  CheckoutRedirecting: ({ redirectUrl }: { redirectUrl: string }) => (
    <div data-testid="checkout-redirecting" data-url={redirectUrl}>正在前往安全付款頁面</div>
  ),
}));

// stub Header/HomeFooter(非受測、避其 useRouter/useCart/MobileContext 依賴;沿用 CheckoutSuccess.test 慣例)。
vi.mock('@/components/Header', () => ({ Header: () => null }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => null }));

describe('CheckoutTerminalScreen', () => {
  it('paid → 訂單已成立 + 單號', () => {
    render(<CheckoutTerminalScreen state={{ status: 'paid', displayId: 'PCM-2026-0007' }} />);
    expect(screen.getByText('訂單已成立')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0007')).toBeTruthy();
    cleanup();
  });

  it('processing → 付款處理中 + 帶單號 + 顯示 message', () => {
    render(
      <CheckoutTerminalScreen
        state={{ status: 'processing', displayId: 'PCM-2026-0008', message: '付款處理中,請勿重複付款' }}
      />,
    );
    expect(screen.getByText('付款處理中')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0008')).toBeTruthy();
    expect(screen.getByText('付款處理中,請勿重複付款')).toBeTruthy();
    cleanup();
  });

  it('🔴 unknown → 付款狀態確認中 + 勿重複付款訊息 + **無單號區塊**(回應遺失層無單號)', () => {
    const { container } = render(
      <CheckoutTerminalScreen
        state={{ status: 'unknown', message: '付款狀態未知,請勿重複付款,客服 LINE 將協助確認' }}
      />,
    );
    expect(screen.getByText('付款狀態確認中')).toBeTruthy();
    expect(screen.getByText(/請勿重複付款/)).toBeTruthy();
    expect(container.querySelector('.co-success-order')).toBeNull();
    cleanup();
  });

  it('redirect → 交付 redirectUrl 原樣給 CheckoutRedirecting', () => {
    const url = 'https://sandbox.tappaysdk.com/tpc/3ds/pay?token=abc123';
    render(<CheckoutTerminalScreen state={{ status: 'redirect', redirectUrl: url }} />);
    expect(screen.getByTestId('checkout-redirecting').getAttribute('data-url')).toBe(url);
    cleanup();
  });
});

describe('isTerminalChargeState', () => {
  const TERMINAL: TerminalChargeState[] = [
    { status: 'paid', displayId: 'PCM-2026-0007' },
    { status: 'processing', message: 'm' },
    { status: 'unknown', message: 'm' },
    { status: 'redirect', redirectUrl: 'https://example.test' },
  ];

  // 🔴 非終態必須全部回 false。這條就是 codex 關卡1 R1 must-fix 的負向守門:
  //   若呼叫端改用「JSX 元素是否 truthy」當判斷(元素恆 truthy),idle/submitting/error/wait/in_flight
  //   都會被誤判成終態 → 客人的結帳表單整頁消失。
  const NON_TERMINAL: ChargeState[] = [
    { status: 'idle' },
    { status: 'submitting' },
    { status: 'error', message: 'm' },
    { status: 'wait', message: 'm' },
    { status: 'in_flight', message: 'm' },
  ];

  it('四個終態全回 true', () => {
    for (const s of TERMINAL) expect(isTerminalChargeState(s)).toBe(true);
  });

  it('🔴 五個非終態全回 false(擋「JSX 恆 truthy」誤用)', () => {
    for (const s of NON_TERMINAL) expect(isTerminalChargeState(s)).toBe(false);
  });
});
