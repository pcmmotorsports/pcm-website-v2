// @vitest-environment jsdom
//
// CascadeFilterTop smoke test — 前台 regression 安全網。
// 驗「render 不報錯 + 關鍵互動(選品牌 → 出現清除鈕)不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CascadeFilterTop } from './CascadeFilterTop';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';
import type { FilterTopData } from './FilterTop';

const data: FilterTopData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

afterEach(cleanup);

describe('CascadeFilterTop', () => {
  it('should render the cascade bar without crashing', () => {
    render(<CascadeFilterTop data={data} />);
    expect(screen.getByText('確認適用車款')).toBeDefined();
  });

  it('should reveal the 清除車輛 button after selecting a brand', () => {
    render(<CascadeFilterTop data={data} />);
    // 第一個 select = 品牌;選 MOCK_MOTO_BRANDS 第一筆
    const [brandSelect] = screen.getAllByRole('combobox');
    if (!brandSelect) throw new Error('品牌 select 未 render');
    const [firstBrand] = MOCK_MOTO_BRANDS;
    if (!firstBrand) throw new Error('MOCK_MOTO_BRANDS 為空');
    fireEvent.change(brandSelect, { target: { value: firstBrand.id } });
    expect(screen.getByText('清除車輛')).toBeDefined();
  });
});
