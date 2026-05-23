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
});
