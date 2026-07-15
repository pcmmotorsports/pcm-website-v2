// @vitest-environment jsdom
// FilterDrawerVehicleTab smoke — V-1b2 抽屜車輛 tab(tap drill 不變+打字快速找車;共用 vehicle-match 核心)。

import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
import { FilterDrawerVehicleTab } from './FilterDrawerVehicleTab';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [{ id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022] }],
  },
  { id: 'kawasaki', name: 'Kawasaki', models: [] },
] as MockMotoBrand[];

function Harness() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  return <FilterDrawerVehicleTab motoBrands={BRANDS} cascade={cascade} dispatch={dispatch} />;
}

afterEach(cleanup);

describe('FilterDrawerVehicleTab', () => {
  it('打字過濾品牌(全形亦可)、tap drill 換層自動清查詢;查無顯提示', () => {
    render(<Harness />);
    const search = screen.getByLabelText('打字快速找車') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'ＹＡ' } });
    expect(screen.queryByText('Kawasaki')).toBeNull();
    fireEvent.click(screen.getByText('Yamaha'));
    expect(search.value).toBe(''); // 換層清查詢
    expect(screen.getByText('MT-09 SP')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('查無符合的車型,請調整關鍵字')).toBeTruthy();
  });

  it('drill 到年份、點年份=三層 dispatch 選定(勾勾顯示)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Yamaha'));
    fireEvent.click(screen.getByText('MT-09 SP'));
    fireEvent.click(screen.getByText('2021'));
    expect(screen.getByText('2021').closest('button')?.className).toContain('is-active');
  });
});
