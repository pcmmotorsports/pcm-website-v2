// @vitest-environment jsdom
//
// FilterTop smoke test — 前台 regression 安全網。
// 驗「render 不報錯 + 關鍵互動(chip dropdown 開合 / 現貨 toggle)不報錯」。
// M-1-12a 起 FilterTop 改 controlled、用 Harness 持 useReducer + useState 模擬宿主。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { useReducer, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
import { FilterTop, type FilterTopData } from './FilterTop';
import { makeInitialExtraFilters, type ProductExtraFilters } from './filter-state';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';

const data: FilterTopData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

// controlled FilterTop 的宿主模擬 — 持 cascade reducer + extras + sort state。
function Harness() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  const [sort, setSort] = useState('recommend');
  return (
    <FilterTop
      data={data}
      resultCount={128}
      cascade={cascade}
      dispatch={dispatch}
      extras={extras}
      setExtras={setExtras}
      sort={sort}
      setSort={setSort}
    />
  );
}

// 自訂價格區間那幾條要斷言 `extras` 的內容,而 FilterTop 不對外吐 state
// ⇒ 宿主自己把它印成一個 data-testid,測試讀那一格。
// (只在本檔的 Harness,不動產品程式。)
function PriceHarness() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  const [sort, setSort] = useState('recommend');
  return (
    <>
      <FilterTop
        data={data}
        resultCount={128}
        cascade={cascade}
        dispatch={dispatch}
        extras={extras}
        setExtras={setExtras}
        sort={sort}
        setSort={setSort}
      />
      <output data-testid="extras">{JSON.stringify({ price: extras.price, priceRange: extras.priceRange ?? null })}</output>
    </>
  );
}

/**
 * 開啟價格 dropdown 並回傳兩個輸入框與套用鈕。
 * 🔴 chip 的文字**會變**:`FilterTop.tsx:190` 是 `{extras.price || '價格'}`
 *    ⇒ 選過預設列之後,那顆 chip 上面寫的是選中的標籤,不是「價格」。
 *    (第一版測試寫死找「價格」,選過預設列的那條就找不到了 —— 那是測試的錯,不是產品的。)
 */
function openPricePanel(chipText = '價格') {
  // 🔴 用 `.ft-chip` 限定:選過預設列之後,同一段文字**同時**出現在 chip 與已選 pill 上
  //    ⇒ 純用文字找會撞到兩個(第二版測試就是這樣紅的)。
  const chip = screen
    .getAllByText(chipText)
    .map((el) => el.closest('button.ft-chip'))
    .find((el): el is HTMLButtonElement => el !== null);
  if (chip === undefined) throw new Error(`找不到文字為 ${chipText} 的 .ft-chip`);
  fireEvent.click(chip);
  return {
    min: screen.getByPlaceholderText('最低'),
    max: screen.getByPlaceholderText('最高'),
    apply: screen.getByText('套用'),
  };
}

const readExtras = () => JSON.parse(screen.getByTestId('extras').textContent ?? '{}');

afterEach(cleanup);

