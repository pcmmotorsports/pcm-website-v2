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

type Row = Record<string, unknown>;

/**
 * 假 PostgREST:真的套用 eq / is / in / gte / lt 與 range(maxRows 模擬伺服器每次最多回幾列)。
 * 過濾不套的話, 「讀錯欄位」的寫法照樣會綠(R1 必修 1 就是這樣漏掉的)。
 */
function fakeClient(tables: Record<string, Row[]>, calls: string[] = [], maxRows = 1000): SpendReadClient {
  const chain = (table: string) => {
    let rows = tables[table] ?? [];
    let from = 0;
    let to = Infinity;
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (calls.push(`${table}.eq.${c}=${String(v)}`), (rows = rows.filter((r) => r[c] === v)), q),
      is: (c: string, v: null) => (calls.push(`${table}.is.${c}=${String(v)}`), (rows = rows.filter((r) => (r[c] ?? null) === v)), q),
      in: (c: string, vs: readonly string[]) => (calls.push(`${table}.in.${c}`), (rows = rows.filter((r) => vs.includes(r[c] as string))), q),
      gte: (c: string, v: string) => (calls.push(`${table}.gte.${c}=${v}`), (rows = rows.filter((r) => String(r[c]) >= v)), q),
      lt: (c: string, v: string) => (calls.push(`${table}.lt.${c}=${v}`), (rows = rows.filter((r) => String(r[c]) < v)), q),
      order: () => q,
      range: (f: number, t: number) => ((from = f), (to = t), q),
      then: (res: (v: { data: Row[]; error: null }) => unknown) =>
        res({ data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null }),
    };
    return q;
  };
  return { from: (t: string) => chain(t) } as unknown as SpendReadClient;
}

const NOW = new Date('2026-09-27T13:00:05Z');
const IN_WINDOW = '2026-09-27T05:00:00.000Z';
const BEFORE_WINDOW = '2026-09-26T05:00:00.000Z';

const member = (user_id: string, extra: Row = {}): Row => ({ user_id, tier: 'general', disabled_at: null, ...extra });
/** 🔴 fulfillment_status 恆為 notOrdered:正式站那一欄從來沒被推進過(SupabaseOrderAdapter.ts「正式站全是 notOrdered」)。 */
const order = (id: string, user: string, subtotal: number, extra: Row = {}): Row => ({
  id,
  customer_user_id: user,
  subtotal,
  discount_total: 0,
  cancelled_at: null,
  fulfillment_status: 'notOrdered',
  goods_axis: 'shipped',
  ...extra,
});
/** 一張訂單一箱:包裹 s-<id> → 品項 i-<id> → 訂單 <id>。 */
function shippedIn(orderId: string, user: string, at: string, extra: Row = {}) {
  return {
    shipments: [{ id: `s-${orderId}`, customer_user_id: user, deleted_at: null, shipped_at: at, ...extra }],
    shipment_items: [{ id: `si-${orderId}`, shipment_id: `s-${orderId}`, order_item_id: `i-${orderId}` }],
    order_items: [{ id: `i-${orderId}`, order_id: orderId }],
  };
}

function db(parts: { customers: Row[]; orders: Row[]; ships?: ReturnType<typeof shippedIn>[]; cardRefunds?: Row[]; manualRefunds?: Row[] }) {
  const ships = parts.ships ?? [];
  return {
    customers: parts.customers,
    admin_order_list_v: parts.orders,
    order_refunds: parts.cardRefunds ?? [],
    order_manual_refunds: parts.manualRefunds ?? [],
    shipments: ships.flatMap((s) => s.shipments),
    shipment_items: ships.flatMap((s) => s.shipment_items),
    order_items: ships.flatMap((s) => s.order_items),
  };
}

