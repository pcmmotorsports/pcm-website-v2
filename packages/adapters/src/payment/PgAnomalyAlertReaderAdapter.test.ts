// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { CRON_JOB_WHITELIST, FAILURE_COUNT_MEANINGLESS } from '@pcm/domain';
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
  /**
   * 🔵 **第七支(2026-08-31 片3)**:`get_cron_heartbeat_stale_counts`。
   * 🔴 預設 `undefined` = 尚未 apply ⇒ 既有那 20+ 格全部落 `cronHeartbeatUnknown: true`。
   *    ⇒ 📌 **那正是今天的事實**:那支函式今天還沒 apply 到正式庫(片4 才會)。
   *      **理由與預設值這一次是一致的** —— 而上面 `orderCreated` 那一段記著它們曾經不一致。
   */
  heartbeat?: unknown,
  heartbeatProbeMissing = true,
  /**
   * 🔵 **第八支(2026-09-01 板 ⟦b4-SIG4ERRORS⟧)**:`get_order_created_stuck_count`。
   * 🛑 **這個預設值正是 code-reviewer 2026-09-01 抓到那個洞的一半**:
   *   既有 41 處呼叫的第 7 個參數全是 `null` ⇒ adapter 根本不呼叫這支
   *   ⇒ ⇒ **那一整段新碼的測試分母是 0。**下面那幾格就是把分母補起來。
   *   📌 本檔對【出貨那一支】逐字記過同一件事 —— 而我重犯了一次。
   */
  stuck?: unknown,
  stuckProbeMissing = true,
  /**
   * 🔵 **未付款取消信線的收件人計數**(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-03)。
   * 🔴 **預設 `undefined` = 尚未 apply(42883)⇒ 降級 unknown** —— 而那個預設
   *    **就是今天正式庫的真實狀態**, 不是為了讓既有測試好過。
   *    ⇒ 📌 本檔上面那段記著「預設值與理由曾經不一致」的教訓;這一次我把理由寫在旁邊。
   */
  unpaidCancelled?: unknown,
  /**
   * ⟦b4-NORECIPIENTWINDOW⟧ **第四條線**(2026-09-04):同樣預設 `undefined` = 那支 RPC **尚未 apply**。
   * 🔴 而這一次的理由也是**當下的事實**:`20260904280000_m4b_e4_tracking_corrected_gap_counts.sql`
   *    是今天才寫的、**還沒貼**(它自己還有一道前置閘要求 `20260904220000` 先貼)。
   * ⇒ 📌 預設值讓既有那 20+ 格繼續測【今天線上真的是那個世界】—— 一格期望值都不用動。
   */
  trackingCorrected?: unknown,
  /**
   * 🔵 ⟦b4-PENDINGREFUNDSILENT⟧(2026-09-05):`get_pcm_incident_health`。
   * 🔴 **預設 `undefined` = 那支 RPC 不存在** —— 而這一格與上面幾支【理由不同】:
   *    `20260905290000` **今天已經被 Sean 貼進正式庫了**(帳本有記)。
   *    ⇒ 預設值留 `undefined` 是為了**讓既有那 20+ 格的世界不變**, 不是在描述線上狀態。
   *    ⇒ 📌 要測「它在」的世界, **明確傳一份 payload 進來**。
   * 🔴 **排在最後, 不插中間** —— 位置參數插中間會讓既有呼叫端安靜錯位, 而型別全是 `unknown`
   *    ⇒ typecheck 不會紅。
   */
  incident?: unknown,
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
                      : text.includes('get_cron_heartbeat_stale_counts')
                        ? heartbeatProbeMissing
                        : text.includes('get_order_created_stuck_count')
                          ? stuckProbeMissing
                          : probeMissing,
            },
          ],
        };
      }
      // 🔴 codex 2026-09-05 must-fix ②:原本**沒有這個分支**
      //    ⇒ 那一發查詢掉進最後的 `resultRows(counts)` ⇒ 解析永遠是 Unknown
      //    ⇒ 📌 **payload 正確也映射不出來、位置參數錯位, 查詢次數那一格照樣綠。**
      //    ⇒ 一個「只驗得到 Unknown」的 mock, 對這一族等於沒有測試。
      if (text.includes('get_pcm_incident_health')) {
        if (incident === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(incident);
      }
      if (text.includes('get_cron_heartbeat_stale_counts')) {
        if (heartbeat === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return { rows: [{ result: heartbeat }] };
      }
      // 🔵 `get_order_unpaid_cancelled_gap_counts` 與底下兩支**不共用前綴**
      //   (`get_order_created_` vs `get_order_unpaid_`)⇒ 這一格的順序不是分流的一部分。
      //   ⚠️ 寫出來, 免得下一個人以為它跟底下那格一樣「順序就是分流本身」。
      // 🔵 `get_tracking_corrected_gap_counts` 與其他幾支**不共用前綴** ⇒ 這一格的位置不是分流的一部分。
      if (text.includes('get_tracking_corrected_gap_counts')) {
        if (trackingCorrected === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(trackingCorrected);
      }
      if (text.includes('get_order_unpaid_cancelled_gap_counts')) {
        if (unpaidCancelled === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(unpaidCancelled);
      }
      // 🔴 **必須排在 `get_order_created_gap_counts` 之前** —— 兩個名字共用前綴
      //   `get_order_created_`, 而 `includes` 只看有沒有出現 ⇒ 順序就是分流本身。
      if (text.includes('get_order_created_stuck_count')) {
        if (stuck === undefined) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(stuck);
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
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
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
      // 🔵 未付款取消信線那三格(⟦b4-NORECIPIENTWINDOW⟧)。這一格是**窮舉比對**
      //   ⇒ 它會抓到「新增欄位而忘了接線」那種改法 —— 所以三欄都要在, 不是只寫 unknown。
      //   🔴 而值是 `true` / `null`:本測項的世界裡那支 RPC **尚未 apply**(stub 預設)
      //   ⇒ **不得寫成 0** ——「讀不到」與「一切正常」在裸數字上長得一模一樣。
      unpaidCancelledPendingCount: null,
      unpaidCancelledNoRecipientCount: null,
      unpaidCancelledGapUnknown: true,
      // 🔵 第四條線:同樣三格 null + unknown=true(那支 RPC 尚未 apply)。
      trackingCorrectedPendingCount: null,
      trackingCorrectedNoRecipientCount: null,
      trackingCorrectedGapUnknown: true,
      /**
       * 🔵 訊號 4 三格。本案例 `orderCreatedCutoffIso` 傳 `null` ⇒ **不呼叫那支 RPC**
       * ⇒ `orderCreatedRows` 空 ⇒ unknown = true、兩個 count 是 `null`。
       * 🛑 **期望值是從【呼叫端傳了什麼】推的,不是從跑出來的結果抄的。**
       */
      orderCreatedPaidNoEmailCount: null,
      orderCreatedNoRecipientCount: null,
      orderCreatedGapUnknown: true,
      orderCreatedStuckCount: null,
      orderCreatedStuckOldestMinutes: null,
      orderCreatedStuckUnknown: true,
      // 🔵 片3:harness 預設「那支函式還沒 apply」⇒ 三欄落 unknown 那一組。
      //    🛑 `Count` 是 `null` 不是 `0` —— 「讀不到」與「六支都健康」不得塌成同一個值。
      cronHeartbeatAbnormalCount: null,
      cronHeartbeatAbnormalJobs: null,
      cronHeartbeatUnknown: true,
      // ⟦b9-RLSHARDEN⟧ 甲片B:本 fixture 的 dispatcher 沒有分流這支 ⇒ 回預設 `{ rows: [] }`
      //   ⇒ `bypassRlsUnknown: true`(量不到), 而 `Revoked` 保持 false。
      // 🛑 **兩者不可互相推導** —— `Revoked: false` 在這裡的意思是「我沒量到」,
      //    不是「屬性還在」。那正是本片要分開的兩件事。
      bypassRlsRevoked: false,
      bypassRlsUnknown: true,
      // ⟦b9-ACLDRIFT5⟧ 片二(2026-09-05):本 fixture 沒有那一發回應 ⇒ 同一個世界:
      //   **量不到**(view 還沒貼)⇒ Unknown=true 而 Detected 保持 false。
      aclDriftDetected: false,
      aclDriftUnknown: true,
      aclDriftFamilies: null,
      aclDriftTakenAt: null,
      // ⟦b4-RETRYGAVEUPNOWATCHER⟧:本 fixture 沒有那一發回應 ⇒ 量不到。
      settleRetryGaveUpCount: null,
      settleRetryGaveUpUnknown: true,
      settleRetryGaveUpOldest: null,
      settleRetryGaveUpSampleIds: [],
      settleRetryGaveUpTracked: null,
      bypassRlsPrivilegedCount: null,
      bypassRlsTotalRoleCount: null,
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
      // 🔵 ⟦b4-PENDINGREFUNDSILENT⟧(2026-09-05):本 fixture 的 mock 沒有回
      //    `get_pcm_incident_health` 的東西 ⇒ 那一格**應該**落 Unknown。
      //    🔴 `pcmIncidentUnknown: true` 就是這一族的驗收:**沒讀到不可以印 0。**
      pcmIncidentOpenTotal: null,
      pcmIncidentUnknown: true,
      pcmIncidentOldest: null,
      pcmIncidentByKind: {},
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
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
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
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    // 🔴 三支函式**都要被呼叫到** —— 少了這一格,「只打了計數那支」與「其餘全空」在觀察上一樣。
    //    (F-004 起是三支:計數 / 單號 / 退款卡住計數。)
    /**
     * 🔴 **3 → 5,而那兩發【不是常態成本】** —— 這一格的世界是「寄信那支 RPC 尚未 apply」:
     *   +1 = 打那支 RPC(它 throw 42883)· +1 = `to_regprocedure` 複查它到底在不在
     * ⇒ **apply 之後只會多 1 發**,不是 2 發。
     * 📌 寫出來是因為:一個「多兩發查詢」的數字,會被讀成這片的固定代價,而它是**部署窗口的代價**。
     */
    /**
     * 🔵 **5 → 7(2026-08-31 片3 心跳)** —— 而這個數字是**先推出來、再量到的**,不是抄回來的:
     *   心跳那支同樣走「尚未 apply」那條路 ⇒ +1 打它(throw 42883)· +1 `to_regprocedure` 複查
     *   ⇒ 與上面寄信那兩發**同一個形狀** ⇒ 5 + 2 = 7。實跑也是 7。
     * ⇒ 📌 **apply 之後這一格會掉回 6**(每支只剩 1 發)—— 那時要改的是這個數字, 不是碼。
     */
    /**
     * 🔵 **7 → 8(2026-09-02 ⟦b9-RLSHARDEN⟧ 甲片B)** —— 而它 **+1 不是 +2**,
     *    **與上面兩段的算式【不同】,所以我沒有照抄那個形狀**:
     *    上面兩發是 +2(打它 ⇒ throw `42883` ⇒ 再 `to_regprocedure` 複查),
     *    而本 fixture 的 `twoQueryClient` 對**沒有分流到的 SQL** 回的是 `resultRows(counts)`
     *    —— **它不 throw** ⇒ 走不到那條複查 ⇒ 只 +1。
     *    ⛔ ~~我第一版寫「回預設 `{ rows: [] }`」~~ —— **codex 2026-09-02 nit 打掉**:
     *       那是 `makeClient` 的預設, 不是 `twoQueryClient` 的。
     *       🎯 **兩者今天剛好都落 Unknown(一個是空 rows, 一個是 counts 物件裡沒有那個 key)**
     *       ⇒ 📌 **結論相同而事實宣稱是錯的 —— 而結論相同正是它不會被發現的原因。**
     * 🎯 **而兩條路的【結論相同】**:空 rows 與 42883 都落到 `bypassRlsUnknown = true`
     *    ⇒ 行為對,而**成本的算式不同** ⇒ 這裡寫 8。
     * 🛑 **⇒ 正式庫上若那支函式真的不存在,它會是 +2** —— 這個數是**本 fixture 的數字**,
     *    不是「線上會打幾發」。數字帶著它的世界跟著走。
     *
     * 🔴🔴 **⛔ ~~8~~ ⇒ ✅ 10(2026-09-04, ⟦b4-NORECIPIENTWINDOW⟧ 第四條線)。**
     *    多的那 2 發 = `get_tracking_corrected_gap_counts` 本身 **+1**、
     *    以及它 42883 之後的 `to_regprocedure` 複查 **+1**
     *    ⇒ 📌 **正好演了上面那句「函式真的不存在會是 +2」** —— 而這一次是真的走到了那條路,
     *      因為本 fixture 的 dispatcher 對這支預設 `undefined`(= 尚未 apply)。
     *    🔵 而它是**唯一**會 +2 的一支:姊妹的 `get_order_unpaid_cancelled_gap_counts`
     *      被 `if (cutoff !== null)` 包著, 本組沒設 cutoff ⇒ 它 +0。
     */
    // 🔵 2026-09-05 從 10 ⇒ 11:⟦b9-ACLDRIFT5⟧ 片二多一發 `pcm_acl_drift_status`。
    //    🔴 這個數字**是承重的** —— 它釘住「我加了一發查詢」會被看見,
    //       而不是安靜地多打一次資料庫。
    // 🔵 11 ⇒ 12:⟦b4-RETRYGAVEUPNOWATCHER⟧ 多一發 get_settle_retry_gaveup_health。
      // 🔵 12 ⇒ 13(2026-09-05:多一發 `SELECT public.get_pcm_incident_health()`)。
      expect(query).toHaveBeenCalledTimes(13);
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
    ).rejects.toThrow();
  });

  // 🔴🔴 **同一個 `42883`,兩個完全不同的世界** —— 這一對是本片最容易被寫成「一個 catch 全吞」的地方。
  it('🔴 `42883` 但函式【存在】(=錯在函式體內)⇒ **上拋**,不得降級成「今天沒有單號」', async () => {
    const { client } = twoQueryClient(FULL, undefined, /* probeMissing */ false);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
    ).rejects.toThrow();
  });

  it('🔴 正向對照:同樣的形狀但碼是 `42883` ⇒ **不 throw**、五欄降級成 []', async () => {
    // 少了這一格,上面那三格的「會 throw」與「這條路根本不會降級」不可分辨。
    const { client } = twoQueryClient(FULL);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(res.openDisplayIds).toEqual([]);
    expect(res.openCount).toBe(2); // 計數那支照常回 ⇒ 告警照寄,只是沒有單號
  });

  it('count 欄以字串回(pg bigint→string)仍解析為數字', async () => {
    const { client } = twoQueryClient({ ...FULL, open_count: '5', oldest_open_age_seconds: '3600' });
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
    ).rejects.toMatchObject({ code: '28P01' });
    // 訊息不含 pg 原文(password/連線字串)
    try {
      await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    } catch (e) {
      expect((e as Error).message).not.toContain('password');
      expect((e as Error).message).not.toContain('db.xxx');
    }
  });

  it('end throw 不蓋主錯誤(finally 吞)', async () => {
    const { client } = twoQueryClient(FULL);
    (client.end as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('end failed'));
    // 主 op 成功 → 即使 end throw 也回正常結果
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
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
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(res.orderRefundsStuckCount).toBe(5);
    expect(res.orderRefundsStuckOvernightCount).toBe(2);
    expect(res.orderRefundsStuckUnknown).toBe(false);
  });

  it('🔴 函式不存在(42883 且探測說真的不在)→ unknown + null,**不得是 0**', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, undefined, /* refundsProbeMissing */ true);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(res.orderRefundsStuckUnknown).toBe(true);
    expect(res.orderRefundsStuckCount).toBeNull();
    // 🔴 這一行是本組的重點:`null` 與 `0` 在下游會印不同的字,寫成 0 就等於說謊。
    expect(res.orderRefundsStuckCount).not.toBe(0);
  });

  it('🔴 42883 但探測說函式【存在】(=錯在函式體內)⇒ 上拋,不得降級成 unknown', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, undefined, /* refundsProbeMissing */ false);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
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
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
    ).rejects.toThrow(/異常/);
  });

  it('🔴 對照:同一條路但函式真的不存在 ⇒ unknown(證明上一格紅的是 NULL 不是別的)', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, undefined);
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(res.orderRefundsStuckUnknown).toBe(true);
  });

  it('🔴 錯誤訊息要指向【這一支】函式,不是隔壁那支(值班的人會照著去查)', async () => {
    const { client } = twoQueryClient(FULL, undefined, true, {});
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
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
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null, null);
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

  // ══ 🔵🔵 訊號4【持續失敗】那支 RPC(2026-09-01;code-reviewer must-fix 3)══
  //   🔴 它指的洞逐字:**既有 41 處呼叫的第 7 個參數全是 null** ⇒ adapter 那一整段新碼
  //     從來沒有被執行過 ⇒ 把 $1/$2 寫反、函式名打錯、鍵名打錯, **三綠全綠**。
  //   📌 而本檔在【出貨那一支】上逐字記過同一件事 —— 我重犯了一次。下面五格是那個分母。
  const STUCK_OK = { stuck_count: 3, oldest_stuck_minutes: 240 };
  const CUT = '2026-08-22T00:00:00.000Z';

  it('[K1] 🔵 兩顆 env 都有值 ⇒ 兩個 key 都解析得出來, 而且不是 unknown', async () => {
    const c = twoQueryClient(
    // 位置: counts, ids, probe, refunds, refundsProbe, email, emailProbe,
    //       shipped, shippedProbe, orderCreated, orderCreatedProbe,
    //       heartbeat, heartbeatProbe, stuck, stuckProbe
    FULL, undefined, true, undefined, true, undefined, true, undefined, true,
    undefined, true, undefined, true, STUCK_OK, false,
  );
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, null, 900, CUT, 60,
    );
    expect(r.orderCreatedStuckUnknown).toBe(false);
    expect(r.orderCreatedStuckCount).toBe(3);
    // 🔴 鍵名打錯【不會 typecheck 紅】—— 兩邊都是合法字串 ⇒ 這一格是唯一擋得住的。
    expect(r.orderCreatedStuckOldestMinutes).toBe(240);
  });

  it('[K2] 🔴🔴 參數要【逐字】傳下去, 而且順序不能反', async () => {
    const seen: Array<{ text: string; params?: unknown[] }> = [];
    const base = twoQueryClient(
    // 位置: counts, ids, probe, refunds, refundsProbe, email, emailProbe,
    //       shipped, shippedProbe, orderCreated, orderCreatedProbe,
    //       heartbeat, heartbeatProbe, stuck, stuckProbe
    FULL, undefined, true, undefined, true, undefined, true, undefined, true,
    undefined, true, undefined, true, STUCK_OK, false,
  );
    const c = {
      ...base,
      query: async (text: string, params?: unknown[]) => {
        seen.push({ text, params });
        return base.query(text, params ?? []);
      },
    };
    await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, null, 900, CUT, 60,
    );
    const call = seen.find((q) => q.text.includes('get_order_created_stuck_count'));
    expect(call).toBeDefined();
    // 🔴 型別擋得住【順序反】(timestamptz / integer), 擋不住【值送錯】(例如把 60 寫死)
    //   ⇒ 只有這一格擋得住後者。
    expect(call!.params).toEqual([CUT, 60]);
  });

  it('[K3] 🔵 門檻沒設(還沒上膛)⇒ 那一發查詢根本沒有發出去', async () => {
    const seen: string[] = [];
    const base = twoQueryClient(
    // 位置: counts, ids, probe, refunds, refundsProbe, email, emailProbe,
    //       shipped, shippedProbe, orderCreated, orderCreatedProbe,
    //       heartbeat, heartbeatProbe, stuck, stuckProbe
    FULL, undefined, true, undefined, true, undefined, true, undefined, true,
    undefined, true, undefined, true, STUCK_OK, false,
  );
    const c = {
      ...base,
      query: async (text: string, params?: unknown[]) => {
        seen.push(text);
        return base.query(text, params ?? []);
      },
    };
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, null, 900, CUT, null,
    );
    // 🛑 這一格就是「落地零風險」的證據。
    expect(seen.some((t) => t.includes('get_order_created_stuck_count'))).toBe(false);
    expect(r.orderCreatedStuckCount).toBeNull();
  });

  it('[K4] 🔴 RPC 尚未 apply(42883)⇒ 降級成 unknown, 而【不是 0】', async () => {
    const c = twoQueryClient(
    // 位置: counts, ids, probe, refunds, refundsProbe, email, emailProbe,
    //       shipped, shippedProbe, orderCreated, orderCreatedProbe,
    //       heartbeat, heartbeatProbe, stuck, stuckProbe
    FULL, undefined, true, undefined, true, undefined, true, undefined, true,
    undefined, true, undefined, true, undefined, true,
  );
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
      86400, 43200, 600, null, 900, CUT, 60,
    );
    // 🔴 「讀不到」與「今天沒有卡住的單」在一個裸數字上長得一模一樣 ⇒ 必須 null 不是 0。
    expect(r.orderCreatedStuckUnknown).toBe(true);
    expect(r.orderCreatedStuckCount).toBeNull();
  });

  it('[K5] 🔴 probe 說函式【在】⇒ 那個 42883 來自函式內部 ⇒ 必須上拋', async () => {
    const c = twoQueryClient(
    // 位置: counts, ids, probe, refunds, refundsProbe, email, emailProbe,
    //       shipped, shippedProbe, orderCreated, orderCreatedProbe,
    //       heartbeat, heartbeatProbe, stuck, stuckProbe
    FULL, undefined, true, undefined, true, undefined, true, undefined, true,
    undefined, true, undefined, true, undefined, false,
  );
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(
        86400, 43200, 600, null, 900, CUT, 60,
      ),
    ).rejects.toThrow();
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
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null, null);
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
    await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null, null);
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
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(seen.some((t) => t.includes('get_shipped_email_gap_counts'))).toBe(false);
    expect(r.shippedGapUnknown).toBe(true);
    // 🔴 **不是 0** —— 「沒上膛」與「一切正常」在裸數字上長得一模一樣。
    expect(r.shippedNeverEnqueuedCount).toBeNull();
  });

  it('[S4] 🔴 42883 + 探測說函式真的不存在 ⇒ unknown(部署窗口), 不上拋', async () => {
    const c = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, undefined, true);
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null, null);
    expect(r.shippedGapUnknown).toBe(true);
  });

  it('[S5] 🔴🔴 42883 而探測說函式【在】⇒ 原封上拋(那個 42883 來自函式內部)', async () => {
    // 🛑 這一格是 S4 的翻面:少了它, 一個「凡是 42883 都當 unknown」的實作會全綠,
    //   而那會把【函式內部的錯】吞成「還沒 apply」⇒ 一個真的壞掉被讀成部署窗口。
    const c = twoQueryClient(FULL, undefined, true, undefined, true, undefined, true, undefined, false);
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null, null),
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
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null, null);
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
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, '2026-08-31T00:00:00.000Z', 900, null, null);
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
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z', null);
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
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null, null);
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
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z', null);
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
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z', null),
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
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, '2026-08-20T00:00:00.000Z', 900, null, null),
    ).rejects.toThrow();
  });

  it('[A2] 🔴 缺鍵 ⇒ fail-closed 上拋,【不】當成 unknown', async () => {
    const { signal2_dead_letter_count: _drop, ...missing } = OK;
    const c = twoQueryClient(FULL, undefined, true, undefined, true, missing, false);
    // 🔴 怎麼會紅:把缺鍵也當成 unknown ⇒ 這裡不會拋,而信上會印「查不到」
    //    ⇒ 「函式不在」與「函式回了垃圾」是兩件事,後者必須吵。
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null, null),
    ).rejects.toThrow();
  });

  it('[A3] 🔴 函式【存在】而回 SQL NULL ⇒ 也要上拋,不得讀成「尚未 apply」', async () => {
    const c = twoQueryClient(FULL, undefined, true, undefined, true, null, false);
    // 🔴 這一格守的是 `undefined` 與 `null` 的分別(F-004 那組被 code-reviewer 抓過一次的那格)：
    //    讀成「尚未 apply」⇒ 值班的人跑去查 migration，而它 apply 了
    //    ⇒ 紅在對的時候、指向錯的地方。
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null, null),
    ).rejects.toThrow();
  });

  it('[A4] 🔴 42883 而探針說函式【在】⇒ 原封上拋(函式體壞了,必須吵)', async () => {
    // email=undefined ⇒ 丟 42883；emailProbeMissing=false ⇒ 探針說它在
    const c = twoQueryClient(FULL, undefined, true, undefined, true, undefined, false);
    // 🔴 怎麼會紅:照碼降級(不做 to_regprocedure 複查)⇒ 這裡不拋,而一支壞掉的函式
    //    會被安靜地讀成「今天沒事」,而它不會自己好。
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null, null),
    ).rejects.toThrow();
  });

  it('[A5] 傳給 RPC 的兩個秒數參數真的送出去了(而它們沒有 DEFAULT,漏傳 = 找不到簽章)', async () => {
    const c = twoQueryClient(FULL, undefined, true, undefined, true, OK, false);
    await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    const call = (c.query as ReturnType<typeof vi.fn>).mock.calls.find((x) =>
      String(x[0]).includes('get_email_outbox_deadman_counts'),
    );
    // 🔴 怎麼會紅:少傳一個參數、或傳錯順序 ⇒ 這裡紅。
    //    而在正式庫上那個症狀是「找不到相符的函式簽章」，不是一個看得懂的錯。
    expect(call?.[1]).toEqual([3600, 3600]);
  });
});

