import { describe, it, expect, vi, afterEach } from 'vitest';
import { toMoneyAmount } from '@pcm/domain';
import type {
  ActiveChargeAttempt,
  TapPayRecordQuery,
  TapPayRecordResult,
  TapPayTradeRecord,
} from '@pcm/domain';
import type { ITapPayAdapter, IChargeAttemptStore, IPaymentConfirmer } from '@pcm/ports';
import { settleCharge, type SettleChargeDeps } from './settle-charge';

const ORDER_ID = 'order-uuid-1';
const DISPLAY_ID = 'PCM-2026-0001';
const ATTEMPT_CREATED_AT = '2026-06-14T00:00:00.000Z';
const TXN_TIME_MS = Date.parse(ATTEMPT_CREATED_AT); // 同刻 → 必在窗內

/** active pending attempt(rec + bank 皆有;orderPaymentStatus=unpaid → 走 Record 反查)。 */
const ACTIVE_PENDING: ActiveChargeAttempt = {
  attemptId: 'attempt-1',
  status: 'pending',
  recTradeId: 'D-rec-1',
  bankTransactionId: 'bank-1',
  attemptCreatedAt: ATTEMPT_CREATED_AT,
  orderTotal: 1050,
  orderPaymentStatus: 'unpaid',
  orderDisplayId: DISPLAY_ID,
};

function tradeRecord(over: Partial<TapPayTradeRecord> = {}): TapPayTradeRecord {
  return {
    recTradeId: 'D-rec-1',
    orderNumber: ORDER_ID,
    bankTransactionId: 'bank-1',
    merchantId: 'M_test',
    amount: toMoneyAmount(1050),
    currency: 'TWD',
    recordStatus: 1, // OK
    isCaptured: true,
    transactionTimeMillis: TXN_TIME_MS,
    ...over,
  };
}

function recordResult(
  recOver: Partial<TapPayTradeRecord> = {},
  topOver: Partial<TapPayRecordResult> = {},
): TapPayRecordResult {
  return { queryStatus: 0, numberOfTransactions: 1, records: [tradeRecord(recOver)], ...topOver };
}

