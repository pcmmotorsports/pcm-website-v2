import { describe, it, expect } from 'vitest';
import { VehicleInput } from './index';

// vitest root config glob `{packages,apps}/**/*.{test,spec}.{ts,tsx}` 收本檔。
// #177:service 空值正規化為 null(DB customer_vehicles.service 是 nullable date 欄、塞空字串會炸
// invalid input syntax for type date)。design 為 <input type="date">→ 空字串 / 填 ISO date,故 transform 只需處理空字串 → null。

describe('VehicleInput.service 空值正規化(#177)', () => {
  it('service 省略 → default 補空字串 → 正規化為 null(防 date 欄塞空字串)', () => {
    const parsed = VehicleInput.parse({ name: 'YAMAHA YZF-R6' });
    expect(parsed.service).toBeNull();
  });

  it('service 明確空字串 → 正規化為 null', () => {
    const parsed = VehicleInput.parse({ name: 'YAMAHA YZF-R6', service: '' });
    expect(parsed.service).toBeNull();
  });

  it('service 為 ISO date 字串 → 原值保留(不誤轉 null)', () => {
    const parsed = VehicleInput.parse({ name: 'YAMAHA YZF-R6', service: '2026-04-01' });
    expect(parsed.service).toBe('2026-04-01');
  });

  it('其餘選填字串欄省略 → 仍 default 空字串(僅 service 走 null 正規化、不誤動 year/engine/km/mods)', () => {
    const parsed = VehicleInput.parse({ name: 'YAMAHA YZF-R6' });
    expect(parsed).toMatchObject({ year: '', engine: '', km: '', mods: '', isPrimary: false });
  });

  it('name 仍必填(空字串 → reject、轉 schema 不鬆綁 name.min(1))', () => {
    expect(VehicleInput.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('VehicleInput.name 純空白 trim(#201、對齊 design saveVehicle L774)', () => {
  it('純空白 name → reject(trim 後為空)', () => {
    expect(VehicleInput.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('頭尾空白 name → 通過且入庫值去空白', () => {
    const parsed = VehicleInput.parse({ name: '  YAMAHA YZF-R6  ' });
    expect(parsed.name).toBe('YAMAHA YZF-R6');
  });
});

// V-1d:dict 對(名稱字面)成對不變式+default(null) 恆出現(REQUIRED-1 的 schema 層依據:
// parsed.data 恆帶兩欄 → update patch 恆寫入、dict→free 存檔=雙 null 覆蓋殘留)。
describe('VehicleInput.dict 對(V-1d)', () => {
  it('缺省 → 雙 null 恆出現在 parsed 結果', () => {
    const parsed = VehicleInput.parse({ name: 'YAMAHA YZF-R6' });
    expect(parsed.dictBrandName).toBeNull();
    expect(parsed.dictModelName).toBeNull();
    expect('dictBrandName' in parsed).toBe(true);
  });

  it('成對有值 → 逐字保留', () => {
    const parsed = VehicleInput.parse({
      name: 'YAMAHA YZF-R6',
      dictBrandName: 'YAMAHA',
      dictModelName: 'YZF-R6',
    });
    expect(parsed.dictBrandName).toBe('YAMAHA');
    expect(parsed.dictModelName).toBe('YZF-R6');
  });

  it('單邊有值 → reject(成對不變式、鏡像 DB CHECK)', () => {
    expect(VehicleInput.safeParse({ name: 'x', dictBrandName: 'YAMAHA' }).success).toBe(false);
    expect(VehicleInput.safeParse({ name: 'x', dictModelName: 'YZF-R6' }).success).toBe(false);
  });

  it('空字串當值 → reject(min(1);表單不會送空字串、竄改才會)', () => {
    expect(
      VehicleInput.safeParse({ name: 'x', dictBrandName: '', dictModelName: '' }).success,
    ).toBe(false);
  });
});
