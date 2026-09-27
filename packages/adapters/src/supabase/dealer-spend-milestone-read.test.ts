// Sean 2026-09-27 E2 甲:經銷會員(tier=store)累積 = 已出貨訂單的商品金額(小計減折扣)扣已確認退款;滿 10 萬通知 Sean。
import { describe, expect, it } from 'vitest';

import { countDealersOverMilestone, readDealerSpendMilestoneCount, type SpendReadClient } from './dealer-spend-milestone-read';

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';

describe('countDealersOverMilestone', () => {
  it('小計減折扣加總, 扣掉已確認的卡退款與未作廢的人工退款;剛好 10 萬算', () => {
    const n = countDealersOverMilestone({
      orders: [
        { id: 'o1', customer_user_id: A, subtotal: 80_000, discount_total: 0 },
        { id: 'o2', customer_user_id: A, subtotal: 30_000, discount_total: 5_000 },
        { id: 'o3', customer_user_id: B, subtotal: 120_000, discount_total: 0 },
      ],
      cardRefunds: [{ order_id: 'o3', refund_amount: 25_000 }],
      manualRefunds: [{ order_id: 'o1', refund_amount: 5_000 }],
      threshold: 100_000,
    });
    // A = 80,000 + 25,000 − 5,000 = 100,000(算);B = 120,000 − 25,000 = 95,000(不算)
    expect(n).toBe(1);
  });
});

function fakeClient(tables: Record<string, unknown[]>, calls: string[] = []): SpendReadClient {
  const chain = (table: string) => {
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (calls.push(`${table}.eq.${c}=${String(v)}`), q),
      is: (c: string, v: unknown) => (calls.push(`${table}.is.${c}=${String(v)}`), q),
      in: (c: string) => (calls.push(`${table}.in.${c}`), q),
      limit: () => q,
      then: (res: (v: { data: unknown[]; error: null }) => unknown) => res({ data: tables[table] ?? [], error: null }),
    };
    return q;
  };
  return { from: (t: string) => chain(t) } as unknown as SpendReadClient;
}

describe('readDealerSpendMilestoneCount', () => {
  it('只查車行(tier=store)且沒停用的會員、已出貨且沒取消的訂單、已確認且沒作廢的卡退款', async () => {
    const calls: string[] = [];
    const n = await readDealerSpendMilestoneCount(
      fakeClient(
        {
          customers: [{ user_id: A }],
          orders: [{ id: 'o1', customer_user_id: A, subtotal: 150_000, discount_total: 0 }],
          order_refunds: [],
          order_manual_refunds: [],
        },
        calls,
      ),
    );
    expect(n).toBe(1);
    expect(calls).toEqual(
      expect.arrayContaining([
        'customers.eq.tier=store',
        'customers.is.disabled_at=null',
        'orders.eq.fulfillment_status=shipped',
        'orders.is.cancelled_at=null',
        'order_refunds.eq.status=confirmed',
        'order_refunds.is.voided_at=null',
        'order_manual_refunds.is.voided_at=null',
      ]),
    );
  });

  it('沒有車行會員 ⇒ 0, 不查訂單', async () => {
    const calls: string[] = [];
    expect(await readDealerSpendMilestoneCount(fakeClient({ customers: [] }, calls))).toBe(0);
    expect(calls.some((c) => c.startsWith('orders.'))).toBe(false);
  });

  it('🔴 讀到單次上限(1000 列)⇒ throw(當成讀不到), 不給偏少的數', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `o${i}`, customer_user_id: A, subtotal: 1, discount_total: 0 }));
    await expect(
      readDealerSpendMilestoneCount(fakeClient({ customers: [{ user_id: A }], orders: many, order_refunds: [], order_manual_refunds: [] })),
    ).rejects.toThrow();
  });
});
