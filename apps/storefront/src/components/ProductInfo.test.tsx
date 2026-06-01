// @vitest-environment jsdom
//
// ProductInfo smoke test — 商品詳細頁右欄 pd-info column
// M-1-16c-3:由 mock color/size 選擇器改吃真變體(資料驅動 weave/finish/special 文字鈕、選了換價)。
// 驗 SKU/title/subtitle + 變體選擇器渲染 + 選變體換價 + special 第三排 + 無變體向後相容。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)

import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';

import { ProductInfo } from './ProductInfo';
import { MOCK_PRODUCTS, type MockProduct } from '../data/mock-products';
import { CartProvider } from '../contexts/CartContext';

// render shadow + CartProvider wrapper(useCart 必須在 Provider 內)
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') window.localStorage.clear();
});

// 帶變體的 fixture(weave × finish、價隨 weave 變;對齊 RPM 真資料 shape)
const variantProduct: MockProduct = {
  ...MOCK_PRODUCTS[0]!,
  price: 8400,
  variants: [
    { sku: 'A-G-F', spec: { weave: 'Forged', finish: 'Glossy' }, price: 8400, images: [] },
    { sku: 'A-M-F', spec: { weave: 'Forged', finish: 'Matt' }, price: 8400, images: [] },
    { sku: 'A-G-T', spec: { weave: 'Twill', finish: 'Glossy' }, price: 6800, images: [] },
    { sku: 'A-M-T', spec: { weave: 'Twill', finish: 'Matt' }, price: 6800, images: [] },
  ],
};

// 帶 special 第三維的 fixture(部分變體有 special、應渲染第三排 + 標準選項)
const specialProduct: MockProduct = {
  ...MOCK_PRODUCTS[0]!,
  price: 6800,
  variants: [
    { sku: 'B-G-P', spec: { weave: 'Plain', finish: 'Glossy' }, price: 6800, images: [] },
    { sku: 'B-G-12P', spec: { weave: 'Plain', finish: 'Glossy', special: '12K' }, price: 8400, images: [] },
  ],
};

describe('ProductInfo', () => {
  it('should render SKU line as single mono row "{brand} · PCM-{id 5 digits}"', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    expect(
      screen.getByText(`${product.brand} · PCM-${String(product.id).padStart(5, '0')}`),
    ).toBeDefined();
  });

  it('should render product title as h1', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(product.name);
  });

  it('should render .pd-sub subtitle combining product.fits + brandCountry hardcoded "義大利"', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductInfo product={product} tier="general" />);
    expect(screen.getByText(`適用 ${product.fits} · 義大利原裝進口`)).toBeDefined();
  });

  // ── M-1-16c-3 變體選擇器 ──

  it('should render weave + finish selectors with Chinese labels when product has variants', () => {
    render(<ProductInfo product={variantProduct} tier="general" />);
    expect(screen.getByText('紋路')).toBeDefined();
    expect(screen.getByText('表面')).toBeDefined();
    expect(screen.getByRole('button', { name: '鍛造紋' })).toBeDefined();
    expect(screen.getByRole('button', { name: '斜紋' })).toBeDefined();
    expect(screen.getByRole('button', { name: '亮面' })).toBeDefined();
    expect(screen.getByRole('button', { name: '消光' })).toBeDefined();
  });

  it('should default to first variant (Forged Glossy, NT$ 8,400) with active state', () => {
    render(<ProductInfo product={variantProduct} tier="general" />);
    expect(screen.getByText('NT$ 8,400')).toBeDefined();
    expect(screen.getByRole('button', { name: '鍛造紋' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '亮面' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('should change price when a different weave is selected (snap to nearest variant)', () => {
    render(<ProductInfo product={variantProduct} tier="general" />);
    // 預設 Forged Glossy 8400;點斜紋 → snap Twill Glossy 6800
    fireEvent.click(screen.getByRole('button', { name: '斜紋' }));
    expect(screen.getByText('NT$ 6,800')).toBeDefined();
    expect(screen.getByRole('button', { name: '斜紋' }).getAttribute('aria-pressed')).toBe('true');
    // finish 維持 Glossy(snap 保留其他維度)
    expect(screen.getByRole('button', { name: '亮面' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('should render 特殊材質 selector with 標準 + 12K when some variants have special', () => {
    render(<ProductInfo product={specialProduct} tier="general" />);
    expect(screen.getByText('特殊材質')).toBeDefined();
    expect(screen.getByRole('button', { name: '標準' })).toBeDefined();
    expect(screen.getByRole('button', { name: '12K碳纖' })).toBeDefined();
    // 點 12K → 換 8400(special 變體);點回標準 → 6800(SPEC_NONE sentinel 往返)
    fireEvent.click(screen.getByRole('button', { name: '12K碳纖' }));
    expect(screen.getByText('NT$ 8,400')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '標準' }));
    expect(screen.getByText('NT$ 6,800')).toBeDefined();
  });

  it('should NOT render variant selectors and shows product.price when product has no variants', () => {
    const noVariant = MOCK_PRODUCTS[0]!; // 無 variants 欄
    render(<ProductInfo product={noVariant} tier="general" />);
    expect(screen.queryByText('紋路')).toBeNull();
    expect(screen.queryByText('表面')).toBeNull();
    expect(screen.getByText(`NT$ ${noVariant.price.toLocaleString()}`)).toBeDefined();
  });

  it('should add to cart without crashing (variant sku discriminator)', () => {
    render(<ProductInfo product={variantProduct} tier="general" />);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    // 不崩潰即可(cart 寫 localStorage);變體 sku 走 color 欄、非本 smoke 斷言範圍
    expect(screen.getByRole('button', { name: '加入購物車' })).toBeDefined();
  });
});
