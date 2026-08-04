// @vitest-environment jsdom
//
// GarageChips smoke test — 型錄「我的愛車」鈕(V-1e)。
// 驗:未登入不顯示 / toggle 展膠囊 / 精確命中 chip → dispatch 進 cascade(brand→model→year)/
//     年份缺不 dispatchYear / 多命中展建議清單、明選才 dispatch(REQUIRED-2 零猜)。

import type { ReactElement } from 'react';
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
        garage={[{ id: 'g1', name: 'MT-09 SP', year: '2021', dictBrandName: null, dictModelName: null, isPrimary: false }]}
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
        garage={[{ id: 'g1', name: 'mt-09 sp', year: '2021', dictBrandName: null, dictModelName: null, isPrimary: false }]}
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
        garage={[{ id: 'g1', name: 'MT-09 SP', year: '', dictBrandName: null, dictModelName: null, isPrimary: false }]}
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
        garage={[{ id: 'g2', name: 'MT-0', year: '', dictBrandName: null, dictModelName: null, isPrimary: false }]}
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
        garage={[{ id: 'g3', name: '我的紅色小車', year: '', dictBrandName: null, dictModelName: null, isPrimary: false }]}
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

// ── A9(選車引擎統一 B′):升為全站唯一 chips 元件 ──
describe('GarageChips — A9 onApply 出口與統一字面', () => {
  const CHIP = {
    id: 'g1',
    name: 'mt-09 sp',
    year: '2021',
    dictBrandName: null,
    dictModelName: null,
    isPrimary: false,
  };

  // spec §4-1 點名的最大一顆地雷:首頁/PDP/購物車沒有 cascade reducer,不是 drop-in。
  it('給 onApply → 呼叫 onApply 帶已解析的 brand/model/year,且**完全不 dispatch**', () => {
    const onApply = vi.fn();
    render(
      <GarageChips garage={[CHIP]} motoBrands={BRANDS} onApply={onApply} variant="top" />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('2021 mt-09 sp'));

    // 決策腦與年份閘門不變:回傳的是字典字面 + 已過閘的 year
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0]![0]).toMatchObject({
      brand: 'Yamaha',
      model: 'MT-09 SP',
      year: 2021,
    });
  });

  // 🔴 「走 onApply 就完全不 dispatch」這句話,只有真的遞一個 dispatch 進去才驗得到。
  //    型別上兩者互斥(同時傳=編譯錯,已用 tsc 實證),所以這裡**刻意 cast 繞過型別**去打執行期分支。
  //    少了這條,在 onApply 分支裡偷加一發 dispatch 全套照樣綠(2026-08-05 實測突變存活)。
  it('走 onApply 時,即使宿主硬塞 dispatch 進來也一發都不送', () => {
    const onApply = vi.fn();
    const dispatch = vi.fn();
    const Both = GarageChips as unknown as (p: Record<string, unknown>) => ReactElement;
    render(
      <Both garage={[CHIP]} motoBrands={BRANDS} onApply={onApply} dispatch={dispatch} variant="top" />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('2021 mt-09 sp'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('給 onApply 時,建議清單明選也走 onApply(不是只有 chip 直接命中那條路)', () => {
    const onApply = vi.fn();
    render(
      <GarageChips
        garage={[{ ...CHIP, name: 'MT-0', year: '' }]}
        motoBrands={BRANDS}
        onApply={onApply}
        variant="top"
      />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('MT-0'));
    expect(onApply).not.toHaveBeenCalled(); // 多命中不自動套用(零猜)
    fireEvent.click(screen.getByRole('option', { name: 'Yamaha MT-09' }));
    expect(onApply.mock.calls[0]![0]).toMatchObject({ brand: 'Yamaha', model: 'MT-09' });
  });

  it('沒給 onApply → 維持現行 dispatch 三連發(目錄兩處零行為改動)', () => {
    const dispatch = vi.fn();
    render(
      <GarageChips garage={[CHIP]} motoBrands={BRANDS} dispatch={dispatch} variant="top" />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('2021 mt-09 sp'));
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Yamaha'),
      selectVehicleModel('MT-09 SP'),
      selectVehicleYear(2021),
    ]);
  });

  // A 表條 6:副註原本只有手機面板(sheet)有,推廣到四個掛載點。
  it('toggle 變體展開後,面板頂出現副註「點一下直接套用」', () => {
    render(
      <GarageChips garage={[CHIP]} motoBrands={BRANDS} dispatch={vi.fn()} variant="top" />,
    );
    expect(screen.queryByText('點一下直接套用')).toBeNull(); // 收合態不出現
    fireEvent.click(screen.getByText('我的愛車'));
    expect(screen.getByText('點一下直接套用')).toBeTruthy();
  });

  // 這三件在 onApply 路徑上原本零守門(突變刪掉任一行,全套照樣綠 —— 2026-08-05 實測)。
  it('套用後:面板收起、建議清單清空、onApplied 照樣通知宿主(onApply 路徑)', () => {
    const onApplied = vi.fn();
    render(
      <GarageChips
        garage={[{ ...CHIP, name: 'MT-0', year: '' }]}
        motoBrands={BRANDS}
        onApply={vi.fn()}
        onApplied={onApplied}
        variant="top"
      />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('MT-0'));
    expect(screen.getByText(/可能是/)).toBeTruthy(); // 建議清單開著

    fireEvent.click(screen.getByRole('option', { name: 'Yamaha MT-09' }));
    expect(onApplied).toHaveBeenCalledTimes(1); // 不是只有 dispatch 路徑才通知
    expect(screen.queryByText(/可能是/)).toBeNull(); // 建議清單清掉
    expect(screen.queryByText('MT-0')).toBeNull(); // 面板收起(膠囊不再顯示)
  });

  it('sheet 變體維持恆展開 + 副註(ADR-0007 現狀不動)', () => {
    render(
      <GarageChips garage={[CHIP]} motoBrands={BRANDS} dispatch={vi.fn()} variant="sheet" />,
    );
    expect(screen.getByText('點一下直接套用')).toBeTruthy();
    expect(screen.getByText('2021 mt-09 sp')).toBeTruthy(); // 無需點開
  });

  // A 表條 7:零命中句三版收一版,且不再寫「上方/下方」——同一句要掛在四個位置不同的掛載點。
  it('零命中句=A 表定版,且不含方位詞', () => {
    render(
      <GarageChips
        garage={[{ ...CHIP, name: '我的紅色小車', year: '' }]}
        motoBrands={BRANDS}
        dispatch={vi.fn()}
        variant="top"
      />,
    );
    fireEvent.click(screen.getByText('我的愛車'));
    fireEvent.click(screen.getByText('我的紅色小車'));
    expect(
      screen.getByText('無法對應「我的紅色小車」到車款字典，請改用車款選單選擇'),
    ).toBeTruthy();
    expect(screen.queryByText(/上方|下方/)).toBeNull();
  });
});
