// @vitest-environment jsdom
//
// CartVehicleField smoke test — V-2a 購物車車款欄。
// 驗:空值加入 / 愛車快選 dict / 三層 picker dict / 自由輸入 free / 現值顯示+清除 /
//     garage 零命中→以自由輸入記下(source:garage)。共用 resolveGarageChip 決策腦、車種鐵律零猜。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CartVehicleField, formatCartVehicle } from './CartVehicleField';
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

function combo(label: string) {
  return screen.getByRole('combobox', { name: label }) as HTMLInputElement;
}
function pick(label: string, text: string) {
  const input = combo(label);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('formatCartVehicle', () => {
  it('dict=年+品牌車型;free=年+raw', () => {
    expect(formatCartVehicle({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'picker' })).toBe('2021 Yamaha MT-09 SP');
    expect(formatCartVehicle({ kind: 'free', raw: '我的車', source: 'freetext' })).toBe('我的車');
  });
});

describe('CartVehicleField', () => {
  it('無值 → 顯「+ 選擇車款」;點開進編輯', () => {
    render(<CartVehicleField label="這件給哪台車" value={undefined} onChange={vi.fn()} motoBrands={BRANDS} />);
    fireEvent.click(screen.getByText('+ 選擇車款'));
    expect(screen.getByRole('combobox', { name: '選擇廠牌' })).toBeTruthy();
  });

  it('三層 picker:選品牌+車型 → onChange kind:dict source:picker(選車型即帶入、年份可後補)', () => {
    const onChange = vi.fn();
    render(<CartVehicleField label="x" value={undefined} onChange={onChange} motoBrands={BRANDS} />);
    fireEvent.click(screen.getByText('+ 選擇車款'));
    pick('選擇廠牌', 'Yamaha');
    pick('選擇車型', 'MT-09 SP');
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: undefined, source: 'picker' });
    pick('選擇年份', '2021');
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'picker' });
  });

  it('愛車快選 dict 命中 → onChange kind:dict source:garage', () => {
    const onChange = vi.fn();
    render(
      <CartVehicleField label="x" value={undefined} onChange={onChange} motoBrands={BRANDS}
        garage={[{ id: 'g1', name: 'MT-09 SP', year: '2021', dictBrandName: 'Yamaha', dictModelName: 'MT-09 SP', isPrimary: false }]} />,
    );
    fireEvent.click(screen.getByText('+ 選擇車款'));
    fireEvent.click(screen.getByText('2021 MT-09 SP'));
    expect(onChange).toHaveBeenCalledWith({ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'garage' });
  });

  it('自由輸入 → onChange kind:free source:freetext', () => {
    const onChange = vi.fn();
    render(<CartVehicleField label="x" value={undefined} onChange={onChange} motoBrands={BRANDS} />);
    fireEvent.click(screen.getByText('+ 選擇車款'));
    const input = screen.getByLabelText('自由輸入車款') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2017 R6' } });
    fireEvent.click(screen.getByText('記下'));
    expect(onChange).toHaveBeenCalledWith({ kind: 'free', raw: '2017 R6', source: 'freetext' });
  });

  it('garage 零命中(純自由文字車庫車)→「以自由輸入記下」→ onChange kind:free source:garage', () => {
    const onChange = vi.fn();
    render(
      <CartVehicleField label="x" value={undefined} onChange={onChange} motoBrands={BRANDS}
        garage={[{ id: 'g9', name: '阿嬤的野狼', year: '', dictBrandName: null, dictModelName: null, isPrimary: false }]} />,
    );
    fireEvent.click(screen.getByText('+ 選擇車款'));
    fireEvent.click(screen.getByText('阿嬤的野狼'));
    fireEvent.click(screen.getByText(/以自由輸入記下/));
    expect(onChange).toHaveBeenCalledWith({ kind: 'free', raw: '阿嬤的野狼', source: 'garage' });
  });

  // A10c:購物車自刻 chips 退場,換全站唯一的 GarageChips(設計稿 C5 行內密度)。
  // 🔴 沒有這條,把它換回自刻 JSX 上面兩條行為測試照樣綠 ——「4 份收斂成 1 份」本身沒有守門。
  it('用的是統一的 GarageChips 行內密度,但零命中出口仍是購物車自己那顆', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CartVehicleField label="x" value={undefined} onChange={onChange} motoBrands={BRANDS}
        garage={[{ id: 'g9', name: '阿嬤的野狼', year: '', dictBrandName: null, dictModelName: null, isPrimary: false }]} />,
    );
    fireEvent.click(screen.getByText('+ 選擇車款'));

    expect(container.querySelector('.cat-garage--inline')).not.toBeNull();
    expect(container.querySelector('.cvf-garage')).toBeNull(); // 自刻家族退場
    expect(container.querySelector('.cvf-suggest')).toBeNull();
    expect(container.querySelector('.cat-garage-toggle')).toBeNull(); // 行內密度恆展開

    // 🔴 計畫 §2.7 紅字:零命中走購物車專屬出口(renderNoMatch),
    //    **不得**被共用元件那句「請改用車款選單選擇」取代 —— 那會讓「記下阿嬤的野狼」這個能力消失。
    fireEvent.click(screen.getByText('阿嬤的野狼'));
    expect(screen.getByText(/以自由輸入記下/)).toBeTruthy();
    expect(screen.queryByText(/請改用車款選單選擇/)).toBeNull();
  });

  it('現值顯示 + 清除 → onChange(null)', () => {
    const onChange = vi.fn();
    render(<CartVehicleField label="x" value={{ kind: 'dict', brand: 'Yamaha', model: 'MT-09', year: 2021, source: 'search' }} onChange={onChange} motoBrands={BRANDS} />);
    expect(screen.getByText('2021 Yamaha MT-09')).toBeTruthy();
    expect(screen.getByText('來自你的搜尋')).toBeTruthy();
    fireEvent.click(screen.getByText('清除'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

// ── V-2e:車款 vs 商品適用不符 → 紅膠囊「可能不適用」(重用 §7 checkFitment、僅 no-match 亮紅)──
describe('CartVehicleField — V-2e 不符紅膠囊', () => {
  const FITMENTS = [{ motoBrand: 'Yamaha', modelCode: 'MT-09 SP', yearStart: 2021, yearEnd: 2022 }];

  it('dict 車型未列 → 膠囊 data-fit=no-match + 「可能不適用」小字', () => {
    render(
      <CartVehicleField label="x" value={{ kind: 'dict', brand: 'Honda', model: 'CB650R', source: 'picker' }}
        onChange={vi.fn()} motoBrands={BRANDS} fitments={FITMENTS} />,
    );
    expect(screen.getByText('Honda CB650R').getAttribute('data-fit')).toBe('no-match');
    expect(screen.getByText(/可能不適用/)).toBeTruthy();
  });

  it('dict 年份不合(2019 vs 2021-2022)→ no-match 紅(§7 反向:列了車型但年份不符)', () => {
    render(
      <CartVehicleField label="x" value={{ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2019, source: 'picker' }}
        onChange={vi.fn()} motoBrands={BRANDS} fitments={FITMENTS} />,
    );
    expect(screen.getByText('2019 Yamaha MT-09 SP').getAttribute('data-fit')).toBe('no-match');
    expect(screen.getByText(/可能不適用/)).toBeTruthy();
  });

  it('dict 命中 → data-fit=match、無「可能不適用」', () => {
    render(
      <CartVehicleField label="x" value={{ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', year: 2021, source: 'picker' }}
        onChange={vi.fn()} motoBrands={BRANDS} fitments={FITMENTS} />,
    );
    expect(screen.getByText('2021 Yamaha MT-09 SP').getAttribute('data-fit')).toBe('match');
    expect(screen.queryByText(/可能不適用/)).toBeNull();
  });

  it('dict 年份未知+受限 fitment=qualified → 中性不紅(人工確認路、不誤嚇)', () => {
    render(
      <CartVehicleField label="x" value={{ kind: 'dict', brand: 'Yamaha', model: 'MT-09 SP', source: 'picker' }}
        onChange={vi.fn()} motoBrands={BRANDS} fitments={FITMENTS} />,
    );
    expect(screen.getByText('Yamaha MT-09 SP').getAttribute('data-fit')).toBe('qualified');
    expect(screen.queryByText(/可能不適用/)).toBeNull();
  });

  it('free 自由輸入 → 不判定不紅(kind:free=人工確認)', () => {
    render(
      <CartVehicleField label="x" value={{ kind: 'free', raw: '阿嬤的野狼', source: 'freetext' }}
        onChange={vi.fn()} motoBrands={BRANDS} fitments={FITMENTS} />,
    );
    expect(screen.getByText('阿嬤的野狼').getAttribute('data-fit')).toBeNull();
    expect(screen.queryByText(/可能不適用/)).toBeNull();
  });

  it('無 fitments prop(頂部整車欄)→ 不判定(跨商品無單一判定對象)', () => {
    render(
      <CartVehicleField label="x" value={{ kind: 'dict', brand: 'Honda', model: 'CB650R', source: 'picker' }}
        onChange={vi.fn()} motoBrands={BRANDS} />,
    );
    expect(screen.getByText('Honda CB650R').getAttribute('data-fit')).toBeNull();
    expect(screen.queryByText(/可能不適用/)).toBeNull();
  });
});