function makeTapPay(recordQuery: (q: TapPayRecordQuery) => Promise<TapPayRecordResult>): ITapPayAdapter {
  // initiateThreeDSCharge(3DS-5a)為新增 port 方法;settleCharge(結算半段)不呼用、stub 滿足介面。
  return { charge: vi.fn(), refund: vi.fn(), recordQuery: vi.fn(recordQuery), initiateThreeDSCharge: vi.fn() };
}
function makeAttempts(over: Partial<IChargeAttemptStore> = {}): IChargeAttemptStore {
  return {
    begin: vi.fn(),
    markCharged: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    findActiveByOrderId: vi.fn(async () => ACTIVE_PENDING),
    // 3DS-4 sweeper port 方法;settleCharge 本身不呼用(sweeper use-case〔3DS-4b-2〕才呼)、stub 滿足介面。
    expireStuckAtCeiling: vi.fn(async () => 0),
    claimStuckUnsettled: vi.fn(async () => []),
    markSettleRetry: vi.fn(async () => 1),
    flagNonUnpaidActive: vi.fn(async () => 0),
    // 3DS-5b initiate 寫入 port 方法;settleCharge 不呼用(initiate use-case〔3DS-5b〕才呼)、stub 滿足介面。
    recordInitiationBankTxn: vi.fn(async () => {}),
    recordInitiationRec: vi.fn(async () => {}),
    // R2a released failure observation port 方法(settleCharge released branch 在 R2b 才呼;本片 stub 滿足介面)。
    recordReleasedFailureObservation: vi.fn(async () => {}),
    ...over,
  };
}
function makeConfirmer(over: Partial<IPaymentConfirmer> = {}): IPaymentConfirmer {
  return {
    confirm: vi.fn(async () => ({ confirmed: true, idempotent: false })),
    recordPendingInvoice: vi.fn(async () => true),
    ...over,
  };
}
function deps(over: Partial<SettleChargeDeps> = {}): SettleChargeDeps {
  return {
    tappay: over.tappay ?? makeTapPay(async () => recordResult()),
    attempts: over.attempts ?? makeAttempts(),
    confirmer: over.confirmer ?? makeConfirmer(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('settleCharge — paid 收斂(happy path)', () => {
  it('既有 OK captured happy path(record_status=1 + is_captured + 金額符)→ markCharged(主軌 token=\'\')→ confirm → recordPendingInvoice → paid', async () => {
    const d = deps();
    const res = await settleCharge(d, { orderId: ORDER_ID });
    expect(res).toEqual({ kind: 'paid', idempotent: false, displayId: DISPLAY_ID });
    expect(d.attempts.markCharged).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      orderId: ORDER_ID,
      recTradeId: 'D-rec-1', // Record 權威 rec
      fallbackToken: '', // 主軌-only 對帳路徑、無備軌 token
    });
    expect(d.confirmer.confirm).toHaveBeenCalledWith({
      orderId: ORDER_ID,
      amount: { amount: 1050, currency: 'TWD' },
      recTradeId: 'D-rec-1',
    });
    expect(d.confirmer.recordPendingInvoice).toHaveBeenCalledWith(ORDER_ID);
  });

  it('⑩ 重入冪等:confirm 回 idempotent:true → paid{idempotent:true}', async () => {
    const d = deps({ confirmer: makeConfirmer({ confirm: vi.fn(async () => ({ confirmed: true, idempotent: true })) }) });
    const res = await settleCharge(d, { orderId: ORDER_ID });
    expect(res).toEqual({ kind: 'paid', idempotent: true, displayId: DISPLAY_ID });
  });
});

describe('settleCharge — ① no_attempt / ② 短路 / ⑪ recordQuery throw', () => {
  it('① findActiveByOrderId → null → no_attempt(不打 Record)', async () => {
    const tappay = makeTapPay(async () => recordResult());
    const d = deps({ tappay, attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => null) }) });
    const res = await settleCharge(d, { orderId: ORDER_ID });
    expect(res).toEqual({ kind: 'no_attempt' });
    expect(tappay.recordQuery).not.toHaveBeenCalled();
  });

  it('② 缺陷C 短路:orderPaymentStatus=paid → 不打 Record、補記待開票、回 paid{idempotent:true}', async () => {
    const tappay = makeTapPay(async () => recordResult());
    const confirmer = makeConfirmer();
    const d = deps({
      tappay,
      confirmer,
      attempts: makeAttempts({
        findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, status: 'charged' as const, orderPaymentStatus: 'paid' as const })),
      }),
    });
    const res = await settleCharge(d, { orderId: ORDER_ID });
    expect(res).toEqual({ kind: 'paid', idempotent: true, displayId: DISPLAY_ID });
    expect(tappay.recordQuery).not.toHaveBeenCalled(); // 省 §7 rate-limit
    expect(confirmer.recordPendingInvoice).toHaveBeenCalledWith(ORDER_ID); // C×A 自癒
    expect(confirmer.confirm).not.toHaveBeenCalled();
  });

  it('⑪ recordQuery throw → pending:record_unreachable(保留、不誤判 failed)', async () => {
    const d = deps({ tappay: makeTapPay(async () => { throw new Error('HTTP 500'); }) });
    const res = await settleCharge(d, { orderId: ORDER_ID });
    expect(res).toEqual({ kind: 'pending', reason: 'record_unreachable' });
  });
});

