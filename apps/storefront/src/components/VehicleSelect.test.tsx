// @vitest-environment jsdom
// VehicleSelect smoke — V-1b 可打字三層 combobox(prefix 過濾/鍵盤選/blur 唯一精確命中/清空連動)。

import { useReducer } from 'react';
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
  { id: 'kawasaki', name: 'Kawasaki', models: [{ id: 'z900', name: 'Z900', years: [] }] },
] as MockMotoBrand[];

function Harness() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const vehicle = cascade.vehicle;
  return (
    <VehicleSelect
      motoBrands={BRANDS}
      vehicle={vehicle}
      onPickBrand={(n) => dispatch(selectVehicleBrand(n))}
      onPickModel={(n) => dispatch(selectVehicleModel(n))}
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
  it('打字 prefix 過濾+點選=選定;下層解鎖', () => {
    render(<Harness />);
    const brand = combo('選擇品牌');
    expect(combo('選擇車型').disabled).toBe(true);
    fireEvent.change(brand, { target: { value: 'ya' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Yamaha' }));
    expect(brand.value).toBe('Yamaha');
    expect(combo('選擇車型').disabled).toBe(false);
  });

  it('blur 唯一精確命中自動套用(全形/大小寫正規化);非唯一 → 還原不猜', () => {
    render(<Harness />);
    const brand = combo('選擇品牌');
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
    const brand = combo('選擇品牌');
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

  it('focus 未導航直接 Enter=不誤選首項;重選同值不 wipe 下層(R1 must-fix)', () => {
    render(<Harness />);
    const brand = combo('選擇品牌');
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
    const brand = combo('選擇品牌');
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
    expect(combo('選擇車型').disabled).toBe(true);
  });

  it('V-2d④:點選選定後主動 blur 收鍵盤(rAF 後);鍵盤 Enter 選定不 blur=桌機流不變', async () => {
    render(<Harness />);
    const brand = combo('選擇品牌');
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
