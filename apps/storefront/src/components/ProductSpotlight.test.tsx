// @vitest-environment jsdom
//
// ProductSpotlight smoke test — 「碳纖維工藝」深度區塊(OD-7a carbon-ify)。
// 驗條件渲染(hasSpotlight × brandSlug 兩道守門)+ eyebrow / h2 / 2 body / 3 stats 字面。
// 🔴 P0-C 去碳第二道守門:renders 需 hasSpotlight=true **且** brandSlug='rpm-carbon';
//   非 RPM(或 brandSlug 未設)即使 hasSpotlight=true 也不渲染(碳纖維 placeholder 不外洩到非 RPM 頁、Q2=B)。
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

  // 🔴 P0-C 去碳第二道守門:hasSpotlight=true 但非 RPM 品牌 → 不渲染(碳纖維 placeholder 不外洩)。
  it('renders nothing when hasSpotlight=true but brandSlug is non-RPM', () => {
    const nonRpm = { ...MOCK_PRODUCTS[0]!, hasSpotlight: true, brandSlug: 'gb-racing' };
    const { container } = render(<ProductSpotlight product={nonRpm} />);
    expect(container.querySelector('.pd-spotlight')).toBeNull();
  });

  // 🔴 P0-C:hasSpotlight=true 但 brandSlug 未設(mock 省略)→ 不渲染(真 RPM 頁靠 brandSlug、非 mock-only hasSpotlight)。
  it('renders nothing when hasSpotlight=true but brandSlug is undefined', () => {
    const noSlug = { ...MOCK_PRODUCTS[0]!, hasSpotlight: true };
    expect(noSlug.brandSlug).toBeUndefined();
    const { container } = render(<ProductSpotlight product={noSlug} />);
    expect(container.querySelector('.pd-spotlight')).toBeNull();
  });

  it('renders full carbon section when hasSpotlight=true AND brandSlug=rpm-carbon', () => {
    const lightech1 = MOCK_PRODUCTS.find((p) => p.slug === 'lightech-1')!;
    expect(lightech1.hasSpotlight).toBe(true);
    // 🔴 P0-C:RPM 品牌才渲染碳纖維段;mock 未帶 brandSlug、測試明設 'rpm-carbon' 字面(獨立驗守門值)。
    const rpm = { ...lightech1, brandSlug: 'rpm-carbon' };
    const { container } = render(<ProductSpotlight product={rpm} />);
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
    render(<ProductSpotlight product={{ ...lightech1, brandSlug: 'rpm-carbon' }} />);
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