describe('🔴 settleCharge — queryStatus=2 查詢成功放行(2026-06-21 querystatus-fix root cause、PCM-2026-0018)', () => {
  // R1:root cause 正向 — top status=2「已無更多分頁」是查詢成功、count=1、record_status=0(AUTH)→ S1「授權即成立」真生效。
  it('R1 queryStatus=2 + count=1 + record_status=0(AUTH)→ paid(status=2 不再被誤殺)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 0 }, { queryStatus: 2 })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'paid', idempotent: false, displayId: DISPLAY_ID });
  });
  it('R2 queryStatus=2 + record_status=1(OK)→ paid(2 放行後 OK 也成立)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 1 }, { queryStatus: 2 })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'paid', idempotent: false, displayId: DISPLAY_ID });
  });
  // R3:放行 status=2 後 record_status 仍逐態裁決(未弱化)、未知碼仍 fail-closed。
  it.each([
    [-1, { kind: 'failed' }], //                                         ERROR → explicit_failed
    [0, { kind: 'paid', idempotent: false, displayId: DISPLAY_ID }], //  AUTH  → paid(授權即成立)
    [1, { kind: 'paid', idempotent: false, displayId: DISPLAY_ID }], //  OK    → paid
    [2, { kind: 'pending', reason: 'record_unverified' }], //            PARTIALREFUNDED → refund_anomaly(告警、不放行)
    [3, { kind: 'pending', reason: 'record_unverified' }], //            REFUNDED → refund_anomaly
    [4, { kind: 'pending', reason: 'auth_or_pending' }], //              PENDING 待付款(尚未授權)
    [5, { kind: 'failed' }], //                                         CANCEL → explicit_failed
    [999, { kind: 'pending', reason: 'record_unverified' }], //          未知碼 → default fail-closed
  ])('R3 queryStatus=2 × record_status=%i → 逐態裁決(放行 status 後不弱化)', async (rs, expected) => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); // 退款態 console.error 告警(不影響裁決)
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: rs }, { queryStatus: 2 })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual(expected);
    errSpy.mockRestore();
  });
  // R5a/R5b:放行 status 後仍要求恰 1 筆(count 與 records 各自擋、縱深不動)。
  it('R5a queryStatus=2 + count=0 → record_unverified(count 閘仍擋)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({}, { queryStatus: 2, numberOfTransactions: 0 })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('R5b queryStatus=2 + records.length≠1 → record_unverified(records 閘仍擋)', async () => {
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({}, { queryStatus: 2, numberOfTransactions: 1, records: [tradeRecord(), tradeRecord()] }),
      ),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
});

describe('settleCharge — Record 權威全條件不滿足 → pending:record_unverified', () => {
  // 🔴 R4(querystatus-fix):queryStatus 非成功白名單 {0,2}(如 99 未知/error code)→ record_unverified fail-closed。
  //    原測斷言「queryStatus=2 → unverified」是 bug 行為固化(把查詢成功態當失敗),已移除;status=2 正向放行見
  //    「queryStatus=2 查詢成功放行」describe(R1-R5b)。
  it('queryStatus 非白名單 {0,2}(如 99 未知/error code)→ record_unverified(fail-closed、不誤放行錯誤碼)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({}, { queryStatus: 99 })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('numberOfTransactions≠1 → record_unverified', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({}, { numberOfTransactions: 2, records: [tradeRecord(), tradeRecord()] })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('order_number≠orderId(誤命中他單)→ record_unverified', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ orderNumber: 'other-order' })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('③ amount 不符 orders.total → record_unverified(不放行)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ amount: toMoneyAmount(999) })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('currency 非 TWD → record_unverified', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ currency: 'USD' })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
});

