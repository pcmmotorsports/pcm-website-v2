// @vitest-environment jsdom
// VehicleSelect smoke — V-1b 可打字三層 combobox(prefix 過濾/鍵盤選/blur 唯一精確命中/清空連動)。

import { useReducer, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  clearVehicle,
} from '@pcm/ui';
import { VehicleSelect } from './VehicleSelect';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

const BRANDS: MockMotoBrand[] = [
  {
    id: 'yamaha',
    name: 'Yamaha',
    models: [
      { id: 'r6', name: 'R6', years: [2016, 2017] },
      { id: 'mt-09-sp', name: 'MT-09 SP', years: [2021, 2022] },
    ],
  },
  {
    id: 'kawasaki',
    name: 'Kawasaki',
    models: [
      { id: 'z900', name: 'Z900', years: [] },
      // 跨廠牌撞名(R1 nit):Yamaha 與 Kawasaki 都有 R6,消歧正是跨層搜尋存在的理由——
      // 少了這一維,反查廠牌的邏輯錯拿到「隨便一家有 R6 的廠牌」測試也會綠。
      { id: 'kawa-r6', name: 'R6', years: [2019] },
    ],
  },
] as MockMotoBrand[];

function Harness() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const vehicle = cascade.vehicle;
  return (
    <VehicleSelect
      motoBrands={BRANDS}
      vehicle={vehicle}
      onPickBrand={(n) => dispatch(selectVehicleBrand(n))}
      onPickModel={(p) => {
        // 跨層選取(未選廠牌直接打車型)時 reducer 的 select-model 是 no-op,先立廠牌再立車型
        // (與 CascadeFilterTop.pickModel 同型)。
        if (p.brand !== vehicle?.brand) dispatch(selectVehicleBrand(p.brand));
        dispatch(selectVehicleModel(p.model));
      }}
      onPickYear={(y) => dispatch(selectVehicleYear(y))}
      onClearBrand={() => dispatch(clearVehicle())}
      onClearModel={() => vehicle && dispatch(selectVehicleBrand(vehicle.brand))}
      onClearYear={() => vehicle?.model != null && dispatch(selectVehicleModel(vehicle.model))}
    />
  );
}

afterEach(cleanup);

function combo(label: string) {
  return screen.getByRole('combobox', { name: label }) as HTMLInputElement;
}

