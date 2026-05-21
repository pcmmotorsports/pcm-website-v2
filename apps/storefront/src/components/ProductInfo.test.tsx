// @vitest-environment jsdom
//
// ProductInfo smoke test — 商品詳細頁右欄 pd-info column 獨立單元測試(M-1-13d 新建)
// 驗 brand row + sku + title + fits-banner + color/size options + setColor/setSize 互動 + reset on product change
// 不 mock next/navigation(ProductInfo 不用)
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)

import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';

import { ProductInfo } from './ProductInfo';
import { MOCK_PRODUCTS } from '../data/mock-products';
import { CartProvider } from '../contexts/CartContext';

// M-1-13e-b:render shadow + CartProvider wrapper(useCart 必須在 Provider 內)。
// rerender(...) 沿用同 wrapper、call site 不需動。
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

afterEach(() => {
  cleanup();
  // 清掉 CartProvider 寫進 localStorage 的測試殘留、避免 test 之間互染
  if (typeof window !== 'undefined') window.localStorage.clear();
});

describe('ProductInfo', () => {
  // M-1-13H-2:brand-row 拆成單一 SKU line(對應 HANDOFF #4)、字面 `{brand} · PCM-XXXXX`
  it('should render SKU line as single mono row "{brand} · PCM-{id 5 digits}"', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    expect(
      screen.getByText(`${product.brand} · PCM-${String(product.id).padStart(5, '0')}`)
    ).toBeDefined();
  });

  it('should render product title as h1', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(product.name);
  });

  // M-1-13H-2:fits-banner 厚 banner 移除、改副標 .pd-sub(對應 HANDOFF #6 + #7)
  // 字面 `適用 {fits} · 義大利原裝進口`、brandCountry L2 hardcoded 對齊 design VariantCFull L83
  it('should render .pd-sub subtitle combining product.fits + brandCountry hardcoded "義大利"', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    expect(
      screen.getByText(`適用 ${product.fits} · 義大利原裝進口`)
    ).toBeDefined();
  });

  it('should fallback to 通用款 in .pd-sub when product.fits is empty', () => {
    const product = { ...MOCK_PRODUCTS[0]!, fits: '' };
    render(<ProductInfo product={product} tier="general" />);
    expect(screen.getByText('適用 通用款 · 義大利原裝進口')).toBeDefined();
  });

  it('should render 3 color swatches with active state on initial product.color', () => {
    const product = MOCK_PRODUCTS[0]!; // color: 'silver'
    render(<ProductInfo product={product} tier="general" />);
    const swatches = screen.getAllByRole('button', { name: /選擇顏色/ });
    expect(swatches.length).toBe(3);
    // 初始 active = product.color(對齊 design L113 字面 useState(product.color))
    const activeSwatch = swatches.find((s) => s.getAttribute('aria-pressed') === 'true');
    expect(activeSwatch?.getAttribute('aria-label')).toContain('銀色');
  });

  it('should render size options 街道版 / 賽道版 when category includes 卡鉗', () => {
    const brembo = MOCK_PRODUCTS.find((p) => p.slug === 'brembo-7')!;
    render(<ProductInfo product={brembo} tier="general" />);
    expect(screen.getByRole('button', { name: '街道版' })).toBeDefined();
    expect(screen.getByRole('button', { name: '賽道版' })).toBeDefined();
  });

  it('should not render size options section when category does not match 4 branches', () => {
    // rizoma-5 category 「精品配件 · 後視鏡」不命中 排氣/碳纖/避震/卡鉗
    const rizoma = MOCK_PRODUCTS.find((p) => p.slug === 'rizoma-5')!;
    render(<ProductInfo product={rizoma} tier="general" />);
    expect(screen.queryByText('規格')).toBeNull();
  });

  it('should change color when different swatch clicked', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    const swatches = screen.getAllByRole('button', { name: /選擇顏色/ });
    const nonActive = swatches.find((s) => s.getAttribute('aria-pressed') === 'false')!;
    fireEvent.click(nonActive);
    expect(nonActive.getAttribute('aria-pressed')).toBe('true');
  });

  it('should change size when different size button clicked', () => {
    const brembo = MOCK_PRODUCTS.find((p) => p.slug === 'brembo-7')!;
    render(<ProductInfo product={brembo} tier="general" />);
    const street = screen.getByRole('button', { name: '街道版' });
    const track = screen.getByRole('button', { name: '賽道版' });
    expect(street.getAttribute('aria-pressed')).toBe('true');
    expect(track.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(track);
    expect(track.getAttribute('aria-pressed')).toBe('true');
    expect(street.getAttribute('aria-pressed')).toBe('false');
  });

  it('should reset color when product prop changes', () => {
    const productA = MOCK_PRODUCTS[0]!; // silver
    const productB = MOCK_PRODUCTS.find((p) => p.color === 'red')!; // red
    const { rerender } = render(<ProductInfo product={productA} tier="general" />);
    expect(screen.getByRole('button', { name: /銀色/ }).getAttribute('aria-pressed')).toBe('true');
    rerender(<ProductInfo product={productB} tier="general" />);
    expect(screen.getByRole('button', { name: /賽道紅/ }).getAttribute('aria-pressed')).toBe('true');
  });
});
