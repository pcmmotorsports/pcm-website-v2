// @vitest-environment jsdom
//
// MobileVehicleSheet — 手機正式選車面板(ADR-0007 手機決定 1-6)。
// 這裡鎖的是 Sean 已拍板、且「回歸了不會有人發現」的那幾條:
//   ① 開面板不得 autoFocus(鍵盤不自動彈出)
//   ② 面板頂部直接顯示真實「我的愛車」、一點套用(不是先點一顆 toggle 才展開)
//   ③ 三欄可輸入搜尋、也可展開捲動點選;年份最新在前
//   ④ 「清除」只清草稿、**不取消背景已套用車輛**(兩種清除語意分離)
//   ⑤ 聚焦後欄位仍留在可視範圍(scrollIntoView)
//   ⑥ V-1f 既有能力不得因換 UI 回歸:跨層直搜(打 mt-09 直達車款)+ 無年份車型出口
//
// 資料一律走既有真字典 taxonomy + cascadeFilterReducer action;本檔 fixture 是字典形狀的
// 小樣本(對齊 FilterDrawerVehicleTab.test.tsx 慣例),不是 dev-preview 的假車。

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  makeInitialCascadeState,
  type CascadeFilterAction,
  type CascadeFilterState,
} from '@pcm/ui';
import { MobileVehicleSheet } from './MobileVehicleSheet';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { GarageChipItem } from './GarageChips';

const BRANDS: MockMotoBrand[] = [
  { id: 'yamaha', name: 'Yamaha', models: [{ id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022, 2024] }] },
  { id: 'ducati', name: 'Ducati', models: [{ id: 'monster', name: 'Monster', years: [] }] }, // 無年份車型
  { id: 'kawasaki', name: 'Kawasaki', models: [] }, // 無車型
] as MockMotoBrand[];

const GARAGE: GarageChipItem[] = [
  { id: 'g1', name: 'MT-09 SP', year: '2021', dictBrandName: 'Yamaha', dictModelName: 'MT-09 SP', isPrimary: true },
];

function renderSheet({
  cascade = makeInitialCascadeState(),
  garage = [] as GarageChipItem[],
  dispatch = vi.fn<(action: CascadeFilterAction) => void>(),
  onClose = vi.fn<() => void>(),
}: {
  cascade?: CascadeFilterState;
  garage?: GarageChipItem[];
  dispatch?: Mock<(action: CascadeFilterAction) => void>;
  onClose?: Mock<() => void>;
} = {}) {
  const utils = render(
    <MobileVehicleSheet
      open
      onClose={onClose}
      motoBrands={BRANDS}
      cascade={cascade}
      dispatch={dispatch}
      garage={garage}
    />,
  );
  return { ...utils, dispatch, onClose };
}

const brandField = () => screen.getByLabelText('廠牌') as HTMLInputElement;
const modelField = () => screen.getByLabelText('車型') as HTMLInputElement;
const yearField = () => screen.getByLabelText('年份') as HTMLInputElement;

