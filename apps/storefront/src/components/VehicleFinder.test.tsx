// @vitest-environment jsdom
//
// VehicleFinder smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯 + 品牌選擇連動車型 select 不報錯」。
// useRouter 走 per-file vi.mock(元件 router.push 只在點搜尋時觸發、smoke 不需真路由)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { VehicleFinder } from './VehicleFinder';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';

afterEach(cleanup);

describe('VehicleFinder', () => {
  it('should render the vehicle finder without crashing', () => {
    render(<VehicleFinder />);
    expect(screen.getByText('輸入你的車輛')).toBeDefined();
    expect(screen.getByText('搜尋部品')).toBeDefined();
  });

  it('should reveal model options after a brand is selected', () => {
    render(<VehicleFinder />);
    const brand = MOCK_MOTO_BRANDS[0]!;
    const brandSelect = screen.getByText('品牌').parentElement!.querySelector('select')!;
    fireEvent.change(brandSelect, { target: { value: brand.id } });
    expect(screen.getByText(brand.models[0]!.name)).toBeDefined();
  });
});
