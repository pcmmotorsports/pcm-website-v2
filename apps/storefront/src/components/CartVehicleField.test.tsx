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

  // ── Part B 債⑤:草稿被丟棄的提示(核心規則:出口動作已給值的層要排除,見 CartVehicleField.tsx done()) ──
  describe('草稿丟棄提示', () => {
    it('廠牌欄打字沒選中 → 完成 ⇒ 顯示丟棄提示', () => {
      render(<CartVehicleField label="x" value={undefined} onChange={vi.fn()} motoBrands={BRANDS} />);
      fireEvent.click(screen.getByText('+ 選擇車款'));
      const brandInput = combo('選擇廠牌');
      fireEvent.change(brandInput, { target: { value: 'kawa' } });
      fireEvent.blur(brandInput);
      fireEvent.click(screen.getByText('完成'));
      expect(screen.getByText('「kawa」沒有對應到廠牌，已略過')).toBeTruthy();
    });

    // 🔴 反向(防假警報):車型欄跨層選一台別廠牌的車 = 客人刻意的明確選擇,不是零命中被丟棄。
    it('反向:廠牌欄打字沒選中 → 車型欄跨層選別廠牌的車 ⇒ 不得出現任何提示', () => {
      render(<CartVehicleField label="x" value={undefined} onChange={vi.fn()} motoBrands={BRANDS} />);
      fireEvent.click(screen.getByText('+ 選擇車款'));
      const brandInput = combo('選擇廠牌');
      fireEvent.change(brandInput, { target: { value: 'kawa' } });
      fireEvent.blur(brandInput);
      pick('選擇車型', 'Yamaha MT-09 SP'); // 跨層 label,存在於 BRANDS fixture
      fireEvent.click(screen.getByText('完成'));
      expect(screen.queryByText(/沒有對應到/)).toBeNull();
    });

    it('沒有任何草稿時按「完成」⇒ 不渲染提示元素', () => {
      const { container } = render(<CartVehicleField label="x" value={undefined} onChange={vi.fn()} motoBrands={BRANDS} />);
      fireEvent.click(screen.getByText('+ 選擇車款'));
      fireEvent.click(screen.getByText('完成'));
      expect(container.querySelector('.cvf-note')).toBeNull();
    });

    // 🔴 M1 判別力測試:上面那條「跨層選車」反向測試不夠 —— cross-layer 選車會讓 VehicleSelect
    //    本身的 `useEffect([value])` 在同一次事件裡就把 brand 草稿清成 ''(見 VehicleSelect.tsx:131-138
    //    的既有機制),`done()` 的排除規則永遠讀到空字串,拿掉排除規則那條測試也不會變紅(已實測驗證)。
    //    這條才是排除規則真正生效的路徑:sel.brand 已選定(picker 早先選過)時再打新字**不 blur**,
    //    出口走「不動 sel」的車庫套用 ⇒ 排除規則拿掉時,'kawa' 才會真的漏進提示。
    it('sel 已選定後再打字未確認(不 blur)→ 車庫套用(不動 sel)⇒ 該層排除、不顯示提示', () => {
      const onChange = vi.fn();
      render(
        <CartVehicleField label="x" value={undefined} onChange={onChange} motoBrands={BRANDS}
          garage={[{ id: 'g1', name: 'MT-09 SP', year: '2021', dictBrandName: 'Yamaha', dictModelName: 'MT-09 SP', isPrimary: false }]} />,
      );
      fireEvent.click(screen.getByText('+ 選擇車款'));
      pick('選擇廠牌', 'Yamaha');
      pick('選擇車型', 'MT-09 SP');
      const brandInput = combo('選擇廠牌');
      fireEvent.change(brandInput, { target: { value: 'kawa' } }); // 未 blur:草稿留著,sel.brand 仍是 Yamaha
      fireEvent.click(screen.getByText('2021 MT-09 SP')); // 車庫套用不動 sel
      expect(screen.queryByText(/沒有對應到/)).toBeNull();
    });

    // 🔴 F1 回歸(對抗審查 must-fix):`done()` 原本恆看 `sel`,但車庫套用出口
    //    (`GarageChips onApply`)完全不動 `sel` ⇒ 明明廠牌動作後有值,卻被誤判成丟棄。
    it('F1:無值開編輯 → 廠牌打字未選中 → 點愛車 chip(有年份)⇒ 不得出現任何提示', () => {
      render(
        <CartVehicleField label="x" value={undefined} onChange={vi.fn()} motoBrands={BRANDS}
          garage={[{ id: 'g1', name: 'MT-09 SP', year: '2021', dictBrandName: 'Yamaha', dictModelName: 'MT-09 SP', isPrimary: false }]} />,
      );
      fireEvent.click(screen.getByText('+ 選擇車款'));
      const brandInput = combo('選擇廠牌');
      fireEvent.change(brandInput, { target: { value: 'kawa' } });
      fireEvent.blur(brandInput);
      fireEvent.click(screen.getByText('2021 MT-09 SP'));
      expect(screen.queryByText(/沒有對應到/)).toBeNull();
    });

    // 反向(證明修法不是「把車庫出口整條靜音」):已選定廠牌+車型,年份欄打字未選中,
    // 點一台**沒有年份**的愛車 chip ⇒ 套用後年份層仍無值 ⇒ 年份草稿要被報出來。
    it('反向:年份欄打字未選中 → 點沒有年份的愛車 chip ⇒ 出現年份的略過提示', () => {
      render(
        <CartVehicleField label="x" value={undefined} onChange={vi.fn()} motoBrands={BRANDS}
          garage={[{ id: 'g2', name: 'MT-09 SP', year: '', dictBrandName: 'Yamaha', dictModelName: 'MT-09 SP', isPrimary: false }]} />,
      );
      fireEvent.click(screen.getByText('+ 選擇車款'));
      pick('選擇廠牌', 'Yamaha');
      pick('選擇車型', 'MT-09 SP');
      const yearInput = combo('選擇年份');
      fireEvent.change(yearInput, { target: { value: '203' } }); // 不 blur、不選中
      fireEvent.click(screen.getByText('MT-09 SP')); // 車庫車無年份(year:'')⇒ 套用後 year 仍 undefined
      expect(screen.getByText('「203」沒有對應到年份，已略過')).toBeTruthy();
    });

    // 自由輸入出口:整台車改用自由文字記下,三層字典欄位都不再是「沒值」的層。
    it('自由輸入出口:廠牌打字未選中 → 自由輸入記下 ⇒ 不得出現任何提示', () => {
      render(<CartVehicleField label="x" value={undefined} onChange={vi.fn()} motoBrands={BRANDS} />);
      fireEvent.click(screen.getByText('+ 選擇車款'));
      const brandInput = combo('選擇廠牌');
      fireEvent.change(brandInput, { target: { value: 'kawa' } });
      fireEvent.blur(brandInput);
      const freetextInput = screen.getByLabelText('自由輸入車款') as HTMLInputElement;
      fireEvent.change(freetextInput, { target: { value: '2017 R6' } });
      fireEvent.click(screen.getByText('記下'));
      expect(screen.queryByText(/沒有對應到/)).toBeNull();
    });
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
