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

describe('一般會員這一班新滿 10 萬(Sean 2026-09-27 更正 E 選丙:只讓 Sean 知道)', () => {
  it('🔴 有 2 位 ⇒ 刷卡那一行後面接「新滿 10 萬的一般會員：2 位」, 不另外加一行', () => {
    const text = buildOwnerLineDigest(NOW, { ...QUIET, newMilestoneMemberCount: 2 });
    expect(text).toContain(' / 新滿 10 萬的一般會員：2 位');
    expect(text.split('\n')).toHaveLength(buildOwnerLineDigest(NOW, QUIET).split('\n').length);
  });
  it('0 位 / 沒接(undefined)⇒ 不顯示', () => {
    expect(buildOwnerLineDigest(NOW, { ...QUIET, newMilestoneMemberCount: 0 })).not.toContain('新滿 10 萬');
    expect(buildOwnerLineDigest(NOW, QUIET)).not.toContain('新滿 10 萬');
  });
  it('🔴 讀不到(null)⇒ 列進「這一輪讀不到」, 不當成 0', () => {
    expect(ownerLineUnreadable({ ...QUIET, newMilestoneMemberCount: null })).toContain('一般會員累積金額');
    expect(ownerLineUnreadable({ ...QUIET, newMilestoneMemberCount: 0 })).not.toContain('一般會員累積金額');
  });
});

describe('商品一行(Sean 2026-09-29 Q1 甲 有變動才印一行 / Q2 甲 下架不印 / Q3 甲)', () => {
  const PC = {
    newVariants: 12,
    changedVariants: 35,
    top: { title: 'Öhlins TTX GP 避震器', oldPrice: 58000, newPrice: 61200, pct: 5.5 },
    noCompletedSync: false,
  };
  const base = buildOwnerLineDigest(NOW, QUIET).split('\n').length;

  it('🔴 有變動 ⇒ 多一行, 寫規格數與漲最多那一個(計畫第三節範例)', () => {
    const text = buildOwnerLineDigest(NOW, { ...QUIET, productChanges: PC });
    expect(text).toContain('商品:新上架 12 個規格、變價 35 個規格;漲最多 Öhlins TTX GP 避震器 NT$58,000→61,200(+5.5%)');
    expect(text.split('\n')).toHaveLength(base + 1);
    // 放在「細節到後台看」之前
    expect(text.split('\n').at(-1)).toBe('細節到後台看');
  });

  it('🔴 跌價寫「跌最多」, 不寫成漲', () => {
    const text = buildOwnerLineDigest(NOW, {
      ...QUIET,
      productChanges: { ...PC, top: { title: 'X', oldPrice: 1000, newPrice: 900, pct: -10 } },
    });
    expect(text).toContain('跌最多 X NT$1,000→900(-10%)');
    expect(text).not.toContain('漲最多');
  });

  it('只有其中一個數字 > 0 ⇒ 只印那一個;沒有漲跌最大的 ⇒ 不印分號後面那段', () => {
    const text = buildOwnerLineDigest(NOW, { ...QUIET, productChanges: { ...PC, newVariants: 0, top: null } });
    expect(text).toContain('商品:變價 35 個規格');
    expect(text).not.toContain('新上架');
    expect(text).not.toContain('最多');
  });

  it('🔴 品名換行壓成空白、超過 20 字截斷加「…」(不能撐出第二行)', () => {
    const long = '一二三四五六七八九十\n一二三四五六七八九十一二三';
    const text = buildOwnerLineDigest(NOW, { ...QUIET, productChanges: { ...PC, top: { ...PC.top, title: long } } });
    expect(text.split('\n')).toHaveLength(base + 1);
    expect(text).toContain('漲最多 一二三四五六七八九十 一二三四五六七八九…');
  });

  it('🔴 都是 0 且同步正常 ⇒ 不印(有事才出現)', () => {
    const text = buildOwnerLineDigest(NOW, { ...QUIET, productChanges: { ...PC, newVariants: 0, changedVariants: 0, top: null } });
    expect(text).not.toContain('商品');
    expect(text.split('\n')).toHaveLength(base);
  });

  it('🔴 過去 24 小時沒有完成的同步 ⇒ 印那一句;有變動時合併成同一行(不多撐一行)', () => {
    const none = { ...PC, newVariants: 0, changedVariants: 0, top: null, noCompletedSync: true };
    expect(buildOwnerLineDigest(NOW, { ...QUIET, productChanges: none })).toContain('商品同步:過去 24 小時沒有完成的同步');
    const both = buildOwnerLineDigest(NOW, { ...QUIET, productChanges: { ...PC, noCompletedSync: true } });
    expect(both).toContain('商品:新上架 12 個規格、變價 35 個規格;漲最多');
    expect(both).toContain(' / 商品同步:過去 24 小時沒有完成的同步');
    expect(both.split('\n')).toHaveLength(base + 1);
  });

  it('🔴 讀不到(null)⇒ 列進「這一輪讀不到:商品」, 不印那一行、不當成 0;沒接(undefined)⇒ 什麼都不印', () => {
    const text = buildOwnerLineDigest(NOW, { ...QUIET, productChanges: null });
    expect(ownerLineUnreadable({ ...QUIET, productChanges: null })).toContain('商品');
    expect(text).not.toContain('商品:');
    expect(ownerLineUnreadable(QUIET)).not.toContain('商品');
    expect(buildOwnerLineDigest(NOW, QUIET)).not.toContain('商品');
  });

  it('所有會印的行都出現時最多 7 行(原本 6 行 + 商品一行)', () => {
    const worst = buildOwnerLineDigest(NOW, {
      ...QUIET,
      alerted: true,
      openCount: 2,
      orderRefundsStuckUnknown: true,
      productChanges: { ...PC, noCompletedSync: true },
    });
    expect(worst.split('\n').length).toBeLessThanOrEqual(7);
  });
});
