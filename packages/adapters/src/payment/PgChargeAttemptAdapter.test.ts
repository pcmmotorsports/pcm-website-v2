// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PgChargeAttemptAdapter, PG_BUSINESS_REJECT } from './PgChargeAttemptAdapter';
import type { PgClientLike } from './PaymentConfirmerAdapter';

const ORDER = 'order-uuid-1';
const ATTEMPT = 'attempt-uuid-1';
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

type QueryRows = { rows: Array<Record<string, unknown>> };

function makeClient(opts: {
  connect?: () => Promise<void>;
  query?: (text: string, values: unknown[]) => Promise<QueryRows>;
}) {
  const connect = vi.fn(opts.connect ?? (async () => {}));
  const query = vi.fn<(text: string, values: unknown[]) => Promise<QueryRows>>(
    opts.query ?? (async () => ({ rows: [] })),
  );
  const end = vi.fn(async () => {});
  const client = { connect, query, end } as unknown as PgClientLike;
  return { client, connect, query, end };
}

function beginRows(result: Record<string, unknown>): QueryRows {
  return { rows: [{ result }] };
}

describe('PgChargeAttemptAdapter.begin', () => {
  it('acquired:true → 映 {acquired, attemptId, fallbackToken}(snake→camel)', async () => {
    const { client, connect, end } = makeClient({
      query: async () =>
        beginRows({ acquired: true, attempt_id: ATTEMPT, fallback_token: TOKEN }),
    });
    const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    expect(res).toEqual({ acquired: true, attemptId: ATTEMPT, fallbackToken: TOKEN });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
  });

  it.each(['user_in_flight', 'order_locked', 'not_unpaid'] as const)(
    'acquired:false reason=%s → 原樣回(預期業務路徑、非 throw)',
    async (reason) => {
      const { client } = makeClient({
        query: async () => beginRows({ acquired: false, reason }),
      });
      const res = await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
      expect(res).toEqual({ acquired: false, reason });
    },
  );

  it('query 參數 = [orderId]、SQL 呼 begin_charge_attempt', async () => {
    const { client, query } = makeClient({
      query: async () => beginRows({ acquired: false, reason: 'order_locked' }),
    });
    await new PgChargeAttemptAdapter('conn', () => client).begin(ORDER);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('begin_charge_attempt');
    expect(values).toEqual([ORDER]);
  });

  it.each([
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
    ['acquired 非 boolean', beginRows({ acquired: 'yes' })],
    ['acquired:true 缺 token', beginRows({ acquired: true, attempt_id: ATTEMPT })],
    ['acquired:false 未知 reason', beginRows({ acquired: false, reason: 'weird' })],
  ])('回應形狀不符(%s)→ throw 通用訊息', async (_label, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(new PgChargeAttemptAdapter('conn', () => client).begin(ORDER)).rejects.toThrow(
      '回應格式異常',
    );
  });

  it('connect 失敗 → throw 通用訊息 + code 屬性、不含 pg 原文;end 仍被呼', async () => {
    const { client, end } = makeClient({
      connect: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:5432 secret-host-details'), {
          code: 'ECONNREFUSED',
        });
      },
    });
    const err = (await new PgChargeAttemptAdapter('conn', () => client)
      .begin(ORDER)
      .catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe('ECONNREFUSED');
    expect(String(err)).not.toContain('secret-host-details'); // PF-E:零 pg 原文
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe('PgChargeAttemptAdapter.markCharged / markFailed(主軌、雙鍵驗參數)', () => {
  it('markCharged:params = [attemptId, orderId, recTradeId]、🔴 fallbackToken 不入 query', async () => {
    const { client, query } = makeClient({});
    await new PgChargeAttemptAdapter('conn', () => client).markCharged({
      attemptId: ATTEMPT,
      orderId: ORDER,
      recTradeId: 'D20260612X1',
      fallbackToken: TOKEN,
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('mark_charge_attempt_charged');
    expect(sql).not.toContain('fallback');
    expect(values).toEqual([ATTEMPT, ORDER, 'D20260612X1']);
    expect(JSON.stringify(values)).not.toContain(TOKEN); // token 零洩漏
  });

  it('markFailed:params = [attemptId, orderId]', async () => {
    const { client, query } = makeClient({});
    await new PgChargeAttemptAdapter('conn', () => client).markFailed({
      attemptId: ATTEMPT,
      orderId: ORDER,
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('mark_charge_attempt_failed');
    expect(values).toEqual([ATTEMPT, ORDER]);
  });

  it('RPC RAISE(P0001)→ throw 帶 code=P0001(供複合早停)+ 通用訊息不含 pg 原文', async () => {
    const { client } = makeClient({
      query: async () => {
        throw Object.assign(new Error('mark_charge_attempt_charged: 付款處理失敗'), {
          code: 'P0001',
        });
      },
    });
    await expect(
      new PgChargeAttemptAdapter('conn', () => client).markCharged({
        attemptId: ATTEMPT,
        orderId: ORDER,
        recTradeId: 'R1',
        fallbackToken: TOKEN,
      }),
    ).rejects.toMatchObject({ code: PG_BUSINESS_REJECT, message: expect.stringContaining('主軌失敗') });
  });
});
