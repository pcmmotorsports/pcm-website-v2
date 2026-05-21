// @vitest-environment jsdom
//
// ProductHighlights smoke test — 商品詳細頁 N°01 Highlights 區塊(M-1-13H-4 新建)。
// 驗 eyebrow / h2 brand 注入 / lead / 3 卡 num + title + desc 字面渲染。
// 純 presentational server component、無 hooks / interactive(不需 CartProvider wrapper)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductHighlights } from './ProductHighlights';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(cleanup);

describe('ProductHighlights', () => {
  it('renders eyebrow + h2 with product.brand template + lead', () => {
    const product = MOCK_PRODUCTS[0]!; // LIGHTECH
    render(<ProductHighlights product={product} />);
    expect(screen.getByText('N°01 — Highlights')).toBeDefined();
    // h2 模板:`為什麼是 {brand}`
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent).toBe(`為什麼是 ${product.brand}`);
    expect(screen.getByText(/義大利賽道工藝 28 年沉澱/)).toBeDefined();
  });

  it('renders 3 feature cards (01 / 02 / 03) with title + desc', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductHighlights product={product} />);
    // 3 卡 num
    expect(screen.getByText('01')).toBeDefined();
    expect(screen.getByText('02')).toBeDefined();
    expect(screen.getByText('03')).toBeDefined();
    // 3 卡 title
    expect(screen.getByText('航太級材質')).toBeDefined();
    expect(screen.getByText('CNC 一體成型')).toBeDefined();
    expect(screen.getByText('原廠保固')).toBeDefined();
    // 3 卡 desc(各取片段、避免標點全形/半形敏感)
    expect(screen.getByText(/7075-T6 鋁合金/)).toBeDefined();
    expect(screen.getByText(/公差 ±0.02mm/)).toBeDefined();
    expect(screen.getByText(/義大利原廠授權 24 個月/)).toBeDefined();
  });

  it('uses different brand in h2 when product brand differs (template injection)', () => {
    const akrapovic = MOCK_PRODUCTS.find((p) => p.slug === 'akrapovic-6')!;
    render(<ProductHighlights product={akrapovic} />);
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent).toBe('為什麼是 AKRAPOVIČ');
  });

  it('renders exactly 3 .pd-feature-card elements', () => {
    const product = MOCK_PRODUCTS[0]!;
    render(<ProductHighlights product={product} />);
    const cards = document.querySelectorAll('.pd-feature-card');
    expect(cards.length).toBe(3);
  });
});
