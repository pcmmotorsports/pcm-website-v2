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
