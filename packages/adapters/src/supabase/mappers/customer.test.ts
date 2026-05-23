import { describe, expect, it } from 'vitest';
import {
  mapCustomerPatchToRow,
  mapSupabaseCustomerToDomain,
  type SupabaseCustomerRow,
} from './customer';

const fullRow: SupabaseCustomerRow = {
  user_id: 'uuid-1',
  email: 'a@example.com',
  name: '王小明',
  phone: '0912345678',
  birthday: '1990-01-01',
  tier: 'store',
  wallet_balance: 30000,
  total_deposit: 50000,
  created_at: '2026-05-23T00:00:00Z',
  updated_at: '2026-05-23T01:00:00Z',
};

describe('mapSupabaseCustomerToDomain', () => {
  it('should rename snake_case columns to camelCase domain fields', () => {
    const c = mapSupabaseCustomerToDomain(fullRow);
    expect(c.id).toBe('uuid-1');
    expect(c.walletBalance).toBe(30000);
    expect(c.totalDeposit).toBe(50000);
    expect(c.createdAt).toBe('2026-05-23T00:00:00Z');
    expect(c.updatedAt).toBe('2026-05-23T01:00:00Z');
    expect(c.tier).toBe('store');
  });

  it('should coalesce null phone to empty string', () => {
    const c = mapSupabaseCustomerToDomain({ ...fullRow, phone: null });
    expect(c.phone).toBe('');
  });

  it('should pass null birthday through as null', () => {
    const c = mapSupabaseCustomerToDomain({ ...fullRow, birthday: null });
    expect(c.birthday).toBeNull();
  });
});

describe('mapCustomerPatchToRow', () => {
  it('should include only present keys', () => {
    expect(mapCustomerPatchToRow({ name: '新名' })).toEqual({ name: '新名' });
  });

  it('should map all three editable fields when present', () => {
    expect(mapCustomerPatchToRow({ name: 'n', phone: 'p', birthday: '2000-12-31' })).toEqual({
      name: 'n',
      phone: 'p',
      birthday: '2000-12-31',
    });
  });

  it('should not emit updated_at (handled by DB trigger)', () => {
    const row = mapCustomerPatchToRow({ name: 'n' });
    expect(row).not.toHaveProperty('updated_at');
  });

  it('should produce empty object for empty patch', () => {
    expect(mapCustomerPatchToRow({})).toEqual({});
  });
});
