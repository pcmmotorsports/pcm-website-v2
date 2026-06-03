// @vitest-environment jsdom
//
// ProductFitments smoke test — 適用車款表(OD-12、OD §7.5 直接搬、D1=A 3 欄)。
// 驗:空狀態(無 fitments / 空陣列)返 null 兩路徑 + 表渲染(eyebrow / title / 3 欄表頭 / 列) +
// 年式三態格式(開放式 + / 單年 / 區間 –)+ unconfirmed「未確認」標。
// 純 presentational server component、無 hooks / interactive(不需 CartProvider wrapper)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ProductFitments } from './ProductFitments';
import { MOCK_PRODUCTS, type MockProduct, type UIFitment } from '../data/mock-products';

afterEach(cleanup);

// 帶 fitments 的測試品(mock 商品本身無 fitments、spread 後注入真 shape)。
function withFitments(fitments: UIFitment[]): MockProduct {
  return { ...MOCK_PRODUCTS[0]!, fitments };
}

describe('ProductFitments', () => {
  it('renders nothing when product.fitments is undefined (mock / 通用款)', () => {
    const noFit = MOCK_PRODUCTS.find((p) => p.slug === 'rizoma-5')!;
    expect(noFit.fitments).toBeUndefined();
    const { container } = render(<ProductFitments product={noFit} />);
    expect(container.querySelector('.pd-fitments-section')).toBeNull();
  });

  it('renders nothing when product.fitments is an empty array', () => {
    const { container } = render(<ProductFitments product={withFitments([])} />);
    expect(container.querySelector('.pd-fitments-section')).toBeNull();
  });

  it('renders the fitments section with OD §7.5 eyebrow + title + 3 column headers (D1=A)', () => {
    const product = withFitments([
      { motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2025 },
    ]);
    const { container } = render(<ProductFitments product={product} />);
    expect(container.querySelector('.pd-fitments-section')).not.toBeNull();
    expect(screen.getByText('FITMENTS · 適用車款')).toBeDefined();
    expect(screen.getByText('這款部品適用的車型與年式')).toBeDefined();
    // D1=A:3 欄(車廠 / 車型 / 年式)、非 OD 模板 4 欄含車系
    const headers = Array.from(container.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual(['車廠', '車型', '年式']);
  });

  it('renders one row per fitment with brand / model cells', () => {
    const product = withFitments([
      { motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2025 },
      { motoBrand: 'Ducati', modelCode: 'Panigale V4R', yearStart: 2019, yearEnd: 2025 },
    ]);
    const { container } = render(<ProductFitments product={product} />);
    expect(container.querySelectorAll('tbody tr').length).toBe(2);
    expect(screen.getByText('Panigale V4')).toBeDefined();
    expect(screen.getByText('Panigale V4R')).toBeDefined();
    // 車廠走 .brand 樣式
    expect(container.querySelector('.pd-fit-table .brand')?.textContent).toBe('Ducati');
  });

  it('formats years across the three yearEnd states (range – / single / open-ended +)', () => {
    const product = withFitments([
      { motoBrand: 'A', modelCode: 'range', yearStart: 2018, yearEnd: 2025 }, // 區間
      { motoBrand: 'A', modelCode: 'single-omit', yearStart: 2020 }, // 單年(yearEnd 省略)
      { motoBrand: 'A', modelCode: 'single-eq', yearStart: 2021, yearEnd: 2021 }, // 單年(yearEnd===yearStart)
      { motoBrand: 'A', modelCode: 'open', yearStart: 2025, yearEnd: null }, // 開放式
      { motoBrand: 'A', modelCode: 'none' }, // 無年份
    ]);
    const { container } = render(<ProductFitments product={product} />);
    const years = Array.from(container.querySelectorAll('tbody .years')).map((td) => td.textContent);
    expect(years).toEqual(['2018–2025', '2020', '2021', '2025+', '—']);
  });

  it('marks unconfirmed fitments with a 「未確認」 tag', () => {
    const product = withFitments([
      { motoBrand: 'Ducati', modelCode: 'Confirmed', yearStart: 2020 },
      { motoBrand: 'Ducati', modelCode: 'Auto', yearStart: 2021, unconfirmed: true },
    ]);
    const { container } = render(<ProductFitments product={product} />);
    const tags = container.querySelectorAll('.pd-fit-unconfirmed');
    expect(tags.length).toBe(1);
    expect(tags[0]?.textContent).toBe('未確認');
  });
});
