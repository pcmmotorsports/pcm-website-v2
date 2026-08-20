// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
//
// M-4a E2a-2(W3-G 拆出)寄送前 ineligible gate 的 adapter 測試。只驗查詢字面(mock 不執行
// PostgREST 過濾語意,效度限定見本檔對應的 adapter 檔頭)。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  SupabaseIneligibleOrderEmailScannerAdapter,
  type IneligibleOrderEmailScannerClient,
} from './SupabaseIneligibleOrderEmailScannerAdapter';

type Resp = { data: unknown; error: { message: string; code?: string } | null };

/** 鏈式 thenable builder mock(鏡像 SupabasePaidOrderScannerAdapter.test.ts,加 `.lte`/`.or`)。 */
function makeBuilder(result: Resp) {
  const calls: Array<[string, unknown[]]> = [];
  const b: Record<string, unknown> = { calls };
  let limit: number | null = null;
  for (const m of ['select', 'eq', 'gte', 'lte', 'in', 'or', 'order', 'limit']) {
    b[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args]);
      if (m === 'limit' && typeof args[0] === 'number') limit = args[0];
      return b;
    });
  }
  b.then = (resolve: (v: Resp) => unknown) => {
    const data = limit !== null && Array.isArray(result.data) ? result.data.slice(0, limit) : result.data;
    return Promise.resolve({ ...result, data }).then(resolve);
  };
  return b as unknown as { calls: Array<[string, unknown[]]> };
}

function makeClient(...builders: Array<{ calls: Array<[string, unknown[]]> }>) {
  const from = vi.fn();
  for (const b of builders) from.mockReturnValueOnce(b);
  return { client: { from } as unknown as IneligibleOrderEmailScannerClient, from };
}

function argsOf(b: { calls: Array<[string, unknown[]]> }, method: string): unknown[][] {
  return b.calls.filter(([m]) => m === method).map(([, args]) => args);
}

const DUE_ROW = { id: 'outbox-1', order_id: 'order-1', attempts: 1, max_attempts: 5 };

describe('SupabaseIneligibleOrderEmailScannerAdapter — 查詢字面', () => {
  it('🔴 orders 述詞照 plan 拍板原文:payment_status.eq.refunded,cancelled_at.not.is.null(不含 partiallyRefunded)', async () => {
    const dueRows = makeBuilder({ data: [DUE_ROW], error: null });
    const orders = makeBuilder({ data: [{ id: 'order-1' }], error: null });
    const { client, from } = makeClient(dueRows, orders);

    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(from.mock.calls.map(([t]) => t)).toEqual(['email_outbox', 'orders']);
    expect(argsOf(orders, 'or')).toEqual([['payment_status.eq.refunded,cancelled_at.not.is.null']]);
    expect(argsOf(orders, 'in')).toEqual([['id', ['order-1']]]);
  });

  it('email_outbox due 述詞:status in pending/failed,next_retry_at <= now', async () => {
    const dueRows = makeBuilder({ data: [], error: null });
    const { client } = makeClient(dueRows);

    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(argsOf(dueRows, 'in')).toEqual([['status', ['pending', 'failed']]]);
    expect(argsOf(dueRows, 'lte')[0]![0]).toBe('next_retry_at');
  });

  it('🔴 codex 關卡2 must-fix:due 掃描帶 order(next_retry_at asc)—— 最舊(最可能死透)的列先進窗口', async () => {
    const dueRows = makeBuilder({ data: [], error: null });
    const { client } = makeClient(dueRows);

    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(argsOf(dueRows, 'order')).toEqual([['next_retry_at', { ascending: true }]]);
  });

  it('零 due 列 ⇒ 不去查 orders(沒有候選需要核對合格性)', async () => {
    const dueRows = makeBuilder({ data: [], error: null });
    const { client, from } = makeClient(dueRows);

    const res = await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(res).toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('🔴 due 列的 attempts >= max_attempts(死列)⇒ app 層濾掉,不進 orders 候選集', async () => {
    const deadRow = { id: 'outbox-dead', order_id: 'order-2', attempts: 5, max_attempts: 5 };
    const dueRows = makeBuilder({ data: [DUE_ROW, deadRow], error: null });
    const orders = makeBuilder({ data: [{ id: 'order-1' }, { id: 'order-2' }], error: null });
    const { client } = makeClient(dueRows, orders);

    await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    // order-2 只掛在死列上 ⇒ 不該被拿去問 orders 合格性(即使真的不合格也不該回,因為那封信本來就不會被送)。
    expect(argsOf(orders, 'in')).toEqual([['id', ['order-1']]]);
  });

  it('orders 回傳的合格性結果過濾候選:只有出現在 orders 結果裡的 order_id 才算不合格', async () => {
    const rowA = { id: 'outbox-a', order_id: 'order-a', attempts: 1, max_attempts: 5 };
    const rowB = { id: 'outbox-b', order_id: 'order-b', attempts: 1, max_attempts: 5 };
    const dueRows = makeBuilder({ data: [rowA, rowB], error: null });
    // orders 只回 order-a ⇒ order-b 是合格的(不該出現在結果裡)。
    const orders = makeBuilder({ data: [{ id: 'order-a' }], error: null });
    const { client } = makeClient(dueRows, orders);

    const res = await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30);

    expect(res).toEqual([{ id: 'outbox-a', orderId: 'order-a' }]);
  });

  it('limit 在候選數超過時裁切(DUE_SCAN_CAP 大窗、回傳前才裁 limit)', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `outbox-${i}`,
      order_id: `order-${i}`,
      attempts: 1,
      max_attempts: 5,
    }));
    const dueRows = makeBuilder({ data: rows, error: null });
    const orders = makeBuilder({ data: rows.map((r) => ({ id: r.order_id })), error: null });
    const { client } = makeClient(dueRows, orders);

    const res = await new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(3);

    expect(res).toHaveLength(3);
  });

  it.each([0, -1, 1.5])('limit=%s ⇒ throw(契約由 adapter 強制)', async (bad) => {
    const { client } = makeClient(makeBuilder({ data: [], error: null }));
    await expect(
      new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(bad),
    ).rejects.toThrow(/limit 必須是 ≥1 的整數/);
  });

  it('email_outbox 查詢 error ⇒ throw', async () => {
    const dueRows = makeBuilder({ data: null, error: { message: 'boom', code: 'PGRST500' } });
    const { client } = makeClient(dueRows);

    await expect(
      new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30),
    ).rejects.toThrow(/PGRST500/);
  });

  it('orders 查詢 error ⇒ throw', async () => {
    const dueRows = makeBuilder({ data: [DUE_ROW], error: null });
    const orders = makeBuilder({ data: null, error: { message: 'boom', code: 'PGRST502' } });
    const { client } = makeClient(dueRows, orders);

    await expect(
      new SupabaseIneligibleOrderEmailScannerAdapter(client).listDueIneligible(30),
    ).rejects.toThrow(/PGRST502/);
  });
});
