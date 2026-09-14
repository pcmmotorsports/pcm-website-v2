// owner-line-digest.ts — 給老闆看的 LINE 每日摘要(2026-09-14;Sean 逐字「這個 LINE 訊息也是這邊你設定的對吧?
// 文字也非常難理解,精簡扼要就好」)。
//
// 🔴 **LINE 上只印這幾行**;原本那封長信(`buildAnomalyAlertMessage` / `buildAnomalyQuietHeartbeatMessage` 的 `text`)
//    照舊走 Email(值班 / 事後查用),兩者不互相取代 —— `AnomalyAlertMessage.lineText` 有值時 LINE 印它、沒值時印長信。
// 🔴 規則(主視窗 2026-09-14 轉):零 emoji、零 SQL、零 script 路徑、零「它答不出」那種內心話;每段一行;
//    有事要處理時才多印「先到後台看,不要自己去 TapPay 退」那一句。`pcm_acl_approve_latest` 那步不印給 Sean。
// 🔴 「有沒有事」**跟長信同一把尺**:`alerted`(= `shouldAlert`)是唯一判準,本檔不自己再發明一組門檻
//    (codex 2026-09-14 R1 must-fix ①:自己挑一部分計數 ⇒ 多收款 / 權限被收 / 寄信卡住那些觸發長信的事在短版消失)。
//    這裡只把「哪一類」講出來(錢 / 寄信 / 排程 / 權限),**不印總筆數** —— 那些計數分母不同、會重複算
//    (must-fix ②:一次雙扣同時命中 open 與候選組 ⇒「異常 2 筆」是假的)。
// 🔴 「讀不到」與 0 分得開(本線每一族的鐵律):讀不到的項目一行列出來,不折成 0(must-fix ③)。

export type OwnerLineDigestInput = {
  /** = 長信的 `shouldAlert`。true ⇒ 印「要處理」那一行。 */
  alerted: boolean;
  /** 權限快照與昨天不同 / 讀不到;`service_role` 的 BYPASSRLS 被收掉。 */
  aclDriftDetected: boolean;
  aclDriftUnknown: boolean;
  bypassRlsRevoked: boolean;
  /** 24 小時刷卡:失敗筆數(card / 3DS 不互斥、不相加)、分母;`null` = 讀不到。 */
  dailyCardFailedCount: number | null;
  dailyThreeDsFailedCount: number | null;
  dailyChargeAttemptsTotal: number | null;
  dailyChargeCountsUnknown: boolean;
  /** 後台客戶搜尋次數;`null` = 讀不到。 */
  manualCustomerSearchCount: number | null;
  manualCustomerSearchUnknown: boolean;
  // ── 分類用(只判 > 0,不相加)──
  openCount: number;
  refundingStuckCount: number;
  attemptManualReviewCount: number;
  releasedStuckCount: number;
  pendingDoubleChargeCandidateCount: number;
  orderRefundsStuckCount: number | null;
  settleRetryGaveUpCount: number | null;
  pcmIncidentOpenTotal: number | null;
  /** 逐 kind 未解決件數;只拿 `line_forward_failed` 印一行(那不是錢, 從「錢」那類扣掉)。 */
  pcmIncidentByKind?: Record<string, number>;
  stuckBankCount?: number;
  stuckBankOverpaidCount?: number;
  emailOverdueCount: number | null;
  emailDeadLetterCount: number | null;
  emailStuckSendingCount: number | null;
  emailQuotaConfirmedCount: number | null;
  emailQuotaSuspectedCount: number | null;
  shippedNeverEnqueuedCount: number | null;
  shippedUnsendableCount: number | null;
  orderCreatedNoRecipientCount: number | null;
  orderCreatedStuckCount: number | null;
  unpaidCancelledNoRecipientCount: number | null;
  trackingCorrectedNoRecipientCount: number | null;
  trackingCorrectedPayloadUnparseableCount: number | null;
  cronHeartbeatAbnormalCount: number | null;
  syncStaleOpen?: number;
  fitmentStale?: boolean;
  // ── 讀不到(各族的 *Unknown)──
  orderRefundsStuckUnknown: boolean;
  settleRetryGaveUpUnknown: boolean;
  pcmIncidentUnknown: boolean;
  emailOutboxUnknown: boolean;
  shippedGapUnknown: boolean;
  orderCreatedGapUnknown: boolean;
  orderCreatedStuckUnknown: boolean;
  unpaidCancelledGapUnknown: boolean;
  trackingCorrectedGapUnknown: boolean;
  cronHeartbeatUnknown: boolean;
  bypassRlsUnknown: boolean;
  cancelledMixedRailUnknown: boolean;
  partialRefundCancelUnknown: boolean;
  stuckBankUnknown?: boolean;
  searchLogUnknown?: boolean;
  syncStaleUnknown?: boolean;
  fitmentUnknown?: boolean;
};

const gt0 = (n: number | null | undefined) => (n ?? 0) > 0;
const lineForwardFailed = (r: OwnerLineDigestInput) => r.pcmIncidentByKind?.line_forward_failed ?? 0;

