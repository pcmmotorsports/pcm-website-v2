import type { IWebhookInbox } from '@pcm/ports';
import type { DueWebhookEvent, StuckChargeAttempt } from '@pcm/domain';
import { settleCharge, type SettleChargeDeps } from './settle-charge';

/**
 * sweepSettlements:3DS 對帳兜底 sweeper use-case(M-3 3DS-4b-2;master plan v5 §2;plan §5.2)。
 *
 * callback(3DS-3)/ webhook(3DS-2)漏接的「最終一致保證」。週期 cron(3DS-4c route、Vercel cron)
 * 觸發 → 掃兩來源 → 共呼 settleCharge(Record API 唯一權威):
 * ```
 * ① 前置守衛(每輪無條件、claim 前必呼;plan §5.2③ 不變式):
 *    expireEventsAtCeiling()  — inbox 達 ceiling 孤兒 → 轉 needs_manual_review(防孤兒卡死)
 *    expireStuckAtCeiling()   — attempt 達 ceiling 孤兒 → 轉 manual
 *    flagNonUnpaidActive()    — refunded/partiallyPaid 殘留 active attempt 的【唯一回收路徑】
 *                               (claim/expirer/mark 皆濾 unpaid、跳過它 → 漏呼=該格永久殘留)
 * ② claim due inbox(原子 lease)→ settleCharge(orderId, recTradeIdHint=inbox rec、🔴 群3 rec 優先序)
 *    → terminal(paid/failed)/no_attempt → markProcessed(token guard);pending → markRetry(退避)
 * ③ claim stuck unsettled(原子 lease;pending+charged-unpaid 群1)→ settleCharge(orderId)
 *    → terminal/no_attempt → settleCharge 已改 status 收斂(attempt 路徑無 processed 旗);
 *      pending → markSettleRetry(退避)
 * ④ 結構化告警(零 PII counts only;durable 轉人工已由 RPC needs_manual_review 落)
 * ```
 *
 * 安全 / 信任邊界(鐵則 12):
 * - 不採信任何外部輸入:orderId 全 from DB(claim RPC 回);無 client 參數。
 * - settleCharge 冪等 + Record 唯一權威 + 金額整數 → 即使被觸發亦不雙扣/不偽 paid。
 * - 不以年齡判 failed(只 Record final-failed/cancel 才 markFailed);不釋已 charged 鎖
 *   (O8:charged-unpaid 遇 explicit_failed → markFailed RPC RAISE → settleCharge 吞 pending,
 *    刻意安全、留 needs_manual_review 人工,**勿改成釋鎖**)。
 * - 單筆 throw → try/catch + continue(fail-closed、不中斷整批);達 ceiling → RPC 已 durable 轉人工。
 * - log 零 PII(僅 counts;reason_code 走固定碼集)。
 * - deps = getSettleChargeDeps()(cookieless、主軌-only)+ inbox;Record 節流 = 批次 limit + 順序/有界並發。
 *
 * @see docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md §5.2
 * @see docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §2/§9
 */
export type SweepSettlementsDeps = SettleChargeDeps & {
  inbox: IWebhookInbox;
};

/**
 * SweepSettlementsOptions:批次/節流參數(由 3DS-4c route 顯式注入、plan Q2/Q3=A)。
 * - `inboxLimit` / `stuckLimit`:每輪上限(Record 節流;Q3=A 各 50、超出留下輪)。
 * - `stuckAgeSeconds`:stuck attempt 最小齡(避 racing 即時 callback/webhook;Q2=A 600=10 分)。
 * - `concurrency`:有界並發度(預設 1=嚴格順序;群7 連線預算、避 N×pg Client 撞 pooler ceiling;可 2-3)。
 */
export type SweepSettlementsOptions = {
  inboxLimit: number;
  stuckLimit: number;
  stuckAgeSeconds: number;
  concurrency?: number;
};

/** SweepSettlementsResult:結構化摘要(零 PII、counts only;3DS-4c route log/回應用)。 */
export type SweepSettlementsResult = {
  inboxClaimed: number;
  inboxProcessed: number;
  inboxRetried: number;
  stuckClaimed: number;
  stuckSettled: number;
  stuckRetried: number;
  /** stuck orderId 本輪已由 inbox settle 過 → 去重跳過(不再打 Record)。 */
  deduped: number;
  /** 達 ceiling 轉人工筆數(>0 告警)。 */
  expiredInboxAtCeiling: number;
  expiredStuckAtCeiling: number;
  /** refunded/partiallyPaid 殘留 active attempt 轉人工筆數(>0 告警)。 */
  flaggedNonUnpaid: number;
  /**
   * mark*(processed/retry/settleRetry)token guard no-op 筆數(affected=0:被另一 run 重領 / 已轉人工 /
   * order 已收斂)。**非錯誤**;僅供「DB 實寫 < disposition 計數」的可見度(processed/retried 是裁決計數、
   * 非保證 DB 都寫了)。codex 關卡2 consider:提升摘要誠實度。
   */
  staleMarks: number;
  /** 單筆 throw 計數(fail-closed、不中斷整批)。 */
  errors: number;
};