describe('VehicleSelect', () => {
  // A3(選車引擎統一 B′)字面守門:aria label 與 placeholder 逐字鎖 OD `vehicle-picker-design.html`
  // A 表定版。這支測試是本次「廠牌 / 選擇或輸入 X」統一唯一的直接證據 —— 少了它,字面被改回去全綠。
  it('A 表字面:aria=選擇廠牌/車型/年份、placeholder=選擇或輸入 X', () => {
    render(<Harness />);
    expect(combo('選擇廠牌').placeholder).toBe('選擇或輸入廠牌');
    // Sean 2026-08-06 拍板 B:車型欄改成與 CascadeFilterTop 一致 —— 未選廠牌(crossLayer=true,
    // 本測試在斷言前未做任何互動)時附例字。本條釘的是**新**字面,擋的是「有人改回舊字面」。
    expect(combo('選擇車型').placeholder).toBe('選擇或輸入車型，例:R6');
    expect(combo('選擇年份').placeholder).toBe('選擇或輸入年份');
    // 「品牌」保留給零件品牌,選車三欄不得再出現
    expect(screen.queryByRole('combobox', { name: '選擇品牌' })).toBeNull();
  });

  // MF6(R1):CascadeFilterTop 的 crossLayer=false 分支有測試釘住(CascadeFilterTop.test.tsx:207),
  // 本檔原本沒有對應的 —— VehicleSelect.tsx:276 三元式的 false 分支改成任意字串仍全綠,
  // 淨損一格覆蓋(原本釘該字面的那條被改去釘新字面時一併移走了)。
  it('已選廠牌後(crossLayer=false),車型欄 placeholder 落回無例字版', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'yamaha' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    expect(combo('選擇車型').placeholder).toBe('選擇或輸入車型');
  });

  it('打字 prefix 過濾+點選=選定;下層解鎖', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    // A5:車型欄不再鎖廠牌(本片主體),未選廠牌時改跨層可搜尋——見下方新 describe。
    // 「下層解鎖」的判別力因此改交給年份欄:未選車型前年份欄恆鎖(disabled===true、
    // 與是否已選廠牌無關),留住原本那半的證據(年份欄真正的解鎖斷言見 :95 起選定車型後)。
    expect(combo('選擇年份').disabled).toBe(true);
    fireEvent.change(brand, { target: { value: 'ya' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    expect(brand.value).toBe('Yamaha');
    expect(combo('選擇車型').disabled).toBe(false);
  });

  it('blur 唯一精確命中自動套用(全形/大小寫正規化);非唯一 → 還原不猜', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'ＹＡＭＡＨＡ' } });
    fireEvent.blur(brand);
    expect(brand.value).toBe('Yamaha');
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'r' } }); // R6 與 MT-09 SP 皆非精確 → 不套用
    fireEvent.blur(model);
    expect(model.value).toBe('');
  });

  it('鍵盤 ArrowDown+Enter 選 highlight 項;年份選定', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'yamaha' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'mt' } });
    fireEvent.keyDown(model, { key: 'Enter' });
    expect(model.value).toBe('MT-09 SP');
    const year = combo('選擇年份');
    fireEvent.focus(year);
    fireEvent.keyDown(year, { key: 'ArrowDown' });
    fireEvent.keyDown(year, { key: 'ArrowDown' });
    fireEvent.keyDown(year, { key: 'Enter' });
    expect(year.value).toBe('2022');
  });

  it('V-2h/nit-8:完整 combobox ARIA——開列表 aria-controls 指 listbox、方向鍵導航更新 aria-activedescendant', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.focus(brand);
    const listboxId = brand.getAttribute('aria-controls');
    expect(listboxId).toBeTruthy();
    expect(document.getElementById(listboxId!)?.getAttribute('role')).toBe('listbox');
    fireEvent.keyDown(brand, { key: 'ArrowDown' }); // hi 0→1(focus 起 hi=-1)
    const active = brand.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.getAttribute('role')).toBe('option');
  });

  it('focus 未導航直接 Enter=不誤選首項;重選同值不 wipe 下層(R1 must-fix)', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.focus(brand);
    fireEvent.keyDown(brand, { key: 'Enter' }); // hi=-1 → commit(text null)=no-op
    expect(brand.value).toBe('');
    fireEvent.change(brand, { target: { value: 'yamaha' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'r6' } });
    fireEvent.blur(model);
    expect(model.value).toBe('R6');
    // 點開品牌欄再點已選同名 → 不 dispatch、model 不被 cascade reset 清掉
    fireEvent.focus(brand);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    expect(combo('選擇車型').value).toBe('R6');
  });

  it('清空 brand 欄 commit=全清;無年份車型 → 年份欄 disabled 顯「不限年份」', () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    fireEvent.change(brand, { target: { value: 'kawasaki' } });
    fireEvent.blur(brand);
    const model = combo('選擇車型');
    fireEvent.change(model, { target: { value: 'z900' } });
    fireEvent.blur(model);
    const year = combo('選擇年份');
    expect(year.disabled).toBe(true);
    expect(year.placeholder).toBe('不限年份');
    fireEvent.change(brand, { target: { value: '' } });
    fireEvent.blur(brand);
    expect(brand.value).toBe('');
    // A5:disabled 恆 false、已無判別力(nit)——改守它真正要證的連動:
    // 清 brand = cascade 全清,車型欄的值也要跟著清空。
    expect(combo('選擇車型').value).toBe('');
  });

  it('V-2d④:點選選定後主動 blur 收鍵盤(rAF 後);鍵盤 Enter 選定不 blur=桌機流不變', async () => {
    render(<Harness />);
    const brand = combo('選擇廠牌');
    brand.focus();
    fireEvent.change(brand, { target: { value: 'ya' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).not.toBe(brand); // 觸控/滑鼠選定 → focus 釋放=手機鍵盤收
    const model = combo('選擇車型');
    model.focus();
    fireEvent.change(model, { target: { value: 'r' } });
    fireEvent.keyDown(model, { key: 'ArrowDown' });
    fireEvent.keyDown(model, { key: 'Enter' });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect((combo('選擇車型') as HTMLInputElement).value).toBe('R6');
    expect(document.activeElement).toBe(model); // Enter 路徑不 blur
  });
});

