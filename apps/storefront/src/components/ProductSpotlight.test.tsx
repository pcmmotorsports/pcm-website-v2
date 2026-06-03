// @vitest-environment jsdom
//
// ProductSpotlight smoke test — 「碳纖維工藝」深度區塊(OD-7a carbon-ify)。
// 驗條件渲染(hasSpotlight true/false 兩種路徑)+ eyebrow / h2 / 2 body / 3 stats 字面。
// OD-7a:內容由舊鋁件文案(7075-T6/CNC)換碳纖維通用 placeholder、eyebrow 去 N°02 編號。
// 純 presentational server component、無 hooks / interactive(不需 CartProvider wrapper)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductSpotlight } from './ProductSpotlight';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(cleanup);

describe('ProductSpotlight', () => {
  it('renders nothing when product.hasSpotlight is falsy', () => {
    const lightech2 = MOCK_PRODUCTS.find((p) => p.slug === 'lightech-2')!;
    expect(lightech2.hasSpotlight).toBeFalsy();
    const { container } = render(<ProductSpotlight product={lightech2} />);
    expect(container.querySelector('.pd-spotlight')).toBeNull();
  });

  it('renders nothing when product.hasSpotlight is explicitly false', () => {
    const product = { ...MOCK_PRODUCTS[0]!, hasSpotlight: false };
    const { container } = render(<ProductSpotlight product={product} />);
    expect(container.querySelector('.pd-spotlight')).toBeNull();
  });

  it('renders full carbon section when product.hasSpotlight is true', () => {
    const lightech1 = MOCK_PRODUCTS.find((p) => p.slug === 'lightech-1')!;
    expect(lightech1.hasSpotlight).toBe(true);
    const { container } = render(<ProductSpotlight product={lightech1} />);
    expect(container.querySelector('.pd-spotlight')).not.toBeNull();
    // OD-7a:eyebrow 去 N°02 編號、改碳纖維工藝
    expect(screen.getByText('碳纖維工藝')).toBeDefined();
    // h2:含換行、用 partial match
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent).toContain('真碳纖維');
    expect(h2.textContent).toContain('為原廠車身而生');
    // body × 2(碳纖維 placeholder 字面片段)
    expect(screen.getByText(/採用真碳纖維材質/)).toBeDefined();
    expect(screen.getByText(/可直接安裝在原廠車身上/)).toBeDefined();
  });

  it('renders 3 carbon stats with strong + span label', () => {
    const lightech1 = MOCK_PRODUCTS.find((p) => p.slug === 'lightech-1')!;
    render(<ProductSpotlight product={lightech1} />);
    // 3 stats(碳纖維質性、非舊鋁件數字)
    expect(screen.getByText('輕量')).toBeDefined();
    expect(screen.getByText('隔熱')).toBeDefined();
    expect(screen.getByText('直上')).toBeDefined();
    // 3 stats labels
    expect(screen.getByText('比原廠塑件輕')).toBeDefined();
    expect(screen.getByText('真碳纖不導熱')).toBeDefined();
    expect(screen.getByText('針對原廠開模')).toBeDefined();
  });

  it('renders for all 3 hardcoded products (lightech-1 / akrapovic-6 / brembo-7)', () => {
    const slugs = ['lightech-1', 'akrapovic-6', 'brembo-7'];
    for (const slug of slugs) {
      const product = MOCK_PRODUCTS.find((p) => p.slug === slug);
      expect(product?.hasSpotlight).toBe(true);
    }
  });
});