describe('FilterTop', () => {
  it('should render the filter bar without crashing', () => {
    render(<Harness />);
    expect(screen.getByText('128 件商品')).toBeDefined();
    expect(screen.getByText('依車輛搜尋')).toBeDefined();
  });

  it('should open the brand dropdown when the brand chip is clicked', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('品牌'));
    // 品牌 dropdown 顯示品牌列(MOCK_BRANDS 第一筆)
    expect(screen.getByText('BONAMICI RACING')).toBeDefined();
  });

  // Sean 2026-07-13:左欄點大類 = 直接篩「該大類全部」+ 右欄展開細項(取消「全部 {大類}」列)。
  it('should filter the whole category and reveal subs on clicking a top category, no 全部 row', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('零件分類')); // 開分類 dropdown
    fireEvent.click(screen.getByText('代理配件')); // 左欄點大類 → 篩全部 + 右欄展開
    expect(screen.getByText('CNC RACING')).toBeDefined(); // 右欄細項顯示
    expect(screen.queryByText('全部 代理配件')).toBeNull(); // 不再有獨立「全部」列
  });

  // M-1-13e-pre-3:Sean 2026-05-21 業務拍板「不顯示有無庫存」、SHOW_IN_STOCK_FILTER=false
  // 隱藏「僅顯示現貨」chip;原「toggle 後出現清除全部 pill」測點失效、翻轉為「verify hidden」。
  // 未來業務 revisit 把 flag 改 true 時、本 test 會 alert(需改回測 click 互動)、是 regression 錨點。
  it('should not render 僅顯示現貨 chip when SHOW_IN_STOCK_FILTER=false', () => {
    render(<Harness />);
    expect(screen.queryByText('僅顯示現貨')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 自訂價格區間(2026-08-22 接線;此前那三個元素是從 design 靜態稿逐字搬進來的,
// 沒有 value / onChange / onClick ⇒ 客人打完兩個數字按「套用」什麼都不會發生)。
// 溯源:`~/pcm-mailbox/E-011-FilterTop死鈕溯源與規格-20260822.md`
// ─────────────────────────────────────────────────────────────────────────────
describe('FilterTop 自訂價格區間', () => {
  it('填最低與最高按套用 → 寫進 priceRange', () => {
    render(<PriceHarness />);
    const { min, max, apply } = openPricePanel();
    fireEvent.change(min, { target: { value: '1000' } });
    fireEvent.change(max, { target: { value: '5000' } });
    fireEvent.click(apply);
    expect(readExtras().priceRange).toEqual([1000, 5000]);
  });

  // 🔴 這一條是整片最重要的守門。
  // `products-filter-logic.ts:102` 與 `:106` 是【兩條獨立的 if】,`price` 與 `priceRange`
  // 兩個都設會 AND 疊加;而畫面上預設列與自訂區間看起來是同一個「價格」篩選器。
  // ⇒ 疊加的結果是「篩不到東西」,而客人只會以為沒貨。
  // 突變:把 handler 裡的 `price: null` 拿掉 ⇒ 只有這一條紅。
  it('先點預設列再用自訂區間 → 預設列要被清掉,不可以兩個一起生效', () => {
    render(<PriceHarness />);
    fireEvent.click(screen.getByText('價格'));
    fireEvent.click(screen.getByText('NT$ 3,000 – 10,000'));
    expect(readExtras().price).toBe('NT$ 3,000 – 10,000');

    const { min, max, apply } = openPricePanel('NT$ 3,000 – 10,000');
    fireEvent.change(min, { target: { value: '1000' } });
    fireEvent.change(max, { target: { value: '2000' } });
    fireEvent.click(apply);

    const e = readExtras();
    expect(e.priceRange).toEqual([1000, 2000]);
    expect(e.price).toBeNull();
  });

  // 🔴 只填最低時上限不能用 Infinity:網址同步寫 `pmax=String(...)`
  // (`use-catalog-filter-url-sync.tsx` 的 `params.set('pmax', …)` 那行),而回程的 `parseNonNegativeInteger`
  // (`lib/catalog-query.ts:130-139`)要求 `Number.isInteger` —— `Infinity` 過不了
  // ⇒ **重整之後上限會安靜消失**。這一條釘住「上限必須是能來回的整數」。
  // 突變:把 `Number.MAX_SAFE_INTEGER` 換回 `Infinity` ⇒ 只有這一條紅。
  it('只填最低 → 上限要是能通過網址回程檢查的整數,不是 Infinity', () => {
    render(<PriceHarness />);
    const { min, apply } = openPricePanel();
    fireEvent.change(min, { target: { value: '8000' } });
    fireEvent.click(apply);

    const [lo, hi] = readExtras().priceRange;
    expect(lo).toBe(8000);
    expect(Number.isInteger(hi)).toBe(true);
    expect(Number.isFinite(hi)).toBe(true);
    // 正向對照:它真的過得了那支 parser 的判準(非負整數)。
    expect(Number.isInteger(Number(String(hi))) && Number(String(hi)) >= 0).toBe(true);
  });

  it('只填最高 → 下限補 0', () => {
    render(<PriceHarness />);
    const { max, apply } = openPricePanel();
    fireEvent.change(max, { target: { value: '3000' } });
    fireEvent.click(apply);
    expect(readExtras().priceRange[0]).toBe(0);
    expect(readExtras().priceRange[1]).toBe(3000);
  });

  it('打反了要對調,不要給一個必然為空的區間', () => {
    render(<PriceHarness />);
    const { min, max, apply } = openPricePanel();
    fireEvent.change(min, { target: { value: '9000' } });
    fireEvent.change(max, { target: { value: '2000' } });
    fireEvent.click(apply);
    expect(readExtras().priceRange).toEqual([2000, 9000]);
  });

  it('兩格都空按套用 → 取消區間,不是變成篩 0 元以上', () => {
    render(<PriceHarness />);
    const { min, max, apply } = openPricePanel();
    fireEvent.change(min, { target: { value: '1000' } });
    fireEvent.change(max, { target: { value: '5000' } });
    fireEvent.click(apply);
    expect(readExtras().priceRange).toEqual([1000, 5000]);

    const p2 = openPricePanel();
    fireEvent.change(p2.min, { target: { value: '' } });
    fireEvent.change(p2.max, { target: { value: '' } });
    fireEvent.click(p2.apply);
    expect(readExtras().priceRange).toBeNull();
  });

  it('非數字 / 負數 / 小數一律當空白,不寫進 priceRange', () => {
    for (const bad of ['abc', '-100', '12.5', '  ']) {
      cleanup();
      render(<PriceHarness />);
      const { min, apply } = openPricePanel();
      fireEvent.change(min, { target: { value: bad } });
      fireEvent.click(apply);
      expect(readExtras().priceRange, `輸入 ${JSON.stringify(bad)}`).toBeNull();
    }
  });

  // 負向對照:證明上面那些不是「怎麼點都會過」。
  // 沒按套用之前,打字本身不可以改變篩選條件。
  it('只打字不按套用 → 篩選條件完全不動', () => {
    render(<PriceHarness />);
    const { min, max } = openPricePanel();
    fireEvent.change(min, { target: { value: '1000' } });
    fireEvent.change(max, { target: { value: '5000' } });
    expect(readExtras().priceRange).toBeNull();
    expect(readExtras().price).toBeNull();
  });
});

/**
 * ⟦fc-FOCUSTRAP⟧ Tab 在 dropdown 內循環(2026-09-02;樣板 = FilterDrawer)。
 *
 * 🔴🔴 **本支的特別之處:它的 keydown【已經存在】(原本只處理 Escape)。**
 *    循環是**合進那個 handler**,不是再掛第二個 listener ——
 *    掛第二個會長成「兩個 handler 各判各的鍵,而誰先跑取決於註冊順序」
 *    ⇒ 📌 那是一個「今天剛好對」的東西,而順序被改動時**不會紅**。
 * 🔵 而本支**不做「開啟時移入焦點」**:dropdown 是由那顆 chip 點開的,
 *    焦點本來就在 chip 上、而 chip 在面板外 ⇒ 移入會把它搶走,那是另一個決定。
 *    ⇒ 已交主視窗;而循環仍然成立:**一旦焦點進到面板裡,它就走不出去。**
 * ⚠️ 不是等價物:守得住 Tab 走出去,守不住螢幕閱讀器讀到背景(要 `inert`,已另開一列)。
 */
describe('⟦fc-FOCUSTRAP⟧ FilterTop', () => {
  const dropdownFocusables = (container: HTMLElement) =>
    [...(container.querySelector('.ft-dropdown')?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled])',
    ) ?? [])];

  it('🔴 焦點在最後一個 → Tab → 回到第一個(不得走出 dropdown)', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText('品牌'));
    const f = dropdownFocusables(container);
    // 🟢 正對照:少於 2 個 ⇒ 下面那格恆真
    expect(f.length, 'dropdown 內可聚焦少於 2 個 ⇒ 證不到循環').toBeGreaterThan(1);
    const last = f[f.length - 1]!;
    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement, 'Tab 走出了 dropdown ⇒ 客人掉到背後的導覽列').toBe(f[0]);
  });

  it('🔵 既有的 Escape 仍然關得掉(合進去不得弄壞它)', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText('品牌'));
    expect(container.querySelector('.ft-dropdown')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.ft-dropdown'), '合進循環之後 Escape 失效了').toBeNull();
  });

  it('🔵 dropdown 關著時不攔全域 Tab', () => {
    render(<Harness />);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement, '關著卻攔了全站的 Tab').toBe(outside);
    outside.remove();
  });
});
