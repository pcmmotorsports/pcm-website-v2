// @vitest-environment jsdom
//
// ProductsPage smoke test — 前台 regression 安全網。
// 驗「商品列表頁 render 不報錯 + 標題 / 商品數 / 商品卡 / 篩選器 / 載入失敗態」。
// Header useRouter 走 vi.mock、matchMedia 走 beforeAll stub(同 Header.test.tsx)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。
//
// M-1-13e-b-2:Header 改讀 useCart().totalQty、render 必須 wrap <CartProvider>、否則 throw。
// #220:ProductsPage 改吃 server 傳入的 { products, error } props(列表遷真 Supabase 目錄)。
//   本 smoke 傳小 MockProduct[] fixture(非 MOCK_PRODUCTS)、不依真 DB;另驗 error 旗標 → 載入失敗態。

import type { ReactElement } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render as rtlRender, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  // M-1-13I Bug 1:ProductsPage useSearchParams 讀 URL vehicle、mock 回空參數
  // (本 smoke 不帶 vehicle、parseVehicleFromUrl 回 null、不 dispatch、render 預設「全部商品」)
  useSearchParams: () => new URLSearchParams(),
}));

import { ProductsPage } from './ProductsPage';
import type { MockProduct } from '../data/mock-products';
import { CartProvider } from '../contexts/CartContext';

const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

// 小 fixture(對齊真資料單一品牌 RPM CARBON、碳纖維部品);取代 MOCK_PRODUCTS 全量。
const FIXTURE: MockProduct[] = [
  {
    id: 1, slug: 'rpm-carbon-tail', brand: 'RPM CARBON', name: '碳纖維車台護蓋',
    fits: 'Aprilia RSV4', price: 14600, origPrice: null, isNew: false, isSale: false,
    inStock: true, category: '碳纖維部品', color: 'silver', imgTone: 'neutral',
  },
  {
    id: 2, slug: 'rpm-carbon-fender', brand: 'RPM CARBON', name: '碳纖維前土除',
    fits: 'Ducati Panigale', price: 9800, origPrice: null, isNew: false, isSale: false,
    inStock: true, category: '碳纖維部品', color: 'silver', imgTone: 'neutral',
  },
];

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
    render(<ProductsPage products={FIXTURE} error={false} />);
    // 預設標題「全部商品」(無篩選)+ 商品數 = fixture 長度(非 MOCK_PRODUCTS)
    expect(screen.getByText('全部商品')).toBeDefined();
    expect(screen.getByText(`${FIXTURE.length} 件商品`)).toBeDefined();
  });

  it('should mount the cascade bar and side filter', () => {
    render(<ProductsPage products={FIXTURE} error={false} />);
    expect(screen.getByText('確認適用車款')).toBeDefined();
    expect(screen.getByText('篩選條件')).toBeDefined();
  });

  it('should render product cards from the products prop', () => {
    render(<ProductsPage products={FIXTURE} error={false} />);
    // fixture 商品名 render 進卡片(證真資料 props 接線、非 MOCK_PRODUCTS)
    expect(screen.getByText('碳纖維車台護蓋')).toBeDefined();
    expect(screen.getByText('碳纖維前土除')).toBeDefined();
  });

  it('should render pagination and the mobile filter fab', () => {
    render(<ProductsPage products={FIXTURE} error={false} />);
    expect(screen.getByLabelText('每頁')).toBeDefined();
    expect(screen.getByText('篩選')).toBeDefined();
  });

  it('should show the load-error state when error flag is set (#220 Q2=A)', () => {
    render(<ProductsPage products={[]} error={true} />);
    // error → 「載入失敗、請稍後再試」(與真 0 結果「找不到符合條件的商品」區分)
    expect(screen.getByText('載入失敗、請稍後再試')).toBeDefined();
    expect(screen.queryByText('找不到符合條件的商品')).toBeNull();
  });

  it('🔴 #220-B1:側欄隱藏假篩選(零件分類/品牌/顏色/其他)、保留價格範圍', () => {
    render(<ProductsPage products={FIXTURE} error={false} />);
    // 隱藏:真資料單一分類「碳纖維部品」/單一品牌 RPM CARBON/全 silver/無促銷 → 這些篩選無意義
    expect(screen.queryByText('零件分類')).toBeNull();
    expect(screen.queryByText('顏色')).toBeNull();
    expect(screen.queryByText('其他')).toBeNull(); // 僅現貨(#161 關)+ 新品/特價(隱)皆空 → 整段隱藏
    // 品牌篩選用 filter-specific anchor(避與 Header nav「品牌」撞):搜尋品牌 input 不應在
    expect(screen.queryByPlaceholderText('搜尋品牌')).toBeNull();
    // 保留:真價格可篩 + 側欄殼
    expect(screen.getByText('價格範圍')).toBeDefined();
    expect(screen.getByText('篩選條件')).toBeDefined();
  });
});
