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

/**
 * 🔴 2026-08-19 起 `getAlertSummary` 打**兩支不同的函式**(計數一支、單號一支)。
 *    這支 dispatcher 依 SQL 分流 —— **不要退回「兩次都回同一份」**:
 *    那樣的話「adapter 有沒有真的去呼叫第二支」在測試上不可分辨。
 * @param ids `undefined` = 那支函式**不存在**(部署窗口)⇒ 模擬 PG 的 `42883`。
 */
function twoQueryClient(counts: unknown, ids?: unknown, probeMissing = true) {
  return makeClient({
    query: async (text: string) => {
      // 🔴 `to_regprocedure` 那一發是**錯誤路徑的第二問**:42883 之後再確認函式到底在不在。
      //    `probeMissing=false` = 函式在 ⇒ 那個 42883 來自函式【內部】⇒ 必須上拋。
      if (text.includes('to_regprocedure')) return { rows: [{ missing: probeMissing }] };
      if (text.includes('get_payment_anomaly_alert_display_ids')) {
        if (ids === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(ids);
      }
      return resultRows(counts);
    },
  });
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
    // 🔴 `ids` 省略 ⇒ 第二支函式回 `42883`(不存在)= **程式先上、migration 還沒 apply** 那個窗口。
    const { client, query, connect, end } = twoQueryClient(FULL);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600);
    expect(res).toEqual({
      openCount: 2,
      refundingCount: 3,
      refundingStuckCount: 1,
      oldestOpenAgeSeconds: 7200,
      attemptManualReviewCount: 4,
      releasedStuckCount: 0,
      pendingDoubleChargeCandidateCount: 0,
      // 🔴 `FULL` 是**舊版 RPC 的形狀**(沒有那五個單號鍵)⇒ 五個都降級成 `[]`。
      //    這一格釘的就是「程式先上、migration 後 apply」那個部署窗口的行為:
      //    **告警照常寄、只是沒有單號**,而不是整支 503 把雙扣告警停掉。
      openDisplayIds: [],
      refundingStuckDisplayIds: [],
      attemptManualReviewDisplayIds: [],
      releasedStuckDisplayIds: [],
      pendingDoubleChargeDisplayIdPairs: [],
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

  // ── 2026-08-19 片:單號陣列 ──────────────────────────────────────────────
  it('🔴 五個單號陣列都解析得出來(正向對照:先證明這條路真的搬得動東西)', async () => {
    const { client, query } = twoQueryClient(FULL, {
      open_display_ids: ['PCM-2026-0104'],
      refunding_stuck_display_ids: ['PCM-2026-0091', 'PCM-2026-0092'],
      attempt_manual_review_display_ids: [],
      released_stuck_display_ids: ['PCM-2026-0999'],
      pending_double_charge_display_id_pairs: [['PCM-2026-0110', 'PCM-2026-0111']],
    });
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600);
    // 🔴 兩支函式**都要被呼叫到** —— 少了這一格,「只打了計數那支」與「單號全空」在觀察上一樣。
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]![0]).toContain('get_payment_anomaly_alert_display_ids');
    expect(res.openDisplayIds).toEqual(['PCM-2026-0104']);
    expect(res.refundingStuckDisplayIds).toEqual(['PCM-2026-0091', 'PCM-2026-0092']);
    expect(res.attemptManualReviewDisplayIds).toEqual([]);
    expect(res.releasedStuckDisplayIds).toEqual(['PCM-2026-0999']);
    expect(res.pendingDoubleChargeDisplayIdPairs).toEqual([['PCM-2026-0110', 'PCM-2026-0111']]);
  });

  // 🔴 這兩格分的是【缺鍵】與【形狀壞】—— 它們**不可以**走同一條路:
  //    缺鍵 = 部署窗口(舊版 RPC)⇒ 降級,告警照寄;形狀壞 = RPC 真的壞了 ⇒ fail-closed 上拋。
  //    合併成一個 catch-all 的話,RPC 壞掉會被安靜地讀成「今天沒有單號」。
  it.each([
    ['open_display_ids', 'not-an-array'],
    ['open_display_ids', [123]],
    ['released_stuck_display_ids', [{ id: 'x' }]],
    ['pending_double_charge_display_id_pairs', ['PCM-2026-0110']],
    ['pending_double_charge_display_id_pairs', [['only-one']]],
    ['pending_double_charge_display_id_pairs', [['a', 'b', 'c']]],
  ])('🔴 %s 形狀壞(%j)→ throw(fail-closed,不得安靜當成沒有單號)', async (key, bad) => {
    const { client } = twoQueryClient(FULL, { [key]: bad });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600),
    ).rejects.toThrow(/異常/);
  });

  // 🔴🔴 **降級的邊界:只有「函式不存在」可以吞,權限被收走【必須吵】。**
  //    兩者都會讓我們拿不到單號,而它們是**完全不同的世界**:
  //    前者是部署順序(會自己好)、後者是有人把受控窗關掉了(不會自己好)。
  //    合併吞掉的話,「我們被擋住了」會被安靜地讀成「今天沒有單號」。
  it.each([
    ['42501 權限被收走', '42501'],
    ['57014 查詢被取消', '57014'],
    ['08006 連線斷掉', '08006'],
  ])('🔴 單號那支回 %s ⇒ **上拋**(不得降級成空陣列)', async (_label, code) => {
    const { client } = makeClient({
      query: async (text: string) => {
        if (text.includes('get_payment_anomaly_alert_display_ids')) {
          throw Object.assign(new Error('nope'), { code });
        }
        return resultRows(FULL);
      },
    });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600),
    ).rejects.toThrow();
  });

  // 🔴🔴 **同一個 `42883`,兩個完全不同的世界** —— 這一對是本片最容易被寫成「一個 catch 全吞」的地方。
  it('🔴 `42883` 但函式【存在】(=錯在函式體內)⇒ **上拋**,不得降級成「今天沒有單號」', async () => {
    const { client } = twoQueryClient(FULL, undefined, /* probeMissing */ false);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600),
    ).rejects.toThrow();
  });

  it('🔴 正向對照:同樣的形狀但碼是 `42883` ⇒ **不 throw**、五欄降級成 []', async () => {
    // 少了這一格,上面那三格的「會 throw」與「這條路根本不會降級」不可分辨。
    const { client } = twoQueryClient(FULL);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600);
    expect(res.openDisplayIds).toEqual([]);
    expect(res.openCount).toBe(2); // 計數那支照常回 ⇒ 告警照寄,只是沒有單號
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
