import { describe, expect, it } from 'vitest';
import type { CustomerVehicle } from '@pcm/domain';
import {
  mapSupabaseVehicleToDomain,
  mapVehiclePatchToRow,
  mapVehicleToInsertRow,
  type SupabaseVehicleRow,
} from './vehicle';

const baseRow: SupabaseVehicleRow = {
  id: 'veh-1',
  customer_user_id: 'cust-1',
  is_primary: true,
  name: 'YAMAHA YZF-R6',
  year: '2022',
  engine: 'RJ27-12345',
  km: '12,340 km',
  mods: '7 件',
  service: '2026-04-01',
  dict_brand_name: null,
  dict_model_name: null,
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T01:00:00Z',
};

describe('mapSupabaseVehicleToDomain', () => {
  it('should rename snake_case columns to camelCase', () => {
    const v = mapSupabaseVehicleToDomain(baseRow);
    expect(v.customerUserId).toBe('cust-1');
    expect(v.isPrimary).toBe(true);
    expect(v.name).toBe('YAMAHA YZF-R6');
    expect(v.service).toBe('2026-04-01');
  });

  it('should coalesce null year/engine/km/mods to empty string', () => {
    const v = mapSupabaseVehicleToDomain({
      ...baseRow,
      year: null,
      engine: null,
      km: null,
      mods: null,
    });
    expect(v.year).toBe('');
    expect(v.engine).toBe('');
    expect(v.km).toBe('');
    expect(v.mods).toBe('');
  });

  it('should pass null service through as null', () => {
    const v = mapSupabaseVehicleToDomain({ ...baseRow, service: null });
    expect(v.service).toBeNull();
  });

  it('V-1d:dict 欄 nullable 直送(null 恆 null、值逐字)', () => {
    expect(mapSupabaseVehicleToDomain(baseRow).dictBrandName).toBeNull();
    const v = mapSupabaseVehicleToDomain({
      ...baseRow,
      dict_brand_name: 'YAMAHA',
      dict_model_name: 'YZF-R6',
    });
    expect(v.dictBrandName).toBe('YAMAHA');
    expect(v.dictModelName).toBe('YZF-R6');
  });
});

describe('mapVehicleToInsertRow', () => {
  it('should map to snake_case and omit id/timestamps', () => {
    const input: Omit<CustomerVehicle, 'id' | 'createdAt' | 'updatedAt'> = {
      customerUserId: 'cust-1',
      isPrimary: false,
      name: 'HONDA CBR',
      year: '2020',
      engine: 'E-1',
      km: '5,000 km',
      mods: '原廠',
      service: null,
      dictBrandName: 'HONDA',
      dictModelName: 'CBR',
    };
    expect(mapVehicleToInsertRow(input)).toEqual({
      customer_user_id: 'cust-1',
      is_primary: false,
      name: 'HONDA CBR',
      year: '2020',
      engine: 'E-1',
      km: '5,000 km',
      mods: '原廠',
      service: null,
      dict_brand_name: 'HONDA',
      dict_model_name: 'CBR',
    });
  });
});

describe('mapVehiclePatchToRow', () => {
  it('should map only present keys', () => {
    expect(mapVehiclePatchToRow({ isPrimary: true, km: '20,000 km' })).toEqual({
      is_primary: true,
      km: '20,000 km',
    });
  });

  it('should ignore customerUserId / id / timestamps even if present', () => {
    const row = mapVehiclePatchToRow({
      customerUserId: 'other',
      id: 'x',
      createdAt: 'y',
      updatedAt: 'z',
      name: 'keep',
    } as Partial<CustomerVehicle>);
    expect(row).toEqual({ name: 'keep' });
  });

  it('should produce empty object for empty patch', () => {
    expect(mapVehiclePatchToRow({})).toEqual({});
  });

  // V-1d REQUIRED-1(值班台):dict 對「帶到就恆寫」— 雙 null 也要顯式落 row(dict 車改自由輸入
  // 存檔 → 舊對被 NULL 覆蓋、不殘留);undefined(非表單路徑)才略過。
  it('dict 對雙 null → row 顯式帶 null(覆蓋殘留);undefined → 略過', () => {
    expect(mapVehiclePatchToRow({ dictBrandName: null, dictModelName: null })).toEqual({
      dict_brand_name: null,
      dict_model_name: null,
    });
    expect(mapVehiclePatchToRow({ name: 'x' })).toEqual({ name: 'x' });
  });

  it('dict 對有值 → row 逐字帶入', () => {
    expect(mapVehiclePatchToRow({ dictBrandName: 'YAMAHA', dictModelName: 'YZF-R6' })).toEqual({
      dict_brand_name: 'YAMAHA',
      dict_model_name: 'YZF-R6',
    });
  });
});
