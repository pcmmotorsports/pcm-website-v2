// Sean 2026-09-27 更正 E 選丙:一般會員(tier=general)累積 = 已出貨訂單的商品金額(小計減折扣)扣已確認退款;
// 「這一班新跨過 10 萬」的人數進 LINE 摘要, 只提醒一次。
import { describe, expect, it } from 'vitest';

import {
  countNewlyOverMilestone,
  digestWindow,
  readNewMilestoneMemberCount,
  type SpendReadClient,
} from './member-spend-milestone-read';

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const C = 'cccccccc-0000-0000-0000-000000000003';

describe('countNewlyOverMilestone', () => {
  it('小計減折扣加總、扣卡退款與人工退款;只算「扣掉這一班才出貨的訂單後 < 10 萬」的人', () => {
    const n = countNewlyOverMilestone({
      orders: [
        { id: 'a1', customer_user_id: A, subtotal: 80_000, discount_total: 0 },
        { id: 'a2', customer_user_id: A, subtotal: 30_000, discount_total: 5_000 },
        { id: 'b1', customer_user_id: B, subtotal: 150_000, discount_total: 0 },
        { id: 'b2', customer_user_id: B, subtotal: 10_000, discount_total: 0 },
        { id: 'c1', customer_user_id: C, subtotal: 120_000, discount_total: 0 },
      ],
      cardRefunds: [{ order_id: 'c1', refund_amount: 25_000 }],
      manualRefunds: [{ order_id: 'a1', refund_amount: 5_000 }],
      recentOrderIds: new Set(['a2', 'b2', 'c1']),
      threshold: 100_000,
    });
    // A = 75,000 + 25,000 = 100,000(剛好算), 扣掉這班的 a2 ⇒ 75,000 < 10 萬 ⇒ 新滿, 算
    // B = 160,000, 扣掉 b2 ⇒ 150,000 ≥ 10 萬 ⇒ 之前就滿了, 不算(不重複提醒)
    // C = 120,000 − 25,000 = 95,000 ⇒ 沒滿, 不算
    expect(n).toBe(1);
  });
});

describe('digestWindow', () => {
  it('對齊排程 0 1,13 * * *(UTC):上一班到這一班, 半開區間', () => {
    expect(digestWindow(new Date('2026-09-27T13:00:07Z'))).toEqual({
      since: new Date('2026-09-27T01:00:00Z'),
      until: new Date('2026-09-27T13:00:00Z'),
    });
    expect(digestWindow(new Date('2026-09-27T01:00:03Z'))).toEqual({
      since: new Date('2026-09-26T13:00:00Z'),
      until: new Date('2026-09-27T01:00:00Z'),
    });
    // 手動在凌晨 00:30 UTC 跑 ⇒ 歸到前一天 13:00 那一班
    expect(digestWindow(new Date('2026-09-27T00:30:00Z'))).toEqual({
      since: new Date('2026-09-26T01:00:00Z'),
      until: new Date('2026-09-26T13:00:00Z'),
    });
  });
});

function fakeClient(tables: Record<string, unknown[]>, calls: string[] = []): SpendReadClient {
  const chain = (table: string) => {
    let from = 0;
    let to = Infinity;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (calls.push(`${table}.eq.${c}=${String(v)}`), q),
      is: (c: string, v: unknown) => (calls.push(`${table}.is.${c}=${String(v)}`), q),
      in: (c: string) => (calls.push(`${table}.in.${c}`), q),
      gte: (c: string, v: unknown) => (calls.push(`${table}.gte.${c}=${String(v)}`), q),
      lt: (c: string, v: unknown) => (calls.push(`${table}.lt.${c}=${String(v)}`), q),
      order: () => q,
      range: (f: number, t: number) => ((from = f), (to = t), q),
      then: (res: (v: { data: unknown[]; error: null }) => unknown) =>
        res({ data: (tables[table] ?? []).slice(from, to + 1), error: null }),
    };
    return q;
  };
  return { from: (t: string) => chain(t) } as unknown as SpendReadClient;
}

