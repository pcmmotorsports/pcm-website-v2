// @vitest-environment jsdom
// ActiveChips smoke — V-1a(Sean 07-15 追加 2):車輛膠囊拆三顆、可單刪、連動語意。

import { describe, it, expect, vi, afterEach } from 'vitest';

// 🔴 分類膠囊改成【讀網址】之後, 本檔需要一個會動的 searchParams 與一個接得住 replace 的 router。
const hoisted = vi.hoisted(() => ({ search: new URLSearchParams(), replaced: [] as string[] }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => hoisted.search,
  useRouter: () => ({
    replace: (url: string) => {
      hoisted.replaced.push(url);
      hoisted.search = new URLSearchParams(new URL(url, 'http://localhost').search);
    },
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));
import { render, fireEvent, cleanup } from '@testing-library/react';

afterEach(cleanup);
import { ActiveChips } from './ActiveChips';
import { makeInitialExtraFilters } from './filter-state';
import type { FilterTopData } from './FilterTop';

const DATA = { motoBrands: [], categories: [], brands: [] } as unknown as FilterTopData;

function renderChips(vehicle: { brand: string; model?: string; year?: number } | null) {
  const dispatch = vi.fn();
  const utils = render(
    <ActiveChips
      data={DATA}
      cascade={{ vehicle, category: null, brands: [] }}
      dispatch={dispatch}
      extras={makeInitialExtraFilters()}
      setExtras={vi.fn()}
    />,
  );
  return { dispatch, ...utils };
}

// ── ⟦M-4b 多顆分類膠囊 · 顯示那半⟧ Sean 2026-09-04 拍甲「同時列全段+尾段」 ──
// 🔴 **這幾格守的是【分類膠囊讀的是網址, 不是 state】** —— 而那不是實作偏好:
//    `cascade.category` 是單數(`packages/ui`), 裝不下兩顆;改共用狀態機是另一條路。
describe('ActiveChips — 分類膠囊(多顆, 讀網址)', () => {
  function renderWithUrl(qs: string) {
    hoisted.search = new URLSearchParams(qs);
    hoisted.replaced = [];
    const dispatch = vi.fn();
    const utils = render(
      <ActiveChips
        data={DATA}
        cascade={{ vehicle: null, category: null, brands: [] }}
        dispatch={dispatch}
        extras={makeInitialExtraFilters()}
        setExtras={vi.fn()}
      />,
    );
    return { dispatch, ...utils };
  }

  it('🔴 兩顆分類 ⇒ 畫出兩顆膠囊(而 cascade.category 是 null —— 證明它讀的是網址)', () => {
    const { getByText } = renderWithUrl('categories=排氣系統 · 全段排氣管,排氣系統 · 尾段排氣管');
    expect(getByText('全段排氣管')).toBeTruthy();
    expect(getByText('尾段排氣管')).toBeTruthy();
  });

  // 🔴 主視窗-94 指定的正對照:刪一顆 ⇒ 網址少那一個, 而**另一顆還在**。
  it('🔴 刪第一顆 ⇒ 送出的網址只剩第二顆', () => {
    const { getByText } = renderWithUrl('categories=排氣系統 · 全段排氣管,排氣系統 · 尾段排氣管');
    fireEvent.click(getByText('全段排氣管'));
    const url = hoisted.replaced[0] ?? '';
    const next = new URLSearchParams(new URL(url, 'http://localhost').search);
    expect(next.get('categories')).toBe('排氣系統 · 尾段排氣管');
  });

  it('🔴 刪到剩零顆 ⇒ categories 這個 key 整個不見(不是留一個空的)', () => {
    const { getByText } = renderWithUrl('categories=排氣系統 · 全段排氣管');
    fireEvent.click(getByText('全段排氣管'));
    const next = new URLSearchParams(new URL(hoisted.replaced[0] ?? '', 'http://localhost').search);
    expect(next.has('categories')).toBe(false);
  });

  it('🔴 「清除全部」也要把網址上的 categories 帶走(只 dispatch 的話膠囊會留著)', () => {
    const { getByText } = renderWithUrl('categories=排氣系統 · 全段排氣管&sort=price-asc');
    fireEvent.click(getByText('清除全部'));
    const next = new URLSearchParams(new URL(hoisted.replaced[0] ?? '', 'http://localhost').search);
    expect(next.has('categories'), 'categories 留著 ⇒ 按完膠囊還在、篩選還生效').toBe(false);
    expect(next.get('sort'), 'sort 是客人刻意選的, 不該被一起丟掉').toBe('price-asc');
  });

  // 🟢 負對照:車輛/品牌那幾顆**行為不變** —— 它們仍走 dispatch, 不因本片改動。
  it('🟢 負對照:車輛膠囊仍然走 dispatch, 不送 router.replace', () => {
    hoisted.search = new URLSearchParams();
    hoisted.replaced = [];
    const { dispatch, getByText } = renderChips({ brand: 'YAMAHA' });
    fireEvent.click(getByText('YAMAHA'));
    expect(dispatch).toHaveBeenCalled();
    expect(hoisted.replaced.length, '車輛膠囊改走網址了 ⇒ 本片把不該動的東西動到了').toBe(0);
  });
});

describe('ActiveChips — 車輛膠囊拆三顆(V-1a)', () => {
  it('brand/model/year 各一顆;刪 year=重選同 model(只清年份)', () => {
    const { dispatch, getByText } = renderChips({ brand: 'YAMAHA', model: 'R6', year: 2017 });
    expect(getByText('YAMAHA')).toBeTruthy();
    expect(getByText('R6')).toBeTruthy();
    expect(getByText('2017')).toBeTruthy();
    fireEvent.click(getByText('2017'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'vehicle/select-model', model: 'R6' });
  });

  it('刪 model=重選同 brand(連動清 model+year);刪 brand=全清', () => {
    const { dispatch, getByText } = renderChips({ brand: 'YAMAHA', model: 'R6', year: 2017 });
    fireEvent.click(getByText('R6'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'vehicle/select-brand', brand: 'YAMAHA' });
    fireEvent.click(getByText('YAMAHA'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'vehicle/clear' });
  });

  it('只選 brand → 只一顆;無 vehicle → 無車輛膠囊', () => {
    const only = renderChips({ brand: 'YAMAHA' });
    expect(only.getByText('YAMAHA')).toBeTruthy();
    expect(only.queryByText('R6')).toBeNull();
    only.unmount();
    const none = renderChips(null);
    expect(none.container.querySelector('.ac-bar')).toBeNull();
  });
});
