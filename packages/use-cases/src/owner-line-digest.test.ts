import { describe, expect, it } from 'vitest';
import { buildOwnerLineDigest, ownerLineCategories, ownerLineUnreadable, type OwnerLineDigestInput } from './owner-line-digest';

// owner-line-digest.test.ts — 給老闆看的 LINE 短版(2026-09-14)。守的是規則本身:零 emoji / 零 SQL / 零路徑、每段一行、
// 「讀不到」與 0 分得開、「有沒有事」跟長信同一把尺(alerted)、不印總筆數。

const NOW = new Date('2026-09-14T01:00:00Z'); // 台北 09/14 09:00
const QUIET: OwnerLineDigestInput = {
  alerted: false,
  aclDriftDetected: false,
  aclDriftUnknown: false,
  bypassRlsRevoked: false,
  dailyCardFailedCount: 0,
  dailyThreeDsFailedCount: 0,
  dailyChargeAttemptsTotal: 12,
  dailyChargeCountsUnknown: false,
  manualCustomerSearchCount: 0,
  manualCustomerSearchUnknown: false,
  openCount: 0,
  refundingStuckCount: 0,
  attemptManualReviewCount: 0,
  releasedStuckCount: 0,
  pendingDoubleChargeCandidateCount: 0,
  orderRefundsStuckCount: 0,
  settleRetryGaveUpCount: 0,
  pcmIncidentOpenTotal: 0,
  stuckBankCount: 0,
  stuckBankOverpaidCount: 0,
  emailOverdueCount: 0,
  emailDeadLetterCount: 0,
  emailStuckSendingCount: 0,
  emailQuotaConfirmedCount: 0,
  emailQuotaSuspectedCount: 0,
  shippedNeverEnqueuedCount: 0,
  shippedUnsendableCount: 0,
  orderCreatedNoRecipientCount: 0,
  orderCreatedStuckCount: 0,
  unpaidCancelledNoRecipientCount: 0,
  trackingCorrectedNoRecipientCount: 0,
  trackingCorrectedPayloadUnparseableCount: 0,
  cronHeartbeatAbnormalCount: 0,
  syncStaleOpen: 0,
  fitmentStale: false,
  orderRefundsStuckUnknown: false,
  settleRetryGaveUpUnknown: false,
  pcmIncidentUnknown: false,
  emailOutboxUnknown: false,
  shippedGapUnknown: false,
  orderCreatedGapUnknown: false,
  orderCreatedStuckUnknown: false,
  unpaidCancelledGapUnknown: false,
  trackingCorrectedGapUnknown: false,
  cronHeartbeatUnknown: false,
  bypassRlsUnknown: false,
  cancelledMixedRailUnknown: false,
  partialRefundCancelUnknown: false,
  paidAfterCancelUnknown: false,
  stuckBankUnknown: false,
};

