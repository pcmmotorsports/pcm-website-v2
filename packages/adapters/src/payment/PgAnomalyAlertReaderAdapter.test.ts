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
 * 🔴 2026-08-19 起打兩支;**F-004(2026-08-24)起是【三支】**(計數 / 單號 / 退款卡住計數)。
 *    ⚠️ 名字還叫 `twoQueryClient` —— 沒改名是因為它被 20+ 格引用,而**這行字就是它的更正**。
 *    這支 dispatcher 依 SQL 分流 —— **不要退回「每支都回同一份」**:
 *    那樣的話「adapter 有沒有真的去呼叫第二/第三支」在測試上不可分辨。
 *    📌 2026-08-24 當場抓到三格正是那個形狀(用裸 `makeClient` 無條件回同一份),已改掉。
 * @param ids `undefined` = 那支函式**不存在**(部署窗口)⇒ 模擬 PG 的 `42883`。
 */
function twoQueryClient(
  counts: unknown,
  ids?: unknown,
  probeMissing = true,
  /**
   * F-004 第三支:`undefined` = 那支 RPC **不存在**(部署窗口)⇒ 模擬 `42883`。
   * 🔴 預設 `undefined` 是刻意的:既有那些格子本來就在測「程式先上、migration 後 apply」,
   *    加了新 RPC 之後那個世界**多了一支沒 apply 的函式**,預設值讓它們繼續測同一個世界。
   */
  refunds?: unknown,
  refundsProbeMissing = true,
  /**
   * M-4a 第四支:同樣預設 `undefined` = **那支 RPC 尚未 apply**(部署窗口)⇒ 模擬 `42883`。
   * 🔴 而這不只是照抄慣例 —— 它現在是**正式庫的真實狀態**:
   *    `20260829010000_m4a_email_deadman_alert_counts.sql` 已 commit 而**未 apply**
   *    (`grep -c 20260829010000 supabase/APPLIED.tsv` ⇒ 2026-08-29 量到 **0**)
   *    ⇒ 預設值讓既有那些格子繼續測【今天線上真的是那個世界】。
   */
  email?: unknown,
  emailProbeMissing = true,
  /**
   * 🔵 M-4b E4 第五支(2026-08-31):`get_shipped_email_gap_counts`。
   * 🔴 同樣預設 `undefined` = **尚未 apply** —— 而這一次那是【量到的事實】:
   *    `20260831020000` 本人就是這一批新增的, 而它**未進 `APPLIED.tsv`**。
   *    ⇒ 預設值讓既有那些格子繼續測【今天線上真的是那個世界】。
   */
  shipped?: unknown,
  shippedProbeMissing = true,
  /**
   * 🔵 **訊號 4 第六支(2026-08-31)**:`get_order_created_gap_counts`。
   * 🔴 預設 `undefined` = 尚未 apply —— **而這一次那句話今天已經【不是】事實了**:
   *    那支 RPC 2026-08-31 已 apply(`APPLIED.tsv` 有那一列、六格唯讀複驗)。
   *    ⇒ 📌 **預設值留 `undefined` 是為了讓既有 20+ 格繼續測「呼叫端沒傳起始線」那個世界**
   *      (它們第 6 個參數都傳 `null` ⇒ adapter 根本不呼叫這支)——
   *      **不是因為它沒 apply。理由變了, 預設值沒變, 而那要寫下來。**
   */
  orderCreated?: unknown,
  orderCreatedProbeMissing = true,
) {
  return makeClient({
    query: async (text: string) => {
      // 🔴 `to_regprocedure` 那一發是**錯誤路徑的第二問**:42883 之後再確認函式到底在不在。
      //    `probeMissing=false` = 函式在 ⇒ 那個 42883 來自函式【內部】⇒ 必須上拋。
      // 🔴 **三支**函式各有自己的探測,**必須依函式名分流** —— 共用一個旗標的話,
      //    「哪一支不在」在測試上不可分辨。(這句警告本檔原本就有,第三支是 2026-08-29 接上的。)
      if (text.includes('to_regprocedure')) {
        return {
          rows: [
            {
              missing: text.includes('get_order_refunds_stuck_summary')
                ? refundsProbeMissing
                : text.includes('get_email_outbox_deadman_counts')
                  ? emailProbeMissing
                  : text.includes('get_shipped_email_gap_counts')
                    ? shippedProbeMissing
                    : text.includes('get_order_created_gap_counts')
                      ? orderCreatedProbeMissing
                      : probeMissing,
            },
          ],
        };
      }
      if (text.includes('get_order_created_gap_counts')) {
        if (orderCreated === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(orderCreated);
      }
      if (text.includes('get_shipped_email_gap_counts')) {
        if (shipped === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(shipped);
      }
      if (text.includes('get_email_outbox_deadman_counts')) {
        if (email === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(email);
      }
      if (text.includes('get_order_refunds_stuck_summary')) {
        if (refunds === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(refunds);
      }
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

/** F-004:那支 RPC 回得出來時的形狀。 */
const REFUNDS_FULL = {
  order_refunds_stuck_count: 5,
  order_refunds_stuck_overnight_count: 2,
  order_refunds_manual_failed_count: 4,
};

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
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
    expect(res).toEqual({
      // 🔴 M-4a 五格:這一格的世界是「那支 RPC 尚未 apply」⇒ 全 `null` + unknown=true
      //    —— 而 `null` 不是 `0`：後者是「查得到而且沒事」。
      emailOverdueCount: null,
      emailDeadLetterCount: null,
      emailStuckSendingCount: null,
      emailQuotaConfirmedCount: null,
      emailQuotaSuspectedCount: null,
      emailOutboxTotalCount: null,
      // 🔵 出貨那三格 + unknown 旗標(2026-08-31)。這一格的世界是【沒傳起始線】
      //   ⇒ adapter 根本不呼叫那支 RPC ⇒ 三個 count 都是 null、旗標為 true。
      //   🔴 **不是 0** —— 「讀不到 / 沒上膛」與「一切正常」在裸數字上長得一模一樣。
      shippedNeverEnqueuedCount: null,
      shippedUnsendableCount: null,
      shipmentsTotalCount: null,
      shippedGapUnknown: true,
      /**
       * 🔵 訊號 4 三格。本案例 `orderCreatedCutoffIso` 傳 `null` ⇒ **不呼叫那支 RPC**
       * ⇒ `orderCreatedRows` 空 ⇒ unknown = true、兩個 count 是 `null`。
       * 🛑 **期望值是從【呼叫端傳了什麼】推的,不是從跑出來的結果抄的。**
       */
      orderCreatedPaidNoEmailCount: null,
      orderCreatedNoRecipientCount: null,
      orderCreatedGapUnknown: true,
      emailOutboxUnknown: true,
      openCount: 2,
      refundingCount: 3,
      refundingStuckCount: 1,
      oldestOpenAgeSeconds: 7200,
      attemptManualReviewCount: 4,
      releasedStuckCount: 0,
      pendingDoubleChargeCandidateCount: 0,
      // 🔴 F-004:這一格與上面五個單號陣列是**同一個世界** —— 程式先上、migration 還沒 apply。
      //    而它的降級**刻意與單號那五個不同**:單號降級成 `[]`(少講一件事),
      //    退款計數降級成 `null` + unknown(**不得降成 0**)——
      //    把「我讀不到」印成「沒有卡住的退款」,就是這一片本來要修的那個 bug。
      orderRefundsStuckCount: null,
      orderRefundsStuckOvernightCount: null,
      orderRefundsManualFailedCount: null,
      orderRefundsStuckUnknown: true,
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
    // 🔴 改用分流 client:原本這格三支 RPC 都回同一份 —— 那正是 `twoQueryClient` 檔頭警告的形狀。
    const { client } = twoQueryClient({ ...FULL, oldest_open_age_seconds: null });
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
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
    }, true, REFUNDS_FULL);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
    // 🔴 三支函式**都要被呼叫到** —— 少了這一格,「只打了計數那支」與「其餘全空」在觀察上一樣。
    //    (F-004 起是三支:計數 / 單號 / 退款卡住計數。)
    /**
     * 🔴 **3 → 5,而那兩發【不是常態成本】** —— 這一格的世界是「寄信那支 RPC 尚未 apply」:
     *   +1 = 打那支 RPC(它 throw 42883)· +1 = `to_regprocedure` 複查它到底在不在
     * ⇒ **apply 之後只會多 1 發**,不是 2 發。
     * 📌 寫出來是因為:一個「多兩發查詢」的數字,會被讀成這片的固定代價,而它是**部署窗口的代價**。
     */
    expect(query).toHaveBeenCalledTimes(5);
    expect(query.mock.calls[1]![0]).toContain('get_payment_anomaly_alert_display_ids');
    expect(query.mock.calls[2]![0]).toContain('get_order_refunds_stuck_summary');
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow();
  });

  // 🔴🔴 **同一個 `42883`,兩個完全不同的世界** —— 這一對是本片最容易被寫成「一個 catch 全吞」的地方。
  it('🔴 `42883` 但函式【存在】(=錯在函式體內)⇒ **上拋**,不得降級成「今天沒有單號」', async () => {
    const { client } = twoQueryClient(FULL, undefined, /* probeMissing */ false);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow();
  });

  it('🔴 正向對照:同樣的形狀但碼是 `42883` ⇒ **不 throw**、五欄降級成 []', async () => {
    // 少了這一格,上面那三格的「會 throw」與「這條路根本不會降級」不可分辨。
    const { client } = twoQueryClient(FULL);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
    expect(res.openDisplayIds).toEqual([]);
    expect(res.openCount).toBe(2); // 計數那支照常回 ⇒ 告警照寄,只是沒有單號
  });

  it('count 欄以字串回(pg bigint→string)仍解析為數字', async () => {
    const { client } = twoQueryClient({ ...FULL, open_count: '5', oldest_open_age_seconds: '3600' });
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toMatchObject({ code: '28P01' });
    // 訊息不含 pg 原文(password/連線字串)
    try {
      await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
    } catch (e) {
      expect((e as Error).message).not.toContain('password');
      expect((e as Error).message).not.toContain('db.xxx');
    }
  });

  it('end throw 不蓋主錯誤(finally 吞)', async () => {
    const { client } = twoQueryClient(FULL);
    (client.end as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('end failed'));
    // 主 op 成功 → 即使 end throw 也回正常結果
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
    expect(res.openCount).toBe(2);
  });
});

/**
 * F-004 第三支 RPC(退款卡住計數,分母 `order_refunds`)。
 *
 * 🔴 這一組的核心是**一個三分法**,而它最容易被寫成兩分:
 * ```
 * 函式不存在        ⇒ unknown + null   (部署窗口, 會自己好)
 * 函式在而回了垃圾  ⇒ 【上拋】          (RPC 壞了, 不會自己好)
 * 權限被收走(42501)⇒ 【上拋】          (有人把受控窗關掉了)
 * ```
 * 把後兩者也吞成 unknown ⇒ 「我讀不到」會被印成「今天沒有卡住的退款」
 * ⇒ **用這一片的降級路徑,重新造出這一片要修的那個 bug。**
 */
describe('F-004 get_order_refunds_stuck_summary(第三支 RPC)', () => {
  it('回得出來 → 兩個計數都解析得到', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, REFUNDS_FULL);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
    expect(res.orderRefundsStuckCount).toBe(5);
    expect(res.orderRefundsStuckOvernightCount).toBe(2);
    expect(res.orderRefundsStuckUnknown).toBe(false);
  });

  it('🔴 函式不存在(42883 且探測說真的不在)→ unknown + null,**不得是 0**', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, undefined, /* refundsProbeMissing */ true);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
    expect(res.orderRefundsStuckUnknown).toBe(true);
    expect(res.orderRefundsStuckCount).toBeNull();
    // 🔴 這一行是本組的重點:`null` 與 `0` 在下游會印不同的字,寫成 0 就等於說謊。
    expect(res.orderRefundsStuckCount).not.toBe(0);
  });

  it('🔴 42883 但探測說函式【存在】(=錯在函式體內)⇒ 上拋,不得降級成 unknown', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, undefined, /* refundsProbeMissing */ false);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow();
  });

  it.each([
    ['42501 權限被收走', '42501'],
    ['08006 連線斷掉', '08006'],
  ])('🔴 回 %s ⇒ 上拋(不得降級成 unknown)', async (_label, code) => {
    const { client } = makeClient({
      query: async (text: string) => {
        if (text.includes('get_order_refunds_stuck_summary')) {
          throw Object.assign(new Error('nope'), { code });
        }
        if (text.includes('to_regprocedure')) return { rows: [{ missing: true }] };
        if (text.includes('get_payment_anomaly_alert_display_ids')) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(FULL);
      },
    });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow();
  });

  it.each([
    ['缺鍵', {}],
    ['負數', { order_refunds_stuck_count: -1, order_refunds_stuck_overnight_count: 0 }],
    ['非整數', { order_refunds_stuck_count: 1.5, order_refunds_stuck_overnight_count: 0 }],
    ['非數字', { order_refunds_stuck_count: 'x', order_refunds_stuck_overnight_count: 0 }],
  ])('🔴 函式在而回了垃圾(%s)⇒ 上拋,不得當成 unknown', async (_label, bad) => {
    const { client } = twoQueryClient(FULL, undefined, true, bad);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow(/異常/);
  });

  it('🔴🔴 函式【存在】而回了 SQL NULL ⇒ 上拋,不得讀成「尚未 apply」', async () => {
    // 這一格是 code-reviewer 2026-08-24 抓的:`rf === undefined || rf === null` 把兩個世界併了。
    //   refundRows = []   ⇒ undefined ⇒ 我們根本沒拿到那一列 = 函式不存在(部署窗口)
    //   { result: null }  ⇒ null      ⇒ 函式存在而且跑了, 只是回了 NULL
    // 併成一個的後果:migration 明明 apply 了, route 卻印「尚未 apply」
    // ⇒ 值班的人跑去查一件已經做完的事。**紅在對的時候, 指向錯的地方。**
    const { client } = twoQueryClient(FULL, undefined, true, null);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow(/異常/);
  });

  it('🔴 對照:同一條路但函式真的不存在 ⇒ unknown(證明上一格紅的是 NULL 不是別的)', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, undefined);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null);
    expect(res.orderRefundsStuckUnknown).toBe(true);
  });

  it('🔴 錯誤訊息要指向【這一支】函式,不是隔壁那支(值班的人會照著去查)', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, {});
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow(/get_order_refunds_stuck_summary/);
  });
});

