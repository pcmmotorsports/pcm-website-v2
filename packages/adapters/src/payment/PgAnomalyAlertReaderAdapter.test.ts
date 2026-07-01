// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PgAnomalyAlertReaderAdapter } from './PgAnomalyAlertReaderAdapter';
import type { PgClientLike } from './PaymentConfirmerAdapter';

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

const FULL = {
  open_count: 2,
  refunding_count: 3,
  refunding_stuck_count: 1,
  oldest_open_age_seconds: 7200,
  attempt_manual_review_count: 4,
  released_stuck_count: 0,
  pending_double_charge_candidate_count: 0,
};

describe('PgAnomalyAlertReaderAdapter.getAlertSummary(get_payment_anomaly_alert_summary、payment_confirmer 受控窗)', () => {
  it('回聚合 jsonb → 映射 snake→camel;SQL integer cast + params=[refundingStuckSeconds]', async () => {
    const { client, query, connect, end } = makeClient({ query: async () => resultRows(FULL) });
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600);
    expect(res).toEqual({
      openCount: 2,
      refundingCount: 3,
      refundingStuckCount: 1,
      oldestOpenAgeSeconds: 7200,
      attemptManualReviewCount: 4,
      releasedStuckCount: 0,
      pendingDoubleChargeCandidateCount: 0,
    });
    const [sql, values] = query.mock.calls[0]!;
    expect(sql).toMatch(/get_payment_anomaly_alert_summary\(\$1::integer, \$2::integer, \$3::integer\)/);
    expect(values).toEqual([86400, 43200, 600]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1); // finally 永遠釋放
  });

  it('oldest_open_age_seconds=null(無 open)→ null', async () => {
    const { client } = makeClient({ query: async () => resultRows({ ...FULL, oldest_open_age_seconds: null }) });
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600);
    expect(res.oldestOpenAgeSeconds).toBeNull();
  });

  it('count 欄以字串回(pg bigint→string)仍解析為數字', async () => {
    const { client } = makeClient({
      query: async () => resultRows({ ...FULL, open_count: '5', oldest_open_age_seconds: '3600' }),
    });
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600);
    expect(res.openCount).toBe(5);
    expect(res.oldestOpenAgeSeconds).toBe(3600);
  });

  it.each([
    ['result 非物件', resultRows(true)],
    ['空 rows', { rows: [] as Array<Record<string, unknown>> }],
    ['count 缺', resultRows({ ...FULL, open_count: undefined })],
    ['count 負', resultRows({ ...FULL, refunding_count: -1 })],
    ['count 非整數', resultRows({ ...FULL, attempt_manual_review_count: 1.5 })],
    ['oldest 負', resultRows({ ...FULL, oldest_open_age_seconds: -5 })],
  ])('形狀不符(%s)→ throw fail-closed', async (_label, rows) => {
    const { client } = makeClient({ query: async () => rows });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600),
    ).rejects.toThrow();
  });

  it('🔴 pg 錯誤淨化:throw 通用訊息 + 安全 code、不含 pg 原文', async () => {
    const pgErr = Object.assign(new Error('connection to server at "db.xxx" failed: password authentication'), {
      code: '28P01',
    });
    const { client } = makeClient({
      query: async () => {
        throw pgErr;
      },
    });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600),
    ).rejects.toMatchObject({ code: '28P01' });
    // 訊息不含 pg 原文(password/連線字串)
    try {
      await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600);
    } catch (e) {
      expect((e as Error).message).not.toContain('password');
      expect((e as Error).message).not.toContain('db.xxx');
    }
  });

  it('end throw 不蓋主錯誤(finally 吞)', async () => {
    const { client } = makeClient({ query: async () => resultRows(FULL) });
    (client.end as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('end failed'));
    // 主 op 成功 → 即使 end throw 也回正常結果
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600);
    expect(res.openCount).toBe(2);
  });
});