/**
 * 🔴🔴 **這一組承接片2 那支 migration 的具名缺口。**
 *
 * `get_cron_heartbeat_stale_counts` **在 DB 那一側證明不了「呼叫端餵的是完整六支」** ——
 * 一個合法但少一支的陣列會完整通過, 而**那支死掉的排程完全隱形**(它的 `checked` 只證明
 * 「收到幾條就跑幾條」)。成因是設計換來的:唯一名單在 TS ⇒ DB 照定義不知道應該有幾支。
 *
 * ⇒ 📌 **所以那個保護只能長在這裡。** 落點與斷言在
 *   `docs/plans/2026-08-31-cron-heartbeat-into-alerter.md` 片3 那一節先寫死, 再寫這支。
 */
describe('🔴 更正單號信 gap counts:【成功路徑】—— 而它原本一格都沒有', () => {
  /**
   * 🔴🔴 **codex 2026-09-04 must-fix #5**:本檔的 dispatcher 對這支預設 `undefined`
   *    (= 尚未 apply)⇒ 既有 20+ 格走的**全部是「RPC 不存在」那條路**
   *    ⇒ 📌 **把成功回傳的解析整段硬寫成 null/unknown, 那些格子照樣全綠。**
   *    ⇒ 而「不會弄壞別人」與「它真的解析得出來」是兩個宣稱, 我只證了前者。
   *
   * 🛑 **這裡【不用 `twoQueryClient`】** —— 它的 `trackingCorrected` 是**第 17 個位置參數**,
   *    要餵它得先打 15 個 `undefined`。⇒ 那種呼叫**沒有人讀得懂,也沒有東西擋得住數錯一格**
   *    (型別全是 `unknown`)。⇒ 改成一個只認函式名的本地假 client(形狀抄本檔心跳那組)。
   */
  function trackingClient(payload: unknown) {
    const { client } = makeClient({
      query: async (text: string) => {
        if (text.includes('get_tracking_corrected_gap_counts')) return resultRows(payload);
        if (text.includes('to_regprocedure')) return { rows: [{ missing: true }] };
        // 🔵 其餘選配 RPC 一律走「尚未 apply」—— 它們各自的回傳鍵不同,
        //    餵同一份 `FULL` 會被 `parseCount` 的 fail-closed 擋下。
        for (const fn of [
          'get_order_refunds_stuck_summary',
          'get_email_outbox_deadman_counts',
          'get_shipped_email_gap_counts',
          'get_order_created_gap_counts',
          'get_cron_heartbeat_stale_counts',
          'get_order_created_stuck_count',
          'get_order_unpaid_cancelled_gap_counts',
          'get_privileged_role_bypassrls_state',
          'get_payment_anomaly_alert_display_ids',
        ]) {
          if (text.includes(fn)) {
            throw Object.assign(new Error('function does not exist'), { code: '42883' });
          }
        }
        return resultRows(FULL);
      },
    });
    return client;
  }

  const run = (payload: unknown) =>
    new PgAnomalyAlertReaderAdapter('conn', () => trackingClient(payload)).getAlertSummary(
      86400, 43200, 600, null, 900, null, null,
    );

  it('🟢 RPC 存在 ⇒ 三格解析成具體的數, 而 unknown=false', async () => {
    const out = await run({
      pending_count: 7,
      no_recipient_count: 2,
      corrected_shipments_total_count: 9,
    });
    // 🔴 承重:把 `trackingCorrectedCount(...)` 硬寫成 null ⇒ 這三行全紅。
    expect(out.trackingCorrectedPendingCount).toBe(7);
    expect(out.trackingCorrectedNoRecipientCount).toBe(2);
    expect(out.trackingCorrectedGapUnknown).toBe(false);
  });

  it('🔴 少一個 key ⇒ throw(fail-loud), 不是靜靜地變成 0', async () => {
    await expect(
      run({ pending_count: 1, corrected_shipments_total_count: 1 }),
    ).rejects.toThrow(/get_tracking_corrected_gap_counts/);
  });

  it('🔴 計數是負數 ⇒ throw —— 一個負的積壓數比一個錯的數更該吵', async () => {
    await expect(
      run({ pending_count: 1, no_recipient_count: -1, corrected_shipments_total_count: 1 }),
    ).rejects.toThrow(/no_recipient_count/);
  });
});

