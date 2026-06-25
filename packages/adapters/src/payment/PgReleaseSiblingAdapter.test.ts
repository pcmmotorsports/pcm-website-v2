// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PgReleaseSiblingAdapter } from './PgReleaseSiblingAdapter';
import type { PgClientLike } from './PaymentConfirmerAdapter';

const ATTEMPT = 'attempt-uuid-1';
const USER = 'user-uuid-1';
const CART = 'cart-uuid-1';

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

function resultRows(result: unknown): QueryRows {
  return { rows: [{ result }] };
}

describe('PgReleaseSiblingAdapter.release(mark_charge_attempt_released_for_user、payment_confirmer CAS)', () => {
  it.each([true, false])(
    'RPC {released:%s} → 原樣回;params=[attemptId, userId, cartSessionId]、SQL 三 uuid cast',
    async (released) => {
      const { client, query, connect, end } = makeClient({
        query: async () => resultRows({ released }),
      });
      const res = await new PgReleaseSiblingAdapter('conn', () => client).release(ATTEMPT, USER, CART);
      expect(res).toEqual({ released });
      const [sql, values] = query.mock.calls[0]!;
      expect(sql).toMatch(
        /mark_charge_attempt_released_for_user\(\$1::uuid, \$2::uuid, \$3::uuid\)/,
      );
      expect(values).toEqual([ATTEMPT, USER, CART]);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
    },
  );

  it.each([
    ['result.released 非 boolean', resultRows({ released: 'yes' })],
    ['result 缺 released', resultRows({})],
    ['result 非物件', resultRows(true)],
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
  ])('回應形狀不符(%s)→ throw 通用訊息(fail-closed)', async (_l, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(
      new PgReleaseSiblingAdapter('conn', () => client).release(ATTEMPT, USER, CART),
    ).rejects.toThrow('回應格式異常');
  });

  it('RPC throw(P0001)→ throw 帶 code=P0001、通用訊息不含 pg 原文', async () => {
    const { client, end } = makeClient({
      query: async () => {
        throw Object.assign(new Error('mark_charge_attempt_released_for_user: 內部細節'), {
          code: 'P0001',
        });
      },
    });
    await expect(
      new PgReleaseSiblingAdapter('conn', () => client).release(ATTEMPT, USER, CART),
    ).rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('主軌失敗') });
    expect(end).toHaveBeenCalledTimes(1); // 失敗仍釋放連線
  });

  it('transport throw(無 code)→ throw 通用 transport 訊息', async () => {
    const { client } = makeClient({
      connect: async () => {
        throw new Error('ECONNREFUSED 連線細節');
      },
    });
    await expect(
      new PgReleaseSiblingAdapter('conn', () => client).release(ATTEMPT, USER, CART),
    ).rejects.toThrow('release CAS 主軌失敗(transport)');
  });
});
