// @vitest-environment jsdom
//
// CheckoutSuccess smoke test(M-3 3DS-3 加 failed 變體)。
// 驗:① paid 既有渲染 ② processing 既有渲染 ③ unknown 無單號區塊(既有)④ 🔴 failed 新變體(eyebrow/title/
//     message/單號 + CTA「返回購物車」/cart)⑤ 回歸:paid/processing CTA 仍「繼續購物」/products。
// stub Header/HomeFooter(非受測、避其 useRouter/useCart/MobileContext/browser-supabase 依賴);聚焦 CheckoutSuccess 本體。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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

  it('🔴 failed(3DS-3):付款未完成 + FAILED + message + 單號 + CTA 返回購物車 /cart', () => {
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
});