describe('🔴 心跳:傳給 RPC 的 job 清單 = CRON_JOB_WHITELIST 全部, 沒有被過濾過', () => {
  function captureHeartbeatPayload() {
    const seen: { payload: Array<Record<string, unknown>> | null } = { payload: null };
    const { client } = makeClient({
      query: async (text: string, values: unknown[]) => {
        if (text.includes('get_cron_heartbeat_stale_counts')) {
          seen.payload = JSON.parse(String(values[0])) as Array<Record<string, unknown>>;
          return resultRows({ checked: CRON_JOB_WHITELIST.length, abnormal_count: 0, never_beat: [], no_success_ts: [], stale: [], future: [], failing: [] });
        }
        if (text.includes('to_regprocedure')) return { rows: [{ missing: true }] };
        // 🔴 其餘幾支選配 RPC 一律走「尚未 apply」那條路 —— 它們各自有不同的回傳鍵,
        //    餵同一個 `FULL` 會被 `parseCount` 的 fail-closed 擋下(我第一版就是這樣紅的)。
        //    ⇒ 這一格只在測心跳那條路, 其餘刻意降級, **而降級不影響本組要驗的東西**。
        for (const fn of [
          'get_order_refunds_stuck_summary',
          'get_email_outbox_deadman_counts',
          'get_shipped_email_gap_counts',
          'get_order_created_gap_counts',
          'get_payment_anomaly_alert_display_ids',
          // 🔴 ⟦b4-NORECIPIENTWINDOW⟧ 第四條線(2026-09-04)**非加不可**, 而理由與別支不同:
          //    姊妹的 `get_order_unpaid_cancelled_gap_counts` **不在這張清單上也沒事** ——
          //    因為 adapter 那邊用 `if (cutoff !== null)` 包著它, 而本組沒設 cutoff ⇒ 它根本不會被呼叫。
          //    而**我這一支沒有那個守門**(母體天生從空的開始長 ⇒ 不需要 cutoff)
          //    ⇒ 🎯 **它每一發都會被呼叫** ⇒ 不在這裡降級的話, 它會吃到 `FULL`
          //      而 `parseCount` 當場 fail-closed(我第一版就是這樣紅了 8 格)。
          'get_tracking_corrected_gap_counts',
        ]) {
          if (text.includes(fn)) throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        return resultRows(FULL);
      },
    });
    return { client, seen };
  }

  it('送出的 job_name 集合與白名單【逐一相同】(比集合, 不比長度)', async () => {
    const { client, seen } = captureHeartbeatPayload();
    await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(seen.payload).not.toBeNull();
    // 🔴 **比集合不比長度** —— 長度相同而成員不同會過, 而那正是片2 那個「重複 job_name」的病:
    //    送同一支六次 ⇒ 長度 6、DB 的 `checked` 也是 6, 而五支死掉的排程沒有被檢查。
    expect(seen.payload!.map((j) => j.job_name).sort()).toEqual(
      [...CRON_JOB_WHITELIST].map((w) => w.jobName).sort(),
    );
  });

  it('每一條都帶 stale_minutes 與 failures_meaningful(片2 那兩道 RAISE 的鏡像)', async () => {
    const { client, seen } = captureHeartbeatPayload();
    await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    for (const j of seen.payload!) {
      // 🛑 缺任何一鍵, 片2 那支函式會 RAISE ⇒ 整段降級成【查不到】⇒ 心跳告警靜靜地不叫。
      expect(typeof j.stale_minutes).toBe('number');
      expect(typeof j.failures_meaningful).toBe('boolean');
    }
  });

  it('🔵 failures_meaningful 對 FAILURE_COUNT_MEANINGLESS 那一支是 false, 其餘 true', async () => {
    const { client, seen } = captureHeartbeatPayload();
    await new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    // 🔴 這一格分得出兩個世界:全 true(= 忘了接白名單)與正確分流, 在上一格底下印同一個綠。
    const meaningless = seen.payload!.filter((j) => j.failures_meaningful === false).map((j) => j.job_name);
    expect(meaningless).toEqual([...FAILURE_COUNT_MEANINGLESS]);
    expect(meaningless.length).toBeGreaterThan(0);
  });
});

/**
 * 🔴 **回應側的邊界(codex 2026-08-31 片3 R1 #6)。**
 * 上面那三格只驗「送出去的 payload」—— 而**餵它一個畸形的回應, 它們照樣全綠**。
 * ⇒ 這一組驗的是另一半:回應壞掉時**要吵**, 而不是安靜地看起來健康。
 */
describe('🔴 心跳:回應層對帳(壞回應要 throw, 不是靜靜地健康)', () => {
  function withHeartbeatResult(result: unknown) {
    return makeClient({
      query: async (text: string) => {
        if (text.includes('get_cron_heartbeat_stale_counts')) return resultRows(result);
        if (text.includes('to_regprocedure')) return { rows: [{ missing: true }] };
        for (const fn of [
          'get_order_refunds_stuck_summary', 'get_email_outbox_deadman_counts',
          'get_shipped_email_gap_counts', 'get_order_created_gap_counts',
          'get_payment_anomaly_alert_display_ids',
          // 🔴 第四條線非加不可 —— 它在 adapter 那邊【沒有 cutoff 守門】⇒ 每一發都會被呼叫。
          'get_tracking_corrected_gap_counts',
        ]) {
          if (text.includes(fn)) throw Object.assign(new Error('nope'), { code: '42883' });
        }
        return resultRows(FULL);
      },
    }).client;
  }
  // 🔴 **不寫死 7**(2026-09-05 加第七支 `pcm-acl-digest` 時這兩處紅了;同一天 `-mail`
  //    加它那支時也撞過同一格)—— 寫死的話下一個加排程的人會再撞一次,
  //    而他要花一輪才知道是這裡。⇒ 改成跟著白名單長度走。
  // 🛑 而這【不是循環論證】:本 fixture 演的是「DB 說它把白名單全部查過了」,
  //    被測的斷言是 `checked !== 白名單長度 ⇒ throw`;下面那格用寫死的 5 演「少查了」
  //    ⇒ 兩個世界仍然印不同的答案。
  const healthy = { checked: CRON_JOB_WHITELIST.length, abnormal_count: 0, never_beat: [], no_success_ts: [], stale: [], future: [], failing: [] };
  const call = (result: unknown) =>
    new PgAnomalyAlertReaderAdapter('conn', () => withHeartbeatResult(result)).getAlertSummary(86400, 43200, 600, null, 900, null, null);

  it('🟢 正對照:健康回應解析得出來(先證明這條路真的通)', async () => {
    const r = await call(healthy);
    expect(r.cronHeartbeatUnknown).toBe(false);
    expect(r.cronHeartbeatAbnormalCount).toBe(0);
  });

  it('🔴 checked 少於白名單支數 ⇒ throw(少查的那幾支會靜靜地看起來健康)', async () => {
    await expect(call({ ...healthy, checked: 5 })).rejects.toThrow(/檢查了 5 支/);
  });

  it('🔴 abnormal_count 大於 checked ⇒ throw', async () => {
    // 🔴 這裡的 7 原本是【比 checked(當時 6)大】的意思。白名單長到 7 之後,
    //    7 不再大於 checked ⇒ 它會走到另一條錯誤路徑, 而測試名字仍寫著 abnormal_count。
    //    📌 **一個寫死的數字, 表達的是一個【關係】而不是一個值。** ⇒ 改成 length + 1。
    await expect(call({ ...healthy, abnormal_count: CRON_JOB_WHITELIST.length + 1 })).rejects.toThrow(/abnormal_count/);
  });

  /**
   * 🔴 這一格是本組最重要的:`count > 0` 而五個原因陣列全空
   * ⇒ 信裡會寫「有 2 支不正常」而**說不出是哪一支**, 而那是收信人要做的第一件事。
   */
  it('🔴 有數字而零名字 ⇒ throw(那封信對收信人等於沒有)', async () => {
    await expect(call({ ...healthy, abnormal_count: 2 })).rejects.toThrow(/去重後有 0 支/);
  });

  /**
   * 🔴 **這一格是 codex R2 指名的**:我第一版只擋「零名字」,而 `count=2 / 名字=1`
   *   會通過並**寄出一份少一支的名單** —— 收信人會照那份名單去看,而少的那支沒有人會發現。
   * 📌 兩邊該相等的理由:片2 那支 SQL 的 `flagged` 是**每支 job 一列**,
   *   `abnormal_count` 數的是【列】⇒ 它就等於五個陣列去重後的支數。
   */
  it('🔴 數字 2 而只有 1 個名字 ⇒ throw(少一支的名單比沒有名單更糟)', async () => {
    await expect(
      call({ ...healthy, abnormal_count: 2, stale: [{ job_name: 'pcm-settle-sweep' }] }),
    ).rejects.toThrow(/去重後有 1 支/);
  });

  it('🟢 有數字也有名字 ⇒ 通過, 而名字要去重(同一支兩個理由只算一次)', async () => {
    const r = await call({ ...healthy, abnormal_count: 1, stale: [{ job_name: 'pcm-settle-sweep' }], failing: [{ job_name: 'pcm-settle-sweep' }] });
    expect(r.cronHeartbeatAbnormalJobs).toEqual(['pcm-settle-sweep']);
  });

  it('🔴 缺鍵(abnormal_count 不見了)⇒ throw, 不得當成 0', async () => {
    const { checked, never_beat, no_success_ts, stale, future, failing } = healthy;
    await expect(call({ checked, never_beat, no_success_ts, stale, future, failing })).rejects.toThrow();
  });
});

// ⟦b9-ENUMWATCH⟧ 片 2:客戶搜尋計數。**這一族的全部重點是「42883 有兩個意思」。**
//
// 🔴 而那不是推論, 是量的(2026-09-01 拋棄式 PG 17.10, 三行就造得出來):
//    世界 A 函式在而函式體裡少東西 ⇒ 42883 · to_regprocedure IS NULL ⇒ **false**
//    世界 B 函式真的不存在        ⇒ 42883 · to_regprocedure IS NULL ⇒ **true**
//    ⇒ **兩個世界的 SQLSTATE 完全相同, 而只有那發探詢分得開。**
//
// 🛑🛑 **而【錯誤訊息裡的名字, 是最內層失敗的那個東西, 不是你呼叫的那個】** ——
//    世界 A 的訊息寫的是那個 helper 的名字 ⇒ 任何「訊息裡有沒有提到我們那支函式」的判斷
//    在世界 A 會判成「不是我們的問題」而降級 ⇒ **一支壞掉的函式被讀成「今天沒有人搜尋客戶」。**
describe('⟦b4-NEEDSHUMANNOWATCHER⟧ getStuckBankOrdersHealth — 42883 的兩個世界', () => {
  // 🔴🔴 **這個 describe 存在的理由是 codex 2026-09-05 must-fix ⑤ 逐字**:
  //    「現有 adapter 測試零次呼叫此方法;把整個 method body 換成永遠 `return null`,
  //     現有 use-case 測試仍全綠。」
  //    ⇒ 🎯 **我驗了 use-case 那一層的三個接點, 而 adapter 那一層【一格都沒有】。**
  //    🔵 而我查過:`getSearchLogHealth` 也是 0 次 —— **那是模子留下的缺口, 不是本片造成的**,
  //      而我不拿它當免責。那一格另開板列。
  const RPC = 'get_stuck_bank_orders_health';

  function stuckClient(opts: { result?: unknown; raise42883?: boolean; probeMissing?: boolean }) {
    return makeClient({
      query: async (text: string) => {
        if (text.includes('to_regprocedure')) {
          return { rows: [{ missing: opts.probeMissing === true }] };
        }
        if (opts.raise42883 === true) {
          // 🔴 訊息刻意寫【內層 helper 的名字】—— 那是世界 A 的真實形狀
          //   (`admin_compute_order_settlement` 是本 RPC 逐列呼叫的那一支)。
          const err = new Error('function public.admin_compute_order_settlement(uuid) does not exist') as Error & { code: string };
          err.code = '42883';
          throw err;
        }
        return { rows: [{ result: opts.result }] };
      },
    });
  }

  it('🟢 正常:回得出 count 與 oldest', async () => {
    const { client } = stuckClient({ result: { stuck_count: 3, oldest_created: '2026-09-01T10:00:00.000Z', overpaid_count: 0, overpaid_oldest: null, measured: true } });
    const out = await new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth();
    expect(out).toEqual({ stuckCount: 3, oldestCreated: '2026-09-01T10:00:00.000Z', overpaidCount: 0, overpaidOldest: null });
  });

  /**
   * 🔴🔴 ⟦b4-PAIDTHENOVERPAID⟧ 第二個世界的三格(2026-09-05)。
   * 🛑 **而這幾格的由來值得寫下來**:我用一發正則把「期望值」批次補上了新的兩欄,
   *    **而 fixture 那一半沒被同一發改到** ⇒ 上面那格當場紅。
   *    ⇒ 📌 **一個機械修法可以只改到【一半】, 而它在 diff 上看起來完整。**
   *    🔵 抓到它的不是我更仔細, 是那一格本來就在跑。
   */
  it('🟢 兩個世界都有值 ⇒ 四欄各歸各位(不互相冒充)', async () => {
    const { client } = stuckClient({ result: {
      stuck_count: 2, oldest_created: '2026-09-01T10:00:00.000Z',
      overpaid_count: 5, overpaid_oldest: '2026-09-02T08:00:00.000Z', measured: true } });
    const out = await new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth();
    expect(out).toEqual({
      stuckCount: 2, oldestCreated: '2026-09-01T10:00:00.000Z',
      overpaidCount: 5, overpaidOldest: '2026-09-02T08:00:00.000Z',
    });
  });

  it('🔴 `overpaid_count` 缺鍵 ⇒ **丟**(不得當成 0 —— 那會把「沒量到」讀成「零張」)', async () => {
    const { client } = stuckClient({ result: { stuck_count: 0, oldest_created: null, overpaid_oldest: null, measured: true } });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth(),
    ).rejects.toThrow('overpaid_count');
  });

  it('🔴 `overpaid_count` 與 `overpaid_oldest` 互相矛盾 ⇒ **丟**', async () => {
    // 🔵 count=0 而有時刻 ⇒ 那支 RPC 壞了。一份自己前後矛盾的資料讀起來是完整的。
    const { client } = stuckClient({ result: {
      stuck_count: 0, oldest_created: null,
      overpaid_count: 0, overpaid_oldest: '2026-09-02T08:00:00.000Z', measured: true } });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth(),
    ).rejects.toThrow('不一致');
  });

  it('🔵 世界 B(函式真的不存在, probe missing=true)⇒ 回 null, **不 throw**', async () => {
    const { client, query } = stuckClient({ raise42883: true, probeMissing: true });
    const out = await new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth();
    expect(out).toBeNull();
    const texts = query.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => t.includes(`to_regprocedure('public.${RPC}()')`))).toBe(true);
  });

  it('🔴🔴 世界 A(函式在而【它呼叫的那支】壞了, probe missing=false)⇒ **不得降級成 null**(而它會被 sanitizeError 重建)', async () => {
    // ⛔ ~~原本測試名寫「原封上拋」~~ **作廢**(codex R2 nit):`run()` 會經 `sanitizeError()`
    //    **重建**錯誤 ⇒ 原訊息不會原封傳出去。✅ 這一格真正驗的是【它不得降級成 null】,
    //    而 SQLSTATE 有被保留在淨化後的訊息裡。
    // 🎯 這一格是整個 describe 的重點:兩個世界的 SQLSTATE 完全相同,
    //    而**錯誤訊息裡的名字是【最內層失敗的那個東西】** —— 這裡是 OP6a, 不是我們這支。
    //    ⇒ 任何「訊息裡有沒有提到我們那支函式」的判法, 在世界 A 會判成「不是我們的問題」而降級
    //      ⇒ 🔴 **一支壞掉的函式被讀成「今天沒有卡住的單」, 而它不會自己好。**
    const { client } = stuckClient({ raise42883: true, probeMissing: false });
    // 🔵 期望的是【它有丟】, 而不是訊息長什麼樣 —— adapter 的 `sanitizeError` 會把原訊息
    //    淨化成「anomaly 告警聚合讀失敗(<SQLSTATE>)」(那是刻意的:原訊息可能帶 PII)。
    //    ⚠️ **我第一版寫 /does not exist/ ⇒ 紅了, 而它其實丟了。**
    //    ⇒ 📌 **一個「期望訊息字面」的斷言, 在中間隔著一層淨化時, 驗的是淨化器不是行為。**
    await expect(new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth()).rejects.toThrow(/42883/);
  });

  it('🔴 `measured` 缺鍵 ⇒ **丟**(R3 F4:四格 fixture 全帶 measured:true ⇒ 那道閘沒有量具)', async () => {
    // 🎯 codex R2 ③ 要我加那道閘, 而**我加了之後四格 fixture 全帶 `measured: true`**
    //    ⇒ 把整道閘刪掉, 四格照樣全綠 ⇒ 📌 **修法本身沒有量具。**
    const { client } = stuckClient({ result: { stuck_count: 0, oldest_created: null } });
    await expect(new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth()).rejects.toThrow(/measured/);
  });

  it('🔴 `measured: false` ⇒ **丟**(SQL 說它沒量到)', async () => {
    const { client } = stuckClient({ result: { stuck_count: 0, oldest_created: null, measured: false } });
    await expect(new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth()).rejects.toThrow(/measured/);
  });

  it('🔴 count>0 而沒有 oldest ⇒ **丟**(那份資料自己前後矛盾)', async () => {
    // 📌 一份自己矛盾的資料比一份缺資料危險:它讀起來是完整的。
    const { client } = stuckClient({ result: { stuck_count: 2, oldest_created: null, measured: true } });
    await expect(new PgAnomalyAlertReaderAdapter('conn', () => client).getStuckBankOrdersHealth()).rejects.toThrow(/不一致/);
  });
});

