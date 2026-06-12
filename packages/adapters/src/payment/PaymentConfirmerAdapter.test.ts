// node env;mock 'server-only'(PaymentConfirmerAdapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';
import { toMoneyAmount, PaymentConfirmError, type ConfirmOrderPaymentInput } from '@pcm/domain';

vi.mock('server-only', () => ({}));

import { PaymentConfirmerAdapter, type PgClientLike } from './PaymentConfirmerAdapter';

const INPUT: ConfirmOrderPaymentInput = {
  orderId: 'order-uuid-1',
  amount: { amount: toMoneyAmount(1050), currency: 'TWD' },
  recTradeId: 'D20260612001234567',
};

type QueryRows = { rows: Array<Record<string, unknown>> };

function makeClient(opts: {
  connect?: () => Promise<void>;
  query?: (text: string, values: unknown[]) => Promise<QueryRows>;
}) {
  const connect = vi.fn(opts.connect ?? (async () => {}));
  // 顯式 call signature:令 query.mock.calls[0] 為 [text, values] tuple(非空 tuple、可解構 sql/values)。
  const query = vi.fn<(text: string, values: unknown[]) => Promise<QueryRows>>(
    opts.query ?? (async () => ({ rows: [] })),
  );
  const end = vi.fn(async () => {});
  const client = { connect, query, end } as unknown as PgClientLike;
  return { client, connect, query, end };
}

function pgError(code: string): Error {
  return Object.assign(new Error('pg error'), { code });
}

describe('PaymentConfirmerAdapter.confirm — 成功路徑', () => {
  it('回 {confirmed:true, idempotent:false}(真翻 unpaid→paid)', async () => {
    const { client } = makeClient({
      query: async () => ({ rows: [{ result: { confirmed: true, idempotent: false } }] }),
    });
    const res = await new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT);
    expect(res).toEqual({ confirmed: true, idempotent: false });
  });

  it('回 {confirmed:true, idempotent:true}(重放冪等 no-op)', async () => {
    const { client } = makeClient({
      query: async () => ({ rows: [{ result: { confirmed: true, idempotent: true } }] }),
    });
    const res = await new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT);
    expect(res).toEqual({ confirmed: true, idempotent: true });
  });

  it('query 參數 = [orderId, amount.amount 整數, recTradeId] + connect/end 各呼一次', async () => {
    const { client, connect, query, end } = makeClient({
      query: async () => ({ rows: [{ result: { confirmed: true, idempotent: false } }] }),
    });
    await new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('confirm_order_payment');
    expect(values).toEqual(['order-uuid-1', 1050, 'D20260612001234567']); // p_amount 整數、無浮點
  });
});

describe('PaymentConfirmerAdapter.confirm — 失敗分類(SHOULD ③)', () => {
  it('RPC RAISE(SQLSTATE P0001)→ PaymentConfirmError(rejected)', async () => {
    const { client, end } = makeClient({
      query: async () => {
        throw pgError('P0001');
      },
    });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      name: 'PaymentConfirmError',
      code: 'rejected',
    });
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放連線
  });

  it('connect 失敗 → PaymentConfirmError(unreachable)', async () => {
    const { client, end } = makeClient({
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      code: 'unreachable',
    });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('statement_timeout(57014 語句取消)→ unreachable(可重 confirm)', async () => {
    const { client } = makeClient({
      query: async () => {
        throw pgError('57014');
      },
    });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('RPC 回應格式異常(空 rows)→ unreachable', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [] }) });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      code: 'unreachable',
    });
  });

  it('RPC 回應 result 形狀不符(缺 idempotent)→ unreachable', async () => {
    const { client } = makeClient({
      query: async () => ({ rows: [{ result: { confirmed: true } }] }),
    });
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toBeInstanceOf(
      PaymentConfirmError,
    );
  });

  it('end() 自身 throw 不蓋過主錯誤(吞掉)', async () => {
    const connect = vi.fn(async () => {});
    const query = vi.fn(async () => {
      throw pgError('P0001');
    });
    const end = vi.fn(async () => {
      throw new Error('end failed');
    });
    const client = { connect, query, end } as unknown as PgClientLike;
    await expect(new PaymentConfirmerAdapter('conn', () => client).confirm(INPUT)).rejects.toMatchObject({
      code: 'rejected', // 主錯誤(RPC RAISE)仍傳出、非 end 的 'end failed'
    });
  });
});
