// vehicle-context 單測(V-1c;REQUIRED-3 防禦讀取=壞資料 null 絕不 throw)。

import { describe, it, expect } from 'vitest';
import {
  VEHICLE_CONTEXT_KEY,
  writeVehicleContext,
  readVehicleContext,
  clearVehicleContext,
} from './vehicle-context';

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    dump: () => m,
  };
}

describe('vehicle-context — 寫/讀/清 round-trip', () => {
  it('write→read 還原(帶 savedAt);clear 後 null', () => {
    const s = memStorage();
    writeVehicleContext({ brandId: 'yamaha', modelId: 'mt-09-sp', year: 2021, label: 'Yamaha MT-09 SP 2021' }, s);
    const v = readVehicleContext(s);
    expect(v).toMatchObject({ brandId: 'yamaha', modelId: 'mt-09-sp', year: 2021 });
    expect(typeof v?.savedAt).toBe('number');
    clearVehicleContext(s);
    expect(readVehicleContext(s)).toBeNull();
  });

  it('brand-only(model/year 缺)合法', () => {
    const s = memStorage();
    writeVehicleContext({ brandId: 'yamaha', label: 'Yamaha' }, s);
    expect(readVehicleContext(s)).toMatchObject({ brandId: 'yamaha', modelId: undefined });
  });
});

describe('vehicle-context — 防禦讀取(壞資料 → null 絕不 throw)', () => {
  it.each([
    ['壞 JSON', '{oops'],
    ['非物件', '"str"'],
    ['缺 brandId', '{"label":"x","savedAt":1}'],
    ['brandId 空字串', '{"brandId":"","label":"x","savedAt":1}'],
    ['year 非整數', '{"brandId":"y","year":1.5,"label":"x","savedAt":1}'],
    ['label 非字串', '{"brandId":"y","label":9,"savedAt":1}'],
  ])('%s → null', (_name, raw) => {
    const s = memStorage({ [VEHICLE_CONTEXT_KEY]: raw });
    expect(readVehicleContext(s)).toBeNull();
  });

  it('storage=null(SSR/隱私模式)→ 全部 no-op 不炸', () => {
    expect(readVehicleContext(null)).toBeNull();
    expect(() => writeVehicleContext({ brandId: 'y', label: 'x' }, null)).not.toThrow();
    expect(() => clearVehicleContext(null)).not.toThrow();
  });
});

describe('vehicle-context — V-2a additive 名稱字面欄(brandName/modelName)', () => {
  it('write→read 帶回 brandName/modelName 名稱字面', () => {
    const s = memStorage();
    writeVehicleContext(
      { brandId: 'yamaha', modelId: 'mt-09-sp', year: 2021, label: 'Yamaha MT-09 SP 2021', brandName: 'Yamaha', modelName: 'MT-09 SP' },
      s,
    );
    expect(readVehicleContext(s)).toMatchObject({ brandName: 'Yamaha', modelName: 'MT-09 SP' });
  });

  it('舊 context 缺名稱欄 → 讀回 undefined、不擋整筆(不 bump key 相容)', () => {
    const s = memStorage({
      [VEHICLE_CONTEXT_KEY]: '{"brandId":"yamaha","modelId":"mt-09-sp","label":"Yamaha MT-09 SP","savedAt":1}',
    });
    const v = readVehicleContext(s);
    expect(v).not.toBeNull();
    expect(v!.brandName).toBeUndefined();
    expect(v!.modelName).toBeUndefined();
  });

  it('名稱欄型別錯(非字串)→ null(逐欄防禦)', () => {
    const s = memStorage({
      [VEHICLE_CONTEXT_KEY]: '{"brandId":"y","label":"x","savedAt":1,"brandName":9}',
    });
    expect(readVehicleContext(s)).toBeNull();
  });
});