describe('⟦b9-ENUMWATCH⟧ getManualCustomerSearchSummary — 42883 的兩個世界', () => {
  const RPC = 'get_manual_customer_search_summary';

  /** @param probeMissing `to_regprocedure(...) IS NULL` 的回答 —— 這一格就是兩個世界的分界線。 */
  function searchClient(opts: { result?: unknown; raise42883?: boolean; probeMissing?: boolean; otherError?: unknown }) {
    return makeClient({
      query: async (text: string) => {
        if (text.includes('to_regprocedure')) {
          return { rows: [{ missing: opts.probeMissing === true }] };
        }
        if (opts.otherError !== undefined) throw opts.otherError;
        if (opts.raise42883 === true) {
          // 🔴 訊息刻意寫成【內層 helper 的名字】—— 那正是世界 A 的真實形狀。
          const err = new Error('function public.some_inner_helper() does not exist') as Error & { code: string };
          err.code = '42883';
          throw err;
        }
        return resultRows(opts.result);
      },
    });
  }

  it('🟢 正常 ⇒ 回兩個數字', async () => {
    const { client } = searchClient({
      result: { manual_customer_search_count: 7, manual_customer_search_actors: 3 },
    });
    const out = await new PgAnomalyAlertReaderAdapter('postgres://x', () => client)
      .getManualCustomerSearchSummary(86400);
    // 🔵 R3 must-fix 2 之後多一格 `windowSeconds` —— 而它是 adapter 回的, 不是呼叫端拼的。
    expect(out).toEqual({ count: 7, actors: 3, windowSeconds: 86400 });
  });

  it('世界 B(函式真的不存在, probe 回 missing=true)⇒ 回 null, **不 throw**', async () => {
    const { client, query } = searchClient({ raise42883: true, probeMissing: true });
    const out = await new PgAnomalyAlertReaderAdapter('postgres://x', () => client)
      .getManualCustomerSearchSummary(86400);
    // 🔵 那是部署窗口 —— 碼會比 migration 早上線, 而它不得讓整支 cron 炸。
    expect(out).toBeNull();
    // 🎯 而探詢那一發的【完整簽章】在這裡釘(它只在錯誤路徑走得到)
    const texts = query.mock.calls.map((c) => String(c[0]));
    expect(texts.some((t) => t.includes(`to_regprocedure('public.${RPC}(integer)')`))).toBe(true);
  });

  it('🔴🔴 世界 A(函式在而體壞掉, probe 回 missing=false)⇒ **原封上拋, 不得降級**', async () => {
    const { client } = searchClient({ raise42883: true, probeMissing: false });
    // 🎯 這一格就是這一片的分界線。突變:把 adapter 裡那發 to_regprocedure 拿掉
    //    (直接照 42883 降級)⇒ 這一格會拿到 null 而紅。
    await expect(
      new PgAnomalyAlertReaderAdapter('postgres://x', () => client).getManualCustomerSearchSummary(86400),
    ).rejects.toThrow();
  });

  it('🔵 非 42883 的錯誤(例:權限 42501)⇒ 原封上拋, 不得吞', async () => {
    const err = new Error('permission denied') as Error & { code: string };
    err.code = '42501';
    // 🔴🔴 **`probeMissing: true` 是這一格的承重點, 不是順手填的** ——
    //    我第一版沒設它(預設 false)⇒ 拿掉 `code !== 42883` 那道判斷之後, 探詢會說「函式在」
    //    ⇒ 照樣 throw ⇒ **突變殺不掉這一格, 而它是綠的。**
    //    設成 true ⇒ 少了那道判斷就會降級成 null ⇒ 這一格才真的紅。
    //    📌 **⇒ 一個測試要殺得掉突變, 它的 fixture 必須把【兩個世界】真的分開。**
    const { client } = searchClient({ otherError: err, probeMissing: true });
    await expect(
      new PgAnomalyAlertReaderAdapter('postgres://x', () => client).getManualCustomerSearchSummary(86400),
    ).rejects.toThrow();
  });

  // 🔴🔴 **codex R1 must-fix 1 的證人 —— 而我第一版的測試殺不掉它。**
  //    我原本只餵 `'x'` ⇒ `Number('x')` 是 `NaN` ⇒ 舊版的 `Number.isFinite` 照樣 throw
  //    ⇒ **把 typeof 檢查拿掉那個突變是綠的。**
  //    ✅ 而真正會出事的是 `null` / `''` / `false` —— `Number()` 把它們全變成 **0**
  //       ⇒ **一支壞掉的 RPC 看起來像「今天沒有人搜尋客戶」。**
  it.each([null, '', false, undefined])(
    '🔴 計數欄是 %p ⇒ **throw**(Number() 會把它變成 0, 而 0 與「沒有人搜尋」印同一個數字)',
    async (bad) => {
      const { client } = searchClient({
        result: { manual_customer_search_count: bad, manual_customer_search_actors: 1 },
      });
      await expect(
        new PgAnomalyAlertReaderAdapter('postgres://x', () => client).getManualCustomerSearchSummary(86400),
      ).rejects.toThrow();
    },
  );

  it('🔵 回應形狀不符(計數欄是字串)⇒ throw, 不得當成 0', async () => {
    const { client } = searchClient({
      result: { manual_customer_search_count: 'x', manual_customer_search_actors: 1 },
    });
    await expect(
      new PgAnomalyAlertReaderAdapter('postgres://x', () => client).getManualCustomerSearchSummary(86400),
    ).rejects.toThrow();
  });

  // 🔴🔴 **codex R1 must-fix 5:我第一版的「尺自檢」近乎恆真。**
  //    舊版:`texts.some(t => t.includes(RPC))` + 一個現造名字的負對照。
  //    ⛔ 而**那個負對照沒有承重** —— 現造的名字本來就不會出現, 它在任何世界都是 false。
  //    ⛔ 而 `includes(RPC)` 是**子字串** ⇒ 把 RPC 打成 `get_manual_customer_search_summary_x`
  //       仍然通過(原名是它的子字串)。**⇒ 今天第三次同一個病:子字串比對。**
  //    ✅ 改成:①釘住**完整呼叫字面**(含括號與參數佔位)②負對照用【真的會混淆的那個】——
  //       同一支 adapter 的**別支 RPC 名字**, 它們在同一個檔裡, 而打錯很可能就是打成它們。
  it('🟢 尺的自檢:它打的是那支 RPC 的【完整字面】, 而不是任何一支', async () => {
    const { client, query } = searchClient({
      result: { manual_customer_search_count: 0, manual_customer_search_actors: 0 },
    });
    await new PgAnomalyAlertReaderAdapter('postgres://x', () => client).getManualCustomerSearchSummary(86400);
    const texts = query.mock.calls.map((c) => String(c[0]));
    // 🎯 完整字面 ⇒ 名字後面多一個字元就對不上(舊版的 includes 吞得掉)
    expect(texts.some((t) => t.includes(`public.${RPC}($1::integer)`))).toBe(true);
    // 🛑 而【探詢那一發只在錯誤路徑才打】—— 我第一版把它也塞進這一格 ⇒ 當場紅。
    //    ⇒ 那個紅是對的:正常路徑本來就不該多打一發探詢(那會是每輪一次的多餘往返)。
    //    ⇒ 探詢的字面改到下面那一格(世界 B)去釘, 因為那裡才走得到它。
    expect(texts.some((t) => t.includes('to_regprocedure'))).toBe(false);
    // 🔵 負對照用【同一支 adapter 真的存在的別支 RPC】—— 打錯最可能打成它們
    for (const other of [
      'get_payment_anomaly_alert_summary',
      'get_order_refunds_stuck_summary',
      'get_shipped_email_gap_counts',
    ]) {
      expect(texts.some((t) => t.includes(other)), `不該打到 ${other}`).toBe(false);
    }
  });
});