describe('readNewMilestoneMemberCount', () => {
  it('🔴 已出貨看 goods_axis(依品項出貨量), 不看從來沒被推進的 fulfillment_status', async () => {
    const calls: string[] = [];
    const n = await readNewMilestoneMemberCount(
      fakeClient(db({ customers: [member(A)], orders: [order('o1', A, 150_000)], ships: [shippedIn('o1', A, IN_WINDOW)] }), calls),
      NOW,
    );
    expect(n).toBe(1);
    expect(calls).toEqual(
      expect.arrayContaining([
        'customers.eq.tier=general',
        'customers.is.disabled_at=null',
        'admin_order_list_v.eq.goods_axis=shipped',
        'admin_order_list_v.is.cancelled_at=null',
        'order_refunds.eq.status=confirmed',
        'order_refunds.is.voided_at=null',
        'order_manual_refunds.is.voided_at=null',
        'shipments.is.deleted_at=null',
        'shipments.gte.shipped_at=2026-09-27T01:00:00.000Z',
        'shipments.lt.shipped_at=2026-09-27T13:00:00.000Z',
      ]),
    );
    expect(calls.some((c) => c.includes('fulfillment_status'))).toBe(false);
  });

  it('還沒全部出貨(goods_axis 不是 shipped)、已取消 ⇒ 不算', async () => {
    const n = await readNewMilestoneMemberCount(
      fakeClient(
        db({
          customers: [member(A), member(B)],
          orders: [order('o1', A, 150_000, { goods_axis: 'instock' }), order('o2', B, 150_000, { cancelled_at: IN_WINDOW })],
          ships: [shippedIn('o1', A, IN_WINDOW), shippedIn('o2', B, IN_WINDOW)],
        }),
      ),
      NOW,
    );
    expect(n).toBe(0);
  });

  it('經銷會員、已停用的會員 ⇒ 不算', async () => {
    const n = await readNewMilestoneMemberCount(
      fakeClient(
        db({
          customers: [member(A, { tier: 'store' }), member(B, { disabled_at: BEFORE_WINDOW })],
          orders: [order('o1', A, 150_000), order('o2', B, 150_000)],
          ships: [shippedIn('o1', A, IN_WINDOW), shippedIn('o2', B, IN_WINDOW)],
        }),
      ),
      NOW,
    );
    expect(n).toBe(0);
  });

  it('早就滿 10 萬、這一班沒有新出貨 ⇒ 0(不重複提醒)', async () => {
    const n = await readNewMilestoneMemberCount(
      fakeClient(db({ customers: [member(A)], orders: [order('o1', A, 150_000)], ships: [shippedIn('o1', A, BEFORE_WINDOW)] })),
      NOW,
    );
    expect(n).toBe(0);
  });

  it('🔴 這一班寄出的那一箱已作廢(deleted_at)⇒ 不算這一班出貨;與 goods_axis 同一個「作廢不算」', async () => {
    const n = await readNewMilestoneMemberCount(
      fakeClient(
        db({
          customers: [member(A)],
          orders: [order('o1', A, 150_000)],
          ships: [shippedIn('o1', A, IN_WINDOW, { deleted_at: IN_WINDOW })],
        }),
      ),
      NOW,
    );
    expect(n).toBe(0);
  });

  it('沒有人滿 10 萬 ⇒ 0, 不查出貨', async () => {
    const calls: string[] = [];
    const n = await readNewMilestoneMemberCount(
      fakeClient(db({ customers: [member(A)], orders: [order('o1', A, 50_000)], ships: [shippedIn('o1', A, IN_WINDOW)] }), calls),
      NOW,
    );
    expect(n).toBe(0);
    expect(calls.some((c) => c.startsWith('shipments.'))).toBe(false);
  });

  it('🔴 分頁讀完:超過 1000 列, 以及伺服器每次最多只回 300 列時, 都不漏算', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => order(`o${i}`, A, 40));
    // 2500 × 40 = 100,000;少讀一頁就不滿 10 萬 ⇒ 0 位
    const tables = db({ customers: [member(A)], orders: many, ships: [shippedIn('o2499', A, IN_WINDOW)] });
    expect(await readNewMilestoneMemberCount(fakeClient(tables), NOW)).toBe(1);
    expect(await readNewMilestoneMemberCount(fakeClient(tables, [], 300), NOW)).toBe(1);
  });
});
