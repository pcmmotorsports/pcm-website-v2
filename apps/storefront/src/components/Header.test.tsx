// @vitest-environment jsdom
//
// Header smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「desktop / mobile 兩變體 render 不報錯」+ M-1-13e-b-2 cart badge 行為。
// useRouter 走 per-file vi.mock;Header useEffect 用 window.matchMedia、
// jsdom 無此 API → beforeAll 補 polyfill stub。
// useCart 必須 wrap <CartProvider>、否則 throw(M-1-13e-b 設計、防 Provider 漏裝)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

// hoisted stable push spy:供 nav 路由斷言(M-1-14e-f1-a D-f=A 會員圖示→/login)。
const { pushMock, authState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  authState: { session: null as { user: { id: string } } | null },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));
// Header g-1b auth-state:mock browser supabase client。onAuthStateChange 同步 emit INITIAL_SESSION
// (可控 authState.session、預設未登入)→ 測試以 authState.session 切換登入態驗條件路由。
vi.mock('@/lib/supabase/browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        cb('INITIAL_SESSION', authState.session);
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));

import { Header } from './Header';
import { CartProvider } from '@/contexts/CartContext';

const STORAGE_KEY = 'pcm-cart-mock-v2';

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
  pushMock.mockClear();
  authState.session = null; // 預設未登入(各測試自設登入態)
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
    expect(screen.getByLabelText('購物車')).toBeDefined();
  });

  // 🔴 導覽列連結目的地守門(2026-07-22):Header 的「品牌」原本指向不存在的 /brands,
  //   客人按了吃 404 —— 頁尾「品牌專區」早已依 Q4-S5 拍板改指 /products,Header 是漏改的第二個消費端。
  //   本測試把整組 href 鎖住,任何人改動導覽目的地都會當場轉紅、必須是刻意的。
  //   ⚠️ /install 與 /stores 目前**仍是已知死連結**(backlog #269、待 Sean 定內容),
  //      刻意鎖住現況以免被誤讀成「已修好」;#269 收斂時本測試會轉紅,那是預期的提醒。
  describe('導覽列連結目的地 (2026-07-22 品牌死連結修正 + #269 現況鎖)', () => {
    it('每個導覽項目的 href 與預期一致,且「品牌」不再指向不存在的 /brands', () => {
      const { container } = renderWithCart(<Header isMobile={false} />);
      const nav = container.querySelector('.pcm-nav') ?? container.querySelector('nav');
      const actual = Array.from(nav?.querySelectorAll('a') ?? []).map((a) => [
        a.textContent?.trim(),
        a.getAttribute('href'),
      ]);

      expect(actual).toEqual([
        ['商品目錄', '/products'],
        ['依車輛搜尋', '/#vehicle-finder'],
        ['品牌', '/products'], // 🔴 Phase 2 才有品牌頁;先對齊頁尾、不得改回 /brands
        ['新品', '/products?filter=new'],
        ['特價', '/products?filter=sale'],
        ['安裝預約', '/install'], // ⚠️ 已知死連結 = backlog #269
        ['合作店家', '/stores'], // ⚠️ 已知死連結 = backlog #269
      ]);
      // 明確斷言:不得有任何導覽項目再指向 /brands
      expect(actual.some(([, href]) => href === '/brands')).toBe(false);
    });
  });

  describe('會員圖示條件路由 (g-1b、#179 D-f 收尾)', () => {
    it('desktop 未登入 → 會員圖示點擊 → router.push(/login)', () => {
      renderWithCart(<Header isMobile={false} />);
      fireEvent.click(screen.getByLabelText('會員'));
      expect(pushMock).toHaveBeenCalledWith('/login');
    });

    it('desktop 已登入 → 會員圖示點擊 → router.push(/account)', () => {
      authState.session = { user: { id: 'u1' } };
      renderWithCart(<Header isMobile={false} />);
      // onAuthStateChange 同步 emit INITIAL_SESSION(已登入)→ isAuthed=true(render act 內 flush)
      fireEvent.click(screen.getByLabelText('會員'));
      expect(pushMock).toHaveBeenCalledWith('/account');
    });
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
          { productId: 'p1', qty: 2, variantId: 'v-red' },
          { productId: 'p2', qty: 3, variantId: 'v-blue' },
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
