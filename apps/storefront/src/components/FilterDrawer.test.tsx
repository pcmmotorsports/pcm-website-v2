// @vitest-environment jsdom
//
// FilterDrawer smoke test — 前台 regression 安全網。
// 驗「open=false 不 render + open=true render 不報錯 + 關鍵互動(分頁切換 /
// 套用按鈕)不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterDrawer, type FilterDrawerData } from './FilterDrawer';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';

const data: FilterDrawerData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

afterEach(cleanup);

describe('FilterDrawer', () => {
  it('should render nothing when open is false', () => {
    const { container } = render(
      <FilterDrawer open={false} onClose={() => {}} data={data} resultCount={0} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('should render the drawer without crashing when open', () => {
    render(<FilterDrawer open onClose={() => {}} data={data} resultCount={128} />);
    expect(screen.getByText('篩選條件')).toBeDefined();
    expect(screen.getByText('查看 128 件商品')).toBeDefined();
  });

  it('should switch to the brand tab when the brand tab is clicked', () => {
    render(<FilterDrawer open onClose={() => {}} data={data} resultCount={128} />);
    fireEvent.click(screen.getByText('品牌'));
    // 品牌分頁顯示品牌列(MOCK_BRANDS 第一筆)
    expect(screen.getByText('BONAMICI RACING')).toBeDefined();
  });

  it('should call onClose when the apply button is clicked', () => {
    const onClose = vi.fn();
    render(<FilterDrawer open onClose={onClose} data={data} resultCount={128} />);
    fireEvent.click(screen.getByText('查看 128 件商品'));
    expect(onClose).toHaveBeenCalled();
  });
});
