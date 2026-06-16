// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PgWebhookInboxAdapter } from './PgWebhookInboxAdapter';
import type { PgClientLike } from './PaymentConfirmerAdapter';
import type { WebhookEventInput } from '@pcm/domain';

const REC = 'D20260615ABC';
const ORDER = '11111111-2222-3333-4444-555555555555';
const HASH = 'a'.repeat(64);

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

function resultRows(value: unknown): QueryRows {
  return { rows: [{ result: value }] };
}

const FULL: WebhookEventInput = {
  recTradeId: REC,
  orderNumber: ORDER,
  rawHash: HASH,
  reportedStatus: 1,
  amount: 12345,
  bankTransactionId: 'BANK-TXN-1',
  transactionTimeMillis: 1_750_000_000_000,
};

describe('PgWebhookInboxAdapter.recordEvent', () => {
  it('inserted:true(首見)→ 回 true;connect/end 各一次', async () => {
    const { client, connect, end } = makeClient({ query: async () => resultRows(true) });
    const res = await new PgWebhookInboxAdapter('conn', () => client).recordEvent(FULL);
    expect(res).toBe(true);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
  });

  it('inserted:false(重送、ON CONFLICT DO NOTHING)→ 回 false', async () => {
    const { client } = makeClient({ query: async () => resultRows(false) });
    const res = await new PgWebhookInboxAdapter('conn', () => client).recordEvent(FULL);
    expect(res).toBe(false);
  });

  it('SQL 呼 record_webhook_event、7 參數位置對齊 0a RPC 簽名', async () => {
    const { client, query } = makeClient({ query: async () => resultRows(true) });
    await new PgWebhookInboxAdapter('conn', () => client).recordEvent(FULL);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toContain('record_webhook_event');
    expect(values).toEqual([
      REC,
      ORDER,
      HASH,
      1,
      12345,
      'BANK-TXN-1',
      1_750_000_000_000,
    ]);
  });

  it('選填欄缺 → 以 null 傳(notify 可能缺;NOT undefined)', async () => {
    const { client, query } = makeClient({ query: async () => resultRows(true) });
    await new PgWebhookInboxAdapter('conn', () => client).recordEvent({
      recTradeId: REC,
      orderNumber: ORDER,
      rawHash: HASH,
    });
    const [, values] = query.mock.calls[0]!;
    expect(values).toEqual([REC, ORDER, HASH, null, null, null, null]);
    expect(values.slice(3).every((v) => v === null)).toBe(true); // 不留 undefined
  });

  it.each([
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
    ['result 非 boolean(字串)', resultRows('true')],
    ['result null', resultRows(null)],
    ['result undefined', resultRows(undefined)],
  ])('回應形狀不符(%s)→ throw 通用訊息', async (_label, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(
      new PgWebhookInboxAdapter('conn', () => client).recordEvent(FULL),
    ).rejects.toThrow('回應格式異常');
  });

  it('connect 失敗 → throw 通用訊息 + code 屬性、不含 pg 原文;end 仍被呼(PF-E)', async () => {
    const { client, end } = makeClient({
      connect: async () => {
        throw Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:5432 secret-host-details'), {
          code: 'ECONNREFUSED',
        });
      },
    });
    const err = (await new PgWebhookInboxAdapter('conn', () => client)
      .recordEvent(FULL)
      .catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe('ECONNREFUSED');
    expect(String(err)).not.toContain('secret-host-details'); // PF-E:零 pg 原文
    expect(String(err)).toContain('落地失敗');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('RPC RAISE(入口 fail-closed)→ throw 帶 code、不含 pg 原文', async () => {
    const { client } = makeClient({
      query: async () => {
        throw Object.assign(new Error('record_webhook_event: 無法記錄 internal-detail'), {
          code: 'P0001',
        });
      },
    });
    const err = (await new PgWebhookInboxAdapter('conn', () => client)
      .recordEvent(FULL)
      .catch((e: unknown) => e)) as Error & { code?: string };
    expect(err.code).toBe('P0001');
    expect(String(err)).not.toContain('internal-detail');
  });
});

// ── M-3 3DS-4 sweeper ───────────────────────────────────────────────────────────────────────

const DUE_ROW = { rec_trade_id: REC, order_number: ORDER, attempt_count: 3 };

describe('PgWebhookInboxAdapter.expireEventsAtCeiling(ceiling-expirer、3DS-4a-1)', () => {
  it('回轉換筆數;SQL 呼 expire_webhook_events_at_ceiling()、無參數', async () => {
    const { client, query } = makeClient({ query: async () => resultRows(2) });
    const res = await new PgWebhookInboxAdapter('conn', () => client).expireEventsAtCeiling();
    expect(res).toBe(2);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/expire_webhook_events_at_ceiling\(\)/);
    expect(values).toEqual([]);
  });

  it('回應非整數 → throw 通用(fail-closed)', async () => {
    const { client } = makeClient({ query: async () => resultRows(1.5) });
    await expect(
      new PgWebhookInboxAdapter('conn', () => client).expireEventsAtCeiling(),
    ).rejects.toThrow('回應格式異常');
  });
});