// ⟦b9-ENUMWATCH⟧ 片 2:R3(codex, 第三輪)的證人們。
describe('⟦b9-ENUMWATCH⟧ R3 的三格', () => {
  function ok(result: unknown) {
    return makeClient({
      query: async (text: string) =>
        text.includes('to_regprocedure')
          ? { rows: [{ missing: false }] }
          : { rows: [{ result }] },
    });
  }

  it('🔴 R3 must-fix 2:回傳的 windowSeconds 是【我真的送出去的那個】', async () => {
    // 🎯 突變:把 adapter 那個 `windowSeconds,` 拿掉 ⇒ 這一格必須紅。
    //    而它守的是那個被證偽的前提:**放進同一個物件 ≠ 來自同一次量測**。
    const { client } = ok({ manual_customer_search_count: 3, manual_customer_search_actors: 2 });
    const out = await new PgAnomalyAlertReaderAdapter('postgres://x', () => client)
      .getManualCustomerSearchSummary(3600);
    expect(out).toEqual({ count: 3, actors: 2, windowSeconds: 3600 });
  });

  it('🔴 R3 consider 4:`{count:0, actors:1}` 逐欄都合法而合起來不可能 ⇒ throw', async () => {
    const { client } = ok({ manual_customer_search_count: 0, manual_customer_search_actors: 1 });
    await expect(
      new PgAnomalyAlertReaderAdapter('postgres://x', () => client).getManualCustomerSearchSummary(86400),
    ).rejects.toThrow();
  });

  it('🟢 正對照:actors === count 是合法的(每個人各一筆)', async () => {
    const { client } = ok({ manual_customer_search_count: 4, manual_customer_search_actors: 4 });
    const out = await new PgAnomalyAlertReaderAdapter('postgres://x', () => client)
      .getManualCustomerSearchSummary(86400);
    expect(out?.actors).toBe(4);
  });
});

