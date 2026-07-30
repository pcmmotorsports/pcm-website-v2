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
    // #301:未退款時 original_amount === amount(TapPay 兩欄都回)。
    originalAmount: toMoneyAmount(1050),
    currency: 'TWD',
    recordStatus: 1, // OK
    isCaptured: true,
    timeMillis: TXN_TIME_MS,
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
    claimExpiredPendingAttempts: vi.fn(async () => []),
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
    // 🔴 關卡2 R2-5:退款態(2/3)不能沿用「amount=原額、refunded 缺、is_captured=true」那組形狀 ——
    //    那不是 TapPay 實際會回的東西。2 = 部分退(950+100)、3 = 全退(0+1050),兩者 is_captured=false。
    const refundShape: Partial<TapPayTradeRecord> =
      rs === 3
        ? { isCaptured: false, amount: toMoneyAmount(0), refundedAmount: toMoneyAmount(1050) }
        : rs === 2
          ? { isCaptured: false, amount: toMoneyAmount(950), refundedAmount: toMoneyAmount(100) }
          : {};
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({ recordStatus: rs, originalAmount: toMoneyAmount(1050), ...refundShape }, { queryStatus: 2 }),
      ),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual(expected);
    errSpy.mockRestore();
  });
  // 🔴 #301 + Sean 2026-07-30 拍板 A:已退款紀錄的**真實形狀**(amount 歸 0、原額在 original_amount)
  //    必須走到 refund_anomaly 告警,而不是被金額閘當成「認不出的紀錄」默默擋掉。
  //    兩者的裁決結果同為 pending/record_unverified ⇒ **只看回傳值分不出來**,故以告警是否發出為觀察點。
  it('🔴 全額退款真實形狀(amount=0 + refunded=原額 + original_amount=orders.total + status=3 + is_captured=false)→ 退款異常告警有發出', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({
      tappay: makeTapPay(async () =>
        // 形狀取自 2026-07-30 正式商戶實測(0102/0104)——`amount=0`、`refunded_amount=原額`、
        // `record_status=3`、`is_captured=false` 四項是**觀察到的值**;`original_amount` 的值
        // 當時未被觀察(parser 沒讀)⇒ 此處為合成值(關卡2 R2-9)。
        recordResult({
          recordStatus: 3,
          isCaptured: false,
          amount: toMoneyAmount(0),
          refundedAmount: toMoneyAmount(1050),
          originalAmount: toMoneyAmount(1050),
        }),
      ),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Record 顯退款態'), expect.anything());
    errSpy.mockRestore();
  });

  // 消融:同一筆退款紀錄,若身分閘退回舊寫法(比 amount)則 amount=0 ≠ orders.total ⇒ 連告警都不會發。
  // 用「拿掉 original_amount」模擬舊行為 —— 證明上一條測到的是新閘、不是巧合(其餘欄位等長同形)。
  it('🔴 消融:退款紀錄缺 original_amount(退回比 amount)→ 被身分閘擋下、告警不發', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({
          recordStatus: 3,
          isCaptured: false,
          amount: toMoneyAmount(0),
          refundedAmount: toMoneyAmount(1050),
          originalAmount: undefined,
        }),
      ),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // 🔴 關卡2 F1(codex R1 must-fix):改比 original_amount **新增**了兩條 terminal 路徑 ——
  //    「錢已退光(amount=0)卻宣稱 OK/CANCEL」的矛盾紀錄。守恆式 + 非退款態 amount 完好兩道閘擋下。
  it('🔴 矛盾紀錄:original_amount=orders.total 但 amount=0、record_status=1(OK)→ 不得 paid', async () => {
    const attempts = makeAttempts();
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({ recordStatus: 1, amount: toMoneyAmount(0), originalAmount: toMoneyAmount(1050) }),
      ),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });

  it('🔴 矛盾紀錄:original_amount=orders.total 但 amount=0、record_status=5(CANCEL)→ 不得 failed 釋鎖', async () => {
    const attempts = makeAttempts();
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({ recordStatus: 5, amount: toMoneyAmount(0), originalAmount: toMoneyAmount(1050) }),
      ),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markFailed).not.toHaveBeenCalled();
  });

  // 🔴 單獨驗「非退款態的 refunded_amount 必須是 0」(關卡2 R2-6 改版:原本寫成一條被我誤標為
  //    「官方守恆式」的等式,已收斂成只套用在非退款態)。狀態取 1(OK)、amount 完好 ⇒
  //    「amount 必須完好」那道閘刻意不適用,只有這道擋得住。
  //    ⚠️ 觀察點用告警:被身分層擋下 = 不發;若誤放行進退款態判定 = 會發。
  it('🔴 status=1(OK)卻帶非 0 的 refunded_amount(自相矛盾)→ 身分層擋下、告警不發', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const attempts = makeAttempts();
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({
          recordStatus: 1,
          amount: toMoneyAmount(1050),
          refundedAmount: toMoneyAmount(1050), // 錢已退光卻宣稱交易完成
          originalAmount: toMoneyAmount(1050),
        }),
      ),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // 🔴 這條**單獨**驗「非退款態 amount 必須完好」:守恆式刻意成立(950 + 100 = 1050)、
  //    狀態取 1(OK)⇒ 拿掉這道閘就會被判 paid。上面那條矛盾紀錄測試蓋不到它(兩閘互相遮蔽)。
  it('🔴 status=1(OK)但 amount 已被退款吃掉(950 + refunded 100 = 原額)→ 不得 paid', async () => {
    const attempts = makeAttempts();
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({
          recordStatus: 1,
          amount: toMoneyAmount(950),
          refundedAmount: toMoneyAmount(100),
          originalAmount: toMoneyAmount(1050),
        }),
      ),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });

  // 部分退款的**真實形狀**(950 + 100 = 1050、status=2):必須進退款異常告警、且絕不動錢。
  it('🔴 部分退款真實形狀(amount=950 + refunded=100 + status=2)→ 告警 + 不 markCharged/confirm', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const attempts = makeAttempts();
    const confirmer = makeConfirmer();
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({
          recordStatus: 2,
          amount: toMoneyAmount(950),
          refundedAmount: toMoneyAmount(100),
          originalAmount: toMoneyAmount(1050),
        }),
      ),
      attempts,
      confirmer,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Record 顯退款態'), expect.anything());
    expect(attempts.markCharged).not.toHaveBeenCalled();
    expect(confirmer.confirm).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // 🔴 F2:弱識別窗復活後,時間欄自己也要守門(小數毫秒原本可直接穿窗)。
  it('🔴 弱識別 + time 為小數毫秒(attempt+0.5)→ 不得通過時間窗', async () => {
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })),
    });
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ timeMillis: TXN_TIME_MS + 0.5 })),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });

  // ⚠️ 誠實標註:這條由**時間窗下界**(`>= attemptMs`)擋下,不是某道專屬的「非負」守門
  //    (那道守門無法被單獨觸發、已刻意不加)。本條記錄行為,不宣稱它證明了額外防線。
  it('🔴 弱識別 + time 為負值/0 → 不得通過時間窗(由窗下界擋下)', async () => {
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })),
    });
    for (const bad of [0, -1]) {
      const d = deps({ tappay: makeTapPay(async () => recordResult({ timeMillis: bad })), attempts });
      expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    }
  });

  // 🔴 單獨驗 ISO 形狀守門:`Date.parse('0')` 會**成功**解析成 2000-01-01,
  //    再讓 record 時間落在那個假窗內 ⇒ 拿掉守門就會被判 paid(突變 M8 實測)。
  it("🔴 attemptCreatedAt 為鬆散字面 '0' + record 時間落在誤解析出的窗內 → 不得 paid", async () => {
    const bogusWindowMs = Date.parse('2000-01-01T00:00:00.000Z') + 1000;
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({
        ...ACTIVE_PENDING,
        recTradeId: null,
        bankTransactionId: null,
        attemptCreatedAt: '0',
      })),
    });
    const d = deps({ tappay: makeTapPay(async () => recordResult({ timeMillis: bogusWindowMs })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });

  // 🔴 關卡2 R2-1:用 hint 當查詢鍵 ⇒ 回應的 rec 必須就是那把 hint(查 A 收到 B = 不採信)。
  it('🔴 弱識別走 hint:回應 rec_trade_id ≠ hint → 不得 paid(TapPay 沒照 filter 回,fail-closed)', async () => {
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })),
    });
    const d = deps({
      // fixture 的 recTradeId 是 'D-rec-1',與送出的 hint 'D-hint' 不同。
      tappay: makeTapPay(async () => recordResult({ bankTransactionId: undefined })),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID, recTradeIdHint: 'D-hint' })).toEqual({
      kind: 'pending',
      reason: 'record_unverified',
    });
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });

  it('🔴 對照:hint 與回應 rec 相符 → 走得完(證明上一條不是因為這條路本來就不通)', async () => {
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })),
    });
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ recTradeId: 'D-hint', bankTransactionId: undefined })),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID, recTradeIdHint: 'D-hint' })).toEqual({
      kind: 'paid',
      idempotent: false,
      displayId: DISPLAY_ID,
    });
  });

  // 🔴 關卡2 R2-3:弱識別不得 markFailed 釋鎖 —— order_number 是訂單的鍵、不是這次 attempt 的鍵,
  //    同單前一次 attempt 的 ERROR/CANCEL 延遲入帳會落在本次的窗內。
  it.each([-1, 5])(
    '🔴 弱識別(無 rec/bank/hint)+ record_status=%i → 不得 markFailed 釋鎖(維持 pending)',
    async (rs) => {
      const attempts = makeAttempts({
        findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })),
      });
      const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: rs })), attempts });
      expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({
        kind: 'pending',
        reason: 'record_unverified',
      });
      expect(attempts.markFailed).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 5])('對照:強識別(有 rec)+ record_status=%i → 仍照舊 markFailed', async (rs) => {
    const attempts = makeAttempts();
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: rs })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'failed' });
    expect(attempts.markFailed).toHaveBeenCalled();
  });

  // 🔴 關卡2 R2-4:形狀合法但**日曆上不存在**的日期會被 Date 靜默正規化(2/31 → 3/3)⇒ 窗整個平移。
  it("🔴 attemptCreatedAt 為不存在的日曆日('2026-02-31')+ record 落在正規化後的窗內 → 不得 paid", async () => {
    const normalizedMs = Date.parse('2026-03-03T00:00:00.000Z') + 1000;
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({
        ...ACTIVE_PENDING,
        recTradeId: null,
        bankTransactionId: null,
        attemptCreatedAt: '2026-02-31T00:00:00.000Z',
      })),
    });
    const d = deps({ tappay: makeTapPay(async () => recordResult({ timeMillis: normalizedMs })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });

  // 🔴 Fable R3 F7:窗寬常數 `SETTLE_WINDOW_FORWARD_MS`(24h)原本沒有邊界對照 ——
  //    窗內用小 delta、窗外用 +48h,把常數改成 1 小時或 7 天都不會有測試轉紅。
  it.each([
    [24 * 60 * 60 * 1000, 'paid' as const], //     整整 24h = 窗內(<=,含邊界)
    [24 * 60 * 60 * 1000 + 1, 'pending' as const], // 多 1ms = 窗外
  ])('🔴 窗寬邊界:record 時間 = attempt + %ims → %s', async (delta, expectedKind) => {
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })),
    });
    const d = deps({ tappay: makeTapPay(async () => recordResult({ timeMillis: TXN_TIME_MS + delta })), attempts });
    const res = await settleCharge(d, { orderId: ORDER_ID });
    expect(res.kind).toBe(expectedKind);
  });

  // 🔴 Fable R3 F4/F5:上線後要能分辨「這條路沒活」與「新閘擋掉了合法紀錄」——
  //    被時間窗擋下時必須留下非 PII 的 triage 訊號(否則表象只有「單卡人工」)。
  it('🔴 被時間窗擋下 → 留下非 PII 的 console.warn(reason=window;不含金額/卡資料)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })),
    });
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ timeMillis: TXN_TIME_MS + 48 * 60 * 60 * 1000 })),
      attempts,
    });
    await settleCharge(d, { orderId: ORDER_ID });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('識別/金額閘擋下'),
      expect.objectContaining({ reason: 'window', orderId: ORDER_ID }),
    );
    // #16 PII / 金額不入 log。
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('1050');
    warnSpy.mockRestore();
  });

  it('🔴 被新加的金額閘擋下 → reason 可分辨(amount_eroded,不與一般 record_unverified 混在一起)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({ recordStatus: 1, amount: toMoneyAmount(0), originalAmount: toMoneyAmount(1050) }),
      ),
    });
    await settleCharge(d, { orderId: ORDER_ID });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'amount_eroded' }),
    );
    warnSpy.mockRestore();
  });

  // 對照:既有防線(如 order_number 不符)刻意**不記** log,避免灌爆。
  it('對照:order_number 不符(既有防線)→ 不記 log', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = deps({ tappay: makeTapPay(async () => recordResult({ orderNumber: 'order-其他人' })) });
    await settleCharge(d, { orderId: ORDER_ID });
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // 正向對照:同一條弱識別路徑,時間欄合法(整數毫秒、窗內)時**確實**走得完 ——
  // 否則上面兩條負向測試會因為「這條路根本到不了」而假綠(#301 修的就是這種假綠)。
  it('🔴 正向對照:弱識別 + time 為合法整數毫秒(窗內)→ paid(證明這條路真的活著)', async () => {
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async () => ({ ...ACTIVE_PENDING, recTradeId: null, bankTransactionId: null })),
    });
    const d = deps({ tappay: makeTapPay(async () => recordResult({ timeMillis: TXN_TIME_MS })), attempts });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({
      kind: 'paid',
      idempotent: false,
      displayId: DISPLAY_ID,
    });
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
  it('③ original_amount 不符 orders.total → record_unverified(不放行)', async () => {
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({ amount: toMoneyAmount(999), originalAmount: toMoneyAmount(999) }),
      ),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  // 🔴 #301:缺 original_amount(舊紀錄/其他 payment_method)時退回 amount = 舊行為,金額閘一樣要擋得住。
  it('③b 缺 original_amount 時 amount 不符 orders.total → record_unverified(fallback 不是漏洞)', async () => {
    const d = deps({
      tappay: makeTapPay(async () =>
        recordResult({ amount: toMoneyAmount(999), originalAmount: undefined }),
      ),
    });
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
    const d = deps({
      tappay: makeTapPay(async () =>
        // 真實部分退款形狀(950 + 100 = 1050、is_captured=false)。
        recordResult({
          recordStatus: 2,
          isCaptured: false,
          amount: toMoneyAmount(950),
          refundedAmount: toMoneyAmount(100),
          originalAmount: toMoneyAmount(1050),
        }),
      ),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(errSpy).toHaveBeenCalled();
  });
  it('⑦ record_status=3(完全退款)→ pending:record_unverified + 告警', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({
      tappay: makeTapPay(async () =>
        // 真實全額退款形狀(amount 歸 0、refunded=原額、is_captured=false)。
        recordResult({
          recordStatus: 3,
          isCaptured: false,
          amount: toMoneyAmount(0),
          refundedAmount: toMoneyAmount(1050),
          originalAmount: toMoneyAmount(1050),
        }),
      ),
    });
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
      tappay: makeTapPay(async () => recordResult({ timeMillis: TXN_TIME_MS })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect((await settleCharge(d, { orderId: ORDER_ID })).kind).toBe('paid');
  });
  it('order_number fallback + 交易時間超窗(+48h)→ pending:record_unverified(防誤命中遠古他單)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ timeMillis: TXN_TIME_MS + 48 * 60 * 60 * 1000 })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('🔴 單向窗(codex r2):弱識別 + 交易時間在 attempt「前」1h(舊交易)→ pending + 不 markFailed/markCharged', async () => {
    const attempts = makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) });
    const d = deps({
      // record_status=5(CANCEL)舊交易在 attempt 前 → 不可走 markFailed 釋鎖放行重刷(雙扣)
      tappay: makeTapPay(async () => recordResult({ recordStatus: 5, timeMillis: TXN_TIME_MS - 60 * 60 * 1000 })),
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
      tappay: makeTapPay(async () => recordResult({ recordStatus: 5, timeMillis: TXN_TIME_MS - 3 * 60 * 1000 })),
      attempts,
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
    expect(attempts.markFailed).not.toHaveBeenCalled();
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });
  it('🔴 S1 收緊:弱識別 + record_status=1 paid 落 attempt「前」3min(原 -5min skew 帶內)→ pending:record_unverified(下界收成 attempt、移除 paid 自癒 skew、雙扣縫關閉)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ timeMillis: TXN_TIME_MS - 3 * 60 * 1000 })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('🔴 S1【審查①】弱識別 + record_status=0(AUTH)落 attempt「前」2min → pending:record_unverified、不呼 markCharged/confirm/markFailed(放寬到 AUTH 後 pre-attempt 仍被收緊窗擋、不走 settlePaid)', async () => {
    const attempts = makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) });
    const confirmer = makeConfirmer();
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, timeMillis: TXN_TIME_MS - 2 * 60 * 1000 })),
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
      tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, timeMillis: TXN_TIME_MS })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect((await settleCharge(d, { orderId: ORDER_ID })).kind).toBe('paid');
  });
  it('弱識別 + Record 缺交易時間 → fail-closed pending:record_unverified(無法驗窗)', async () => {
    const d = deps({
      tappay: makeTapPay(async () => recordResult({ timeMillis: undefined })),
      attempts: makeAttempts({ findActiveByOrderId: vi.fn(async () => weakAttempt) }),
    });
    expect(await settleCharge(d, { orderId: ORDER_ID })).toEqual({ kind: 'pending', reason: 'record_unverified' });
  });
  it('強識別(有 rec)不套時間窗:即使交易時間超窗仍正常(rec 已唯一識別)', async () => {
    const d = deps({ tappay: makeTapPay(async () => recordResult({ timeMillis: TXN_TIME_MS + 99 * 24 * 60 * 60 * 1000 })) });
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
    const d = deps({ tappay: makeTapPay(async () => recordResult({ recordStatus: 0, isCaptured: false, amount: toMoneyAmount(999), originalAmount: toMoneyAmount(999) })), attempts });
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
