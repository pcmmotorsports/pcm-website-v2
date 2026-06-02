// @vitest-environment jsdom
//
// ProductInfo smoke test — 商品詳細頁右欄 pd-info column
// M-1-16c-3:由 mock color/size 選擇器改吃真變體(資料驅動 weave/finish/special 文字鈕、選了換價)。
// 驗 SKU/title/subtitle + 變體選擇器渲染 + 選變體換價 + special 第三排 + 無變體向後相容。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)

import { useState, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render as rtlRender, screen } from '@testing-library/react';

import { ProductInfo } from './ProductInfo';
import { MOCK_PRODUCTS, type MockProduct, type UIVariant } from '../data/mock-products';
import type { MemberTier } from '@pcm/domain';
import { CartProvider } from '../contexts/CartContext';

// render shadow + CartProvider wrapper(useCart 必須在 Provider 內)
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: CartProvider });

// OD-4a:ProductInfo 改受控(selectedVariant 提升 ProductPage)。測試用 stateful harness 持 state、
//   模擬 ProductPage 持有 selectedVariant,讓「點規格鈕 → onSelectVariant → 換價」行為可驗。
function renderInfo(product: MockProduct, tier: MemberTier = 'general') {
  function Harness() {
    const [sv, setSv] = useState<UIVariant | null>(product.variants?.[0] ?? null);
    return (
      <ProductInfo product={product} tier={tier} selectedVariant={sv} onSelectVariant={setSv} />
    );
  }
  return render(<Harness />);
}

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
  // M-1-16c-4a:料號顯真 sku(有變體)/ slug(無變體 fallback)、不再顯 PCM-{hash}
  it('should render SKU line with selected variant sku when product has variants', () => {
    renderInfo(variantProduct);
    expect(screen.getByText(`${variantProduct.brand} · A-G-F`)).toBeDefined();
  });

  it('should fallback SKU line to slug when product has no variants', () => {
    const product = MOCK_PRODUCTS[0]!;
    renderInfo(product);
    expect(screen.getByText(`${product.brand} · ${product.slug}`)).toBeDefined();
  });

  it('should render product title as h1', () => {
    const product = MOCK_PRODUCTS[0]!;
    renderInfo(product);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toBe(product.name);
  });

  // M-1-16c-4a:副標顯 DB 真 subtitle、拿掉寫死「義大利原裝進口」
  it('should render .pd-sub with product.subtitle when present (no hardcoded 義大利)', () => {
    const product = { ...MOCK_PRODUCTS[0]!, subtitle: 'Ducati Panigale · 碳纖維' };
    renderInfo(product);
    expect(screen.getByText('Ducati Panigale · 碳纖維')).toBeDefined();
    expect(screen.queryByText(/義大利原裝進口/)).toBeNull();
  });

  it('should fallback .pd-sub to 適用 {fits} when no subtitle (no hardcoded 義大利)', () => {
    const product = { ...MOCK_PRODUCTS[0]!, subtitle: undefined };
    renderInfo(product);
    expect(screen.getByText(`適用 ${product.fits}`)).toBeDefined();
    expect(screen.queryByText(/義大利原裝進口/)).toBeNull();
  });

  // ── M-1-16c-3 變體選擇器 ──

  it('should render weave + finish selectors with Chinese labels when product has variants', () => {
    renderInfo(variantProduct);
    expect(screen.getByText('紋路')).toBeDefined();
    expect(screen.getByText('表面')).toBeDefined();
    expect(screen.getByRole('button', { name: '鍛造' })).toBeDefined();
    expect(screen.getByRole('button', { name: '斜紋' })).toBeDefined();
    expect(screen.getByRole('button', { name: '亮光' })).toBeDefined();
    expect(screen.getByRole('button', { name: '消光' })).toBeDefined();
  });

  it('should default to first variant (Forged Glossy, NT$ 8,400) with active state', () => {
    renderInfo(variantProduct);
    expect(screen.getByText('NT$ 8,400')).toBeDefined();
    expect(screen.getByRole('button', { name: '鍛造' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '亮光' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('should change price when a different weave is selected (snap to nearest variant)', () => {
    renderInfo(variantProduct);
    // 預設 Forged Glossy 8400;點斜紋 → snap Twill Glossy 6800
    fireEvent.click(screen.getByRole('button', { name: '斜紋' }));
    expect(screen.getByText('NT$ 6,800')).toBeDefined();
    expect(screen.getByRole('button', { name: '斜紋' }).getAttribute('aria-pressed')).toBe('true');
    // finish 維持 Glossy(snap 保留其他維度)
    expect(screen.getByRole('button', { name: '亮光' }).getAttribute('aria-pressed')).toBe('true');
  });

  // OD-4c:12K 折進紋路(顯「12K平織」)、無「特殊」獨立欄、無「標準」NONE(Sean Q-OD4c-1=A)
  it('should fold 12K into 紋路 (12K平織) with no separate 特殊 row, price changes', () => {
    renderInfo(specialProduct);
    // 無「特殊材質」獨立欄 / 無「標準」NONE 選項
    expect(screen.queryByText('特殊材質')).toBeNull();
    expect(screen.queryByRole('button', { name: '標準' })).toBeNull();
    // 紋路含 平織 + 12K平織(special 折入);表面只 亮光(1 值不渲染)
    expect(screen.getByText('紋路')).toBeDefined();
    expect(screen.queryByText('表面')).toBeNull();
    expect(screen.getByRole('button', { name: '平織' })).toBeDefined();
    expect(screen.getByRole('button', { name: '12K平織' })).toBeDefined();
    // 預設 平織 6800;點 12K平織 → 8400;點回 平織 → 6800
    fireEvent.click(screen.getByRole('button', { name: '12K平織' }));
    expect(screen.getByText('NT$ 8,400')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '平織' }));
    expect(screen.getByText('NT$ 6,800')).toBeDefined();
  });

  // OD-4c:Kevlar 也折進紋路(顯「Kevlar斜紋」、Sean Q-OD4c-2=A、同 12K 邏輯)
  it('should fold Kevlar into 紋路 (Kevlar斜紋)', () => {
    const kevlarProduct: MockProduct = {
      ...MOCK_PRODUCTS[0]!,
      price: 6800,
      variants: [
        { sku: 'K-G-T', spec: { weave: 'Twill', finish: 'Glossy' }, price: 6800, images: [] },
        { sku: 'K-G-KT', spec: { weave: 'Twill', finish: 'Glossy', special: 'Kevlar' }, price: 9200, images: [] },
      ],
    };
    renderInfo(kevlarProduct);
    expect(screen.queryByText('特殊材質')).toBeNull();
    expect(screen.getByRole('button', { name: '斜紋' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Kevlar斜紋' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Kevlar斜紋' }));
    expect(screen.getByText('NT$ 9,200')).toBeDefined();
  });

  it('should NOT render variant selectors and shows product.price when product has no variants', () => {
    const noVariant = MOCK_PRODUCTS[0]!; // 無 variants 欄
    renderInfo(noVariant);
    expect(screen.queryByText('紋路')).toBeNull();
    expect(screen.queryByText('表面')).toBeNull();
    expect(screen.getByText(`NT$ ${noVariant.price.toLocaleString()}`)).toBeDefined();
  });

  it('should add to cart without crashing (variant sku discriminator)', () => {
    renderInfo(variantProduct);
    fireEvent.click(screen.getByRole('button', { name: '加入購物車' }));
    // 不崩潰即可(cart 寫 localStorage);變體 sku 走 color 欄、非本 smoke 斷言範圍
    expect(screen.getByRole('button', { name: '加入購物車' })).toBeDefined();
  });
});