/**
 * ⟦b9-RLSHARDEN⟧ 甲(片B):`service_role` 的 `BYPASSRLS` 三態。
 *
 * 🔴 上面既有那 20+ 格覆蓋到的只有【量不到】那一態(dispatcher 回預設空 rows)——
 *    而**本片存在的理由是另外那一態**:`false`。⇒ 沒有這一組,最重要的那個世界零覆蓋。
 * 🛑 而三態要**分別**驗:`true`(靜)/ `false`(叫)/ `null`(角色不存在 ⇒ 量不到),
 *    **不是「有回傳就算過」** —— 那是一個恆綠格。
 */
describe('⟦b9-RLSHARDEN⟧ 甲片B:BYPASSRLS 三態', () => {
  function clientWithBypassState(state: unknown) {
    return makeClient({
      query: async (text: string) => {
        if (text.includes('get_privileged_role_bypassrls_state')) {
          return resultRows(state);
        }
        // 🔴 主計數那支**必須回一份合法的** —— 回空會讓 summary 解析先炸掉,
        //    而那時上面每一格斷言驗的都不是它宣稱要驗的東西(它們根本沒跑到)。
        if (text.includes('get_payment_anomaly_alert_summary')) return resultRows(FULL);
        // 🔵 其餘一律回空 —— 本組只在驗這一支,別的旗標落 unknown 是預期的。
        return { rows: [] };
      },
    });
  }

  async function readState(state: unknown) {
    const { client } = clientWithBypassState(state);
    return new PgAnomalyAlertReaderAdapter('conn', () => client)
      .getAlertSummary(86400, 43200, 600, null, 900, null, null);
  }

  it('🔴 false ⇒ Revoked=true、Unknown=false(這是要叫的那一格)', async () => {
    const res = await readState({
      service_role_bypassrls: false,
      privileged_role_count: 5,
      total_role_count: 35,
    });
    expect(res.bypassRlsRevoked).toBe(true);
    expect(res.bypassRlsUnknown, '被收掉了卻同時說「量不到」⇒ route 會回 503 而信不會寄').toBe(false);
  });

  it('🟢 正對照:true ⇒ 兩個都 false(今天的正常態,靜)', async () => {
    // 🔵 這一組的值不是我編的:正式庫 2026-09-02 真的呼叫過那支函式 ⇒
    //    {"total_role_count":35,"privileged_role_count":6,"service_role_bypassrls":true}
    const res = await readState({
      service_role_bypassrls: true,
      privileged_role_count: 6,
      total_role_count: 35,
    });
    expect(res.bypassRlsRevoked).toBe(false);
    expect(res.bypassRlsUnknown).toBe(false);
  });

  it('🔴 null(service_role 這個角色不存在)⇒ Unknown,而【不是】Revoked', async () => {
    // 🛑 這一格最容易寫錯:`null` 用 `?? false` 收掉的話會變成「屬性還在」⇒ 靜靜通過。
    //    而它的真相是【我沒量到】—— 那要走 503,不是走「沒事」。
    const res = await readState({
      service_role_bypassrls: null,
      privileged_role_count: 6,
      total_role_count: 35,
    });
    expect(res.bypassRlsRevoked).toBe(false);
    expect(res.bypassRlsUnknown).toBe(true);
  });

  it('🔴 codex MF②:回**字串** "false" ⇒ 必須是 Unknown,不得被當成健康', async () => {
    /**
     * 🛑 這一格是 codex 2026-09-02 打出來的 **fail-open**:
     *   我第一版直接 `br.service_role_bypassrls === false` ⇒ 字串 `"false"` 不等於 boolean `false`
     *   ⇒ `Revoked=false` · `Unknown=false` ⇒ **靜靜通過, 被當成「屬性還在」**。
     * 📌 **一個不是我預期的型別, 在 `=== false` 底下與「一切正常」印同一個答案。**
     */
    const res = await readState({
      service_role_bypassrls: 'false',
      privileged_role_count: 6,
      total_role_count: 35,
    });
    expect(res.bypassRlsRevoked).toBe(false);
    expect(res.bypassRlsUnknown, '型別不對卻說「我量到了」⇒ 那是 fail-open').toBe(true);
  });

  it('🔴 codex MF④:函式**不存在**(42883 → to_regprocedure)⇒ Unknown,而那條路要真的被走過', async () => {
    /**
     * 🛑 上面那些格用的是「回空 rows」來**模擬結果**, 而它**走不到** adapter 的 catch/probe。
     *   ⇒ codex 實測:把整段 catch/probe 刪掉, 那些格**仍然全綠** ⇒ 那條路零覆蓋。
     * 🎯 本格丟真的 `42883`, 再讓 `to_regprocedure` 回 `missing=true` ⇒ 逼它走完那條路。
     */
    const { client, query } = makeClient({
      query: async (text: string) => {
        if (text.includes('to_regprocedure')) return { rows: [{ missing: true }] };
        if (text.includes('get_privileged_role_bypassrls_state')) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        if (text.includes('get_payment_anomaly_alert_summary')) return resultRows(FULL);
        return { rows: [] };
      },
    });
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client)
      .getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(res.bypassRlsUnknown).toBe(true);
    expect(res.bypassRlsRevoked).toBe(false);
    // 🔵 而【那條路真的被走過】要有證據 —— 否則本格與上面那些「模擬結果」的格子沒有差別。
    const probed = query.mock.calls.some(
      (c) => typeof c[0] === 'string' && c[0].includes("to_regprocedure('public.get_privileged_role_bypassrls_state()')"),
    );
    expect(probed, '沒有打那一發 to_regprocedure ⇒ catch/probe 那段沒被驗到').toBe(true);
  });

  it('🔴 42883 而函式其實【在】(probe 說沒 missing)⇒ 必須上拋,不得降級', async () => {
    // 🎯 那個 42883 來自函式**內部**(它自己呼叫了別的不存在的東西)⇒ 那是真的壞了。
    //    降級成 Unknown 會讓一個壞掉的函式被讀成「還沒 apply」。
    const { client } = makeClient({
      query: async (text: string) => {
        if (text.includes('to_regprocedure')) return { rows: [{ missing: false }] };
        if (text.includes('get_privileged_role_bypassrls_state')) {
          throw Object.assign(new Error('function does not exist'), { code: '42883' });
        }
        if (text.includes('get_payment_anomaly_alert_summary')) return resultRows(FULL);
        return { rows: [] };
      },
    });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getAlertSummary(86400, 43200, 600, null, 900, null, null),
      // 🔵 訊息被 adapter 包過(`anomaly 告警聚合讀失敗(42883)`)—— 我第一版寫 /does not exist/
      //    而那是**底層 pg 的原句**。⇒ 斷言要對到【它真的丟出來的那一句】, 不是我以為的那一句。
    ).rejects.toThrow(/42883/);
  });

  it('🔴 codex R2:回 **array**(`[]`)也是壞形狀 ⇒ 必須上拋,不得降級成 Unknown', async () => {
    /**
     * 🛑 `typeof [] === 'object'` 且 `[] !== null` ⇒ **它通得過我第一版那兩個條件**
     *   ⇒ 不 throw ⇒ 靜靜降級成 Unknown ⇒ 而 route 會把它印成
     *     「函式未 apply 或 service_role 不存在」—— **那是錯的成因**。
     * 📌 **⇒ 一個【壞掉的回應】被記成【還沒部署】, 而兩者的下一步完全不同。**
     */
    await expect(readState([])).rejects.toThrow(/回應格式異常/);
  });

  it('🔴 回傳形狀壞掉 ⇒ throw(不得降級成 unknown)', async () => {
    // 🎯 「函式不存在」與「函式跑了而回了怪東西」是兩件事:前者是部署窗口(降級),
    //    後者是**它真的壞了**(fail-closed 上拋)。合併會讓壞掉被讀成「還沒 apply」。
    await expect(readState('not-an-object')).rejects.toThrow(/回應格式異常/);
  });
});

