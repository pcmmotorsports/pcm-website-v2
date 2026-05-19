// @vitest-environment jsdom
//
// FilterDrawer smoke test — 前台 regression 安全網。
// 驗「open=false 不 render + open=true render 不報錯 + 關鍵互動(分頁切換 /
// 套用按鈕)不報錯」。M-1-12a 起 FilterDrawer 改 controlled、用 Harness 持
// useReducer + useState 模擬宿主。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { useReducer, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
import { FilterDrawer, type FilterDrawerData } from './FilterDrawer';
import { makeInitialExtraFilters, type ProductExtraFilters } from './filter-state';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';

const data: FilterDrawerData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

// controlled FilterDrawer 的宿主模擬 — 持 cascade reducer + extras state。
function Harness({
  open,
  onClose = () => {},
  resultCount = 128,
}: {
  open: boolean;
  onClose?: () => void;
  resultCount?: number;
}) {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  return (
    <FilterDrawer
      open={open}
      onClose={onClose}
      data={data}
      resultCount={resultCount}
      cascade={cascade}
      dispatch={dispatch}
      extras={extras}
      setExtras={setExtras}
    />
  );
}

afterEach(cleanup);

describe('FilterDrawer', () => {
  it('should render nothing when open is false', () => {
    const { container } = render(<Harness open={false} resultCount={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render the drawer without crashing when open', () => {
    render(<Harness open />);
    expect(screen.getByText('篩選條件')).toBeDefined();
    expect(screen.getByText('查看 128 件商品')).toBeDefined();
  });

  it('should switch to the brand tab when the brand tab is clicked', () => {
    render(<Harness open />);
    fireEvent.click(screen.getByText('品牌'));
    // 品牌分頁顯示品牌列(MOCK_BRANDS 第一筆)
    expect(screen.getByText('BONAMICI RACING')).toBeDefined();
  });

  it('should call onClose when the apply button is clicked', () => {
    const onClose = vi.fn();
    render(<Harness open onClose={onClose} />);
    fireEvent.click(screen.getByText('查看 128 件商品'));
    expect(onClose).toHaveBeenCalled();
  });
});
