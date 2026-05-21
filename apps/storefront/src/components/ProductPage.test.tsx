// @vitest-environment jsdom
//
// ProductPage smoke test — 前台 regression 安全網(M-1-13b)。
// 驗「商品詳細頁骨架 + breadcrumb 8-source 3 分支 + vehicle pill render 不報錯」。
// Header useRouter / useSearchParams / usePathname 走 vi.mock、matchMedia 走 beforeAll stub。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: vi.fn(), replace: mockReplace }),
  usePathname: () => '/products/lightech-1',
}));

import { ProductPage } from './ProductPage';
import { MOCK_PRODUCTS } from '../data/mock-products';

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
  mockReplace.mockReset();
  mockSearchParams = new URLSearchParams();
});

describe('ProductPage', () => {
  it('should render baseline from=catalog + category breadcrumb', () => {
    mockSearchParams = new URLSearchParams('from=catalog&category=操控部品');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" />);
    // 用 within(nav) 限定 breadcrumb 範圍、避免與 Footer 內同字面衝突
    const breadcrumbNav = screen.getByLabelText('navigation path');
    expect(within(breadcrumbNav).getByText('首頁')).toBeDefined();
    expect(within(breadcrumbNav).getByText('商品目錄')).toBeDefined();
    expect(within(breadcrumbNav).getByText('操控部品')).toBeDefined();
    expect(within(breadcrumbNav).getByText(MOCK_PRODUCTS[0]!.name)).toBeDefined();
  });

  it('should render from=brand branch with sourceLabel', () => {
    mockSearchParams = new URLSearchParams('from=brand&sourceId=akrapovic&sourceLabel=AKRAPOVIČ');
    const akrapovic = MOCK_PRODUCTS.find((p) => p.slug === 'akrapovic-6')!;
    render(<ProductPage product={akrapovic} tier="general" />);
    const breadcrumbNav = screen.getByLabelText('navigation path');
    expect(within(breadcrumbNav).getByText('品牌')).toBeDefined();
    expect(within(breadcrumbNav).getByText('AKRAPOVIČ')).toBeDefined();
    expect(within(breadcrumbNav).getByText(akrapovic.name)).toBeDefined();
  });

  it('should render from=sale branch with default sourceLabel', () => {
    mockSearchParams = new URLSearchParams('from=sale');
    render(<ProductPage product={MOCK_PRODUCTS[1]!} tier="general" />);
    const breadcrumbNav = screen.getByLabelText('navigation path');
    expect(within(breadcrumbNav).getByText('特價精選')).toBeDefined();
  });

  it('should render vehicle pill when vehicle searchParam set', () => {
    mockSearchParams = new URLSearchParams('from=catalog&vehicle=yamaha:r6:2024');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" />);
    // vehiclePill label = 'YAMAHA · YZF-R6 · 2024'
    const pill = screen.getByLabelText(/清除車輛篩選/);
    expect(pill).toBeDefined();
    expect(pill.textContent).toContain('YAMAHA');
    expect(pill.textContent).toContain('YZF-R6');
    expect(pill.textContent).toContain('2024');
  });

  it('should call router.replace without vehicle when pill × clicked', () => {
    mockSearchParams = new URLSearchParams('from=catalog&category=操控部品&vehicle=yamaha:r6:2024');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" />);
    const pill = screen.getByLabelText(/清除車輛篩選/);
    fireEvent.click(pill);
    expect(mockReplace).toHaveBeenCalledOnce();
    const calledWith = mockReplace.mock.calls[0]![0] as string;
    // 應保留 from + category、移除 vehicle
    expect(calledWith).toContain('from=catalog');
    expect(calledWith).toContain('category');
    expect(calledWith).not.toContain('vehicle');
  });

  // ProductGallery / ProductInfo 獨立單元測試移至 ProductGallery.test.tsx / ProductInfo.test.tsx
  // 本檔留 2 個整合 case、證明 ProductPage 正確 mount 兩個子元件、不重複測 internal state

  it('should integrate ProductGallery (render counter 01 / 03)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    render(<ProductPage product={MOCK_PRODUCTS[0]!} tier="general" />);
    expect(screen.getByText('01 / 03')).toBeDefined();
  });

  it('should integrate ProductInfo (render brand row + SKU)', () => {
    mockSearchParams = new URLSearchParams('from=catalog');
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductPage product={product} tier="general" />);
    expect(screen.getByText(product.brand)).toBeDefined();
    expect(
      screen.getByText(`SKU · PCM-${String(product.id).padStart(5, '0')}`),
    ).toBeDefined();
  });
});
