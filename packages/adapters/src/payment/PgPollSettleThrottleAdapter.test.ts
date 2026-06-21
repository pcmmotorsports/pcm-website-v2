// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
// 驗:RPC 回 true/false 正確映 / SQL 呼 claim_order_poll_settle + 參數 [orderId, throttleSeconds] /
//     非 boolean·空 rows → throw 通用 / 連線層 throw → sanitizeError 通用(零 pg 原文)/ finally 永遠 end。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PgPollSettleThrottleAdapter } from './PgPollSettleThrottleAdapter';
import type { PgClientLike } from './PaymentConfirmerAdapter';

const ORDER = 'order-uuid-1';

type QueryRows = { rows: Array<Record<string, unknown>> };

function makeClient(opts: {
  connect?: () => Promise<void>;
  query?: (text: string, values: unknown[]) => Promise<QueryRows>;
}) {
  const connect = vi.fn(opts.connect ?? (async () => {}));
  const query = vi.fn<(text: string, values: unknown[]) => Promise<QueryRows>>(
    opts.query ?? (async () => ({ rows: [{ result: false }] })),
  );
  const end = vi.fn(async () => {});
  const client = { connect, query, end } as unknown as PgClientLike;
  return { client, connect, query, end };
}

describe('PgPollSettleThrottleAdapter.claimPollSettle', () => {
  it('RPC 回 true → 放行(回 true);connect/end 各一次', async () => {
    const { client, connect, end } = makeClient({
      query: async () => ({ rows: [{ result: true }] }),
    });
    const res = await new PgPollSettleThrottleAdapter('conn', () => client).claimPollSettle(ORDER, 10);
    expect(res).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
  });

  it('RPC 回 false → 被 throttle(回 false)', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [{ result: false }] }) });
    const res = await new PgPollSettleThrottleAdapter('conn', () => client).claimPollSettle(ORDER, 10);
    expect(res).toBe(false);
  });

  it('SQL 呼 claim_order_poll_settle、參數 = [orderId, throttleSeconds]', async () => {
    const { client, query } = makeClient({ query: async () => ({ rows: [{ result: true }] }) });
    await new PgPollSettleThrottleAdapter('conn', () => client).claimPollSettle(ORDER, 10);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('claim_order_poll_settle');
    expect(values).toEqual([ORDER, 10]);
  });

  it.each([
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
    ['result 非 boolean(number)', { rows: [{ result: 1 }] }],
    ['result null', { rows: [{ result: null }] }],
    ['缺 result 欄', { rows: [{ other: true }] }],
  ])('回應形狀不符(%s)→ throw 通用、finally end', async (_label, rows) => {
    const { client, end } = makeClient({ query: async () => rows as QueryRows });
    await expect(
      new PgPollSettleThrottleAdapter('conn', () => client).claimPollSettle(ORDER, 10),
    ).rejects.toThrow();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('query throw(transport)→ sanitizeError 通用訊息(零 pg 原文)、finally end', async () => {
    const { client, end } = makeClient({
      query: async () => {
        throw new Error('pg raw secret-detail leak');
      },
    });
    await expect(
      new PgPollSettleThrottleAdapter('conn', () => client).claimPollSettle(ORDER, 10),
    ).rejects.toThrow(/poll-settle throttle 主軌失敗/);
    await expect(
      new PgPollSettleThrottleAdapter('conn', () => client).claimPollSettle(ORDER, 10),
    ).rejects.not.toThrow(/secret-detail/);
    expect(end).toHaveBeenCalled();
  });

  it('connect throw → sanitizeError 通用(零 pg 原文)', async () => {
    const { client } = makeClient({
      connect: async () => {
        throw new Error('connect secret-detail');
      },
    });
    await expect(
      new PgPollSettleThrottleAdapter('conn', () => client).claimPollSettle(ORDER, 10),
    ).rejects.toThrow(/poll-settle throttle 主軌失敗/);
  });
});
