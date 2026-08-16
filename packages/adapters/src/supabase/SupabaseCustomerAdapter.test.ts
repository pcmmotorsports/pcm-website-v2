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
    // 🔴 **本格 2026-08-16 改過:多了三欄**(客戶頁三欄,讀 `admin_customer_list_v`)。
    //    ⚠️ 改它是**刻意的**,不是為了讓測試變綠:投影真的多了三個欄位。
    //    而白名單的理由沒有變 —— 見下一格(禁用字元集一個都沒少),
    //    且 view 本身**逐顆列出**那六欄、`wallet_balance`/`total_deposit` 連 view 裡都沒有。
    //
    // 🔴🔴 **這一格是 TS↔TS 的 byte-equal —— 真值在資料庫,而資料庫沒有出現在這一格裡。**
    //    (E 窗 2026-08-16 盤點:`ADMIN_ORDER_LIST_SELECT` 同型,而那是 08-07 正式站
    //     8 小時事故的形狀:應用層先於 DB 上線,守門看不到。)
    //    ⇒ **真值那一半由 `docs/probes/customer-list-select-probe.sh` 守**:
    //      它把**這串字面**送給一個**真的 PostgREST**、對一支**真的用 migration 建出來的 view** 查,
    //      並有兩道負向對照(不存在的欄要 400、`wallet_balance` 要 400)。
    //    ⚠️ 那支跑在拋棄式叢集上 ⇒ **不證正式站**(那支 migration 還沒 apply)。
    expect(ADMIN_CUSTOMER_LIST_SELECT).toBe(
      'user_id, name, email, phone, tier, created_at, ' +
        'active_order_count, active_spend_total, last_active_ordered_at',
    );
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

  it('查詢鏈 admin_customer_list_v / select(ADMIN_CUSTOMER_LIST_SELECT,{count:exact}) / tier eq 下推 / order(created_at desc) / range(offset,offset+limit-1);row → AdminCustomerSummary', async () => {
    const { client, from, select, eq, order, range } = makeAdminListClient({
      data: [
        {
          user_id: 'u1',
          name: '王小明',
          email: 'ming@example.com',
          phone: '0912345678',
          tier: 'premiumStore',
          created_at: '2099-04-15T10:00:00Z',
          active_order_count: 12,
          active_spend_total: 54321,
          last_active_ordered_at: '2099-08-01T03:00:00Z',
        },
      ],
      error: null,
      count: 88,
    });

    const res = await new SupabaseCustomerAdapter(client).listCustomerSummariesForAdmin(
      { tier: 'premiumStore' },
      { limit: 20, offset: 40 },
    );

    // 🔴 **`from` 換成 view 是本片的契約改動,不是測試被改鬆** ——
    //    三欄的值只有 `admin_customer_list_v` 算得出來(`customers` 表沒有那些欄)。
    expect(from).toHaveBeenCalledWith('admin_customer_list_v');
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
          activeOrderCount: 12,
          activeSpendTotal: 54321,
          lastActiveOrderedAt: '2099-08-01T03:00:00Z',
        },
      ],
      total: 88,
      // 🔴 `#525`:沒帶 keyword ⇒ `null`(= **根本沒查**),**不是 `0`**。
      //    `toEqual` 是全等比對 ⇒ 這兩欄漏掉或值錯都會紅,不會靜默通過。
      keywordTruncated: false,
      keywordMatchCount: null,
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

describe('🔴 客戶頁三欄的 null / 零值語意', () => {
  it('零訂單:count 與 sum 是 0,而 lastActiveOrderedAt 是 null(不得被 ?? 0 吃掉)', async () => {
    const { client } = makeAdminListClient({
      data: [
        {
          user_id: 'u2',
          name: '零訂單',
          email: 'zero@example.com',
          phone: null,
          tier: 'general',
          created_at: '2099-01-01T00:00:00Z',
          active_order_count: 0,
          active_spend_total: 0,
          last_active_ordered_at: null,
        },
      ],
      error: null,
      count: 1,
    });
    const res = await new SupabaseCustomerAdapter(client).listCustomerSummariesForAdmin(
      {},
      { limit: 20, offset: 0 },
    );
    // 🔴 這一格守的是「三欄的 null 語意【不一致】是對的」:
    //    0 / 0 / null —— 沒有一個合理的「零日期」,而畫面靠 null 才知道要顯示「從未下單」。
    expect(res.items[0]!.activeOrderCount).toBe(0);
    expect(res.items[0]!.activeSpendTotal).toBe(0);
    expect(res.items[0]!.lastActiveOrderedAt).toBeNull();
  });
});
