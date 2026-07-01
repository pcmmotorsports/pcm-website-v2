import type { IAnomalyAlertReader, IAlertNotifier } from '@pcm/ports';
import type { AnomalyAlertSummary, AnomalyAlertMessage } from '@pcm/domain';

/**
 * checkAnomalyAlerts:雙扣 anomaly 主動告警 use-case(M-3 #250;pull→push)。
 *
 * 週期 cron(app/api/cron/anomaly-alert、Vercel cron)觸發 → 讀 anomaly + 死卡列零 PII 計數 → 任一門檻踩
 * → 對「所有已設定管道」(LINE/Email、Q1=A+C)推播固定格式**零 PII** 告警。杜絕「沉默故障 + 錯過客訴黃金期」。
 *
 * ```
 * summary = reader.getAlertSummary(refundingStuckSeconds)   // throw → 上拋(route 503,不吞)
 * shouldAlert = open>0 || refundingStuck>0 || attemptManualReview>0 || releasedStuck>0
 * if shouldAlert: 對每個 notifier.notify(固定訊息)、Promise.allSettled 收集失敗數
 * return { alerted, ...counts, notifiersTotal, notifiersFailed, errors=notifiersFailed }
 * ```
 *
 * 安全 / 信任邊界(鐵則 12):
 * - reader 走 payment_confirmer SECDEF 受控窗、對 anomaly 兩表零表權;回傳只計數、零 PII/零金額/零 id。
 * - 告警訊息固定格式、只含計數;🔴 文案不宣稱「已確認雙扣」(open=候選、待查證;runbook line51)。
 * - fail-closed:reader throw → 上拋 → route 503;notifier throw → 計入 errors → route 503(壞掉的管道必須可見、
 *   不得靜默吞成成功)。一管道掛掉不影響另一管道(Promise.allSettled 各自送)。
 * - **無 per-anomaly 去重**(本片刻意):未解決前每輪重推 = 持續提醒(雙扣不可被遺忘);去重狀態表列 follow-up。
 *
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
 * @see docs/phase-1-backlog.md #250
 */
export type CheckAnomalyAlertsDeps = {
  reader: IAnomalyAlertReader;
  /** 已設定的推播管道(LINE/Email;composition 依 env 存在性組;至少 1 個〔否則 composition fail-closed〕)。 */
  notifiers: IAlertNotifier[];
};

export type CheckAnomalyAlertsOptions = {
  /** refunding 卡住門檻秒數(route 常數注入、營運參數非 SLA)。 */
  refundingStuckSeconds: number;
  /** #256 pending 雙扣候選:兩 paid 單 paid_at 差窗秒數(route 常數、預設 12h)。 */
  pendingDoubleChargeWindowSeconds: number;
  /** #256 卡住指紋門檻秒數(charged attempt updated_at-created_at 逾此才算卡住;route 常數、預設 10min)。 */
  pendingDoubleChargeStuckSeconds: number;
};

/** CheckAnomalyAlertsResult:結構化摘要(零 PII counts only;route log/回應用)。 */
export type CheckAnomalyAlertsResult = {
  /** 是否踩門檻並嘗試推播。 */
  alerted: boolean;
  openCount: number;
  refundingCount: number;
  refundingStuckCount: number;
  attemptManualReviewCount: number;
  releasedStuckCount: number;
  /** #256 pending-based 雙扣候選「組」數(卡住指紋 + 同額 + 窗;候選待查證)。 */
  pendingDoubleChargeCandidateCount: number;
  /** 最舊 open anomaly 年齡秒數(排序訊號、非 PII;無 open → null)。 */
  oldestOpenAgeSeconds: number | null;
  /** 本輪嘗試推播的管道數(shouldAlert=false 時為 0)。 */
  notifiersTotal: number;
  /** 推播失敗的管道數(>0 → route 503)。 */
  notifiersFailed: number;
  /** errors = notifiersFailed(route 據此回 503;reader throw 已上拋不進此)。 */
  errors: number;
};

/** 每小時秒數(refundingStuckSeconds → 顯示小時)。 */
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

/** 年齡秒數 → 白話(≥1 天顯天、否則顯小時;純聚合年齡、非 PII)。 */
function formatAge(seconds: number): string {
  if (seconds >= SECONDS_PER_DAY) {
    return `${Math.floor(seconds / SECONDS_PER_DAY)} 天`;
  }
  return `${Math.max(1, Math.floor(seconds / SECONDS_PER_HOUR))} 小時`;
}

/**
 * 由計數摘要組固定格式**零 PII** 告警訊息(只列踩門檻的類別)。
 * 🔴 文案:open = 雙扣**候選**、待查證(runbook line51:open≠已確認雙扣)→ 提醒查 W1 對帳、勿直接退款。
 */
