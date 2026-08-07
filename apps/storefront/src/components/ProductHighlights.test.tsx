// @vitest-environment jsdom
//
// ProductHighlights smoke test — 商品詳細頁 N°01「為什麼選 RPM Carbon」(OD-6 reskin)。
// 驗 eyebrow(義體數字 + 品牌 label)/ h2 / lead / 3 卡 num + title + desc 字面渲染。
// OD-6 起 prop-less(N°01 = OD 模板 RPM 共用區塊、RPM 固定內容、不再吃 product)。
// 純 presentational、無 hooks / interactive(不需 CartProvider wrapper)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductHighlights } from './ProductHighlights';

afterEach(cleanup);

describe('ProductHighlights', () => {
  it('renders nested eyebrow (01 + RPM Carbon logo) + h2 + lead', () => {
    render(<ProductHighlights />);
    // eyebrow:義體數字 01 + 真 RPM Carbon logo 圖(#270 B、pd-eb-logo img、Sean 2026-07-09 提供)
    expect(document.querySelector('.pd-eb-no')?.textContent).toBe('01');
    expect(screen.getByAltText('RPM Carbon')).toBeDefined();
    // h2:RPM 固定(取代舊「為什麼是 {brand}」)
    const h2 = screen.getByRole('heading', { level: 2 });
    expect(h2.textContent).toBe('為什麼選 RPM Carbon');
    expect(screen.getByText(/來自泰國/)).toBeDefined();
  });

  it('renders 3 feature cards (01 / 02 / 03) with OD title + desc', () => {
    render(<ProductHighlights />);
    // 3 卡 title(直接搬 OD N°01)
    expect(screen.getByText('可直上原廠')).toBeDefined();
    expect(screen.getByText('紋路想怎麼搭都行')).toBeDefined();
    expect(screen.getByText('輕量化．隔熱防燙')).toBeDefined();
    // 3 卡 desc 片段(取卡內獨有字串、避免與 lead 或標點衝突)
    expect(screen.getByText(/直接安裝在原廠車身上/)).toBeDefined();
    expect(screen.getByText(/五款紋路/)).toBeDefined();
    expect(screen.getByText(/真碳纖維比原廠塑件更輕/)).toBeDefined();
  });

  it('renders exactly 3 .pd-feature-card elements', () => {
    render(<ProductHighlights />);
    const cards = document.querySelectorAll('.pd-feature-card');
    expect(cards.length).toBe(3);
  });
});
