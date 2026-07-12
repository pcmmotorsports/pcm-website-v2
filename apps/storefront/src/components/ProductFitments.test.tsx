// @vitest-environment jsdom
//
// ProductFitments smoke test — 適用車款分組清單(OD-12 + OD-12d 重設計、D1=A 車廠/車型/年式)。
// 驗:空狀態(無 fitments / 空陣列)返 null 兩路徑 + 渲染(eyebrow / title)+ 依車廠→車型分組
// (單/多車廠)+ 年式 chip 三態格式(開放式 + / 單年 / 區間 – / 無年份 —)+ 年式升序排序
// + a11y 巢狀 ARIA list 語意(品牌 / 車型 / 年式清單 role + 年式清單 aria-label 帶車型名)。
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

  it('exposes grouped fitments as nested ARIA lists with per-model year labels (a11y)', () => {
    const product = withFitments([
      { motoBrand: 'Aprilia', modelCode: 'RSV4', yearStart: 2016, yearEnd: 2019 },
      { motoBrand: 'Aprilia', modelCode: 'RSV4', yearStart: 2021, yearEnd: 2024 },
    ]);
    const { container } = render(<ProductFitments product={product} />);
    // 巢狀 list 語意:品牌清單 → 車型清單 → 年式清單(視覺不變、純 role 屬性)
    // S1 起品牌清單的 role=list 在 .pd-fit-groups 內層 tier 容器(兩層時各 tier 一個 list)
    expect(container.querySelector('.pd-fit-groups > div[role="list"]')).not.toBeNull();
    expect(container.querySelector('.pd-fit-group')?.getAttribute('role')).toBe('listitem');
    expect(container.querySelector('.pd-fit-rows')?.getAttribute('role')).toBe('list');
    expect(container.querySelector('.pd-fit-row')?.getAttribute('role')).toBe('listitem');
    // 年式清單以「{車型} 適用年式」具名(建立年式↔車型關係、報讀器最易丟失)
    const years = container.querySelector('.pd-fit-years');
    expect(years?.getAttribute('role')).toBe('list');
    expect(years?.getAttribute('aria-label')).toBe('RSV4 適用年式');
    expect(container.querySelector('.pd-fit-year')?.getAttribute('role')).toBe('listitem');
  });

  // S1 兩層(2026-07-12、Sean Q4=A):direct=原廠適用 / inherited=車系相容(推導)
  describe('two-tier (matchSource, S1)', () => {
    it('renders single tier without tier labels when no inherited fitments (零回歸)', () => {
      const product = withFitments([
        { motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2021, yearEnd: 2026 },
      ]);
      const { container } = render(<ProductFitments product={product} />);
      expect(container.querySelector('.pd-fit-tier')).toBeNull();
      expect(screen.getByText(/列表為主要適用車款/)).toBeDefined();
    });

    it('splits direct vs inherited into two labeled tiers with provenance note', () => {
      const product = withFitments([
        { motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2021, yearEnd: 2026 },
        { motoBrand: 'Yamaha', modelCode: 'MT-09 SP', yearStart: 2021, yearEnd: 2026, matchSource: 'inherited' },
        { motoBrand: 'Yamaha', modelCode: 'MT-09 Y-AMT', yearStart: 2024, yearEnd: 2026, matchSource: 'inherited' },
      ]);
      const { container } = render(<ProductFitments product={product} />);
      // 兩個層標:原廠適用 + 車系相容(推導)
      expect(screen.getByText('原廠適用')).toBeDefined();
      expect(screen.getByText('車系相容（推導）')).toBeDefined();
      // direct tier 只有 MT-09;inherited tier 有 SP / Y-AMT
      const tiers = container.querySelectorAll('.pd-fit-groups > div[role="list"]');
      expect(tiers.length).toBe(2);
      const modelsOf = (el: Element) =>
        Array.from(el.querySelectorAll('.pd-fit-model')).map((m) => m.textContent);
      expect(modelsOf(tiers[0]!)).toEqual(['MT-09']);
      expect(modelsOf(tiers[1]!)).toEqual(['MT-09 SP', 'MT-09 Y-AMT']);
      // provenance 說明文案切換
      expect(screen.getByText(/「原廠適用」為供應商原廠明示/)).toBeDefined();
    });

    it('renders inherited-only product without empty direct tier label', () => {
      const product = withFitments([
        { motoBrand: 'Yamaha', modelCode: 'MT-09 SP', yearStart: 2021, yearEnd: 2026, matchSource: 'inherited' },
      ]);
      const { container } = render(<ProductFitments product={product} />);
      // 無 direct → 不顯「原廠適用」空層標;推導層標仍在
      expect(screen.queryByText('原廠適用')).toBeNull();
      expect(screen.getByText('車系相容（推導）')).toBeDefined();
      expect(container.querySelectorAll('.pd-fit-groups > div[role="list"]').length).toBe(1);
    });
  });
});
