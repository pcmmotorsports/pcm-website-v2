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
    expect(yearChips(container)).toEqual(['2009–2015', '2016', '2021–2024', '2025 年起']);
  });

  it('開放年才補責任邊界那句話;封閉年段不補(對照組)', () => {
    const open = withFitments([{ motoBrand: 'A', modelCode: 'X', yearStart: 2018, yearEnd: null }]);
    const closed = withFitments([{ motoBrand: 'A', modelCode: 'X', yearStart: 2018, yearEnd: 2024 }]);
    const noteOf = (p: Parameters<typeof ProductFitments>[0]['product']) =>
      render(<ProductFitments product={p} />).container.querySelector('.pd-fit-note')?.textContent ?? '';
    expect(noteOf(open)).toContain('請以實車確認');
    // 🔵 對照組:沒有開放年的商品不該出現那句話 —— 否則每一件都在說「請以實車確認」,那句話就沒有意義了。
    expect(noteOf(closed)).not.toContain('請以實車確認');
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

describe('🔴 「這些情況裝不上」那一塊(2026-09-18 Sean 拍乙)', () => {
  const TITLE = '這些情況裝不上';
  const fitted = () =>
    withFitments([{ motoBrand: 'Honda', modelCode: 'X-ADV 750', yearStart: 2017, yearEnd: 2020 }]);

  // 🔴🔴 **負對照排在最前面, 而那是刻意的**(主視窗逐字:它比正向那幾件重要)。
  //   正向那幾件改完一定有人去看;而「**沒有條款的商品多長出一塊東西**」是那種
  //   沒有人會主動去看的頁面 —— 一旦發生就是 1,106 件 rpm 商品**一起長**。
  it('🔵 負對照①:沒有傳 exclusions ⇒ 那一塊【整個不存在】(不是空框、不是「無」)', () => {
    const { container } = render(<ProductFitments product={fitted()} />);
    expect(container.textContent).not.toContain(TITLE);
    expect(container.querySelector('.pd-fit-excl')).toBeNull();
  });

  it('🔵 負對照②:傳空陣列 ⇒ 一樣整個不存在', () => {
    const { container } = render(<ProductFitments product={fitted()} exclusions={[]} />);
    expect(container.textContent).not.toContain(TITLE);
    expect(container.querySelector('.pd-fit-excl')).toBeNull();
  });

  it('正向:有條款 ⇒ 標題與每一句都印得出來', () => {
    const { container } = render(
      <ProductFitments product={fitted()} exclusions={['2021 年以後的車型裝不上', '配原廠排氣管時裝不上']} />,
    );
    expect(container.textContent).toContain(TITLE);
    expect(container.textContent).toContain('2021 年以後的車型裝不上');
    expect(container.textContent).toContain('配原廠排氣管時裝不上');
    expect(container.querySelectorAll('.pd-fit-excl-list li')).toHaveLength(2);
  });

  it('🛑 商品沒有 fitments ⇒ 整段本來就不渲染 ⇒ 那一塊也不可以自己冒出來', () => {
    // 🔵 這一格守的是「兩個空狀態的疊加」:別讓排除條款把一個本來不該存在的段落撐出來。
    const { container } = render(<ProductFitments product={withFitments([])} exclusions={['不管寫什麼']} />);
    expect(container.textContent).not.toContain(TITLE);
  });
});

describe('🔴 正常路徑:元件【自己】用 (brandSlug, productCode) 查 —— 不靠 prop', () => {
  // 🛑 上面那幾格都餵 `exclusions` prop ⇒ 它們驗的是「拿到字串之後畫得對不對」,
  //   **驗不到「查得對不對」**。而查錯商品正是這一片要防的病。
  const rpmProduct = (productCode: string) => ({
    ...withFitments([{ motoBrand: 'Honda', modelCode: 'X-ADV 750', yearStart: 2017, yearEnd: 2020 }]),
    brandSlug: 'rpm-carbon',
    productCode,
  });

  it('真的有條款的那一件 ⇒ 自己查得到、畫得出來', () => {
    const { container } = render(<ProductFitments product={rpmProduct('XADV04')} />);
    expect(container.textContent).toContain('這些情況裝不上');
    expect(container.textContent).toContain('2021');
  });

  it('🔵 負對照①:同品牌但料號不在例外表 ⇒ 那一塊不存在', () => {
    const { container } = render(<ProductFitments product={rpmProduct('ZZZ-NOT-IN-TABLE')} />);
    expect(container.querySelector('.pd-fit-excl')).toBeNull();
  });

  it('🔴 負對照②:料號對【而品牌不對】⇒ 那一塊不存在(這格守的是「不要掛錯商品」)', () => {
    // 🎯 同一個料號跨供應商撞號實查 **97 組** ⇒ 若哪天有人把鍵改成只用 productCode,
    //   這一格會紅 —— 那正是它存在的理由。
    const other = { ...rpmProduct('XADV04'), brandSlug: 'bonamici' };
    const { container } = render(<ProductFitments product={other} />);
    expect(container.querySelector('.pd-fit-excl')).toBeNull();
  });
});

