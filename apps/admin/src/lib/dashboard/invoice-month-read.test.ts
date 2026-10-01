import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from, rpc: mocks.rpc }),
}));

import { INVOICE_MONTH_ROW_LIMIT, loadInvoiceMonthStats, taipeiMonthRange } from './invoice-month-read';

// 台北 2026-09-13 中午。
const NOW = new Date('2026-09-13T04:00:00Z');

type Call = { fn: string; args: unknown[] };
function makeChain(result: { data?: unknown; count?: unknown; error?: unknown; reject?: unknown }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  for (const fn of ['select', 'eq', 'neq', 'is', 'gte', 'lt', 'limit']) {
    chain[fn] = (...args: unknown[]) => {
      calls.push({ fn, args });
      return chain;
    };
  }
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    result.reject !== undefined
      ? Promise.reject(result.reject).then(res, rej)
      : Promise.resolve({ data: result.data ?? null, count: result.count ?? null, error: result.error ?? null }).then(res, rej);
  return { chain, calls };
}

type RpcResult = { data?: unknown; error?: unknown; reject?: unknown };
/** 兩支撈列照呼叫順序回:① 開票列 ② 沒填日期 count;營業額走 RPC admin_revenue_between。 */
function arm(issued: ReturnType<typeof makeChain>, revenue: RpcResult, missing: ReturnType<typeof makeChain>) {
  mocks.from.mockReturnValueOnce(issued.chain).mockReturnValueOnce(missing.chain);
  mocks.rpc.mockReturnValueOnce(
    revenue.reject !== undefined
      ? Promise.reject(revenue.reject)
      : Promise.resolve({ data: revenue.data ?? null, error: revenue.error ?? null }),
  );
}
const revRow = (revenue: unknown, missing_fee_count: unknown = 0) => ({
  data: [{ received: 0, fees: 0, refunds: 0, revenue, missing_fee_count }],
});

beforeEach(() => vi.clearAllMocks());

describe('taipeiMonthRange', () => {
  it('本月 [1 日, 下月 1 日),台北日界;12 月跨年', () => {
    expect(taipeiMonthRange(NOW)).toEqual({
      month: '2026-09',
      fromYmd: '2026-09-01',
      toYmd: '2026-10-01',
      fromIso: '2026-09-01T00:00:00+08:00',
      toIso: '2026-10-01T00:00:00+08:00',
    });
    expect(taipeiMonthRange(new Date('2026-12-31T16:30:00Z')).month).toBe('2027-01');
    expect(taipeiMonthRange(new Date('2026-12-31T15:30:00Z')).toYmd).toBe('2027-01-01');
  });
});

describe('loadInvoiceMonthStats', () => {
  it('🔴 開票按【開立日】分月只算 issued;營業額走 admin_revenue_between(本月台北月界、按收款日;Sean 2026-10-01);沒填日期 = issued × 日期 NULL', async () => {
    const issued = makeChain({ data: [{ invoice_amount: 300 }, { invoice_amount: null }, { invoice_amount: 700 }] });
    const missing = makeChain({ count: 0 });
    // 3100 刷卡 ⇒ 3023(手續費 77);bigint 經 PostgREST 可能是字串
    arm(issued, { data: [{ received: '3100', fees: '77', refunds: '0', revenue: '3023', missing_fee_count: '0' }] }, missing);

    const out = await loadInvoiceMonthStats(NOW);
    expect(out).toEqual({
      month: '2026-09',
      invoicedAmount: 1000,
      revenueAmount: 3023,
      revenueMissingFeeCount: 0,
      issuedWithoutDateCount: 0,
      truncated: false,
    });
    expect(mocks.from.mock.calls.map((c) => c[0])).toEqual(['orders', 'orders']);
    expect(mocks.rpc.mock.calls).toEqual([
      ['admin_revenue_between', { p_from: '2026-09-01T00:00:00+08:00', p_to: '2026-10-01T00:00:00+08:00' }],
    ]);

    expect(issued.calls).toEqual([
      { fn: 'select', args: ['invoice_amount'] },
      { fn: 'eq', args: ['invoice_status', 'issued'] },
      { fn: 'gte', args: ['invoice_issued_at', '2026-09-01'] },
      { fn: 'lt', args: ['invoice_issued_at', '2026-10-01'] },
      { fn: 'limit', args: [INVOICE_MONTH_ROW_LIMIT + 1] },
    ]);
    expect(missing.calls).toEqual([
      { fn: 'select', args: ['id', { count: 'exact', head: true }] },
      { fn: 'eq', args: ['invoice_status', 'issued'] },
      { fn: 'is', args: ['invoice_issued_at', null] },
    ]);
  });

  it('🔴 上限必須嚴格小於 PostgREST db-max-rows(實測 2000),否則 length > N 恆假、旗標恆不亮', () => {
    expect(INVOICE_MONTH_ROW_LIMIT).toBeLessThan(2000);
  });

  it('撞上限 ⇒ truncated = true(金額仍回,畫面標下限)', async () => {
    const rows = Array.from({ length: INVOICE_MONTH_ROW_LIMIT + 1 }, () => ({ invoice_amount: 1 }));
    arm(makeChain({ data: rows }), revRow(0), makeChain({ count: 0 }));
    const out = await loadInvoiceMonthStats(NOW);
    expect(out.truncated).toBe(true);
    expect(out.invoicedAmount).toBe(INVOICE_MONTH_ROW_LIMIT + 1);
  });

  it('🔴 一支失敗 ⇒ 那格 null 不是 0,另外兩格照算;transport reject 同樣被接住', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    arm(makeChain({ error: { message: 'x' } }), revRow(9), makeChain({ reject: new Error('net') }));
    const out = await loadInvoiceMonthStats(NOW);
    expect(out.invoicedAmount).toBeNull();
    expect(out.revenueAmount).toBe(9);
    expect(out.issuedWithoutDateCount).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('🔴 零列 ⇒ 0(月初常態),不是 null;count 不是安全整數 ⇒ null', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    arm(makeChain({ data: [] }), revRow(0), makeChain({ count: '3' }));
    const out = await loadInvoiceMonthStats(NOW);
    expect(out.invoicedAmount).toBe(0);
    expect(out.revenueAmount).toBe(0);
    expect(out.issuedWithoutDateCount).toBeNull();
    spy.mockRestore();
  });

  it('🔴 營業額 RPC 失敗 / 被拒 ⇒ 營業額與沒有費率筆數都是 null(不是 0),開票照算', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    arm(makeChain({ data: [{ invoice_amount: 5 }] }), { error: { message: 'boom' } }, makeChain({ count: 0 }));
    const a = await loadInvoiceMonthStats(NOW);
    expect([a.invoicedAmount, a.revenueAmount, a.revenueMissingFeeCount]).toEqual([5, null, null]);
    arm(makeChain({ data: [] }), { reject: new Error('net') }, makeChain({ count: 0 }));
    const b = await loadInvoiceMonthStats(NOW);
    expect([b.revenueAmount, b.revenueMissingFeeCount]).toEqual([null, null]);
    spy.mockRestore();
  });

  it('沒有費率的筆數照回(畫面要標示營業額偏高)', async () => {
    arm(makeChain({ data: [] }), revRow(2900, 1), makeChain({ count: 0 }));
    const out = await loadInvoiceMonthStats(NOW);
    expect(out.revenueAmount).toBe(2900);
    expect(out.revenueMissingFeeCount).toBe(1);
  });
});
