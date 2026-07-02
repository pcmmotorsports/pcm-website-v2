// @vitest-environment jsdom
//
// VehicleFinder smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯 + 品牌選擇連動車型 select 不報錯 + S2 無年車型不限年份 + 短版 push」。
// useRouter 走 per-file vi.mock(共享 mockPush 供斷言 push URL)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { VehicleFinder } from './VehicleFinder';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';

afterEach(() => {
  cleanup();
  mockPush.mockReset();
});

// S2/#220b:VehicleFinder 改 props motoBrands(server 端真 fitment 衍生);
// 測試以 MOCK_MOTO_BRANDS 當 fixture(形狀同 MockMotoBrand[]、fixture 合法)。
describe('VehicleFinder', () => {
  it('should render the vehicle finder without crashing', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    expect(screen.getByText('輸入你的車輛')).toBeDefined();
    expect(screen.getByText('搜尋部品')).toBeDefined();
  });

  it('should reveal model options after a brand is selected', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const brand = MOCK_MOTO_BRANDS[0]!;
    const brandSelect = screen.getByText('品牌').parentElement!.querySelector('select')!;
    fireEvent.change(brandSelect, { target: { value: brand.id } });
    expect(screen.getByText(brand.models[0]!.name)).toBeDefined();
  });

  it('should allow searching a model without years via 不限年份 (37/94 真車型無年)', () => {
    const noYearBrands = [
      { id: 'ducati', name: 'Ducati', models: [{ id: 'monster', name: 'Monster', years: [] }] },
    ];
    render(<VehicleFinder motoBrands={noYearBrands} />);
    const selects = screen.getByText('品牌').closest('.ed-finder-bar')!.querySelectorAll('select');
    fireEvent.change(selects[0]!, { target: { value: 'ducati' } });
    fireEvent.change(selects[1]!, { target: { value: 'monster' } });
    // 年份下拉顯「不限年份」、搜尋鈕可按(不因無年死鎖)
    expect(screen.getByText('不限年份')).toBeDefined();
    const go = screen.getByText('搜尋部品').closest('button')!;
    expect(go.hasAttribute('disabled')).toBe(false);
    // push 短版、無 year 段
    fireEvent.click(go);
    expect(mockPush).toHaveBeenCalledWith(
      `/products?${new URLSearchParams({ vehicle: 'ducati:monster' }).toString()}`,
    );
  });

  it('should push short-form ?vehicle= on search (id 空間統一 S2)', () => {
    render(<VehicleFinder motoBrands={MOCK_MOTO_BRANDS} />);
    const brand = MOCK_MOTO_BRANDS[0]!;
    const model = brand.models[0]!;
    const year = model.years[0]!;
    const selects = screen.getByText('品牌').closest('.ed-finder-bar')!.querySelectorAll('select');
    fireEvent.change(selects[0]!, { target: { value: brand.id } });
    fireEvent.change(selects[1]!, { target: { value: model.id } });
    fireEvent.change(selects[2]!, { target: { value: String(year) } });
    fireEvent.click(screen.getByText('搜尋部品').closest('button')!);
    expect(mockPush).toHaveBeenCalledWith(
      `/products?${new URLSearchParams({ vehicle: `${brand.id}:${model.id}:${year}` }).toString()}`,
    );
  });
});
