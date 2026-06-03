// @vitest-environment jsdom
//
// ProductFitments smoke test — 適用車款分組清單(OD-12 + OD-12d 重設計、D1=A 車廠/車型/年式)。
// 驗:空狀態(無 fitments / 空陣列)返 null 兩路徑 + 渲染(eyebrow / title)+ 依車廠→車型分組
// (單/多車廠)+ 年式 chip 三態格式(開放式 + / 單年 / 區間 – / 無年份 —)+ 年式升序排序。
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

function yearChips(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll('.pd-fit-year')).map((el) => el.textContent ?? '');
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

  it('renders the section with eyebrow + title', () => {
    const product = withFitments([
      { motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2025 },
    ]);
    const { container } = render(<ProductFitments product={product} />);
    expect(container.querySelector('.pd-fitments-section')).not.toBeNull();
    expect(screen.getByText('FITMENTS · 適用車款')).toBeDefined();
    expect(screen.getByText('這款部品適用的車型與年式')).toBeDefined();
  });

  it('groups by brand → model (single brand, distinct models)', () => {
    const product = withFitments([
      { motoBrand: 'Aprilia', modelCode: 'RSV4', yearStart: 2016, yearEnd: 2019 },
      { motoBrand: 'Aprilia', modelCode: 'RSV4', yearStart: 2021, yearEnd: 2024 },
      { motoBrand: 'Aprilia', modelCode: 'Tuono V4', yearStart: 2016, yearEnd: 2019 },
    ]);
    const { container } = render(<ProductFitments product={product} />);
    // 單一車廠 → 1 個 group;標頭顯車廠
    const groups = container.querySelectorAll('.pd-fit-group');
    expect(groups.length).toBe(1);
    expect(groups[0]?.querySelector('.pd-fit-brand')?.textContent).toBe('Aprilia');
    // 2 個 distinct 車型 → 2 個 row(同車型多年式不重複列)
    const models = Array.from(container.querySelectorAll('.pd-fit-model')).map((el) => el.textContent);
    expect(models).toEqual(['RSV4', 'Tuono V4']);
    // RSV4 兩個年式聚在同一車型 row
    const rsv4Row = container.querySelectorAll('.pd-fit-row')[0]!;
    expect(yearChips(rsv4Row)).toEqual(['2016–2019', '2021–2024']);
  });

  it('groups multiple brands into separate groups (insertion order)', () => {
    const product = withFitments([
      { motoBrand: 'Aprilia', modelCode: 'RSV4', yearStart: 2016, yearEnd: 2019 },
      { motoBrand: 'Ducati', modelCode: 'Panigale V4', yearStart: 2018, yearEnd: 2025 },
    ]);
    const { container } = render(<ProductFitments product={product} />);
    const brands = Array.from(container.querySelectorAll('.pd-fit-brand')).map((el) => el.textContent);
    expect(brands).toEqual(['Aprilia', 'Ducati']);
    expect(container.querySelectorAll('.pd-fit-group').length).toBe(2);
  });

  it('formats year chips across three yearEnd states and sorts ascending by yearStart', () => {
    // 故意亂序 + 涵蓋 區間 / 單年(yearEnd 省略)/ 開放式 三態
    const product = withFitments([
      { motoBrand: 'A', modelCode: 'X', yearStart: 2021, yearEnd: 2024 }, // 區間
      { motoBrand: 'A', modelCode: 'X', yearStart: 2009, yearEnd: 2015 }, // 區間
      { motoBrand: 'A', modelCode: 'X', yearStart: 2025, yearEnd: null }, // 開放式
      { motoBrand: 'A', modelCode: 'X', yearStart: 2016 }, // 單年(yearEnd 省略)
    ]);
    const { container } = render(<ProductFitments product={product} />);
    // 升序排列(yearStart asc):2009 / 2016 / 2021 / 2025
    expect(yearChips(container)).toEqual(['2009–2015', '2016', '2021–2024', '2025+']);
  });

  it('renders 「—」 for fitment without yearStart and sorts it last', () => {
    const product = withFitments([
      { motoBrand: 'A', modelCode: 'X' }, // 無年份 → —
      { motoBrand: 'A', modelCode: 'X', yearStart: 2020, yearEnd: 2020 }, // 單年(===起年)
    ]);
    const { container } = render(<ProductFitments product={product} />);
    // 無 yearStart 排末
    expect(yearChips(container)).toEqual(['2020', '—']);
  });
});