/**
 * 固定 reason 碼集(零 PII;非碼集 → 'unknown';RPC 端 allowlist 亦把關,此處 use-case 邊界縱深)。
 *
 * 🔴 M-3 3DS 乙路 R2a(canonical §5、Q1=A):加 `released_failure_observed`(released attempt 讀 -1/5)。
 * ⚠️ **TS↔DB allowlist 暫不對齊**:live DB 的 `mark_attempt_settle_retry`/`mark_*_retry` RPC allowlist
 * 仍只認 (record_unreachable/record_unverified/auth_or_pending),released_failure_observed 傳到 DB 會被
 * 正規化成 'unknown' 存進診斷欄 last_settle_error(零 PII、不影響重試與結算正確性)。R1 bundle 已 live、
 * 守線禁動 live migration → DB allowlist 補在 flag-on 前的獨立小 migration(backlog #251)。
 * Phase 1 producer-gating(零 released row)下此路徑零觸發。
 */
const SWEEP_REASON_CODES: ReadonlySet<string> = new Set([
  'record_unreachable',
  'record_unverified',
  'auth_or_pending',
  'released_failure_observed',
]);

function normalizeReason(reason: string): string {
  return SWEEP_REASON_CODES.has(reason) ? reason : 'unknown';
}

export async function sweepSettlements(
  deps: SweepSettlementsDeps,
  opts: SweepSettlementsOptions,
): Promise<SweepSettlementsResult> {
  const { inbox, attempts } = deps;
  // 🔴 concurrency fail-safe(審查側 N4):`?? 1` 不擋 NaN(opts.concurrency=NaN → Math.max(1,NaN)=NaN →
  //    runBounded 0 worker → 整批靜默不處理)。非有限/非 ≥1 一律降為 1(順序);取整防小數;
  //    4c 注入端另驗有限正整數(縱深)。
  const requestedConcurrency = opts.concurrency;
  const concurrency =
    Number.isFinite(requestedConcurrency) && (requestedConcurrency as number) >= 1
      ? Math.floor(requestedConcurrency as number)
      : 1;

  const result: SweepSettlementsResult = {
    inboxClaimed: 0,
    inboxProcessed: 0,
    inboxRetried: 0,
    stuckClaimed: 0,
    stuckSettled: 0,
    stuckRetried: 0,
    deduped: 0,
    expiredInboxAtCeiling: 0,
    expiredStuckAtCeiling: 0,
    flaggedNonUnpaid: 0,
    staleMarks: 0,
    errors: 0,
  };

  // ── ① 每輪無條件前置守衛(claim 前必呼;plan §5.2③ 不變式)──────────────────────
  //    各自 fail-closed:throw → 計 error + 續(一守衛掛不阻其他守衛/後續 claim;claim 自帶
  //    ceiling/unpaid WHERE 濾,守衛失敗只是本輪不轉 manual、下輪重來,不丟資料、不熱迴圈)。
  try {
    result.expiredInboxAtCeiling = await inbox.expireEventsAtCeiling();
  } catch {
    result.errors++;
  }
  try {
    result.expiredStuckAtCeiling = await attempts.expireStuckAtCeiling();
  } catch {
    result.errors++;
  }
  try {
    result.flaggedNonUnpaid = await attempts.flagNonUnpaidActive(opts.stuckLimit);
  } catch {
    result.errors++;
  }

  // per-order 去重(Q4=A Phase I 降級:僅 in-memory 單 run;同 run inbox+stuck 撞同單只 settle 一次,
  // 不重打 Record。跨 run/跨路徑〔callback/webhook〕去重靠 inbox next_retry_at 退避 + settleCharge paid
  // 短路;Q4-B 持久查窗綁 flag-on 前置〔master §9〕)。
  const settledOrderIds = new Set<string>();

  // ── ② claim due inbox events → settleCharge(帶 recTradeIdHint)→ mark ───────────
  let dueEvents: DueWebhookEvent[] = [];
  try {
    dueEvents = await inbox.claimDueEvents(opts.inboxLimit);
  } catch {
    result.errors++;
  }
  result.inboxClaimed = dueEvents.length;

  await runBounded(dueEvents, concurrency, async (e) => {
    // 🔴 inbox row = per-rec work item(rec_trade_id 為 inbox PK):各自 markProcessed/markRetry,**不**對
    //    同 order 多 rec 去重(去重會孤兒化未標事件 → 永不 processed)。settledOrderIds 僅供「② inbox → ③ stuck」
    //    跨來源去重。同步登記(無 await 間隔=原子):即使本筆後續 throw 亦不漏登記、stuck 不再重打同單 Record。
    settledOrderIds.add(e.orderNumber);
    try {
      const outcome = await settleCharge(deps, {
        orderId: e.orderNumber,
        recTradeIdHint: e.recTradeId, // 🔴 群3 master §1 rec 優先序:attempt 無 rec/bank 時用 inbox rec 查 Record
      });
      if (outcome.kind === 'pending') {
        const affected = await inbox.markRetry(e.recTradeId, e.attemptCount, normalizeReason(outcome.reason));
        result.inboxRetried++;
        if (affected === 0) result.staleMarks++; // token guard no-op(被重領/已轉人工)
      } else {
        // paid / failed / no_attempt → 標 processed(token guard:被另一 run 重領/已轉人工 → RPC 端 no-op)。
        const affected = await inbox.markProcessed(e.recTradeId, e.attemptCount);
        result.inboxProcessed++;
        if (affected === 0) result.staleMarks++;
      }
    } catch {
      result.errors++; // 🔴 fail-closed:單筆 throw 不中斷整批
    }
  });

  // ── ③ claim stuck unsettled attempts → settleCharge → markSettleRetry ──────────
  let stuck: StuckChargeAttempt[] = [];
  try {
    stuck = await attempts.claimStuckUnsettled(opts.stuckAgeSeconds, opts.stuckLimit);
  } catch {
    result.errors++;
  }
  result.stuckClaimed = stuck.length;

  await runBounded(stuck, concurrency, async (a) => {
    // per-order 去重:inbox 本輪已處理同單 → 不再打 Record。🔴 lease-only skip(審查側 N5):**不**寫
    //   markSettleRetry,僅靠 claim 已設的 5min lease 回收(下輪 lease 到期重來、或 order 已 paid→不再 claim);
    //   安全可恢復、僅 telemetry 計 deduped(不計 stuckRetried/stuckSettled、不誤示為已對帳)。
    if (settledOrderIds.has(a.orderId)) {
      result.deduped++;
      return;
    }
    settledOrderIds.add(a.orderId);
    try {
      const outcome = await settleCharge(deps, { orderId: a.orderId });
      if (outcome.kind === 'pending') {
        const affected = await attempts.markSettleRetry(a.attemptId, a.settleCount, normalizeReason(outcome.reason));
        result.stuckRetried++;
        if (affected === 0) result.staleMarks++; // token guard no-op(被重領/已轉人工/order 已收斂)
      } else {
        // paid / failed / no_attempt → settleCharge 已改 status 收斂(attempt 路徑無 processed 旗)。
        result.stuckSettled++;
      }
    } catch {
      result.errors++; // 🔴 fail-closed
    }
  });

  // ── ④ 結構化告警(零 PII、counts only;durable 轉人工已由 RPC needs_manual_review 落)──────
  //    告警閾值 = ceiling 轉人工 / 非 unpaid 殘留 / 單筆失敗 > 0。reason 連續性告警(跨 run)需
  //    持久狀態 → Phase II 監控(master §9),Phase I 以 needs_manual_review durable 旗為準。
  if (
    result.expiredInboxAtCeiling > 0 ||
    result.expiredStuckAtCeiling > 0 ||
    result.flaggedNonUnpaid > 0 ||
    result.errors > 0
  ) {
    console.error(
      '[sweepSettlements] 🔴 需人工關注(ceiling 轉人工 / 非 unpaid 殘留 / 單筆失敗;durable 旗見 needs_manual_review)',
      { ...result },
    );
  }

  return result;
}

/**
 * 有界並發 runner(concurrency=1 → 嚴格順序;群7 連線預算、避 N×per-request pg Client 撞 session
 * pooler ceiling)。每筆 `fn` 已自帶 try/catch(fail-closed),此處不再吞錯。
 */
async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
}