describe('PgWebhookInboxAdapter.claimDueEvents(原子 lease claim、3DS-4a-1)', () => {
  it('SETOF → 映 DueWebhookEvent[];SQL 鎖 claim_due_webhook_events($1::integer)、參數=[limit]', async () => {
    const { client, query, connect, end } = makeClient({
      query: async () => ({ rows: [DUE_ROW, { ...DUE_ROW, attempt_count: 1 }] }),
    });
    const res = await new PgWebhookInboxAdapter('conn', () => client).claimDueEvents(50);
    expect(res).toEqual([
      { recTradeId: REC, orderNumber: ORDER, attemptCount: 3 },
      { recTradeId: REC, orderNumber: ORDER, attemptCount: 1 },
    ]);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/claim_due_webhook_events\(\$1::integer\)/); // 🔴 鎖 cast(codex K2 consider)
    expect(values).toEqual([50]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('空 rows(本輪無 due)→ []', async () => {
    const { client } = makeClient({ query: async () => ({ rows: [] }) });
    expect(await new PgWebhookInboxAdapter('conn', () => client).claimDueEvents(50)).toEqual([]);
  });

  it.each([
    ['rec_trade_id 非字串', { ...DUE_ROW, rec_trade_id: 1 }],
    ['order_number 缺', { rec_trade_id: REC, attempt_count: 3 }],
    ['attempt_count 非數字', { ...DUE_ROW, attempt_count: '3' }],
    ['attempt_count 非整數(1.5)', { ...DUE_ROW, attempt_count: 1.5 }], // 🔴 claim token 必整數(codex K2 must-fix)
    ['attempt_count NaN', { ...DUE_ROW, attempt_count: Number.NaN }],
  ])('SETOF 列形狀不符(%s)→ throw 通用(fail-closed)', async (_l, row) => {
    const { client } = makeClient({ query: async () => ({ rows: [row] }) });
    await expect(
      new PgWebhookInboxAdapter('conn', () => client).claimDueEvents(50),
    ).rejects.toThrow('回應格式異常');
  });
});

describe('PgWebhookInboxAdapter.markProcessed / markRetry(token guard、回 affected)', () => {
  it('markProcessed:回 affected(1=已標);SQL 呼 mark_webhook_processed、參數=[rec, count]', async () => {
    const { client, query } = makeClient({ query: async () => resultRows(1) });
    const res = await new PgWebhookInboxAdapter('conn', () => client).markProcessed(REC, 3);
    expect(res).toBe(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/mark_webhook_processed\(\$1::text, \$2::integer\)/); // 🔴 鎖 cast
    expect(values).toEqual([REC, 3]);
  });

  it('markProcessed:stale/manual → affected=0(no-op、不覆寫)', async () => {
    const { client } = makeClient({ query: async () => resultRows(0) });
    expect(await new PgWebhookInboxAdapter('conn', () => client).markProcessed(REC, 99)).toBe(0);
  });

  it('markRetry:回 affected;SQL 呼 mark_webhook_retry、參數=[rec, count, reason]', async () => {
    const { client, query } = makeClient({ query: async () => resultRows(1) });
    const res = await new PgWebhookInboxAdapter('conn', () => client).markRetry(
      REC,
      3,
      'record_unreachable',
    );
    expect(res).toBe(1);
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/mark_webhook_retry\(\$1::text, \$2::integer, \$3::text\)/); // 🔴 鎖 cast
    expect(values).toEqual([REC, 3, 'record_unreachable']);
  });

  it.each([
    ['result 非數字', resultRows('1')],
    ['result 非整數', resultRows(1.5)],
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
  ])('affected 形狀不符(%s)→ throw 通用(fail-closed)', async (_l, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(
      new PgWebhookInboxAdapter('conn', () => client).markProcessed(REC, 3),
    ).rejects.toThrow('回應格式異常');
  });
});
