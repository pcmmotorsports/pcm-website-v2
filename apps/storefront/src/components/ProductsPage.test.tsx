// @vitest-environment jsdom
//
// ProductsPage smoke test — 前台 regression 安全網。
// 驗「商品列表頁 render 不報錯 + 標題 / 商品數 / 商品卡 / 篩選器顯示」。
// Header useRouter 走 vi.mock、matchMedia 走 beforeAll stub(同 Header.test.tsx)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。
//
// M-1-13e-b-2:Header 改讀 useCart().totalQty、render 必須 wrap <CartProvider>、否則 throw

import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  // M-1-13I Bug 1:ProductsPage 新增 useSearchParams 讀 URL vehicle、mock 回空參數
  // (本 smoke test 不帶 vehicle、parseVehicleFromUrl 回 null、不 dispatch、render 預設「全部商品」)
  useSearchParams: () => new URLSearchParams(),
}));

import { ProductsPage } from './ProductsPage';
import { MOCK_PRODUCTS } from '../data/mock-products';
import { CartProvider } from '../contexts/CartContext';

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

beforeAll(() => {
  // jsdom 不實作 matchMedia、Header useEffect 會呼叫 → 補最小 stub
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
  // 清掉 CartProvider 寫進 localStorage 的測試殘留、避免 test 之間互染
  if (typeof window !== 'undefined') window.localStorage.clear();
});

describe('ProductsPage', () => {
  it('should render the products listing without crashing', () => {
    render(<ProductsPage />);
    // 預設標題「全部商品」(無篩選)+ 商品數
    expect(screen.getByText('全部商品')).toBeDefined();
    expect(screen.getByText(`${MOCK_PRODUCTS.length} 件商品`)).toBeDefined();
  });

  it('should mount the cascade bar and side filter', () => {
    render(<ProductsPage />);
    expect(screen.getByText('確認適用車款')).toBeDefined();
    expect(screen.getByText('篩選條件')).toBeDefined();
  });

  it('should render product cards', () => {
    render(<ProductsPage />);
    // MOCK_PRODUCTS 含多筆 LIGHTECH 品牌商品
    expect(screen.getAllByText('LIGHTECH').length).toBeGreaterThan(0);
  });

  it('should render pagination and the mobile filter fab', () => {
    render(<ProductsPage />);
    expect(screen.getByLabelText('每頁')).toBeDefined();
    expect(screen.getByText('篩選')).toBeDefined();
  });
});