describe('settleCharge — record_status 官方 7 值映射(§5)', () => {
  it('🔴 S1 record_status=0(AUTH)強識別 → paid(授權即成立、不再要求 is_captured;走 settlePaid 全鏈)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false })) });
    const res = await settleCharge(d, { orderId: ORDER_ID });
    expect(res).toEqual({ kind: 'paid', idempotent: false, displayId: DISPLAY_ID });
    expect(d.attempts.markCharged).toHaveBeenCalledWith({ attemptId: 'attempt-1', orderId: ORDER_ID, recTradeId: 'D-rec-1', fallbackToken: '' });
    expect(d.confirmer.confirm).toHaveBeenCalledWith({ orderId: ORDER_ID, amount: { amount: 1050, currency: 'TWD' }, recTradeId: 'D-rec-1' });
    expect(d.confirmer.recordPendingInvoice).toHaveBeenCalledWith(ORDER_ID);
  });
  it('🔴 S1 關鍵分界 record_status=4(PENDING 待付款、尚未授權)→ pending:auth_or_pending(0 反轉但 4 守住)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 4, isCaptured: false })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'auth_or_pending' });
  });
  it('🔴 S1 record_status=1 但 is_captured=false → paid(OK 即成立、不再要求 captured)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 1, isCaptured: false })) });
    expect((await settleCharge(d, { orderId: ORDER_ID })).kind).toBe('paid');
  });
  it('⑤ record_status=-1(ERROR)→ markFailed → failed', async () => {
    const attempts = makeAttempts();
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: -1 })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'failed' });
    expect(attempts.markFailed).toHaveBeenCalledWith({ attemptId: 'attempt-1', orderId: ORDER_ID });
  });
  it('⑤ record_status=5(CANCEL)→ markFailed → failed', async () => {
    const attempts = makeAttempts();
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 5 })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'failed' });
    expect(attempts.markFailed).toHaveBeenCalledOnce();
  });
  it('⑦ record_status=2(部分退款)→ pending:record_unverified + 告警(不自動放行)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 2 })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(errSpy).toHaveBeenCalled();
  });
  it('⑦ record_status=3(完全退款)→ pending:record_unverified + 告警', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 3 })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('settleCharge — ④ paid 收斂寫入失敗 → pending', () => {
  it('④ markCharged ok → confirm throw → pending:record_unreachable(已扣款不棄、retry)', async () => {
    const d = deps({ confirmer: makeConfirmer({ confirm: vi.fn(async () => { throw new Error('confirm down'); }) }) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unreachable' });
  });
  it('markCharged throw → pending:record_unreachable(retry 冪等)', async () => {
    const d = deps({ attempts: makeAttempts({ markCharged: vi.fn(async () => { throw new Error('pg down'); }) }) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unreachable' });
  });
  it('confirm 回 confirmed:false(drift)→ fail-closed pending:record_unverified(不宣 paid)', async () => {
    const d = deps({ confirmer: makeConfirmer({ confirm: vi.fn(async () => ({ confirmed: false, idempotent: false })) }) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
});

describe('settleCharge — fail-closed 讀/釋鎖(codex 關卡2:不 reject route)', () => {
  it('findActiveByOrderId throw → pending:record_unreachable(不 reject、sweeper 重來)', async () => {
    const d = deps({ attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => { throw new Error('pg read down'); }) }) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unreachable' });
  });
  it('explicit_failed(-1/5)但 markFailed throw → pending:record_unreachable(不誤回 failed、不 reject)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ recordStatus: 5 })),
      attempts: makeAttempts({ markFailed: vi.fn(async () => { throw new Error('release down'); }) }),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unreachable' });
  });
});

describe('settleCharge — 共用識別+金額閘(codex 關卡2:防誤命中他單誤釋鎖)', () => {
  it('本機有 rec 但 Record rec 不符 → pending:record_unverified(即使 record_status=1)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recTradeId: 'D-other' })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('本機有 bank 但 Record bank 不符 → pending:record_unverified', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ bankTransactionId: 'bank-other' })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('🔴 識別閘擋在 terminal 前:record_status=5(CANCEL)但 rec 不符 → pending(不 markFailed 放行=防雙扣)', async () => {
    const attempts = makeAttempts();
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 5, recTradeId: 'D-other' })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });
});

describe('settleCharge — 弱識別(order_number/hint fallback)時間窗(master plan §1 step2)', () => {
  const weakAttempt: ActiveChargeAttempt = { ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null };
  it('order_number fallback + 交易時間在窗內 → 正常裁決(paid)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ transactionTimeMillis: TXN_TIME_MS })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect((await settleCharge(d, { orderId: ORDER_ID })).kind).toBe('paid');
  });
  it('order_number fallback + 交易時間超窗(+48h)→ pending:record_unverified(防誤命中遠古他單)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ transactionTimeMillis: TXN_TIME_MS + 48 * 60 * 60 * 1000 })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('🔴 單向窗(codex r2):弱識別 + 交易時間在 attempt「前」1h(舊交易)→ pending + 不 markFailed/markCharged', async () => {
    const attempts = makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) });
    const d = deps({
      // record_status=5(CANCEL)舊交易在 attempt 前 → 不可走 markFailed 釋鎖放行重刷(雙扣)
      tappay: makeTapPay(async () => recordResult({ recordStatus: 5, transactionTimeMillis: TXN_TIME_MS - 60 * 60 * 1000 })),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markFailed).not.toHaveBeenCalled();
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });
  it('🔴 S1【審查④】explicit_failed 下界不回歸:弱識別 + record_status=5(CANCEL)落 attempt「前」3min → pending:record_unverified、不呼 markFailed/markCharged(收緊後 recordMatchesOrder L89 統一擋拒 pre-attempt、防誤釋鎖重刷雙扣)', async () => {
    const attempts = makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) });
    const d = deps({
      // S1 收緊後下界=attempt:此交易早於 attempt → recordMatchesOrder 弱識別窗即擋成 record_unverified、到不了 explicit_failed
      tappay: makeTapPay(async () => recordResult({ recordStatus: 5, transactionTimeMillis: TXN_TIME_MS - 3 * 60 * 1000 })),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markFailed).not.toHaveBeenCalled();
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });
  it('🔴 S1 收緊:弱識別 + record_status=1 paid 落 attempt「前」3min(原 -5min skew 帶內)→ pending:record_unverified(下界收成 attempt、移除 paid 自癒 skew、雙扣縫關閉)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ transactionTimeMillis: TXN_TIME_MS - 3 * 60 * 1000 })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('🔴 S1【審查①】弱識別 + record_status=0(AUTH)落 attempt「前」2min → pending:record_unverified、不呼 markCharged/confirm/markFailed(放寬到 AUTH 後 pre-attempt 仍被收緊窗擋、不走 settlePaid)', async () => {
    const attempts = makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) });
    const confirmer = makeConfirmer();
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, transactionTimeMillis: TXN_TIME_MS - 2 * 60 * 1000 })),
      attempts,
      confirmer,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
    expect(confirmer.confirm).not.toHaveBeenCalled();
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });
  it('🔴 S1【審查②】弱識別 + record_status=0(AUTH)交易時間 = attempt(本 attempt 自己 charge)→ paid(走 settlePaid)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, transactionTimeMillis: TXN_TIME_MS })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect((await settleCharge(d, { orderId: ORDER_ID })).kind).toBe('paid');
  });
  it('弱識別 + Record 缺交易時間 → fail-closed pending:record_unverified(無法驗窗)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ transactionTimeMillis: undefined })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('強識別(有 rec)不套時間窗:即使交易時間超窗仍正常(rec 已唯一識別)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ transactionTimeMillis: TXN_TIME_MS + 99 * 24 * 60 * 60 * 1000 })) });
    expect((await settleCharge(d, { orderId: ORDER_ID })).kind).toBe('paid'); // ACTIVE_PENDING 有 rec → 強識別、不驗窗
  });
});