// ─────────────────────────────────────────────────────────────
// 🔴 M-4a:寄信那支 RPC【真的 apply 之後】那條路
//
// **為什麼要單獨一組**(codex 2026-08-29 抓到,而它是本片最大的覆蓋缺口):
// 上面每一格的 `email` 都預設 `undefined` = **那支 RPC 不存在** ——
// 那是今天線上的真實狀態,所以那個預設是對的。
// 🔴 **而它的副作用是:apply 之後才會走的那條路【一格都沒有被測過】。**
// 📌 **一個「今天不會走到」的分支,與一個「永遠不會走到」的分支,在覆蓋率上長得一樣** ——
//    而前者會在【某個人按下 apply 的那一刻】變成主要路徑。
describe('🔴 寄信計數 RPC 已 apply 之後(今天走不到,而按下 apply 那一刻就是主路徑)', () => {
  const OK = {
    signal1_overdue_count: 4,
    signal2_dead_letter_count: 3,
    signal3_stuck_sending_count: 1,
    signal5_quota_confirmed_count: 2,
    signal5_quota_suspected_count: 1,
    total_count: 12,
  };

  it('[A1] 五個鍵都解析得出來,而且不是 unknown(正向對照:先證明這條路搬得動東西)', async () => {
    const c = twoQueryClient(FULL, undefined, true, undefined, true, OK, false);
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null);
    // 🔴 怎麼會紅:adapter 沒把那五個鍵接上、或鍵名打錯 ⇒ 這裡拿到 null。
    //    📌 而鍵名打錯【不會 typecheck 紅】—— 兩邊都是合法字串。
    expect(r.emailOutboxUnknown).toBe(false);
    expect(r.emailOverdueCount).toBe(4);
    expect(r.emailDeadLetterCount).toBe(3);
    expect(r.emailStuckSendingCount).toBe(1);
    expect(r.emailQuotaConfirmedCount).toBe(2);
    expect(r.emailQuotaSuspectedCount).toBe(1);
    // 🔴🔴 **codex 2026-08-31 must-fix**:`total_count: 12` 在 fixture 裡, 而【沒有人斷言它】。
    //   ⇒ 我實測 codex 指的三個突變, **只有一個真的活著**:
    //     · `emailOutboxTotalCount: 0`                    ⇒ 已被下面 A0 那格的整包比對殺掉
    //     · 略過 `parseCount`(直接讀 `em?.['total_count']`)⇒ 也被殺掉
    //     · 🔴 **把 key 換成另一個【合法的】count key**(例 `signal1_overdue_count`)
    //       ⇒ **40 格全綠** —— 那一個是真的洞, 而它正是 A1 自己的註解在講的那件事:
    //         「**鍵名打錯不會 typecheck 紅 —— 兩邊都是合法字串**」。
    //   📌 **⇒ 那句話寫在這一格的註解裡, 而這一格【對新加的那個鍵沒有執行它】。**
    //   ⇒ ⇒ **一段正確的說明, 與一格真的在做那件事的斷言, 是兩件事。**
    expect(r.emailOutboxTotalCount).toBe(12);
  });

  // ══ 🔵🔵 出貨缺口那支 RPC(2026-08-31;codex R1 must-fix 2)══
  //   🔴 它指的洞逐字:**所有真 adapter 測試都傳 null** ⇒ cutoff 有值那條【主路徑】
  //     整段可以失效而全綠。下面五格就是那條路。
  const SHIPPED_OK = {
    shipped_never_enqueued_count: 4,
    shipped_unsendable_count: 2,
    shipments_total_count: 77,
  };

  it('[S1] 🔵 起始線有值 ⇒ 三個 key 都解析得出來,而且不是 unknown', async () => {
    const c = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, SHIPPED_OK, false);
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null,
    );
    expect(r.shippedGapUnknown).toBe(false);
    expect(r.shippedNeverEnqueuedCount).toBe(4);
    expect(r.shippedUnsendableCount).toBe(2);
    // 🔴 鍵名打錯【不會 typecheck 紅】—— 兩邊都是合法字串 ⇒ 這一格是唯一擋得住的東西。
    expect(r.shipmentsTotalCount).toBe(77);
  });

  it('[S2] 🔴🔴 參數要【逐字】傳下去(起始線與寬限, 而且順序不能反)', async () => {
    // 🔴 codex R1 逐字點名的可存活突變之一:「參數順序錯」。
    //   ⇒ 兩個參數型別不同(timestamptz / integer), 型別擋得住反過來;
    //     而**值送錯**(例如把常數寫死)型別擋不住 ⇒ 只有這一格擋得住。
    const seen: Array<{ text: string; params?: unknown[] }> = [];
    const base = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, SHIPPED_OK, false);
    const c = { ...base, query: async (text: string, params?: unknown[]) => {
      seen.push({ text, params });
      return base.query(text, params ?? []);
    } };
    await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null);
    const call = seen.find((q) => q.text.includes('get_shipped_email_gap_counts'));
    expect(call?.params).toEqual(['2026-08-20T00:00:00.000Z', 900]);
  });

  it('[S3] 🔴 起始線是 null ⇒ 那支 RPC【完全不呼叫】(而不是傳 null 進去)', async () => {
    // 🛑 那支函式的參數無 DEFAULT, 而它自己的閘對 NULL 直接 RAISE ——
    //   所以「傳 null 進去」會炸掉整支告警。這一格擋的是那個。
    const seen: string[] = [];
    const base = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, SHIPPED_OK, false);
    const c = { ...base, query: async (text: string, params?: unknown[]) => {
      seen.push(text);
      return base.query(text, params ?? []);
    } };
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, null, 900, null);
    expect(seen.some((t) => t.includes('get_shipped_email_gap_counts'))).toBe(false);
    expect(r.shippedGapUnknown).toBe(true);
    // 🔴 **不是 0** —— 「沒上膛」與「一切正常」在裸數字上長得一模一樣。
    expect(r.shippedNeverEnqueuedCount).toBeNull();
  });

  it('[S4] 🔴 42883 + 探測說函式真的不存在 ⇒ unknown(部署窗口), 不上拋', async () => {
    const c = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, undefined, true);
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null,
    );
    expect(r.shippedGapUnknown).toBe(true);
  });

  it('[S5] 🔴🔴 42883 而探測說函式【在】⇒ 原封上拋(那個 42883 來自函式內部)', async () => {
    // 🛑 這一格是 S4 的翻面:少了它, 一個「凡是 42883 都當 unknown」的實作會全綠,
    //   而那會把【函式內部的錯】吞成「還沒 apply」⇒ 一個真的壞掉被讀成部署窗口。
    const c = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, undefined, false);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
        86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null),
    ).rejects.toThrow();
  });

  it('[S6] 🔴🔴 那支函式自己 RAISE(P0001)⇒ 降級成【查不到】,而【不是】0、也【不是】整條炸掉', async () => {
    // 🔴 `-48` 2026-08-31 指名的驗收, 而我**先量了現在會怎樣**:
    //   修之前 ⇒ `THREW: anomaly 告警聚合讀失敗(P0001)` ⇒ route 503 ⇒ **今晚一封告警都不寄**
    //   ⇒ 📌 一個【設定問題】把整條告警帶走了 —— 而那正是告警最該在的那一晚。
    const base = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, undefined, true);
    const c = { ...base, query: async (text: string, params?: unknown[]) => {
      if (text.includes('get_shipped_email_gap_counts')) {
        /**
         * 🔴 訊息**逐字帶那支函式自己的前綴** —— 對齊 `20260831020000_...sql:68` 的真實 RAISE。
         * 改前這裡只寫 `'p_grace_seconds 必須是正整數'`(**沒有前綴**)⇒ 一個只認前綴的收窄版
         *   會判它不是參數閘 ⇒ 原封上拋。
         * 📌 **⇒ 一個【比真實訊息短】的假錯誤,會讓一道靠訊息辨識的守門在測試裡表現得與正式庫不同。**
         */
        throw Object.assign(
          new Error('get_shipped_email_gap_counts:p_grace_seconds 必須是正整數(收到 0)'),
          { code: 'P0001' },
        );
      }
      return base.query(text, params ?? []);
    } };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null,
    );
    expect(r.shippedGapUnknown).toBe(true);
    // 🛑 **不是 0** —— 吞成 0 會把片1 的 fail-closed 在下游拆掉。
    expect(r.shippedNeverEnqueuedCount).toBeNull();
    /**
     * 🔴 而【其他告警還在】—— 這一格證明它沒有把整條帶走。
     * ⛔ ~~舊寫法 `expect(r.openCount).toBeGreaterThanOrEqual(0)`~~(codex 2026-08-31 R1 nit)
     *   —— **一個把所有計數都寫死成 0 的降級實作,照樣過** ⇒ 它證不出「其他告警還在」,
     *   只證得出「openCount 是個非負數」。
     * ✅ `FULL.open_count = 2` ⇒ 斷言它**逐字等於 2**:那分得出「原值保留」與「被歸零」。
     * 📌 **一個 `>= 0` 的斷言,在它要守的那個東西壞掉時不會變紅。**
     */
    expect(r.openCount).toBe(2);
    expect(r.refundingCount).toBe(3);
    expect(JSON.stringify(errSpy.mock.calls)).toContain('shipped_gap_rpc_raised');
    errSpy.mockRestore();
  });

  it('[S6b] 🔵 P0001 而訊息【不像】它自己的參數閘 ⇒ 仍然降級(控制流不變),但 log 換一句', async () => {
    /**
     * 🔴🔴 **這一格的宣稱在 codex R2 之後【換過方向】,舊的留著讓人看到為什麼**:
     * ⛔ ~~舊版:前綴不符 ⇒ 原封上拋~~ —— codex R2 must-fix:
     *   「migration 改動參數閘前綴或標點而應用程式尚未同步 ⇒ 真正可降級的參數錯誤改成整條上拋,
     *    **付款／退款等其他告警同輪無法送出**」。
     *   📌 **⇒ 那是 R1 already 打過我一次的同一個形狀:一個新守門擋掉的比它守的寬。**
     * ✅ 現在的宣稱:**控制流不變(照樣降級)**,前綴只決定 log 印哪一句 + `reason` 標成
     *   `shipped_gap_rpc_raised_unexpected_shape`,讓看 log 的人分得出兩種來源。
     * ⚠️ **今天踩不踩得到:踩不到**(那支函式體內只有 2 條 RAISE,兩條都是參數閘)。
     *
     * 🔴 **而 codex R2 另有一條 nit 打舊版**:它只 `rejects.toThrow()` ⇒
     *   實作換成拋任何別的錯、或掉了 `P0001`,那條照樣過。**本版不靠 toThrow,靠具名的值。**
     */
    const base = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, undefined, true);
    const c = { ...base, query: async (text: string, params?: unknown[]) => {
      if (text.includes('get_shipped_email_gap_counts')) {
        throw Object.assign(
          new Error('some_other_constraint_violation: 對帳金額不一致'),
          { code: 'P0001' },
        );
      }
      return base.query(text, params ?? []);
    } };
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, '2026-08-31T00:00:00.000Z', 900, null);
    // 🔵 控制流與參數閘那一格相同:降級成「查不到」,不是 0、不是整條炸掉
    expect(r.shippedGapUnknown).toBe(true);
    expect(r.shippedNeverEnqueuedCount).toBeNull();
    // 🔴 而【其他告警還在】—— 逐字比值,不是 >= 0(R1 nit 就是打這個)
    expect(r.openCount).toBe(2);
    expect(r.refundingCount).toBe(3);
    // 🔴 本格的判別值:reason 要標成 unexpected_shape,而【不是】參數閘那一句
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('shipped_gap_rpc_raised_unexpected_shape');
    expect(logged).toContain('訊息不像它自己的參數閘');
    errSpy.mockRestore();
  });

  it('[T1] 🔵 訊號4:起始線有值 ⇒ 真的呼叫那支 RPC, 三格映射出來', async () => {
    /**
     * 🔴 **codex 2026-08-31 R1 must-fix**:原本這支檔**所有**第 6 個參數都傳 `null`
     * ⇒ adapter 那條新路**一次都沒被執行過** ⇒ RPC 名稱打錯、參數順序錯、回應鍵拼錯,
     *   **測試全部照樣綠**。這一格是那條路的第一次真的執行。
     */
    const c = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      { paid_no_email_count: 7, no_recipient_count: 2, orders_total_count: 23 }, false,
    );
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z',
    );
    expect(r.orderCreatedPaidNoEmailCount).toBe(7);
    expect(r.orderCreatedNoRecipientCount).toBe(2);
    expect(r.orderCreatedGapUnknown).toBe(false);
    // 🔵 而別族不受影響 —— 逐字比值, 不是 >= 0
    expect(r.openCount).toBe(2);
  });

  it('[T2] 🔴 負對照:起始線是 null ⇒ 【根本不呼叫】那支 RPC ⇒ unknown', async () => {
    /**
     * 🛑 少了這一格, 一個「不管有沒有起始線都去呼叫」的實作會讓 T1 全綠 ——
     *   而那支 RPC 的參數無 DEFAULT、它自己的閘會對 NULL 直接 RAISE ⇒ 每天炸一次。
     */
    const seen: string[] = [];
    const base = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      { paid_no_email_count: 7, no_recipient_count: 2, orders_total_count: 23 }, false,
    );
    const c = { ...base, query: async (text: string, params?: unknown[]) => {
      seen.push(text);
      return base.query(text, params ?? []);
    } };
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, null, 900, null,
    );
    expect(seen.some((t) => t.includes('get_order_created_gap_counts'))).toBe(false);
    expect(r.orderCreatedGapUnknown).toBe(true);
    // 🔴 不寫成 0 —— 「讀不到」與「一切正常」在一個裸數字上長得一樣
    expect(r.orderCreatedNoRecipientCount).toBeNull();
  });

  it('[T3] 🔴 訊號4 的 RPC 尚未 apply(42883)⇒ 降級成 unknown, 而其他告警照常', async () => {
    // 🛑 那支 RPC 今天已 apply, 而這條路仍要留:碼先上線而 migration 還沒到的世界會再發生。
    const c = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      undefined, true,
    );
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z',
    );
    expect(r.orderCreatedGapUnknown).toBe(true);
    expect(r.orderCreatedPaidNoEmailCount).toBeNull();
    // 🔴 而【其他告警還在】—— 逐字比值
    expect(r.openCount).toBe(2);
    expect(r.refundingCount).toBe(3);
  });

  it('[T4] 🔴🔴 負對照:42883 而 to_regprocedure 說函式【在】⇒ 原封上拋,不得吞成 unknown', async () => {
    // 🛑 少了這一格, 一個「凡 42883 都降級」的實作會讓 T3 全綠 ——
    //   而那會把一個【函式內部】拋出的 42883(例如它自己去呼叫了一支不存在的東西)讀成「還沒 apply」。
    const c = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      undefined, false,
    );
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
        86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z',
      ),
    ).rejects.toThrow();
  });

  it('[S7] 🔴🔴 負對照:42501(權限)⇒ 【仍然原封上拋】,不得被降級吞掉', async () => {
    // 🛑 少了這一格, 一個「凡是 RPC 出錯都降級」的實作會讓 S6 全綠 ——
    //   而那會把一個【真的壞掉】讀成「還沒上膛」。
    const base = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, undefined, true);
    const c = { ...base, query: async (text: string, params?: unknown[]) => {
      if (text.includes('get_shipped_email_gap_counts')) {
        throw Object.assign(new Error('permission denied'), { code: '42501' });
      }
      return base.query(text, params ?? []);
    } };
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
        86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null),
    ).rejects.toThrow();
  });

  it('[A2] 🔴 缺鍵 ⇒ fail-closed 上拋,【不】當成 unknown', async () => {
    const { signal2_dead_letter_count: _drop, ...missing } = OK;
    const c = twoQueryClient(FULL, undefined, true, undefined, true, missing, false);
    // 🔴 怎麼會紅:把缺鍵也當成 unknown ⇒ 這裡不會拋,而信上會印「查不到」
    //    ⇒ 「函式不在」與「函式回了垃圾」是兩件事,後者必須吵。
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow();
  });

  it('[A3] 🔴 函式【存在】而回 SQL NULL ⇒ 也要上拋,不得讀成「尚未 apply」', async () => {
    const c = twoQueryClient(FULL, undefined, true, undefined, true, null, false);
    // 🔴 這一格守的是 `undefined` 與 `null` 的分別(F-004 那組被 code-reviewer 抓過一次的那格)：
    //    讀成「尚未 apply」⇒ 值班的人跑去查 migration，而它 apply 了
    //    ⇒ 紅在對的時候、指向錯的地方。
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow();
  });

  it('[A4] 🔴 42883 而探針說函式【在】⇒ 原封上拋(函式體壞了,必須吵)', async () => {
    // email=undefined ⇒ 丟 42883；emailProbeMissing=false ⇒ 探針說它在
    const c = twoQueryClient(FULL, undefined, true, undefined, true, undefined, false);
    // 🔴 怎麼會紅:照碼降級(不做 to_regprocedure 複查)⇒ 這裡不拋,而一支壞掉的函式
    //    會被安靜地讀成「今天沒事」,而它不會自己好。
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null),
    ).rejects.toThrow();
  });

  it('[A5] 傳給 RPC 的兩個秒數參數真的送出去了(而它們沒有 DEFAULT,漏傳 = 找不到簽章)', async () => {
    const c = twoQueryClient(FULL, undefined, true, undefined, true, OK, false);
    await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null);
    const call = (c.query as ReturnType<typeof vi.fn>).mock.calls.find((x) =>
      String(x[0]).includes('get_email_outbox_deadman_counts'),
    );
    // 🔴 怎麼會紅:少傳一個參數、或傳錯順序 ⇒ 這裡紅。
    //    而在正式庫上那個症狀是「找不到相符的函式簽章」，不是一個看得懂的錯。
    expect(call?.[1]).toEqual([3600, 3600]);
  });
});