export function buildAnomalyAlertMessage(
  summary: AnomalyAlertSummary,
  refundingStuckSeconds: number,
): AnomalyAlertMessage {
  const stuckHours = Math.round(refundingStuckSeconds / SECONDS_PER_HOUR);
  const lines: string[] = [];
  if (summary.openCount > 0) {
    // 附最舊 open 年齡(排序訊號、對齊 W1 open_age「越久越優先」;純聚合年齡非 PII)。
    const agePart =
      summary.oldestOpenAgeSeconds !== null ? `(最舊 ${formatAge(summary.oldestOpenAgeSeconds)})` : '';
    lines.push(`• 雙扣候選(open,待查證)${summary.openCount} 筆${agePart}`);
  }
  if (summary.refundingStuckCount > 0) {
    lines.push(`• 退款卡逾時(refunding 逾 ${stuckHours}h)${summary.refundingStuckCount} 筆`);
  }
  if (summary.attemptManualReviewCount > 0) {
    lines.push(`• 人工待確認(pending 孤兒)${summary.attemptManualReviewCount} 筆`);
  }
  if (summary.releasedStuckCount > 0) {
    lines.push(`• released 死卡 ${summary.releasedStuckCount} 筆`);
  }
  if (summary.pendingDoubleChargeCandidateCount > 0) {
    // #256 GAP2:同客戶同額、其一付款卡住 → 疑似重複扣款;🔴 需人工查證哪一筆為重複再退(GAP2 無 released 錨點)。
    lines.push(
      `• 疑似重複扣款(同客戶同額、其一付款卡住)${summary.pendingDoubleChargeCandidateCount} 組 — 請查 Report C 對帳,確認哪一筆為重複再退`,
    );
  }
  const text = [
    lines.join('\n'),
    '',
    '請登入後台/MCP 查 W1 退款候選報表(open)+ Report C(pending 雙扣候選)對帳後,再決定 refund / dismissed(皆為候選、待查證,勿直接退款)。',
    '(本訊息零個資、僅計數)',
  ].join('\n');
  return { subject: '⚠️ PCM 付款異常告警', text };
}

export async function checkAnomalyAlerts(
  deps: CheckAnomalyAlertsDeps,
  opts: CheckAnomalyAlertsOptions,
): Promise<CheckAnomalyAlertsResult> {
  // reader throw → 上拋(route catch → 503);無法讀狀態時不推播(不知狀態、fail-closed)。
  const summary = await deps.reader.getAlertSummary(
    opts.refundingStuckSeconds,
    opts.pendingDoubleChargeWindowSeconds,
    opts.pendingDoubleChargeStuckSeconds,
  );

  const shouldAlert =
    summary.openCount > 0 ||
    summary.refundingStuckCount > 0 ||
    summary.attemptManualReviewCount > 0 ||
    summary.releasedStuckCount > 0 ||
    summary.pendingDoubleChargeCandidateCount > 0;

  let notifiersTotal = 0;
  let notifiersFailed = 0;

  if (shouldAlert) {
    // 🔴 fail-closed 縱深(關卡2 codex MED):踩門檻卻零 notifier = 告警無處可送 = 沉默故障 → 上拋(route 503、可見)。
    //    live path 由 composition getAnomalyAlertDeps「enabled 但零管道 throw」先擋;此為 use-case 端第二道防線
    //    (防未來其他 composition / 測試替身直接注入空陣列時偽 200)。
    if (deps.notifiers.length === 0) {
      throw new Error('checkAnomalyAlerts:踩告警門檻但未注入任何 notifier(告警無法送達、fail-closed)');
    }
    const message = buildAnomalyAlertMessage(summary, opts.refundingStuckSeconds);
    notifiersTotal = deps.notifiers.length;
    // 各管道各自送(一管道掛掉不影響另一管道);失敗計數 → route 503(壞掉的管道必須可見)。
    const results = await Promise.allSettled(deps.notifiers.map((n) => n.notify(message)));
    notifiersFailed = results.filter((r) => r.status === 'rejected').length;
  }

  return {
    alerted: shouldAlert,
    openCount: summary.openCount,
    refundingCount: summary.refundingCount,
    refundingStuckCount: summary.refundingStuckCount,
    attemptManualReviewCount: summary.attemptManualReviewCount,
    releasedStuckCount: summary.releasedStuckCount,
    pendingDoubleChargeCandidateCount: summary.pendingDoubleChargeCandidateCount,
    oldestOpenAgeSeconds: summary.oldestOpenAgeSeconds,
    notifiersTotal,
    notifiersFailed,
    errors: notifiersFailed,
  };
}