describe('settleCharge — S1 授權即成立:放寬不弱化識別/金額閘(AUTH 四閘 + count guard)', () => {
  it('🔴【把關】AUTH 強識別 + rec/bank/amount/currency 全符 → paid', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false })) });
    expect((await settleCharge(d, { orderId: ORDER_ID })).kind).toBe('paid');
  });
  it('🔴【把關】AUTH + rec 不符 → pending:record_unverified(識別閘對 AUTH 仍擋、不走 settlePaid)', async () => {
    const attempts = makeAttempts();
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, recTradeId: 'D-other' })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });
  it('🔴【把關】AUTH + bank 不符 → pending:record_unverified', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, bankTransactionId: 'bank-other' })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('🔴【把關】AUTH + amount 不符 orders.total → pending:record_unverified(金額閘對 AUTH 仍擋)', async () => {
    const attempts = makeAttempts();
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, amount: toMoneyAmount(999) })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });
  it('🔴【把關】AUTH + currency 非 TWD → pending:record_unverified', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, currency: 'USD' })) });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('🔴 S1【審查③】count=2(records.length=2)→ pending:record_unverified、不呼 markCharged/markFailed(L85 短路、永不進 classifyRecordStatus)', async () => {
    const attempts = makeAttempts();
    const d = deps({
      tappay: makeTapPay(async () => recordResult({}, { numberOfTransactions: 2, records: [tradeRecord({ recordStatus: 0 }), tradeRecord({ recordStatus: 0 })] })),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });
});

