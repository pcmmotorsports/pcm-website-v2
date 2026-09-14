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
    expect(ownerLineUnreadable({ ...QUIET, manualCustomerSearchUnknown: true, manualCustomerSearchCount: null })).toEqual(['客戶搜尋']);
    // codex R2:搜尋日誌 / 供應商同步 / 車款資料那三族讀不到也要講(它們讀不到時 route 照樣寄心跳)。
    expect(ownerLineUnreadable({ ...QUIET, searchLogUnknown: true, syncStaleUnknown: true, fitmentUnknown: true })).toEqual(['搜尋日誌', '供應商同步', '車款資料']);
  });

  it('有刷卡失敗 ⇒ 兩個數分開講、帶分母;不相加', () => {
    const t = buildOwnerLineDigest(NOW, { ...QUIET, dailyCardFailedCount: 3, dailyThreeDsFailedCount: 2, manualCustomerSearchCount: 5 });
    expect(t).toContain('刷卡失敗 3 筆、3DS 沒過 2 筆(共 12 筆) / 客戶搜尋 5 次');
    expect(t).not.toContain('5 筆失敗');
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
});
