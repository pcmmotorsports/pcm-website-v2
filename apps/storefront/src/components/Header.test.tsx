// @vitest-environment jsdom
//
// Header smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「desktop / mobile 兩變體 render 不報錯」+ M-1-13e-b-2 cart badge 行為。
// useRouter 走 per-file vi.mock;Header useEffect 用 window.matchMedia、
// jsdom 無此 API → beforeAll 補 polyfill stub。
// useCart 必須 wrap <CartProvider>、否則 throw(M-1-13e-b 設計、防 Provider 漏裝)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { Header } from './Header';
import { CartProvider } from '@/contexts/CartContext';

const STORAGE_KEY = 'pcm-cart-mock-v1';

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

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(cleanup);

function renderWithCart(ui: ReactElement) {
  return render(<CartProvider>{ui}</CartProvider>);
}

describe('Header', () => {
  it('should render the desktop header without crashing', () => {
    renderWithCart(<Header isMobile={false} />);
    expect(screen.getByText('PCM MOTORSPORTS')).toBeDefined();
    expect(screen.getByText('商品目錄')).toBeDefined();
  });

  it('should render the mobile header without crashing', () => {
    renderWithCart(<Header isMobile />);
    expect(screen.getByText('PCM')).toBeDefined();
    expect(screen.getByLabelText('cart')).toBeDefined();
  });

  describe('cart badge (M-1-13e-b-2)', () => {
    it('does not render .pcm-cart-dot when cart is empty (totalQty=0)', () => {
      renderWithCart(<Header isMobile />);
      // 既無預載 localStorage、initial state 與 hydration 後皆空 → dot 永不顯
      expect(document.querySelector('.pcm-cart-dot')).toBeNull();
    });

    it('renders .pcm-cart-dot with totalQty when localStorage has items (mobile)', async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([
          { productId: 'p1', qty: 2, color: 'red' },
          { productId: 'p2', qty: 3 },
        ])
      );
      renderWithCart(<Header isMobile />);
      // 等 CartProvider useEffect 從 localStorage 載入 → totalQty=5 → dot 顯 "5"
      await waitFor(() => {
        expect(screen.getByText('5')).toBeDefined();
      });
      const dot = document.querySelector('.pcm-cart-dot');
      expect(dot).not.toBeNull();
      expect(dot?.textContent).toBe('5');
    });

    it('renders .pcm-cart-dot with totalQty when localStorage has items (desktop)', async () => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([{ productId: 'p1', qty: 7 }])
      );
      renderWithCart(<Header isMobile={false} />);
      await waitFor(() => {
        expect(screen.getByText('7')).toBeDefined();
      });
      const dot = document.querySelector('.pcm-cart-dot');
      expect(dot).not.toBeNull();
      expect(dot?.textContent).toBe('7');
    });
  });
});
