// @vitest-environment jsdom
//
// ProductSpotlight smoke test — N°02 Engineering Spotlight 區塊(M-1-13H-4 新建)。
// 驗條件渲染(hasSpotlight true/false 兩種路徑)+ eyebrow / h2 / 2 body / 3 stats 字面。
// 純 presentational server component、無 hooks / interactive(不需 CartProvider wrapper)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductSpotlight } from './ProductSpotlight';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(cleanup);

describe('ProductSpotlight', () => {
  it('renders nothing when product.hasSpotlight is falsy', () => {
    // mock 順序前 5(lightech-1 / lightech-2 / cnc-racing-3 / gb-racing-4 / rizoma-5)中
    // 只有 lightech-1 hasSpotlight: true(Sean 2026-05-22 A1 拍板)、其餘 falsy
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

  it('renders full section when product.hasSpotlight is true', () => {
    // Sean A1 拍板:lightech-1 / akrapovic-6 / brembo-7 hasSpotlight: true
    const lightech1 = MOCK_PRODUCTS.find((p) => p.slug === 'lightech-1')!;
    expect(lightech1.hasSpotlight).toBe(true);
    const { container } = render(<ProductSpotlight product={lightech1} />);
    expect(container.querySelector('.pd-spotlight')).not.toBeNull();
    expect(screen.getByText('N°02 — Engineering')).toBeDefined();
    // h2 結構:`為賽道設計、<br/>適合每日通勤。` — 含換行、用 partial match
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent).toContain('為賽道設計');
    expect(h2.textContent).toContain('適合每日通勤');
    // body × 2(字面片段)
    expect(screen.getByText(/從 SBK 賽事工程衍生/)).toBeDefined();
    expect(screen.getByText(/Plug & Play/)).toBeDefined();
  });

  it('renders 3 stats with strong number + span label', () => {
    const lightech1 = MOCK_PRODUCTS.find((p) => p.slug === 'lightech-1')!;
    render(<ProductSpotlight product={lightech1} />);
    // 3 stats numbers
    expect(screen.getByText('−38%')).toBeDefined();
    expect(screen.getByText('±0.02mm')).toBeDefined();
    expect(screen.getByText('24m')).toBeDefined();
    // 3 stats labels
    expect(screen.getByText('較原廠輕量化')).toBeDefined();
    expect(screen.getByText('CNC 加工公差')).toBeDefined();
    expect(screen.getByText('原廠保固期')).toBeDefined();
  });

  it('renders for all 3 hardcoded products (lightech-1 / akrapovic-6 / brembo-7)', () => {
    const slugs = ['lightech-1', 'akrapovic-6', 'brembo-7'];
    for (const slug of slugs) {
      const product = MOCK_PRODUCTS.find((p) => p.slug === slug);
      expect(product?.hasSpotlight).toBe(true);
    }
  });
});
