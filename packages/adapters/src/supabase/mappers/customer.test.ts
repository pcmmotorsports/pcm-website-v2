import { describe, expect, it, vi } from 'vitest';
import {
  mapCustomerPatchToRow,
  mapSupabaseCustomerToDomain,
  type SupabaseCustomerRow,
  narrowGender,
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
// ══ 🔴🔴 `:573` 性別(2026-09-01;codex R1 must-fix「narrowGender 或 mapper 整段壞掉都可能全綠」)══
describe('narrowGender 與 gender 的 patch 白名單', () => {
  it('🟢 三個合法代碼原樣通過', () => {
    for (const v of ['male', 'female', 'undisclosed'] as const) {
      expect(narrowGender(v, 'test')).toBe(v);
    }
  });

  it('null / undefined ⇒ null(兩者都是「沒有值」)', () => {
    expect(narrowGender(null, 'test')).toBeNull();
    expect(narrowGender(undefined, 'test')).toBeNull();
  });

  // 🔴 這一格是判別力所在:認不得的值**不得原樣帶進 domain** ——
  //    帶進去的話,下游每一個 switch 都會落到它沒寫的分支,而那時已經離這裡很遠了。
  it('🔴 認不得的值 ⇒ null,而且【留下 console.error】(降級要留鑑識,不得靜默)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(narrowGender('男', 'test')).toBeNull();
    expect(narrowGender('other', 'test')).toBeNull();
    expect(narrowGender(123, 'test')).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('🔴 patch 沒送 gender ⇒ row 裡【不得出現這個 key】(不是設成 null)', () => {
    const row = mapCustomerPatchToRow({ name: '王' });
    expect('gender' in row).toBe(false);
  });

  // 🟢 正對照 —— 沒有它,上面那格在「gender 永遠不寫」時也會綠。
  it('🟢 patch 送了 gender ⇒ 進 row;送 null ⇒ 也要進(那是明確的清空)', () => {
    expect(mapCustomerPatchToRow({ gender: 'female' }).gender).toBe('female');
    const cleared = mapCustomerPatchToRow({ gender: null });
    expect('gender' in cleared).toBe(true);
    expect(cleared.gender).toBeNull();
  });
});

