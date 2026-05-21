// @vitest-environment jsdom
//
// ProductInfo smoke test — 商品詳細頁右欄 pd-info column 獨立單元測試(M-1-13d 新建)
// 驗 brand row + sku + title + fits-banner + color/size options + setColor/setSize 互動 + reset on product change
// 不 mock next/navigation(ProductInfo 不用)
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ProductInfo } from './ProductInfo';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(() => {
  cleanup();
});

describe('ProductInfo', () => {
  it('should render brand row with brand link + SKU padded to 5 digits', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    expect(screen.getByText(product.brand)).toBeDefined();
    expect(screen.getByText(`SKU · PCM-${String(product.id).padStart(5, '0')}`)).toBeDefined();
  });

  it('should render product title as h1', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(product.name);
  });

  it('should render fits-banner with product.fits', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    expect(screen.getByText('適用車款')).toBeDefined();
    expect(screen.getByText(product.fits)).toBeDefined();
  });

  it('should fallback to 通用款 when product.fits is empty', () => {
    const product = { ...MOCK_PRODUCTS[0]!, fits: '' };
    render(<ProductInfo product={product} tier="general" />);
    expect(screen.getByText('通用款')).toBeDefined();
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