describe('buildOwnerLineDigest', () => {
  it('安靜日:四行;刷卡 0 帶分母(不會讀成沒人刷卡);台北日期', () => {
    expect(buildOwnerLineDigest(NOW, QUIET)).toBe(
      ['PCM 每日摘要 09/14', '權限:跟昨天一樣', '刷卡失敗 0 筆(共 12 筆) / 客戶搜尋 0 次', '細節到後台看'].join('\n'),
    );
  });

  it('權限跟昨天不同 ⇒ 那一行照主視窗給的字面;讀不到 ⇒ 印讀不到,不印「一樣」', () => {
    expect(buildOwnerLineDigest(NOW, { ...QUIET, aclDriftDetected: true }).split('\n')[1]).toBe('權限:跟昨天不同(昨天有貼 migration ⇒ 正常;沒貼 ⇒ 要查)');
    expect(buildOwnerLineDigest(NOW, { ...QUIET, aclDriftUnknown: true }).split('\n')[1]).toBe('權限:這一輪讀不到');
  });

  it('🔴 「讀不到」與 0 分得開:刷卡 / 搜尋各自印讀不到;各族 *Unknown 一行列出來,不折成 0', () => {
    const t1 = buildOwnerLineDigest(NOW, { ...QUIET, dailyChargeCountsUnknown: true, dailyCardFailedCount: null, dailyThreeDsFailedCount: null });
    expect(t1).toContain('刷卡:讀不到 / 客戶搜尋 0 次');
    expect(t1).toContain('這一輪讀不到:刷卡');
    const t2 = buildOwnerLineDigest(NOW, { ...QUIET, orderRefundsStuckUnknown: true, orderRefundsStuckCount: null, partialRefundCancelUnknown: true });
    expect(t2).toContain('這一輪讀不到:退款、取消單');
    expect(buildOwnerLineDigest(NOW, QUIET)).not.toContain('讀不到');
    // ⟦f3-PAIDCANCELRACE1⟧ codex R1 must-fix:新那支讀不到 ⇒ 短版也列「取消單」, 不是靜靜消失。
    expect(buildOwnerLineDigest(NOW, { ...QUIET, paidAfterCancelUnknown: true })).toContain('這一輪讀不到:取消單');
    expect(ownerLineUnreadable({ ...QUIET, manualCustomerSearchUnknown: true, manualCustomerSearchCount: null })).toEqual(['客戶搜尋']);
    // codex R2:搜尋日誌 / 供應商同步 / 車款資料那三族讀不到也要講(它們讀不到時 route 照樣寄心跳)。
    expect(ownerLineUnreadable({ ...QUIET, searchLogUnknown: true, syncStaleUnknown: true, fitmentUnknown: true })).toEqual(['搜尋日誌', '供應商同步', '車款資料']);
  });

  it('有刷卡失敗 ⇒ 兩個數分開講、帶分母;不相加', () => {
    const t = buildOwnerLineDigest(NOW, { ...QUIET, dailyCardFailedCount: 3, dailyThreeDsFailedCount: 2, manualCustomerSearchCount: 5 });
    expect(t).toContain('刷卡失敗 3 筆、3DS 沒過 2 筆(共 12 筆) / 客戶搜尋 5 次');
    expect(t).not.toContain('5 筆失敗');
  });

  // 🆕 20260914120000(主視窗裁甲:同一行加字, 不加行)—— 第一筆失敗的單號印在「刷卡失敗 N 筆」後面。
  it('🔴 有失敗且有單號 ⇒ 同一行印(第一筆 X), 行數不變', () => {
    const base = buildOwnerLineDigest(NOW, { ...QUIET, dailyCardFailedCount: 3, dailyThreeDsFailedCount: 2, manualCustomerSearchCount: 5 });
    const t = buildOwnerLineDigest(NOW, { ...QUIET, dailyCardFailedCount: 3, dailyThreeDsFailedCount: 2, manualCustomerSearchCount: 5, dailyChargeFirstFailedDisplayId: 'PCM-2026-1007' });
    expect(t).toContain('刷卡失敗 3 筆(第一筆 PCM-2026-1007)、3DS 沒過 2 筆(共 12 筆) / 客戶搜尋 5 次');
    expect(t.split('\n').length).toBe(base.split('\n').length);
  });

  it('🔴 0 筆失敗 / 讀不到 / 第 1 代 RPC(key 缺)⇒ 不印括號', () => {
    expect(buildOwnerLineDigest(NOW, { ...QUIET, dailyChargeFirstFailedDisplayId: 'PCM-2026-1007' })).not.toContain('第一筆');
    expect(buildOwnerLineDigest(NOW, { ...QUIET, dailyChargeCountsUnknown: true, dailyCardFailedCount: null, dailyThreeDsFailedCount: null, dailyChargeFirstFailedDisplayId: 'PCM-2026-1007' })).not.toContain('第一筆');
    expect(buildOwnerLineDigest(NOW, { ...QUIET, dailyCardFailedCount: 3, dailyThreeDsFailedCount: 0 })).toContain('刷卡失敗 3 筆、3DS');
    expect(buildOwnerLineDigest(NOW, { ...QUIET, dailyCardFailedCount: 3, dailyThreeDsFailedCount: 0, dailyChargeFirstFailedDisplayId: null })).not.toContain('第一筆');
  });

  it('🔴 「有沒有事」= alerted(跟長信同一把尺):只有多收款 / 只有 BYPASSRLS 被收 / 只有寄信卡住 都要印那一行,而且分得出類', () => {
    expect(buildOwnerLineDigest(NOW, { ...QUIET, alerted: true, stuckBankOverpaidCount: 3 })).toContain('要處理:錢,先到後台看,不要自己去 TapPay 退');
    expect(buildOwnerLineDigest(NOW, { ...QUIET, alerted: true, bypassRlsRevoked: true })).toContain('要處理:權限,先到後台看');
    expect(buildOwnerLineDigest(NOW, { ...QUIET, alerted: true, emailOverdueCount: 1 })).toContain('要處理:寄信,先到後台看');
    expect(ownerLineCategories({ ...QUIET, openCount: 1, cronHeartbeatAbnormalCount: 2, aclDriftDetected: true })).toEqual(['錢', '排程', '權限']);
    // 觸發了而這裡分不出類(例:搜尋日誌那族)⇒ 仍然叫他去後台看,不靜靜省略。
    expect(buildOwnerLineDigest(NOW, { ...QUIET, alerted: true })).toContain('有事要處理,先到後台看,不要自己去 TapPay 退');
    // 沒觸發 ⇒ 沒那一行;也不印任何總筆數。
    const quiet = buildOwnerLineDigest(NOW, QUIET);
    expect(quiet).not.toContain('TapPay');
    expect(quiet).not.toMatch(/異常 \d+ 筆/);
  });

  it('LINE 轉發失敗(line_forward_failed):同一行印件數、分到「LINE」不分到「錢」;0 件不印', () => {
    const r = { ...QUIET, alerted: true, pcmIncidentOpenTotal: 2, pcmIncidentByKind: { line_forward_failed: 2 } };
    expect(buildOwnerLineDigest(NOW, r)).toContain('/ LINE 訊息沒轉到報價單 2 件');
    expect(ownerLineCategories(r)).toEqual(['LINE']);
    // 錢的事故 + LINE 的事故混在同一個總數 ⇒ 兩類都要出來。
    expect(ownerLineCategories({ ...r, pcmIncidentOpenTotal: 3, pcmIncidentByKind: { line_forward_failed: 2, auto_cancel_failed: 1 } })).toEqual(['錢', 'LINE']);
    expect(buildOwnerLineDigest(NOW, QUIET)).not.toContain('LINE');
    expect(buildOwnerLineDigest(NOW, { ...QUIET, pcmIncidentByKind: { line_forward_failed: 0 } })).not.toContain('LINE');
  });

  it('P1-6:錢收足未付(匯款 / 現金)、付款狀態算不動、現金單放棄 ⇒ 都歸「錢」;讀不到各自列出,缺(沒接)不列', () => {
    for (const extra of [
      { stuckBankUnpaidSettledBankCount: 1 },
      { stuckBankUnpaidSettledCashCount: 1 },
      { stuckBankJudgeErrorCount: 2 },
      { settleRetryGaveUpCashCount: 1 },
    ]) {
      expect(ownerLineCategories({ ...QUIET, ...extra }), JSON.stringify(extra)).toEqual(['錢']);
    }
    expect(ownerLineCategories({ ...QUIET, stuckBankUnpaidSettledCashCount: 0, settleRetryGaveUpCashCount: 0 })).toEqual([]);
    expect(ownerLineUnreadable({ ...QUIET, settleRetryGaveUpCashCount: null })).toEqual(['現金重試']);
    expect(ownerLineUnreadable({ ...QUIET, stuckBankUnpaidSettledCashCount: null })).toEqual(['錢收足未付']);
    expect(ownerLineUnreadable({ ...QUIET, stuckBankJudgeErrorCount: null })).toEqual(['付款狀態計算']);
    // 整族讀不到時只列「匯款單」/「匯款重試」, 不重複列細項
    expect(ownerLineUnreadable({ ...QUIET, stuckBankUnknown: true, stuckBankJudgeErrorCount: null })).toEqual(['匯款單']);
    expect(ownerLineUnreadable({ ...QUIET, settleRetryGaveUpUnknown: true, settleRetryGaveUpCashCount: null })).toEqual(['匯款重試']);
    expect(ownerLineUnreadable(QUIET)).toEqual([]);
  });

  it('🔴 規則:零 emoji、零 SQL、零 script 路徑、零內心話;每段一行、不超過 6 行', () => {
    const worst = buildOwnerLineDigest(NOW, {
      ...QUIET,
      alerted: true,
      aclDriftUnknown: true,
      dailyCardFailedCount: 9,
      dailyThreeDsFailedCount: 1,
      manualCustomerSearchCount: 99,
      openCount: 2,
      pcmIncidentOpenTotal: 1,
      emailDeadLetterCount: 4,
      orderRefundsStuckUnknown: true,
      cronHeartbeatUnknown: true,
    });
    const lines = worst.split('\n');
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
    expect(worst).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(worst).not.toMatch(/SELECT|FROM|pcm_acl_approve_latest|scripts\/|\.sh|\.py|答不出|我讀不到/i);
    expect(worst).not.toMatch(/NT\$|TWD|PCM-\d{4}-\d{4}/);
  });

  it('部分取消對帳:>0 同一行印張數(行數不變)、告警日歸「錢」;0 不印;讀不到列出', () => {
    const t = buildOwnerLineDigest(NOW, { ...QUIET, partialCancelReconciliation: { total: 3 } });
    expect(t).toContain('/ 部分取消退款對不上 3 張');
    expect(t.split('\n').length).toBe(buildOwnerLineDigest(NOW, QUIET).split('\n').length);
    expect(buildOwnerLineDigest(NOW, { ...QUIET, partialCancelReconciliation: { total: 0 } })).not.toContain('部分取消');
    expect(ownerLineCategories({ ...QUIET, partialCancelReconciliation: { total: 3 } })).toEqual(['錢']);
    expect(ownerLineCategories({ ...QUIET, partialCancelReconciliation: { total: 0 } })).toEqual([]);
    expect(ownerLineUnreadable({ ...QUIET, partialCancelReconciliationUnknown: true })).toEqual(['部分取消對帳']);
  });

  it('⟦db-WEBHOOKMANUALBACKLOG⟧ 付款通知:已套門檻才歸「錢」;讀不到列「付款通知」;缺 = 不影響', () => {
    expect(ownerLineCategories({ ...QUIET, webhookManualReviewOverdue: true })).toEqual(['錢']);
    expect(ownerLineCategories({ ...QUIET, webhookManualReviewOverdue: false })).toEqual([]);
    expect(ownerLineCategories(QUIET)).toEqual([]);
    expect(ownerLineUnreadable({ ...QUIET, webhookManualReviewUnknown: true })).toEqual(['付款通知']);
    expect(ownerLineUnreadable({ ...QUIET, webhookManualReviewUnknown: false })).toEqual([]);
  });
});

