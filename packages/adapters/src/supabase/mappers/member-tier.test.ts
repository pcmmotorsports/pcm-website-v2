// member-tier.test.ts — `#879`:adapter 邊界的 tier runtime 收窄
//
// 🔴 這一組守的是一個**沒有回饋路徑**的缺陷:未知 tier 流進 admin 的
//    `Record<MemberTier, string>` 查表 ⇒ 得到 `undefined` ⇒ **畫面上少一格字,不 throw**。
//    ⇒ 沒有人會通報 ⇒ **只有測試看得見。**

import { describe, expect, it, vi } from 'vitest';
import { narrowMemberTier } from './member-tier';
import { mapSupabaseCustomerToDomain, type SupabaseCustomerRow } from './customer';

const row = (tier: unknown): SupabaseCustomerRow =>
  ({
    user_id: 'uuid-1',
    email: 'a@example.com',
    name: '王小明',
    phone: '0912345678',
    birthday: '1990-01-01',
    tier,
    wallet_balance: 0,
    total_deposit: 0,
    created_at: '2026-05-23T00:00:00Z',
    updated_at: '2026-05-23T01:00:00Z',
  }) as unknown as SupabaseCustomerRow;

describe('narrowMemberTier', () => {
  // 🔴 **三個值都要跑** —— 只驗一個值是本窗今晚被打中的第三次(`#873` code-reviewer nit)。
  it.each(['general', 'store', 'premiumStore'] as const)('%s ⇒ 原樣', (t) => {
    expect(narrowMemberTier(t, 'test')).toBe(t);
  });

  it('🔴 認不得 ⇒ 退成 general,而且留一行 log', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(narrowMemberTier('platinumDealer', 'test/where')).toBe('general');
      expect(spy).toHaveBeenCalled();
      // 呼叫點識別字要真的進 log —— 否則三個呼叫點的 log 長得一樣,查不出是哪一條路漂了
      expect(String(spy.mock.calls[0]?.[0])).toContain('test/where');
    } finally {
      spy.mockRestore();
    }
  });

  it('🔴 對照組:三個合法值都不得留 log(否則上面那格的 log 斷言是恆真的)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const t of ['general', 'store', 'premiumStore'] as const) narrowMemberTier(t, 'test');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('`#879` · 收窄真的接在 mapper 上(不是只有 helper 自己會做)', () => {
  it('🔴 mapSupabaseCustomerToDomain 拿到未知 tier ⇒ 回 general', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(mapSupabaseCustomerToDomain(row('platinumDealer')).tier).toBe('general');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('🔴 對照組:三個合法 tier 原樣傳出、且零 log(擋「一律回 general」與「恆真 log」)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const t of ['general', 'store', 'premiumStore'] as const) {
        expect(mapSupabaseCustomerToDomain(row(t)).tier).toBe(t);
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
