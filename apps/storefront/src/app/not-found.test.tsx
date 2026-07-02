// @vitest-environment jsdom
//
// not-found smoke test(A3)— 前台 regression 安全網。
// 驗「404 頁渲染 + design 字面 + 兩 CTA link href」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/not-a-real-page',
  useSearchParams: () => new URLSearchParams(),
}));

import NotFound from './not-found';
import { CartProvider } from '../contexts/CartContext';

// Header 內含 useCart → CartProvider wrapper(對齊 ProductPage.test 慣例)
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList));
});

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.localStorage.clear();
});

describe('NotFound (404)', () => {
  it('renders design ErrorPage 404 variant with CTA links', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeDefined();
    expect(screen.getByText('找不到這個頁面')).toBeDefined();
    // 兩 CTA:回首頁 → / 、商品目錄(err-cta 內)→ /products
    const home = screen.getByText('回首頁').closest('a')!;
    expect(home.getAttribute('href')).toBe('/');
    const catalog = document.querySelector('.err-cta a.btn-outline')!;
    expect(catalog.getAttribute('href')).toBe('/products');
    // 404 變體不含 500 專屬 support 段
    expect(document.querySelector('.err-support')).toBeNull();
  });
});