describe('經銷商申請待審件數(Sean 2026-09-25 Q2:有待審才印, 沒有不顯示)', () => {
  it('🔴 有 3 件 ⇒ 刷卡那一行後面接「有 3 件經銷商申請待審核」, 不另外加一行', () => {
    const text = buildOwnerLineDigest(NOW, { ...QUIET, dealerApplicationsPendingCount: 3 });
    expect(text).toContain(' / 有 3 件經銷商申請待審核');
    expect(text.split('\n')).toHaveLength(buildOwnerLineDigest(NOW, QUIET).split('\n').length);
  });
  it('0 件 / 沒接(undefined)⇒ 不顯示', () => {
    expect(buildOwnerLineDigest(NOW, { ...QUIET, dealerApplicationsPendingCount: 0 })).not.toContain('經銷商申請');
    expect(buildOwnerLineDigest(NOW, QUIET)).not.toContain('經銷商申請');
  });
  it('🔴 讀不到(null)⇒ 列進「這一輪讀不到」, 不當成 0', () => {
    expect(ownerLineUnreadable({ ...QUIET, dealerApplicationsPendingCount: null })).toContain('經銷商申請件數');
    expect(ownerLineUnreadable({ ...QUIET, dealerApplicationsPendingCount: 0 })).not.toContain('經銷商申請件數');
  });
});
