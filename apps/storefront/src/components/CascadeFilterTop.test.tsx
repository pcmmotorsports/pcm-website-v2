// @vitest-environment jsdom
//
// CascadeFilterTop smoke test — 前台 regression 安全網。
// 驗「render 不報錯 + 關鍵互動(選品牌 → 出現清除鈕)不報錯」。
// M-1-12a 起 CascadeFilterTop 改 controlled、用 Harness 持 useReducer 模擬宿主。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。
//
// 2026-07-30(ADR-0007 桌機正式落地):搜尋式三欄 + 年份新到舊由 `?vehicle-ui=preview`
// 提升為**正式預設輸出**。本檔同時鎖三件事,任一被無聲改回都會轉紅:
//   ① 一般 `/products`(零 query)即出搜尋式三欄與提示字面
//   ② 年份最新在前
//   ③ 「我的愛車」仍在選車列右側 `.cft-right`、仍用中性 `variant="top"` 外殼
//   ④ `vehicle-ui=preview` 不再具備任何正式語意(帶不帶參數輸出等價)

import { useReducer } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { cascadeFilterReducer, makeInitialCascadeState } from '@pcm/ui';
import { CascadeFilterTop } from './CascadeFilterTop';
import { MOCK_MOTO_BRANDS } from '../data/mock-moto-brands';
import { MOCK_CATEGORIES } from '../data/mock-categories';
import { MOCK_BRANDS } from '../data/mock-brands';
import type { FilterTopData } from './FilterTop';
import type { GarageChipItem } from './GarageChips';

const data: FilterTopData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

const GARAGE: GarageChipItem[] = [
  { id: 'g1', name: 'YZF-R1', year: '2024', dictBrandName: 'YAMAHA', dictModelName: 'YZF-R1', isPrimary: true },
];

// controlled CascadeFilterTop 的宿主模擬 — 持 cascade reducer。
function Harness({ garage = [] }: { garage?: GarageChipItem[] }) {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  return <CascadeFilterTop data={data} cascade={cascade} dispatch={dispatch} garage={garage} />;
}

// 選到 YAMAHA / YZF-R1(字典內有五個年份 2020-2024)= 年份排序斷言的資料前提。
function pickYamahaR1() {
  const brandInput = screen.getByPlaceholderText('選擇或輸入廠牌');
  fireEvent.change(brandInput, { target: { value: 'YAMAHA' } });
  fireEvent.blur(brandInput);

  const modelInput = screen.getByPlaceholderText('選擇或輸入車型');
  fireEvent.change(modelInput, { target: { value: 'YZF-R1' } });
  fireEvent.blur(modelInput);
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/products');
});

