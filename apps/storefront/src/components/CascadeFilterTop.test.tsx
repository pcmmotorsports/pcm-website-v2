// @vitest-environment jsdom
//
// CascadeFilterTop smoke test — 前台 regression 安全網。
// 驗「render 不報錯 + 關鍵互動(選品牌 → 出現清除鈕)不報錯」。
// M-1-12a 起 CascadeFilterTop 改 controlled、用 Harness 持 useReducer 模擬宿主。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
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

// controlled CascadeFilterTop 的宿主模擬 — 持 cascade reducer。
function Harness() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  return <CascadeFilterTop data={data} cascade={cascade} dispatch={dispatch} />;
}

afterEach(cleanup);

describe('CascadeFilterTop', () => {
  it('should render the cascade bar without crashing', () => {
    render(<Harness />);
    expect(screen.getByText('確認適用車款')).toBeDefined();
  });

  it('should reveal the 清除車輛 button after picking a brand via typeahead(V-1b combobox 版)', () => {
    render(<Harness />);
    // 第一個 combobox = 品牌;打全名 → blur 唯一精確命中自動套用(REQUIRED-2)
    const [brandInput] = screen.getAllByRole('combobox');
    if (!brandInput) throw new Error('品牌 combobox 未 render');
    const [firstBrand] = MOCK_MOTO_BRANDS;
    if (!firstBrand) throw new Error('MOCK_MOTO_BRANDS 為空');
    fireEvent.change(brandInput, { target: { value: firstBrand.name } });
    fireEvent.blur(brandInput);
    expect(screen.getByText('清除車輛')).toBeDefined();
    expect((brandInput as HTMLInputElement).value).toBe(firstBrand.name);
  });
});