/** combobox 的選定路徑 = 打字 → 點選項(與桌機 VehicleCombo 同一顆引擎)。 */
function pickOption(input: HTMLInputElement, typed: string, optionLabel: string) {
  fireEvent.change(input, { target: { value: typed } });
  fireEvent.mouseDown(screen.getByRole('option', { name: optionLabel }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MobileVehicleSheet(ADR-0007 手機選車面板)', () => {
  it('open=false 不 render', () => {
    const { container } = render(
      <MobileVehicleSheet
        open={false}
        onClose={vi.fn()}
        motoBrands={BRANDS}
        cascade={makeInitialCascadeState()}
        dispatch={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  // ① 手機鍵盤:開面板不得自動聚焦任何輸入欄位。
  it('開面板時任何欄位都不得自動取得焦點', () => {
    const { container } = renderSheet();
    expect(container.querySelector('[autofocus]')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  // ② 面板頂部直接顯示真實愛車、一點套用(不需先點 toggle)。
  it('頂部直接列出真實「我的愛車」、一點就套用並關面板', () => {
    const { dispatch, onClose } = renderSheet({ garage: GARAGE });

    const chip = screen.getByText('2021 MT-09 SP');
    expect(chip).toBeTruthy(); // 收合態不算通過:必須一開面板就看得到

    fireEvent.click(chip);
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Yamaha'),
      selectVehicleModel('MT-09 SP'),
      selectVehicleYear(2021),
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('未登入/空車庫 → 不顯示「我的愛車」區塊', () => {
    renderSheet({ garage: [] });
    expect(screen.queryByText('我的愛車')).toBeNull();
  });

  // ③ 三欄皆可輸入搜尋 + 展開捲動點選。
  it('三欄可輸入過濾、也可聚焦展開捲動點選', () => {
    renderSheet();

    // 展開:聚焦即出清單(不需先打字)
    fireEvent.focus(brandField());
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Yamaha', 'Ducati', 'Kawasaki',
    ]);

    // 輸入過濾
    fireEvent.change(brandField(), { target: { value: 'duc' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ducati']);
  });

  it('年份選項最新在前', () => {
    renderSheet();
    pickOption(brandField(), 'Yamaha', 'Yamaha');
    pickOption(modelField(), 'MT-09 SP', 'MT-09 SP');

    fireEvent.focus(yearField());
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['2024', '2022', '2021']);
  });

  // ④ 兩種清除語意分離 —— 這條是本片最容易被寫錯的一條。
  it('「清除」只清草稿、不取消背景已套用車輛', () => {
    const applied: CascadeFilterState = {
      ...makeInitialCascadeState(),
      vehicle: { brand: 'Ducati', model: 'Monster' },
    };
    const { dispatch } = renderSheet({ cascade: applied });

    pickOption(brandField(), 'Yamaha', 'Yamaha');
    expect(brandField().value).toBe('Yamaha');
    dispatch.mockClear(); // 草稿階段不該動 cascade,以下只看「清除」這一下

    fireEvent.click(screen.getByRole('button', { name: '清除車輛輸入欄位' }));

    expect(brandField().value).toBe('');
    expect(modelField().value).toBe('');
    expect(yearField().value).toBe('');
    // 🔴 關鍵:一個 action 都不准發 —— 發了就等於順手把客人背景的車清掉
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('草稿全空時「清除」停用', () => {
    renderSheet();
    const clear = screen.getByRole('button', { name: '清除車輛輸入欄位' }) as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
  });

  it('選車草稿在按下套用前不動 cascade', () => {
    const { dispatch } = renderSheet();
    pickOption(brandField(), 'Yamaha', 'Yamaha');
    pickOption(modelField(), 'MT-09 SP', 'MT-09 SP');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('套用 → brand→model→year 三連發 + 關面板', () => {
    const { dispatch, onClose } = renderSheet();
    pickOption(brandField(), 'Yamaha', 'Yamaha');
    pickOption(modelField(), 'MT-09 SP', 'MT-09 SP');
    pickOption(yearField(), '2022', '2022');

    fireEvent.click(screen.getByRole('button', { name: '查看適用商品' }));
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Yamaha'),
      selectVehicleModel('MT-09 SP'),
      selectVehicleYear(2022),
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  // Sean 2026-07-30 手機實測回饋 1:三種粒度都要能送出(不再強迫三欄全填)。
  // 🔴 這三條同時鎖住「dispatch 幾發」—— 少一發或多一發都會讓 URL 的 ?vehicle= 段數變掉、
  //    server 就查成另一個範圍(桌機一直是這個語意,手機以前比它嚴)。
  it('只選廠牌 → 可送出、只 dispatch brand(看該廠牌全部商品)', () => {
    const { dispatch, onClose } = renderSheet();
    pickOption(brandField(), 'Yamaha', 'Yamaha');

    const apply = screen.getByRole('button', { name: '查看適用商品' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([selectVehicleBrand('Yamaha')]);
    expect(onClose).toHaveBeenCalled();
  });

  it('廠牌+車型、年份留空 → 可送出、不 dispatch year(不限年份)', () => {
    const { dispatch } = renderSheet();
    pickOption(brandField(), 'Yamaha', 'Yamaha');
    pickOption(modelField(), 'MT-09 SP', 'MT-09 SP');

    const apply = screen.getByRole('button', { name: '查看適用商品' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Yamaha'),
      selectVehicleModel('MT-09 SP'),
    ]);
  });

  it('三欄全填 → 三連發(最精確)', () => {
    const { dispatch } = renderSheet();
    pickOption(brandField(), 'Yamaha', 'Yamaha');
    pickOption(modelField(), 'MT-09 SP', 'MT-09 SP');
    pickOption(yearField(), '2022', '2022');
    fireEvent.click(screen.getByRole('button', { name: '查看適用商品' }));
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Yamaha'),
      selectVehicleModel('MT-09 SP'),
      selectVehicleYear(2022),
    ]);
  });

  it('三欄全空 → 套用鈕仍停用(沒選車不該能送出)', () => {
    renderSheet();
    const apply = screen.getByRole('button', { name: '查看適用商品' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  // ⑥ V-1f 無年份車型出口(既有能力、不得回歸)。
  it('無年份車型 → 年份欄顯「不限年份」且可直接套用(不 dispatch year)', () => {
    const { dispatch } = renderSheet();
    pickOption(brandField(), 'Ducati', 'Ducati');
    pickOption(modelField(), 'Monster', 'Monster');

    expect(yearField().disabled).toBe(true);
    expect(yearField().placeholder).toBe('不限年份');

    const apply = screen.getByRole('button', { name: '查看適用商品' }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    expect(dispatch.mock.calls.map((c) => c[0])).toEqual([
      selectVehicleBrand('Ducati'),
      selectVehicleModel('Monster'),
    ]);
  });

  // ⑥ V-1f 跨層直搜(既有能力、不得回歸):不先選廠牌,直接在車型欄打「mt-09」直達車款。
  it('跨層直搜:未選廠牌時在車型欄打 mt-09 → 命中「Yamaha MT-09 SP」、選它同時補上廠牌', () => {
    renderSheet();

    fireEvent.change(modelField(), { target: { value: 'mt-09' } });
    // 跨層字面空間 =「品牌 車型」(與愛車建議清單同一顆 flattenVehicleModels)
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha MT-09 SP' }));

    expect(brandField().value).toBe('Yamaha');
    expect(modelField().value).toBe('MT-09 SP');
  });

  it('跨層直搜查無 → 提示、不猜', () => {
    renderSheet();
    fireEvent.change(modelField(), { target: { value: 'zzz' } });
    expect(screen.getByText('查無符合的車款，請調整關鍵字')).toBeTruthy();
  });

  // ⑤ 鍵盤出現後作用中欄位仍須可見。
  it('聚焦輸入欄位 → 把該欄捲進可視範圍', () => {
    vi.useFakeTimers();
    try {
      renderSheet();
      fireEvent.focus(modelField());
      vi.runAllTimers();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: 'center' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