/** 有事的類別(順序固定,老闆每天看同一個順序)。空陣列 = 觸發了但這裡分不出類(照樣叫他去後台看)。 */
export function ownerLineCategories(r: OwnerLineDigestInput): string[] {
  const out: string[] = [];
  if (
    gt0(r.openCount) || gt0(r.refundingStuckCount) || gt0(r.attemptManualReviewCount) || gt0(r.releasedStuckCount) ||
    gt0(r.pendingDoubleChargeCandidateCount) || gt0(r.orderRefundsStuckCount) || gt0(r.settleRetryGaveUpCount) ||
    (r.pcmIncidentOpenTotal ?? 0) - lineForwardFailed(r) > 0 || gt0(r.stuckBankCount) || gt0(r.stuckBankOverpaidCount)
  ) out.push('錢');
  if (lineForwardFailed(r) > 0) out.push('LINE');
  if (
    gt0(r.emailOverdueCount) || gt0(r.emailDeadLetterCount) || gt0(r.emailStuckSendingCount) || gt0(r.emailQuotaConfirmedCount) ||
    gt0(r.emailQuotaSuspectedCount) || gt0(r.shippedNeverEnqueuedCount) || gt0(r.shippedUnsendableCount) ||
    gt0(r.orderCreatedNoRecipientCount) || gt0(r.orderCreatedStuckCount) || gt0(r.unpaidCancelledNoRecipientCount) ||
    gt0(r.trackingCorrectedNoRecipientCount) || gt0(r.trackingCorrectedPayloadUnparseableCount)
  ) out.push('寄信');
  if (gt0(r.cronHeartbeatAbnormalCount) || gt0(r.syncStaleOpen) || r.fitmentStale === true) out.push('排程');
  if (r.bypassRlsRevoked || r.aclDriftDetected) out.push('權限');
  return out;
}

/** 這一輪讀不到的項目(給人看的名字,一行列出)。 */
export function ownerLineUnreadable(r: OwnerLineDigestInput): string[] {
  const out: string[] = [];
  if (r.orderRefundsStuckUnknown) out.push('退款');
  if (r.settleRetryGaveUpUnknown) out.push('匯款重試');
  if (r.pcmIncidentUnknown) out.push('事故');
  if (r.stuckBankUnknown === true) out.push('匯款單');
  if (r.emailOutboxUnknown) out.push('寄信');
  if (r.shippedGapUnknown || r.orderCreatedGapUnknown || r.orderCreatedStuckUnknown || r.unpaidCancelledGapUnknown || r.trackingCorrectedGapUnknown) out.push('通知信缺口');
  if (r.cancelledMixedRailUnknown || r.partialRefundCancelUnknown) out.push('取消單');
  if (r.cronHeartbeatUnknown) out.push('排程');
  if (r.searchLogUnknown === true) out.push('搜尋日誌');
  if (r.syncStaleUnknown === true) out.push('供應商同步');
  if (r.fitmentUnknown === true) out.push('車款資料');
  if (r.bypassRlsUnknown) out.push('service_role 權限');
  if (r.dailyChargeCountsUnknown) out.push('刷卡');
  if (r.manualCustomerSearchUnknown) out.push('客戶搜尋');
  return out;
}

function taipeiMonthDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('month')}/${get('day')}`;
}

export function buildOwnerLineDigest(now: Date, r: OwnerLineDigestInput): string {
  const lines: string[] = [`PCM 每日摘要 ${taipeiMonthDay(now)}`];

  lines.push(
    r.aclDriftUnknown
      ? '權限:這一輪讀不到'
      : r.aclDriftDetected
        ? '權限:跟昨天不同(昨天有貼 migration ⇒ 正常;沒貼 ⇒ 要查)'
        : '權限:跟昨天一樣',
  );

  const cardKnown = !r.dailyChargeCountsUnknown && r.dailyCardFailedCount !== null && r.dailyThreeDsFailedCount !== null;
  const searchKnown = !r.manualCustomerSearchUnknown && r.manualCustomerSearchCount !== null;
  const total = r.dailyChargeAttemptsTotal === null ? '' : `(共 ${r.dailyChargeAttemptsTotal} 筆)`;
  const card = !cardKnown
    ? '刷卡:讀不到'
    : r.dailyCardFailedCount === 0 && r.dailyThreeDsFailedCount === 0
      ? `刷卡失敗 0 筆${total}`
      : `刷卡失敗 ${r.dailyCardFailedCount} 筆、3DS 沒過 ${r.dailyThreeDsFailedCount} 筆${total}`;
  const search = searchKnown ? `客戶搜尋 ${r.manualCustomerSearchCount} 次` : '客戶搜尋:讀不到';
  // LINE 轉發失敗(20260914100000):客人傳給官方帳號的訊息沒到報價單 ⇒ FAQ 沒回。有才印;掛在同一行守「不超過 6 行」。
  const lf = lineForwardFailed(r);
  lines.push(`${card} / ${search}${lf > 0 ? ` / LINE 訊息沒轉到報價單 ${lf} 件` : ''}`);

  if (r.alerted) {
    const cats = ownerLineCategories(r);
    lines.push(`${cats.length > 0 ? `要處理:${cats.join('、')}` : '有事要處理'},先到後台看,不要自己去 TapPay 退`);
  }

  const unreadable = ownerLineUnreadable(r);
  if (unreadable.length > 0) lines.push(`這一輪讀不到:${unreadable.join('、')}`);

  lines.push('細節到後台看');
  return lines.join('\n');
}