describe('settleCharge — ⑧ 缺陷A + C×A 待開票 best-effort 自癒', () => {
  it('paid 尾呼 recordPendingInvoice;其 throw 不翻 paid(best-effort)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const confirmer = makeConfirmer({ recordPendingInvoice: vi.fn(async () => { throw new Error('invoice down'); }) });
    const d = deps({ confirmer });
    const res = await settleCharge(d, { orderId: ORDER_ID });
    expect(res).toEqual({ kind: 'paid', idempotent: false, displayId: DISPLAY_ID }); // throw 不翻 paid
    expect(confirmer.recordPendingInvoice).toHaveBeenCalledWith(ORDER_ID);
    expect(errSpy).toHaveBeenCalled();
  });

  it('C×A:首次 step5 recordPendingInvoice throw → 重入(order 已 paid 短路)仍補記成功(durable 自癒)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // 首次:unpaid → 走 step5,recordPendingInvoice 第一次 throw、第二次成功
    const recordInvoice = vi
      .fn<(orderId: string) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('invoice transient'))
      .mockResolvedValueOnce(true);
    const confirmer = makeConfirmer({ recordPendingInvoice: recordInvoice });

    const first = await settleCharge(deps({ confirmer }), { orderId: ORDER_ID });
    expect(first.kind).toBe('paid'); // 首記 throw 仍 paid

    // 重入:order 已 paid → step2 短路、**也呼** recordPendingInvoice(C×A 自癒補記)
    const reentryAttempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, status: 'charged' as const, orderPaymentStatus: 'paid' as const })),
    });
    const second = await settleCharge(deps({ confirmer, attempts: reentryAttempts }), { orderId: ORDER_ID });
    expect(second.kind).toBe('paid');
    expect(recordInvoice).toHaveBeenCalledTimes(2); // 重入補記了(非永久遺失)
  });
});

describe('settleCharge — ⑨ R4 Record 查詢鍵優先序', () => {
  async function capturedQuery(attempt: ActiveChargeAttempt, hint?: string): Promise<TapPayRecordQuery> {
    const tappay = makeTapPay(async () => recordResult());
    const d = deps({ tappay, attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => attempt) }) });
    await settleCharge(d, { orderId: ORDER_ID, recTradeIdHint: hint });
    return (tappay.recordQuery as ReturnType<typeof vi.fn>).mock.calls[0]![0] as TapPayRecordQuery;
  }

  it('rec_trade_id 最優先', async () => {
    expect(await capturedQuery(ACTIVE_PENDING)).toEqual({ recTradeId: 'D-rec-1' });
  });
  it('無 rec → bank_transaction_id', async () => {
    expect(await capturedQuery({ ...ACTIVE_PENDING, recTradeId: null })).toEqual({ bankTransactionId: 'bank-1' });
  });
  it('無 rec/bank → hint(僅 hint、Record 驗)', async () => {
    expect(await capturedQuery({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null }, 'D-hint')).toEqual({
      recTradeId: 'D-hint',
    });
  });
  it('無 rec/bank/hint → order_number(=orderId 唯一)', async () => {
    expect(await capturedQuery({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })).toEqual({
      orderNumber: ORDER_ID,
    });
  });
});

describe('settleCharge — 並發邏輯分支一致(F:DB 行級序列化非此測範圍)', () => {
  // 🔴 鐵則11 字面界定:此測斷言「兩並發呼叫各自走正確邏輯分支(皆 paid)」,**非**測 DB 防雙扣;
  //    真防雙扣 = markCharged FOR UPDATE+rec UNIQUE / confirm FOR UPDATE+paid no-op(RPC migration assert
  //    + codex 關卡2 + 審查側 MCP 並發模擬覆蓋),mock store 測不到行級鎖。
  it('兩並發 settleCharge(同單、Record 皆 paid)→ 皆回 paid(邏輯冪等)', async () => {
    const d = deps();
    const [a, b] = await Promise.all([
      settleCharge(d, { orderId: ORDER_ID }),
      settleCharge(d, { orderId: ORDER_ID }),
    ]);
    expect(a.kind).toBe('paid');
    expect(b.kind).toBe('paid');
  });
});