// A5(2026-08-06):未選廠牌時車型欄跨層搜尋(打車型直達車款),選定同時回填廠牌。
// 用獨立 spy harness(而非上面共用的 reducer Harness)才能直接斷言 onPickModel 收到的物件字面,
// 不繞經 reducer 往返觀察間接效果。
function SpyHarness({
  onPick,
  initial = null,
}: {
  onPick: (pick: { brand: string; model: string }) => void;
  initial?: { brand: string; model?: string; year?: number } | null;
}) {
  const [vehicle, setVehicle] = useState(initial);
  return (
    <VehicleSelect
      motoBrands={BRANDS}
      vehicle={vehicle}
      onPickBrand={(name) => setVehicle({ brand: name })}
      onPickModel={(p) => {
        onPick(p);
        setVehicle({ brand: p.brand, model: p.model });
      }}
      onPickYear={() => {}}
      onClearBrand={() => setVehicle(null)}
      onClearModel={() => setVehicle((v) => (v ? { brand: v.brand } : v))}
      onClearYear={() => {}}
    />
  );
}

describe('VehicleSelect 跨層車型(A5:未選廠牌可直接打車型)', () => {
  it('未選廠牌時,車型欄選項為跨廠牌攤平的「品牌 車型」label', () => {
    render(<SpyHarness onPick={() => {}} />);
    const model = combo('選擇車型');
    expect(model.disabled).toBe(false); // 本片主體:車型欄不再鎖廠牌
    fireEvent.focus(model);
    expect(screen.getByRole('option', { name: 'Yamaha R6' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Kawasaki Z900' })).toBeTruthy();
  });

  it('未選廠牌時直接選跨廠牌車型 ⇒ onPickModel 同時收到正確 brand 與 model', () => {
    const picks: { brand: string; model: string }[] = [];
    render(<SpyHarness onPick={(p) => picks.push(p)} />);
    const model = combo('選擇車型');
    fireEvent.focus(model);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Kawasaki Z900' }));
    expect(picks).toEqual([{ brand: 'Kawasaki', model: 'Z900' }]);
  });

  it('已選廠牌時,車型欄選項退回該廠牌自己的車型,onPickModel 的 brand=已選廠牌', () => {
    const picks: { brand: string; model: string }[] = [];
    render(<SpyHarness onPick={(p) => picks.push(p)} initial={{ brand: 'Yamaha' }} />);
    const model = combo('選擇車型');
    fireEvent.focus(model);
    expect(screen.getByRole('option', { name: 'R6' })).toBeTruthy(); // 非跨層:裸車型名
    expect(screen.queryByRole('option', { name: 'Kawasaki Z900' })).toBeNull();
    fireEvent.mouseDown(screen.getByRole('option', { name: 'R6' }));
    expect(picks).toEqual([{ brand: 'Yamaha', model: 'R6' }]);
  });

  it('跨廠牌撞名(兩廠牌都有 R6)⇒ 選 Kawasaki R6 反查到正確廠牌,不誤配到 Yamaha', () => {
    const picks: { brand: string; model: string }[] = [];
    render(<SpyHarness onPick={(p) => picks.push(p)} />);
    const model = combo('選擇車型');
    fireEvent.focus(model);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Kawasaki R6' }));
    expect(picks).toEqual([{ brand: 'Kawasaki', model: 'R6' }]);
  });
});
