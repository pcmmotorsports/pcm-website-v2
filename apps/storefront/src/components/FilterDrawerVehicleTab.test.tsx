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
    expect(screen.getByText('查無符合的車款，請調整關鍵字')).toBeTruthy();
  });

  // A5(選車引擎統一 B′):步驟標原本還寫「選擇品牌」,三處空清單提示原本零守門
  // —— 改回半形/品牌照樣全綠。(Sean 08-03 拍 Q2=A 全形 ，)
  // ⚠️ A5 原註寫「本檔是全站唯一還用半形的入口」是**假的**(R2 抓到):同批還有
  //    `account/InlineVehicleForm.tsx:117`,本檔自己的搜尋欄 placeholder 也還是半形。已一起改。
  it('A 表字面:步驟標=選擇廠牌、三層空清單提示皆全形逗號', () => {
    render(<Harness />);
    expect(screen.getByText('選擇廠牌')).toBeTruthy();
    expect(screen.queryByText('選擇品牌')).toBeNull();
    // R2(I2):搜尋欄 placeholder 的逗號同批改全形(主視窗裁定 Q2=A 作用於選車 UI 字面)
    expect(
      (screen.getByLabelText('打字快速找車') as HTMLInputElement).placeholder,
    ).toBe('打字找車，例:R6、MT-09、Panigale');

    const search = screen.getByLabelText('打字快速找車') as HTMLInputElement;
    // 廠牌層:tap drill 模式下清單由 brands 過濾,打字會走跨層直搜 ⇒ 用 Harness 的空字典驗不到,
    // 改驗車型層與年份層(drill 進去後清單為空的兩個真實出口)。
    fireEvent.click(screen.getByText('Kawasaki')); // 無車型
    expect(screen.getByText('查無符合的車型，請調整關鍵字')).toBeTruthy();
    expect(search.value).toBe('');
  });
});
