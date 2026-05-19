// @vitest-environment jsdom
//
// FilterTop smoke test — 前台 regression 安全網。
// 驗「render 不報錯 + 關鍵互動(chip dropdown 開合 / 現貨 toggle)不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterTop, type FilterTopData } from './FilterTop';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';

const data: FilterTopData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

afterEach(cleanup);

describe('FilterTop', () => {
  it('should render the filter bar without crashing', () => {
    render(<FilterTop data={data} resultCount={128} />);
    expect(screen.getByText('128 件商品')).toBeDefined();
    expect(screen.getByText('依車輛搜尋')).toBeDefined();
  });

  it('should open the brand dropdown when the brand chip is clicked', () => {
    render(<FilterTop data={data} resultCount={128} />);
    fireEvent.click(screen.getByText('品牌'));
    // 品牌 dropdown 顯示品牌列(MOCK_BRANDS 第一筆)
    expect(screen.getByText('BONAMICI RACING')).toBeDefined();
  });

  it('should show the active pill row after toggling 僅顯示現貨', () => {
    render(<FilterTop data={data} resultCount={128} />);
    fireEvent.click(screen.getByText('僅顯示現貨'));
    // pill 區出現「清除全部」
    expect(screen.getByText('清除全部')).toBeDefined();
  });
});