/**
 * ⟦b9-RLSHARDEN⟧ 甲片B · R3 consider 2(我當 must-fix 修)。
 * 🎯 **一支用來偵測「權限被收緊」的探針,不可以在權限被收緊那天把金流告警一起弄啞。**
 */
describe('⟦b9-RLSHARDEN⟧ 甲片B:非 42883 的錯誤不得拖垮整輪告警', () => {
  it('🔴 42501(權限不足,強化當天最現實的那個)⇒ 落 Unknown,而其他計數照常回來', async () => {
    const { client } = makeClient({
      query: async (text: string) => {
        if (text.includes('get_privileged_role_bypassrls_state')) {
          throw Object.assign(new Error('permission denied for function'), { code: '42501' });
        }
        if (text.includes('get_payment_anomaly_alert_summary')) return resultRows(FULL);
        return { rows: [] };
      },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await new PgAnomalyAlertReaderAdapter('conn', () => client)
      .getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(res.bypassRlsUnknown).toBe(true);
    // 🔴 這一行才是本格的重點:**別人的數字要活著回來**。
    //    我第一版 `throw` ⇒ 整輪炸掉 ⇒ 那天的雙重扣款/退款卡住告警一封都不寄。
    expect(res.openCount, '權限那一格失敗把整輪拖垮 ⇒ 金流告警當天全啞').toBe(FULL.open_count);
    expect(JSON.stringify(errSpy.mock.calls)).toContain('非 42883');
    errSpy.mockRestore();
  });
});

/**
 * ⟦b4-NORECIPIENTWINDOW⟧ 未付款取消信線的收件人計數(2026-09-03)。
 *
 * 🔴🔴 **為什麼要有這一族, 而理由逐字寫在本檔上面**:
 *    「既有 41 處呼叫的第 7 個參數全是 `null` ⇒ adapter 根本不呼叫這支
 *      ⇒ **那一整段新碼的測試分母是 0**。」
 *    ⇒ 📌 我加了一段新的 adapter 路徑, 而 stub 的預設是「尚未 apply」
 *      ⇒ **不補這一族的話, 我的新路徑同樣一次都沒被執行過**
 *      ⇒ RPC 名稱打錯 / 參數順序錯 / 回應鍵拼錯, **測試全部照樣綠**。
 *    🎯 **那條教訓就寫在我改的這支檔裡, 而它是【上一個人】留給我的。**
 */
describe('🔵 未付款取消信線的收件人計數(⟦b4-NORECIPIENTWINDOW⟧)', () => {
  it('[U1] 起始線有值 ⇒ 真的呼叫那支 RPC, 三格映射出來', async () => {
    const c = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      { paid_no_email_count: 7, no_recipient_count: 2, orders_total_count: 23 }, false,
      // 🔵 heartbeat(12,13)· stuck(14,15)兩對都要佔位, 第 16 個才是本族的參數。
      //   🛑 我第一版少了一對 ⇒ 我的物件落在 `stuck` 的位置 ⇒ **U1 紅、而錯的是我不是碼**。
      undefined, true, undefined, true,
      { pending_count: 5, no_recipient_count: 3, orders_total_count: 23 },
    );
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z', null);
    expect(r.unpaidCancelledPendingCount).toBe(5);
    expect(r.unpaidCancelledNoRecipientCount).toBe(3);
    expect(r.unpaidCancelledGapUnknown).toBe(false);
    // 🔵 **兩條線不得互相汙染** —— 它們共用同一顆 cutoff, 而值必須各自來自各自那支 RPC。
    //   🛑 這一格會抓到「複製貼上時忘了改變數名」那種改法(兩邊都讀 `oc`)。
    expect(r.orderCreatedNoRecipientCount).toBe(2);
    // 🔵 別族不受影響 —— 逐字比值, 不是 >= 0
    expect(r.openCount).toBe(2);
  });

  it('[U2] 🔴 負對照:起始線是 null ⇒ 【根本不呼叫】那支 RPC ⇒ unknown', async () => {
    /**
     * 🛑 少了這一格, 一個「不管有沒有起始線都去呼叫」的實作會讓 U1 全綠 ——
     *   而那支 RPC 的參數無 DEFAULT、它自己的閘會對 NULL 直接 RAISE ⇒ 每天炸一次。
     */
    const seen: string[] = [];
    const c = makeClient({
      query: async (text: string) => {
        seen.push(text);
        if (text.includes('to_regprocedure')) return { rows: [{ missing: true }] };
        if (text.includes('get_payment_anomaly_alert_summary')) return { rows: [{ result: FULL }] };
        throw Object.assign(new Error('function does not exist'), { code: '42883' });
      },
    }).client;
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, null, null);
    expect(seen.some((t) => t.includes('get_order_unpaid_cancelled_gap_counts'))).toBe(false);
    expect(r.unpaidCancelledGapUnknown).toBe(true);
    // 🔴 **不得寫成 0** ——「沒查」與「今天沒有卡住的單」在裸數字上長得一模一樣。
    expect(r.unpaidCancelledNoRecipientCount).toBeNull();
  });

  it('[U3] 🔴 RPC 尚未 apply(42883)⇒ 降級成 unknown, 而其他告警照常', async () => {
    const c = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      { paid_no_email_count: 7, no_recipient_count: 2, orders_total_count: 23 }, false,
      // 🔵 heartbeat(12,13)· stuck(14,15)兩對都要佔位, 第 16 個才是本族的參數。
      //   🛑 我第一版少了一對 ⇒ 我的物件落在 `stuck` 的位置 ⇒ **U1 紅、而錯的是我不是碼**。
      undefined, true, undefined, true,
      undefined,
    );
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z', null);
    expect(r.unpaidCancelledGapUnknown).toBe(true);
    expect(r.unpaidCancelledNoRecipientCount).toBeNull();
    // 🔵 **整支告警不得因此死掉** —— 這正是本片降級處置存在的理由。
    expect(r.orderCreatedNoRecipientCount).toBe(2);
    expect(r.openCount).toBe(2);
  });

  it('[U4] 🔴 函式在而回了非物件 ⇒ throw, 不是安靜地當成 unknown', async () => {
    /**
     * 🛑 分辨兩個世界:**函式不存在**(部署窗口, 可以降級)與
     *   **函式在而回應形狀壞了**(那是真的壞了, 安靜降級會讓它永遠沒人發現)。
     */
    const c = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      { paid_no_email_count: 7, no_recipient_count: 2, orders_total_count: 23 }, false,
      // 🔵 heartbeat(12,13)· stuck(14,15)兩對都要佔位, 第 16 個才是本族的參數。
      //   🛑 我第一版少了一對 ⇒ 我的物件落在 `stuck` 的位置 ⇒ **U1 紅、而錯的是我不是碼**。
      undefined, true, undefined, true,
      'not-an-object',
    );
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z', null),
    ).rejects.toThrow(/get_order_unpaid_cancelled_gap_counts/);
  });
});

/**
 * 🔴 `[U5]` —— **這一格的存在理由是【別的檔要引用它】**。
 *
 * `anomaly-alert-key-contract.test.ts` 的 `FAIL_LOUD_RPCS` 是一張註冊表,
 * 而那張表逐字要求「**分堆是開檔看的, 不是猜的**」。
 * 🛑 而「開檔看」得到的是一個**推論**(`parseCount(undefined)` ⇒ NaN ⇒ throw),
 *    ⇒ 📌 **一個推論被寫進註冊表之後, 它與量到的事實長得一模一樣。**
 * ✅ 所以這一格**真的餵一個少一把鍵的回應**進去, 讓那個分堆有一個量到的來源。
 */
