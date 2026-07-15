// @vitest-environment jsdom
//
// GarageChips smoke test — 型錄「我的愛車」鈕(V-1e)。
// 驗:未登入不顯示 / toggle 展膠囊 / 精確命中 chip → dispatch 進 cascade(brand→model→year)/
//     年份缺不 dispatchYear / 多命中展建議清單、明選才 dispatch(REQUIRED-2 零猜)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
} from '@pcm/ui';
import { GarageChips } from './GarageChips';
import type { MockMotoBrand } from '../data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022] },
      { id: 'mt-09', name: 'MT-09', years: [2021] },
    ],
  },
];

afterEach(cleanup);

describe('GarageChips(V-1e 型錄我的愛車鈕)', () => {
  it('未登入/空車庫 → 整個鈕不顯示', () => {
    const { container } = render(
      <GarageChips garage={[]} motoBrands={BRANDS} dispatch={vi.fn()} variant="top" />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('我的愛車')).toBeNull();
  });

  it('toggle 鈕點開才展膠囊列', () => {
    render(
      <GarageChips
        garage={[{ id: 'g1', name: 'MT-09 SP', year: '2021', dictBrandName: null, dictModelName: null }]}
        motoBrands={BRANDS}
        dispatch={vi.fn()}
        variant="top"
      />,
    );
    expect(screen.queryByText('2021 MT-09 SP')).toBeNull(); // 收合態
    fireEvent.click(screen.getByText('我的愛車'));
    expect(screen.getByText('2021 MT-09 SP')).toBeTruthy();
  });

  it('唯一精確命中 chip → dispatch brand→model→year 三連發進 cascade', () => {
    const dispatch = vi.fn();
    render(
      <GarageChips
        garage={[{ id: 'g1', name: 'mt-09 sp', year: '2021', dictBrandName: null, dictModelName: null }]}
        motoBrands={BRANDS}
        dispatch={dispatch}
        variant="top"
      />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('2021 mt-09 sp'));
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Yamaha'),
      selectVehicleModel('MT-09 SP'),
      selectVehicleYear(2021),
    ]);
  });

  it('年份缺(非四位數字)→ 不 dispatchYear(不限年份)', () => {
    const dispatch = vi.fn();
    render(
      <GarageChips
        garage={[{ id: 'g1', name: 'MT-09 SP', year: '', dictBrandName: null, dictModelName: null }]}
        motoBrands={BRANDS}
        dispatch={dispatch}
        variant="top"
      />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('MT-09 SP'));
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Yamaha'),
      selectVehicleModel('MT-09 SP'),
    ]);
  });

  it('多命中 → 展建議清單、chip 不自動 dispatch;明選才 dispatch(零猜)', () => {
    const dispatch = vi.fn();
    render(
      <GarageChips
        garage={[{ id: 'g2', name: 'MT-0', year: '', dictBrandName: null, dictModelName: null }]}
        motoBrands={BRANDS}
        dispatch={dispatch}
        variant="drawer"
      />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('MT-0'));
    expect(dispatch).not.toHaveBeenCalled(); // 多命中不自動套用
    expect(screen.getByText(/可能是/)).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    fireEvent.click(screen.getByRole('option', { name: 'Yamaha MT-09' }));
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Yamaha'),
      selectVehicleModel('MT-09'),
    ]);
  });

  it('零命中(純自由文字)→ 顯「無法對應」、不 dispatch', () => {
    const dispatch = vi.fn();
    render(
      <GarageChips
        garage={[{ id: 'g3', name: '我的紅色小車', year: '', dictBrandName: null, dictModelName: null }]}
        motoBrands={BRANDS}
        dispatch={dispatch}
        variant="top"
      />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('我的紅色小車'));
    expect(screen.getByText(/無法對應/)).toBeTruthy();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
