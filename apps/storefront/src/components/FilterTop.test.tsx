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
