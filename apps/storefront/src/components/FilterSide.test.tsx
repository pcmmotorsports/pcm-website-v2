// @vitest-environment jsdom
//
// FilterSide smoke test — WO-2 工作流優化、前台 regression 安全網。
// 驗「render 不報錯 + 關鍵互動(車輛 accordion 切換 / 分類展開)不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterSide, type FilterSideData } from './FilterSide';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';

const data: FilterSideData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

afterEach(cleanup);

describe('FilterSide', () => {
  it('should render the filter sidebar without crashing', () => {
    render(<FilterSide data={data} />);
    expect(screen.getByText('篩選條件')).toBeDefined();
    expect(screen.getByText('清除全部')).toBeDefined();
  });

  it('should show the vehicle accordion when hideVehicle is not set', () => {
    render(<FilterSide data={data} />);
    expect(screen.getByText('依車輛搜尋')).toBeDefined();
  });

  it('should hide the vehicle accordion when hideVehicle is set', () => {
    render(<FilterSide data={data} hideVehicle />);
    expect(screen.queryByText('依車輛搜尋')).toBeNull();
  });

  it('should expand a category and reveal its sub-items on click', () => {
    render(<FilterSide data={data} />);
    // 「零件分類」defaultOpen=true、大分類「代理配件」可見;點它展開細項
    fireEvent.click(screen.getByText('代理配件'));
    expect(screen.getByText('BONAMICI RACING')).toBeDefined();
  });
});