const NOW = new Date('2026-09-27T13:00:05Z');

describe('readNewMilestoneMemberCount', () => {
  it('只查一般會員(tier=general)且沒停用、已出貨沒取消的訂單、已確認沒作廢的退款、這一班的出貨', async () => {
    const calls: string[] = [];
    const n = await readNewMilestoneMemberCount(
      fakeClient(
        {
          customers: [{ user_id: A }],
          orders: [{ id: 'o1', customer_user_id: A, subtotal: 150_000, discount_total: 0 }],
          order_refunds: [],
          order_manual_refunds: [],
          shipments: [{ id: 's1' }],
          shipment_items: [{ order_item_id: 'i1' }],
          order_items: [{ order_id: 'o1' }],
        },
        calls,
      ),
      NOW,
    );
    expect(n).toBe(1);
    expect(calls).toEqual(
      expect.arrayContaining([
        'customers.eq.tier=general',
        'customers.is.disabled_at=null',
        'orders.eq.fulfillment_status=shipped',
        'orders.is.cancelled_at=null',
        'order_refunds.eq.status=confirmed',
        'order_refunds.is.voided_at=null',
        'order_manual_refunds.is.voided_at=null',
        'shipments.is.deleted_at=null',
        'shipments.gte.shipped_at=2026-09-27T01:00:00.000Z',
        'shipments.lt.shipped_at=2026-09-27T13:00:00.000Z',
      ]),
    );
  });

  it('經銷會員(不在一般會員名單)的訂單不算', async () => {
    const n = await readNewMilestoneMemberCount(
      fakeClient({
        customers: [{ user_id: A }],
        orders: [{ id: 'o1', customer_user_id: B, subtotal: 150_000, discount_total: 0 }],
        order_refunds: [],
        order_manual_refunds: [],
        shipments: [{ id: 's1' }],
        shipment_items: [{ order_item_id: 'i1' }],
        order_items: [{ order_id: 'o1' }],
      }),
      NOW,
    );
    expect(n).toBe(0);
  });

  it('早就滿 10 萬、這一班沒有新出貨 ⇒ 0(不重複提醒), 不查出貨明細', async () => {
    const calls: string[] = [];
    const n = await readNewMilestoneMemberCount(
      fakeClient(
        {
          customers: [{ user_id: A }],
          orders: [{ id: 'o1', customer_user_id: A, subtotal: 150_000, discount_total: 0 }],
          order_refunds: [],
          order_manual_refunds: [],
          shipments: [],
        },
        calls,
      ),
      NOW,
    );
    expect(n).toBe(0);
    expect(calls.some((c) => c.startsWith('shipment_items.'))).toBe(false);
  });

  it('沒有人滿 10 萬 ⇒ 0, 不查出貨', async () => {
    const calls: string[] = [];
    const n = await readNewMilestoneMemberCount(
      fakeClient(
        {
          customers: [{ user_id: A }],
          orders: [{ id: 'o1', customer_user_id: A, subtotal: 50_000, discount_total: 0 }],
          order_refunds: [],
          order_manual_refunds: [],
        },
        calls,
      ),
      NOW,
    );
    expect(n).toBe(0);
    expect(calls.some((c) => c.startsWith('shipments.'))).toBe(false);
  });

  it('🔴 超過 1000 列會分頁讀完, 不會漏算第 1001 筆之後的訂單', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({ id: `o${i}`, customer_user_id: A, subtotal: 40, discount_total: 0 }));
    // 2500 × 40 = 100,000;只讀第一頁會得到 40,000 ⇒ 0 位
    const n = await readNewMilestoneMemberCount(
      fakeClient({
        customers: [{ user_id: A }],
        orders: many,
        order_refunds: [],
        order_manual_refunds: [],
        shipments: [{ id: 's1' }],
        shipment_items: [{ order_item_id: 'i1' }],
        order_items: [{ order_id: 'o2499' }],
      }),
      NOW,
    );
    expect(n).toBe(1);
  });
});