describe('CascadeFilterTop', () => {
  it('should render the cascade bar without crashing', () => {
    render(<Harness />);
    expect(screen.getByText('選擇適用車輛')).toBeDefined();
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

  // ADR-0007 桌機決定 2:三欄皆可輸入搜尋、也可展開捲動點選(正式預設、非 preview query)。
  it('ships the searchable three-field picker on the plain /products URL', () => {
    window.history.replaceState({}, '', '/products');
    render(<Harness />);

    expect(screen.getByText('選擇適用車輛')).toBeDefined();
    expect(screen.getByText('可直接選擇，也可輸入搜尋')).toBeDefined();
    expect(screen.getByPlaceholderText('選擇或輸入廠牌')).toBeDefined();
    // 尚未選廠牌 ⇒ 車型欄是跨層直搜態(Sean 2026-07-30:桌機也要能直接輸入車款)
    expect(screen.getByPlaceholderText('選擇或輸入車型，例:R6')).toBeDefined();
    expect(screen.getByPlaceholderText('選擇或輸入年份')).toBeDefined();
    // 舊字面已退場(留著=兩套並存、正式站會出現沒人維護的分支)
    expect(screen.queryByText('確認適用車款')).toBeNull();
    expect(screen.queryByText('先選車，只顯示裝得上的零件')).toBeNull();
  });

  // ADR-0007 桌機決定 3:年份由新到舊。
  it('orders the year options newest-first on the plain /products URL', () => {
    window.history.replaceState({}, '', '/products');
    render(<Harness />);
    pickYamahaR1();

    fireEvent.focus(screen.getByPlaceholderText('選擇或輸入年份'));
    const yearOptions = screen.getAllByRole('option').map((option) => option.textContent);
    expect(yearOptions).toEqual(['2024', '2023', '2022', '2021', '2020']);
  });

  // ADR-0007 桌機決定 4:「我的愛車」維持選車列右側原位置 + 中性膠囊(variant="top")。
  it('keeps 我的愛車 in the right-hand slot with the neutral top shell', () => {
    const { container } = render(<Harness garage={GARAGE} />);

    const toggle = screen.getByText('我的愛車').closest('button');
    expect(toggle).not.toBeNull();
    // 綁 DOM 位置、不只綁字面:日後被搬到選車列左側或改成抽屜外殼時當場轉紅。
    expect(container.querySelector('.cft-right')?.contains(toggle as Node)).toBe(true);
    expect(toggle?.closest('.cat-garage--top')).not.toBeNull();
    expect(toggle?.closest('.cat-garage--drawer')).toBeNull();
  });

  // Sean 2026-07-30 逐字:「電腦版也要可以直接輸入車款,目前只有輸入廠牌」。
  // 🔴 這條同時鎖住「跨層命中要補上廠牌」:只 dispatch 車型的話 reducer 會 no-op(無廠牌時
  //    select-model 是防禦式空轉)⇒ 客人打了車款、按了選項,畫面卻什麼都沒發生。
  it('lets the desktop model field search across brands before a brand is picked', () => {
    render(<Harness />);

    const modelInput = screen.getByPlaceholderText('選擇或輸入車型，例:R6');
    expect((modelInput as HTMLInputElement).disabled).toBe(false); // 不再需要先選廠牌

    fireEvent.change(modelInput, { target: { value: 'YZF-R1' } });
    // 跨層字面空間 =「品牌 車型」(與愛車建議清單、手機面板同一顆 flattenVehicleModels)
    const option = screen.getByRole('option', { name: 'YAMAHA YZF-R1' });
    fireEvent.mouseDown(option);

    // 廠牌欄被一併補上、車型欄落在字典字面
    expect((screen.getByPlaceholderText('選擇或輸入廠牌') as HTMLInputElement).value).toBe('YAMAHA');
    expect(screen.getByDisplayValue('YZF-R1')).toBeDefined();
    expect(screen.getByText('清除車輛')).toBeDefined();
  });

  it('shows a no-match hint instead of a silent empty list on the desktop model field', () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText('選擇或輸入車型，例:R6'), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText('查無符合的車款，請調整關鍵字')).toBeDefined();
  });

  // A4(選車引擎統一 B′):A 表要求三欄 emptyHint 同式,原本只有車型欄有 ⇒ 廠牌/年份兩欄補齊。
  // 沒有這條,兩個新 prop 拿掉後整支測試照樣全綠(零命中時只是靜靜地不出清單)。
  it('廠牌與年份欄零命中同樣出提示(A 表:三欄同式)', () => {
    render(<Harness />);
    fireEvent.change(screen.getByPlaceholderText('選擇或輸入廠牌'), { target: { value: 'zzzz' } });
    expect(screen.getByText('查無符合的廠牌，請調整關鍵字')).toBeDefined();

    // 年份欄要先選到有年份的車型才不是 disabled(disabled 欄不顯提示)
    fireEvent.change(screen.getByPlaceholderText('選擇或輸入廠牌'), { target: { value: 'YAMAHA' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'YAMAHA' }));
    fireEvent.change(screen.getByPlaceholderText('選擇或輸入車型'), { target: { value: 'YZF-R1' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'YZF-R1' }));
    fireEvent.change(screen.getByPlaceholderText('選擇或輸入年份'), { target: { value: '1999' } });
    expect(screen.getByText('查無符合的年份，請調整關鍵字')).toBeDefined();
  });

  // 收工條件(交接檔 Slice B):`vehicle-ui=preview` 只能是開發過渡、不得留正式語意。
  // 🔴 不比 innerHTML:VehicleCombo 用 useId、跨 root 的 id 前綴會漂 ⇒ 那種比法會為錯的
  //    理由轉紅。改比「有無 preview 專屬分支的可觀察痕跡」。
  it('gives vehicle-ui=preview no remaining production meaning', () => {
    window.history.replaceState({}, '', '/products?vehicle-ui=preview');
    const { container } = render(<Harness />);

    // preview 專屬 modifier class 已不存在(CSS 側的 preview 作用域一併退場)
    expect(container.querySelector('.cft-bar--vehicle-preview')).toBeNull();
    // 帶參數時的字面 = 正式字面(不是另一套分支)
    expect(screen.getByText('選擇適用車輛')).toBeDefined();
    expect(screen.getByPlaceholderText('選擇或輸入廠牌')).toBeDefined();
    expect(screen.queryByText('確認適用車款')).toBeNull();
  });

  // 🔴 「不得讓桌機 markup 在手機寬度形成三個被壓縮的橫向輸入框」= 整條 `.cft-bar` 在手機
  //    由 CSS 關掉(單一機制、守門在 styles/products-mobile.test.ts)。此處只鎖「三欄確實
  //    全部長在 .cft-bar 裡面」—— 若日後有人把某一欄搬出去,它就會在手機漏出來。
  it('keeps the whole three-field picker inside the single .cft-bar shell', () => {
    const { container } = render(<Harness />);
    const bar = container.querySelector('.cft-bar');
    expect(bar).not.toBeNull();

    const inputs = screen.getAllByRole('combobox');
    expect(inputs).toHaveLength(3);
    for (const input of inputs) {
      expect(bar?.contains(input)).toBe(true);
    }
  });
});
