// @vitest-environment jsdom
//
// FilterSide smoke test — WO-2 工作流優化、前台 regression 安全網。
// 驗「render 不報錯 + 關鍵互動(車輛 accordion 切換 / 分類展開)不報錯」。
// M-1-12a 起 FilterSide 改 controlled、用 Harness 持 useReducer + useState 模擬宿主。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { useReducer, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
import { FilterSide, type FilterSideData } from './FilterSide';
import { makeInitialExtraFilters, type ProductExtraFilters } from './filter-state';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';

const data: FilterSideData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

// controlled FilterSide 的宿主模擬 — 持 cascade reducer + extras state。
function Harness({ hideVehicle }: { hideVehicle?: boolean }) {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  return (
    <FilterSide
      data={data}
      hideVehicle={hideVehicle}
      cascade={cascade}
      dispatch={dispatch}
      extras={extras}
      setExtras={setExtras}
    />
  );
}

afterEach(cleanup);

describe('FilterSide', () => {
  it('should render the filter sidebar without crashing', () => {
    render(<Harness />);
    expect(screen.getByText('篩選條件')).toBeDefined();
    expect(screen.getByText('清除全部')).toBeDefined();
  });

  it('should show the vehicle accordion when hideVehicle is not set', () => {
    render(<Harness />);
    expect(screen.getByText('依車輛搜尋')).toBeDefined();
  });

  it('should hide the vehicle accordion when hideVehicle is set', () => {
    render(<Harness hideVehicle />);
    expect(screen.queryByText('依車輛搜尋')).toBeNull();
  });

  it('should expand a category and reveal its sub-items on click', () => {
    render(<Harness />);
    // 「零件分類」defaultOpen=true、大分類「代理配件」可見;點它展開細項
    fireEvent.click(screen.getByText('代理配件'));
    expect(screen.getByText('BONAMICI RACING')).toBeDefined();
  });

  // regression:勾選「其他」checkbox 後 row 應帶 is-checked class(勾勾才顯示)
  it('should mark the 其他 checkbox row as checked after clicking it', () => {
    render(<Harness />);
    // 「其他」accordion 預設收合、先展開再勾選「僅顯示現貨」
    fireEvent.click(screen.getByText('其他'));
    fireEvent.click(screen.getByText('僅顯示現貨'));
    const row = screen.getByText('僅顯示現貨').closest('label');
    expect(row?.className).toContain('is-checked');
  });
});