describe('🔵 未付款取消線:缺鍵的分堆依據(給 key-contract 那張註冊表用)', () => {
  it('[U5] RPC 在、而回應【少一把鍵】⇒ throw(= fail-loud, 不是安靜變 null)', async () => {
    const c = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      { paid_no_email_count: 7, no_recipient_count: 2, orders_total_count: 23 }, false,
      undefined, true, undefined, true,
      // 🔴 少了 `pending_count` —— 其餘兩把鍵都在, 所以這一格量的是【缺鍵】本身,
      //    不是「回了垃圾」(那是 [U4] 那一格)。
      { no_recipient_count: 3, orders_total_count: 23 },
    );
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z', null),
    ).rejects.toThrow(/get_order_unpaid_cancelled_gap_counts/);
  });

  it('[U6] 🔵 負對照:三把鍵都在 ⇒ 不 throw(否則 U5 的紅可能來自別的原因)', async () => {
    const c = twoQueryClient(
      FULL, undefined, true, undefined, true, undefined, true, undefined, true,
      { paid_no_email_count: 7, no_recipient_count: 2, orders_total_count: 23 }, false,
      undefined, true, undefined, true,
      { pending_count: 5, no_recipient_count: 3, orders_total_count: 23 },
    );
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => c).getAlertSummary(86400, 43200, 600, null, 900, '2026-08-22T00:00:00.000Z', null);
    expect(r.unpaidCancelledPendingCount).toBe(5);
  });
});

/**
 * `getSearchLogHealth` —— 2026-09-05 補。
 *
 * 🔴 **它到今天為止零測試**(當場量:本檔 `grep -c getSearchLogHealth` ⇒ **0**)。
 *    而它是 `⟦search-LOGSILENTZERO⟧` 那條線的讀取端:**搜尋日誌靜靜歸零時就靠它出聲**。
 *    ⇒ 📌 **一個負責「東西沒聲音時發出聲音」的元件, 自己沒有東西在盯它。**
 *
 * 🛑 **而這四格的模子是 `-mail` 在 `getStuckBankOrdersHealth` 上先做的** ——
 *    我**沒有讀到他那支檔**(2026-09-05 當場找:`git grep -l getStuckBankOrdersHealth --all` ⇒ 查無,
 *    他還沒推)⇒ **這四格是照主視窗轉述的四個世界寫的, 不是照他的碼抄的。**
 *    ⇒ 兩邊形狀若有出入, 以他那支為準(他是那個模子的作者), 而**這一句要留著** ——
 *      否則下一個人會以為兩支是對過的。
 */
function searchLogClient(result: unknown, probeMissing = true) {
  return makeClient({
    query: async (text: string) => {
      if (text.includes('to_regprocedure')) {
        return { rows: [{ missing: probeMissing }] };
      }
      if (text.includes('get_search_log_health')) {
        if (result === undefined) {
          // 🔴 模擬 PG 的 42883:那支函式不存在(部署窗口)
          const e = new Error('function public.get_search_log_health() does not exist') as Error & {
            code?: string;
          };
          e.code = '42883';
          throw e;
        }
        return { rows: [{ result }] };
      }
      return { rows: [] };
    },
  });
}

describe('PgAnomalyAlertReaderAdapter.getSearchLogHealth(⟦search-LOGSILENTZERO⟧ 的讀取端)', () => {
  it('① 正常:三個鍵原封回傳(snake→camel), 不在這裡判斷要不要告警', async () => {
    const { client } = searchLogClient({
      table_exists: true,
      last_row_at: '2026-09-05T01:23:45.000Z',
      anon_can_execute: false,
    });
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => client).getSearchLogHealth();
    expect(r).toEqual({
      tableExists: true,
      lastRowAt: '2026-09-05T01:23:45.000Z',
      // 🔴 `false` 要原封留著 —— 它與 `null` 的下一步【相反】:
      //    false = 門被關上了(有人做了事) / null = 還沒貼(沒有人做過事)。
      anonCanExecute: false,
    });
  });

  it('①b `anon_can_execute: null` 不得被壓成 false —— 那兩個世界的下一步相反', async () => {
    const { client } = searchLogClient({
      table_exists: false,
      last_row_at: null,
      anon_can_execute: null,
    });
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => client).getSearchLogHealth();
    expect(r?.anonCanExecute).toBeNull();
    expect(r?.lastRowAt).toBeNull();
  });

  it('② 世界 B:函式【真的不存在】(42883 + probe 說 missing)⇒ 回 null(降級, 不是壞掉)', async () => {
    const { client } = searchLogClient(undefined, true);
    const r = await new PgAnomalyAlertReaderAdapter('conn', () => client).getSearchLogHealth();
    // 🔴 `null` = 「還沒貼」⇒ 上層走 Unknown, 而不是「查得到而且沒事」。
    expect(r).toBeNull();
  });

  it('③ 世界 A:42883 來自函式【內部】(probe 說函式在)⇒ **原封上拋**, 不得降級', async () => {
    const { client } = searchLogClient(undefined, false);
    // 🔴 這一格是世界 A 與世界 B 的分界:同一個 42883, 兩種成因, 兩個相反的下一步。
    //    少了它, 一個【函式內部炸掉】的世界會被靜靜讀成「還沒貼」⇒ 沒有人會叫。
    //
    // 🛑 **而斷言【不比對 pg 的原文】** —— 我第一版寫 `.toThrow(/does not exist/)` 當場紅:
    //    `sanitizeError` **刻意**把 pg 原文重造掉(防洩漏 token / SQL)⇒ 我等於在測一個
    //    **設計上被移除的東西**。📌 一個測試紅了, 有時是它問錯了問題, 不是碼壞了。
    // ✅ 改比它**刻意保留**的那一格:`code` 要活下來 —— 那才是值班的人分得出成因的依據。
    const err = await new PgAnomalyAlertReaderAdapter('conn', () => client)
      .getSearchLogHealth()
      .then(
        (v) => { throw new Error(`世界 A 竟然沒有丟, 回了 ${JSON.stringify(v)}`); },
        (e: unknown) => e as { code?: unknown; message?: string },
      );
    expect(err.code).toBe('42883');
    expect(err.message).toMatch(/42883/);
  });

  it('④ 矛盾要丟:`last_row_at` 是字串而【不是合法時刻】⇒ 丟, 不得放行', async () => {
    // 🔴 只驗「是字串」不夠:非法日期 ⇒ 上層 `new Date(x).getTime()` 是 NaN
    //    ⇒ `NaN > 86400000` 為 false ⇒ **stale 恆 false** ⇒ 壞回應被讀成「健康」。
    const { client } = searchLogClient({
      table_exists: true,
      last_row_at: '不是時刻',
      anon_can_execute: false,
    });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getSearchLogHealth(),
    ).rejects.toThrow(/last_row_at 不是合法時刻/);
  });

  it('④b 型別不符也要丟(table_exists 不是 boolean / anon_can_execute 不是 boolean)', async () => {
    const bad1 = searchLogClient({ table_exists: 'yes', last_row_at: null, anon_can_execute: null });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => bad1.client).getSearchLogHealth(),
    ).rejects.toThrow(/table_exists 異常/);
    const bad2 = searchLogClient({ table_exists: true, last_row_at: null, anon_can_execute: 1 });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => bad2.client).getSearchLogHealth(),
    ).rejects.toThrow(/anon_can_execute 異常/);
  });

  it('⑤ 連線一定收掉(end 被呼叫)—— 即使走的是丟出去那條路', async () => {
    const { client, end } = searchLogClient({ table_exists: true, last_row_at: '壞的', anon_can_execute: null });
    await expect(
      new PgAnomalyAlertReaderAdapter('conn', () => client).getSearchLogHealth(),
    ).rejects.toThrow();
    // 🔴 per-request `new Client()` + `finally end()` —— 錯誤路徑漏掉 end 會慢慢吃光連線,
    //    而它的症狀出現在【很久以後、別的地方】。
    expect(end).toHaveBeenCalledTimes(1);
  });

  /**
   * ⟦b4-PENDINGREFUNDSILENT⟧(2026-09-05)—— codex must-fix ②③④ 的證人。
   * 🔴 這一族原本**只有 Unknown 那一半有測**(mock 沒有分支 ⇒ 永遠掉進 counts)。
   *    ⇒ 下面第一格是**正向對照**:先證明這條路真的搬得動東西, 後面兩格的紅才有意義。
   */
  describe('⟦b4-PENDINGREFUNDSILENT⟧:get_pcm_incident_health 的三個世界', () => {
    const INC_OK = {
      open_total: 3,
      open_by_kind: { pending_refund_open_failed: 3 },
      oldest_open_at: '2026-09-05T00:00:00Z',
    };

    it('🔴 正向對照:回得出來時三個欄位都映射得到(不是永遠 Unknown)', async () => {
      const { client } = twoQueryClient(
        FULL, undefined, true, undefined, true, undefined, true, undefined, true,
        undefined, true, undefined, true, undefined, true, undefined, undefined, INC_OK,
      );
      const r = await new PgAnomalyAlertReaderAdapter('conn', () => client)
        .getAlertSummary(86400, 43200, 600, null, 900, null, null);
      expect(r.pcmIncidentUnknown, 'mock 回了東西而仍然 Unknown ⇒ 那個分支沒接上').toBe(false);
      expect(r.pcmIncidentOpenTotal).toBe(3);
      expect(r.pcmIncidentByKind).toEqual({ pending_refund_open_failed: 3 });
      expect(r.pcmIncidentOldest).toBe('2026-09-05T00:00:00Z');
    });

    it('🔴 內部矛盾(total=0 而細目=3)⇒ 走 Unknown, 不可以讀成「今天沒有事故」', async () => {
      const { client } = twoQueryClient(
        FULL, undefined, true, undefined, true, undefined, true, undefined, true,
        undefined, true, undefined, true, undefined, true, undefined, undefined,
        { open_total: 0, open_by_kind: { pending_refund_open_failed: 3 }, oldest_open_at: null },
      );
      const r = await new PgAnomalyAlertReaderAdapter('conn', () => client)
        .getAlertSummary(86400, 43200, 600, null, 900, null, null);
      expect(r.pcmIncidentUnknown, '矛盾的回應被讀成健康 ⇒ 真事故被消掉').toBe(true);
      expect(r.pcmIncidentOpenTotal).toBeNull();
    });

    it('🔴 `open_by_kind` 是陣列 ⇒ 走 Unknown, 信裡不可以出現假的種類 `0=3`', async () => {
      const { client } = twoQueryClient(
        FULL, undefined, true, undefined, true, undefined, true, undefined, true,
        undefined, true, undefined, true, undefined, true, undefined, undefined,
        { open_total: 3, open_by_kind: [3], oldest_open_at: null },
      );
      const r = await new PgAnomalyAlertReaderAdapter('conn', () => client)
        .getAlertSummary(86400, 43200, 600, null, 900, null, null);
      expect(r.pcmIncidentUnknown, '陣列通過了 typeof === object ⇒ 會變成 {"0":3}').toBe(true);
      expect(r.pcmIncidentByKind).toEqual({});
    });
  });

});
