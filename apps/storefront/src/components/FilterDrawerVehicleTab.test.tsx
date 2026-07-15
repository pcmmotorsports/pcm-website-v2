// @vitest-environment jsdom
// FilterDrawerVehicleTab smoke — V-1b2 抽屜車輛 tab + V-1f 三修
// (空查詢=tap drill;打字=跨層直搜「品牌 車型」;無年份車型「不限年份」套用出口)。

import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
import { FilterDrawerVehicleTab } from './FilterDrawerVehicleTab';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  { id: 'yamaha', name: 'Yamaha', models: [{ id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022] }] },
  { id: 'ducati', name: 'Ducati', models: [{ id: 'monster', name: 'Monster', years: [] }] }, // 無年份車型
  { id: 'kawasaki', name: 'Kawasaki', models: [] }, // 無車型
] as MockMotoBrand[];

function Harness() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  return <FilterDrawerVehicleTab motoBrands={BRANDS} cascade={cascade} dispatch={dispatch} />;
}

afterEach(cleanup);

describe('FilterDrawerVehicleTab（V-1f）', () => {
  it('空查詢=tap 逐層 drill：品牌→車型→年份 dispatch 選定', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Yamaha'));
    fireEvent.click(screen.getByText('MT-09 SP'));
    fireEvent.click(screen.getByText('2021'));
    expect(screen.getByText('2021').closest('button')?.className).toContain('is-active');
  });

  it('① 跨層直搜:打「mt-09」跨層命中車款(非品牌層過濾)、點結果跳年份層', () => {
    render(<Harness />);
    const search = screen.getByLabelText('打字快速找車') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'mt-09' } });
    // 跨層結果=「品牌 車型」字面(非只品牌);Ducati Monster 不含 mt-09 故不現
    expect(screen.getByText('Yamaha MT-09 SP')).toBeTruthy();
    expect(screen.queryByText('Ducati Monster')).toBeNull();
    fireEvent.click(screen.getByText('Yamaha MT-09 SP'));
    expect(search.value).toBe(''); // 清查詢
    expect(screen.getByText('選擇年份')).toBeTruthy(); // 有年份→跳年份層
    expect(screen.getByText('2021')).toBeTruthy();
  });

  it('① 跨層直搜命中無年份車型 → 直接套用(不限年份 is-active)', () => {
    render(<Harness />);
    const search = screen.getByLabelText('打字快速找車') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'monster' } });
    fireEvent.click(screen.getByText('Ducati Monster'));
    // 無年份→直接 dispatch 套用;年份層顯「不限年份」且 is-active
    const applyBtn = screen.getByText('不限年份(此車型套用全部)').closest('button');
    expect(applyBtn?.className).toContain('is-active');
  });

  it('tap drill 到無年份車型 → 年份層「不限年份」出口套用(修 V-1b2 卡死)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Ducati'));
    fireEvent.click(screen.getByText('Monster'));
    const applyBtn = screen.getByText('不限年份(此車型套用全部)');
    expect(applyBtn).toBeTruthy();
    fireEvent.click(applyBtn);
    expect(applyBtn.closest('button')?.className).toContain('is-active');
  });

  it('跨層直搜查無 → 提示', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('打字快速找車'), { target: { value: 'zzz' } });
    expect(screen.getByText('查無符合的車款,請調整關鍵字')).toBeTruthy();
  });
});
