// SupabaseCustomerAdapter.test.ts — admin 客戶列表摘要(M-4a 客戶管理第一片)。
//
// 聚焦本片新增的 listCustomerSummariesForAdmin + ADMIN_CUSTOMER_LIST_SELECT 白名單守門
// (既有 findById/findByEmail/update 不在本片範圍)。mock 注入式 SupabaseClient 攔查詢鏈:
// from('customers').select(ADMIN_CUSTOMER_LIST_SELECT,{count}).eq(...)?.order('created_at',desc).range(offset,offset+limit-1)。

import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseCustomerAdapter, ADMIN_CUSTOMER_LIST_SELECT } from './SupabaseCustomerAdapter';

// eq 可鏈(回自身 builder);order 回 {range};range 為終端、await 回 {data, error, count}。
function makeAdminListClient(result: { data: unknown; error: unknown; count: number | null }) {
  const range = vi.fn().mockResolvedValue(result);
  const order = vi.fn().mockReturnValue({ range });
  const eq = vi.fn();
  const builder = { eq, order };
  eq.mockReturnValue(builder);
  const select = vi.fn().mockReturnValue(builder);
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, eq, order, range };
}

describe('SupabaseCustomerAdapter.listCustomerSummariesForAdmin + ADMIN_CUSTOMER_LIST_SELECT 守門', () => {
  it('🔴 鐵則 12:ADMIN_CUSTOMER_LIST_SELECT byte-equal 白名單(排除 wallet/儲值/成本欄)', () => {
    expect(ADMIN_CUSTOMER_LIST_SELECT).toBe('user_id, name, email, phone, tier, created_at');
  });

  it('🔴 投影不含 wallet_balance / total_deposit(#202 HOLD)/ 任何成本欄、且無 select("*")', () => {
    const forbidden = [
      '*',
      'wallet_balance',
      'total_deposit',
      'price_store',
      'price_by_tier',
      'cost',
    ];
    for (const token of forbidden) {
      expect(ADMIN_CUSTOMER_LIST_SELECT).not.toContain(token);
    }
  });

  it('查詢鏈 customers / select(ADMIN_CUSTOMER_LIST_SELECT,{count:exact}) / tier eq 下推 / order(created_at desc) / range(offset,offset+limit-1);row → AdminCustomerSummary', async () => {
    const { client, from, select, eq, order, range } = makeAdminListClient({
      data: [
        {
          user_id: 'u1',
          name: '王小明',
          email: 'ming@example.com',
          phone: '0912345678',
          tier: 'premiumStore',
          created_at: '2099-04-15T10:00:00Z',
        },
      ],
      error: null,
      count: 88,
    });

    const res = await new SupabaseCustomerAdapter(client).listCustomerSummariesForAdmin(
      { tier: 'premiumStore' },
      { limit: 20, offset: 40 },
    );

    expect(from).toHaveBeenCalledWith('customers');
    expect(select).toHaveBeenCalledWith(ADMIN_CUSTOMER_LIST_SELECT, { count: 'exact' });
    expect(eq).toHaveBeenCalledWith('tier', 'premiumStore');
    expect(eq).toHaveBeenCalledTimes(1);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(range).toHaveBeenCalledWith(40, 59);
    expect(res).toEqual({
      items: [
        {
          id: 'u1',
          name: '王小明',
          email: 'ming@example.com',
          phone: '0912345678',
          tier: 'premiumStore',
          createdAt: '2099-04-15T10:00:00Z',
        },
      ],
      total: 88,
    });
  });

  it('無 tier 篩選 → 完全不下推 eq(全表);offset 預設 0 → range(0, limit-1);phone null 直送', async () => {
    const { client, eq, range } = makeAdminListClient({
      data: [
        {
          user_id: 'u2',
          name: '陳大文',
          email: 'wen@example.com',
          phone: null,
          tier: 'general',
          created_at: '2099-05-01T00:00:00Z',
        },
      ],
      error: null,
      count: 1,
    });
    const res = await new SupabaseCustomerAdapter(client).listCustomerSummariesForAdmin(
      {},
      { limit: 20 },
    );
    expect(eq).not.toHaveBeenCalled();
    expect(range).toHaveBeenCalledWith(0, 19);
    expect(res.items[0]?.phone).toBeNull();
    expect(res.total).toBe(1);
  });

  it('查詢 error → 裸 throw(caller〔admin 頁〕try/catch 退錯誤態、頁面不 500)', async () => {
    const { client } = makeAdminListClient({
      data: null,
      error: new Error('connection refused'),
      count: null,
    });
    await expect(
      new SupabaseCustomerAdapter(client).listCustomerSummariesForAdmin({}, { limit: 20 }),
    ).rejects.toThrow();
  });
});
