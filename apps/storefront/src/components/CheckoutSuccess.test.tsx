// @vitest-environment jsdom
//
// CheckoutSuccess smoke test(M-3 3DS-3 加 failed 變體)。
// 驗:① paid 既有渲染 ② processing 既有渲染 ③ unknown 無單號區塊(既有)④ 🔴 failed 新變體(eyebrow/title/
//     message/單號 + CTA「返回購物車」/cart)⑤ 回歸:paid/processing CTA 仍「繼續購物」/products。
// stub Header/HomeFooter(非受測、避其 useRouter/useCart/MobileContext/browser-supabase 依賴);聚焦 CheckoutSuccess 本體。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CheckoutSuccess } from './CheckoutSuccess';

vi.mock('@/components/Header', () => ({ Header: () => null }));
vi.mock('@/components/HomeFooter', () => ({ HomeFooter: () => null }));

afterEach(cleanup);

describe('CheckoutSuccess', () => {
  it('paid:訂單已成立 + CONFIRMED + 單號 + 固定文案 + CTA 繼續購物 /products', () => {
    render(<CheckoutSuccess variant="paid" displayId="PCM-2026-0001" />);
    expect(screen.getByText('訂單已成立')).toBeTruthy();
    expect(screen.getByText('N°ORDER · CONFIRMED')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0001')).toBeTruthy();
    expect(screen.getByText('我們會盡快為您出貨。')).toBeTruthy();
    expect(screen.getByRole('link', { name: /繼續購物/ }).getAttribute('href')).toBe('/products');
  });

  it('processing:付款處理中 + message + 單號 + CTA 繼續購物(非返回購物車)', () => {
    render(<CheckoutSuccess variant="processing" displayId="PCM-2026-0002" message="處理中說明" />);
    expect(screen.getByText('付款處理中')).toBeTruthy();
    expect(screen.getByText('N°ORDER · PROCESSING')).toBeTruthy();
    expect(screen.getByText('處理中說明')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0002')).toBeTruthy();
    expect(screen.getByRole('link', { name: /繼續購物/ }).getAttribute('href')).toBe('/products');
  });

  it('unknown:付款狀態確認中 + message + 不渲染單號區塊', () => {
    render(<CheckoutSuccess variant="unknown" message="狀態未知說明" />);
    expect(screen.getByText('付款狀態確認中')).toBeTruthy();
    expect(screen.getByText('N°ORDER · UNKNOWN')).toBeTruthy();
    expect(screen.getByText('狀態未知說明')).toBeTruthy();
    expect(screen.queryByText(/^PCM-/)).toBeNull();
  });

  it('🔴 R3 preflight hold:processing **無 displayId** → message + 不渲染單號區塊(§2.3 新單未建、CheckoutView 傳 undefined)', () => {
    render(<CheckoutSuccess variant="processing" message="訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認" />);
    expect(screen.getByText('付款處理中')).toBeTruthy();
    expect(screen.getByText('訂單付款狀態確認中,請勿重複付款,客服 LINE 將協助確認')).toBeTruthy();
    expect(screen.queryByText(/^PCM-/)).toBeNull(); // 🔴 hold 無單號 → 不崩、不顯單號區塊
  });

  it('🔴 failed(3DS-3、預設 CTA):付款未完成 + FAILED + message + 單號 + CTA 返回購物車 /cart', () => {
    render(<CheckoutSuccess variant="failed" displayId="PCM-2026-0003" message="這筆付款未完成說明" />);
    expect(screen.getByText('付款未完成')).toBeTruthy();
    expect(screen.getByText('N°ORDER · FAILED')).toBeTruthy();
    expect(screen.getByText('這筆付款未完成說明')).toBeTruthy();
    expect(screen.getByText('PCM-2026-0003')).toBeTruthy();
    const cta = screen.getByRole('link', { name: /返回購物車/ });
    expect(cta.getAttribute('href')).toBe('/cart');
    // 回歸:failed 不出現「繼續購物」
    expect(screen.queryByRole('link', { name: /繼續購物/ })).toBeNull();
  });

  it('🔴 S1b-2 failed CTA 參數化:ctaTo/ctaLabel → 重新選購 /products(reconcile 場景、車已清)', () => {
    render(
      <CheckoutSuccess
        variant="failed"
        message="款項未成立"
        ctaTo="/products"
        ctaLabel="重新選購"
      />,
    );
    const cta = screen.getByRole('link', { name: /重新選購/ });
    expect(cta.getAttribute('href')).toBe('/products');
    // 回歸:傳了 ctaLabel 就不再出現預設「返回購物車」
    expect(screen.queryByRole('link', { name: /返回購物車/ })).toBeNull();
  });

  it('🔴 S1b-2 unknown + onReconcile:渲染「查詢付款結果」鈕(可點)+ 次動作繼續購物;reconcileDisabled 時鎖', () => {
    const onReconcile = vi.fn();
    const { rerender } = render(
      <CheckoutSuccess
        variant="unknown"
        message="狀態未知說明"
        onReconcile={onReconcile}
        reconcileDisabled={false}
      />,
    );
    const btn = screen.getByRole('button', { name: /查詢付款結果/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(btn);
    expect(onReconcile).toHaveBeenCalledTimes(1);
    // 次動作:繼續購物 /products(離開出口)
    expect(screen.getByRole('link', { name: /繼續購物/ }).getAttribute('href')).toBe('/products');

    rerender(
      <CheckoutSuccess
        variant="unknown"
        message="狀態未知說明"
        onReconcile={onReconcile}
        reconcileDisabled={true}
      />,
    );
    expect((screen.getByRole('button', { name: /查詢付款結果/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('unknown 無 onReconcile(回歸):不渲染查詢按鈕、CTA 維持繼續購物 /products', () => {
    render(<CheckoutSuccess variant="unknown" message="狀態未知說明" />);
    expect(screen.queryByRole('button', { name: /查詢付款結果/ })).toBeNull();
    expect(screen.getByRole('link', { name: /繼續購物/ }).getAttribute('href')).toBe('/products');
  });
});
