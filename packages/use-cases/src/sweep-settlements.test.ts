import { describe, it, expect, vi, afterEach } from 'vitest';
import { toMoneyAmount } from '@pcm/domain';
import type {
  ActiveChargeAttempt,
  TapPayRecordQuery,
  TapPayRecordResult,
  TapPayTradeRecord,
} from '@pcm/domain';
import type {
  ITapPayAdapter,
  IChargeAttemptStore,
  IPaymentConfirmer,
  IWebhookInbox,
} from '@pcm/ports';
import { sweepSettlements, type SweepSettlementsDeps } from './sweep-settlements';

const ATTEMPT_CREATED_AT = '2026-06-15T00:00:00.000Z';
const TXN_TIME_MS = Date.parse(ATTEMPT_CREATED_AT); // 同刻 → 弱識別必在窗內
const ORDER_X = 'order-x';
const ORDER_Y = 'order-y';
const OPTS = { inboxLimit: 50, stuckLimit: 50, stuckAgeSeconds: 600 };

/** 弱識別 active attempt(rec/bank=null → settleCharge 走 order_number fallback、走時間窗)。 */
function activeFor(orderId: string, over: Partial<ActiveChargeAttempt> = {}): ActiveChargeAttempt {
  return {
    attemptId: `attempt-${orderId}`,
    status: 'pending',
    recTradeId: null,
    bankTransactionId: null,
    attemptCreatedAt: ATTEMPT_CREATED_AT,
    orderTotal: 1050,
    orderPaymentStatus: 'unpaid',
    orderDisplayId: `PCM-${orderId}`,
    ...over,
  };
}

function tradeRecordFor(orderId: string, over: Partial<TapPayTradeRecord> = {}): TapPayTradeRecord {
  return {
    recTradeId: `D-${orderId}`,
    orderNumber: orderId,
    merchantId: 'M_test',
    amount: toMoneyAmount(1050),
    currency: 'TWD',
    recordStatus: 1, // OK
    isCaptured: true,
    transactionTimeMillis: TXN_TIME_MS,
    ...over,
  };
}

function paidResultFor(orderId: string, over: Partial<TapPayTradeRecord> = {}): TapPayRecordResult {
  return { queryStatus: 0, numberOfTransactions: 1, records: [tradeRecordFor(orderId, over)] };
}

/** rec→order 對照(模擬真實「inbox rec 屬於該單」;inbox 走 recTradeIdHint 查 Record 時回對的單)。 */
const REC_TO_ORDER: Record<string, string> = { 'D-rec-x': ORDER_X, 'D-rec-y': ORDER_Y };

/** 依 query 解析所屬 orderId(order_number 直取;rec 經對照表回真單、否則原值;bank 原值)。 */
function resolveOrderId(q: TapPayRecordQuery): string {
  if (q.orderNumber) return q.orderNumber;
  if (q.recTradeId) return REC_TO_ORDER[q.recTradeId] ?? q.recTradeId;
  if (q.bankTransactionId) return q.bankTransactionId;
  return '';
}

/** 預設 tappay:依 query 解析所屬 orderId、回 paid 紀錄(orderNumber 對齊真單 → 過 recordMatchesOrder)。 */
function makeTapPay(
  recordQuery: (q: TapPayRecordQuery) => Promise<TapPayRecordResult> = async (q) =>
    paidResultFor(resolveOrderId(q)),
): ITapPayAdapter {
  // initiateThreeDSCharge(3DS-5a)為新增 port 方法;sweeper(結算半段)不呼用、stub 滿足介面。
  return { charge: vi.fn(), refund: vi.fn(), recordQuery: vi.fn(recordQuery), initiateThreeDSCharge: vi.fn() };
}

function makeAttempts(over: Partial<IChargeAttemptStore> = {}): IChargeAttemptStore {
  return {
    begin: vi.fn(),
    markCharged: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    findActiveByOrderId: vi.fn(async (orderId: string) => activeFor(orderId)),
    expireStuckAtCeiling: vi.fn(async () => 0),
    claimStuckUnsettled: vi.fn(async () => []),
    markSettleRetry: vi.fn(async () => 1),
    flagNonUnpaidActive: vi.fn(async () => 0),
    // 3DS-5b initiate 寫入 port 方法;sweepSettlements 不呼用、stub 滿足介面。
    recordInitiationBankTxn: vi.fn(async () => {}),
    recordInitiationRec: vi.fn(async () => {}),
    ...over,
  };
}

function makeInbox(over: Partial<IWebhookInbox> = {}): IWebhookInbox {
  return {
    recordEvent: vi.fn(async () => true),
    expireEventsAtCeiling: vi.fn(async () => 0),
    claimDueEvents: vi.fn(async () => []),
    markProcessed: vi.fn(async () => 1),
    markRetry: vi.fn(async () => 1),
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

function deps(over: Partial<SweepSettlementsDeps> = {}): SweepSettlementsDeps {
  return {
    tappay: over.tappay ?? makeTapPay(),
    attempts: over.attempts ?? makeAttempts(),
    confirmer: over.confirmer ?? makeConfirmer(),
    inbox: over.inbox ?? makeInbox(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sweepSettlements — ① 前置守衛每輪無條件呼(plan §5.2③ 不變式)', () => {
  it('即使無 due/stuck,expire×2 + flag 各被呼一次(claim 前置)', async () => {
    const inbox = makeInbox();
    const attempts = makeAttempts();
    const res = await sweepSettlements(deps({ inbox, attempts }), OPTS);
    expect(inbox.expireEventsAtCeiling).toHaveBeenCalledOnce();
    expect(attempts.expireStuckAtCeiling).toHaveBeenCalledOnce();
    expect(attempts.flagNonUnpaidActive).toHaveBeenCalledWith(50);
    expect(res).toMatchObject({ inboxClaimed: 0, stuckClaimed: 0, errors: 0 });
  });

  it('🔴 一守衛 throw → fail-closed(errors++ + 續跑其他守衛 + claim)', async () => {
    const inbox = makeInbox({
      expireEventsAtCeiling: vi.fn(async () => {
        throw new Error('expire down');
      }),
      claimDueEvents: vi.fn(async () => [{ recTradeId: 'D-rec-x', orderNumber: ORDER_X, attemptCount: 1 }]),
    });
    const attempts = makeAttempts();
    const res = await sweepSettlements(deps({ inbox, attempts }), OPTS);
    expect(res.errors).toBeGreaterThanOrEqual(1);
    expect(attempts.expireStuckAtCeiling).toHaveBeenCalledOnce(); // 不被前一守衛掛阻
    expect(attempts.flagNonUnpaidActive).toHaveBeenCalledOnce();
    expect(res.inboxProcessed).toBe(1); // claim 仍進行
  });
});

describe('sweepSettlements — ② inbox 來源', () => {
  it('settle paid → markProcessed(rec, claimToken);不 markRetry', async () => {
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => [{ recTradeId: 'D-rec-x', orderNumber: ORDER_X, attemptCount: 3 }]),
    });
    const res = await sweepSettlements(deps({ inbox }), OPTS);
    expect(inbox.markProcessed).toHaveBeenCalledWith('D-rec-x', 3);
    expect(inbox.markRetry).not.toHaveBeenCalled();
    expect(res).toMatchObject({ inboxClaimed: 1, inboxProcessed: 1, inboxRetried: 0 });
  });

  it('settle pending(Record unreachable)→ markRetry(rec, claimToken, reason)退避', async () => {
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => [{ recTradeId: 'D-rec-x', orderNumber: ORDER_X, attemptCount: 2 }]),
    });
    const tappay = makeTapPay(async () => {
      throw new Error('HTTP 500');
    });
    const res = await sweepSettlements(deps({ inbox, tappay }), OPTS);
    expect(inbox.markRetry).toHaveBeenCalledWith('D-rec-x', 2, 'record_unreachable');
    expect(inbox.markProcessed).not.toHaveBeenCalled();
    expect(res).toMatchObject({ inboxRetried: 1, inboxProcessed: 0 });
  });

  it('🔴 群3 inbox 帶 recTradeIdHint:弱 attempt 無 rec/bank → settleCharge 用 inbox rec 查 Record', async () => {
    const recordQuery = vi.fn(async () => paidResultFor(ORDER_X));
    const tappay: ITapPayAdapter = { charge: vi.fn(), refund: vi.fn(), recordQuery, initiateThreeDSCharge: vi.fn() };
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => [{ recTradeId: 'D-inbox-hint', orderNumber: ORDER_X, attemptCount: 1 }]),
    });
    const res = await sweepSettlements(deps({ inbox, tappay }), OPTS);
    expect(recordQuery).toHaveBeenCalledWith({ recTradeId: 'D-inbox-hint' }); // hint 入 Record 查詢入口
    expect(res.inboxProcessed).toBe(1);
  });

  it('token guard stale(markProcessed 回 0)→ disposition 仍計、另記 staleMarks、不爆', async () => {
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => [{ recTradeId: 'D-rec-x', orderNumber: ORDER_X, attemptCount: 1 }]),
      markProcessed: vi.fn(async () => 0), // stale / late mark RPC 端 no-op
    });
    const res = await sweepSettlements(deps({ inbox }), OPTS);
    expect(res).toMatchObject({ inboxProcessed: 1, staleMarks: 1, errors: 0 });
  });

  it('🔴 fail-closed:單筆 mark throw 不中斷整批(第二筆仍處理)', async () => {
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => [
        { recTradeId: 'D-rec-x', orderNumber: ORDER_X, attemptCount: 1 },
        { recTradeId: 'D-rec-y', orderNumber: ORDER_Y, attemptCount: 1 },
      ]),
      markProcessed: vi.fn(async (rec: string) => {
        if (rec === 'D-rec-x') throw new Error('mark down');
        return 1;
      }),
    });
    const res = await sweepSettlements(deps({ inbox }), OPTS);
    expect(res.errors).toBe(1);
    expect(res.inboxProcessed).toBe(1); // 第二筆 Y 仍標 processed
  });
});

describe('sweepSettlements — ③ stuck attempt 來源', () => {
  it('settle pending → markSettleRetry(attemptId, claimToken, reason);terminal 不 markSettleRetry', async () => {
    const attempts = makeAttempts({
      claimStuckUnsettled: vi.fn(async () => [{ attemptId: 'attempt-x', orderId: ORDER_X, settleCount: 4 }]),
    });
    const tappay = makeTapPay(async () => paidResultFor(ORDER_X, { recordStatus: 4, isCaptured: false })); // PENDING
    const res = await sweepSettlements(deps({ attempts, tappay }), OPTS);
    expect(attempts.markSettleRetry).toHaveBeenCalledWith('attempt-x', 4, 'auth_or_pending');
    expect(res).toMatchObject({ stuckClaimed: 1, stuckRetried: 1, stuckSettled: 0 });
  });

  it('🔴 群1 charged-unpaid 收斂:status=charged + order unpaid + Record paid → settleCharge 補 confirm → stuckSettled', async () => {
    const attempts = makeAttempts({
      claimStuckUnsettled: vi.fn(async () => [{ attemptId: 'attempt-x', orderId: ORDER_X, settleCount: 1 }]),
      findActiveByOrderId: vi.fn(async (orderId: string) =>
        activeFor(orderId, { status: 'charged', recTradeId: 'D-rec-1', bankTransactionId: 'bank-1' }),
      ),
    });
    const confirmer = makeConfirmer();
    const tappay = makeTapPay(async () =>
      paidResultFor(ORDER_X, { recTradeId: 'D-rec-1', bankTransactionId: 'bank-1' }),
    );
    const res = await sweepSettlements(deps({ attempts, confirmer, tappay }), OPTS);
    expect(attempts.markCharged).toHaveBeenCalled(); // charged 同 rec no-op
    expect(confirmer.confirm).toHaveBeenCalled(); // 補 confirm 收斂
    expect(attempts.markSettleRetry).not.toHaveBeenCalled();
    expect(res).toMatchObject({ stuckSettled: 1, stuckRetried: 0 });
  });

  it('🔴 O8 charged-unpaid 遇 explicit_failed:markFailed RAISE(throw)→ settleCharge 吞 pending → markSettleRetry(不釋鎖)', async () => {
    const attempts = makeAttempts({
      claimStuckUnsettled: vi.fn(async () => [{ attemptId: 'attempt-x', orderId: ORDER_X, settleCount: 1 }]),
      findActiveByOrderId: vi.fn(async (orderId: string) =>
        activeFor(orderId, { status: 'charged', recTradeId: 'D-rec-1', bankTransactionId: 'bank-1' }),
      ),
      markFailed: vi.fn(async () => {
        throw new Error('charged→failed 永拒 RAISE'); // s2d status=pending guard
      }),
    });
    const tappay = makeTapPay(async () =>
      paidResultFor(ORDER_X, { recordStatus: 5, recTradeId: 'D-rec-1', bankTransactionId: 'bank-1' }),
    ); // CANCEL
    const res = await sweepSettlements(deps({ attempts, tappay }), OPTS);
    expect(attempts.markFailed).toHaveBeenCalled(); // 嘗試釋鎖被 RPC 擋
    expect(attempts.markSettleRetry).toHaveBeenCalledWith('attempt-x', 1, 'record_unreachable'); // 吞 pending、留人工
    expect(res).toMatchObject({ stuckRetried: 1, stuckSettled: 0, errors: 0 });
  });
});

describe('sweepSettlements — per-order 去重(Q4=A 同 run inbox+stuck 撞同單只 settle 一次)', () => {
  it('inbox 已 settle X → stuck 同 X 去重跳過(不 settle、不 markSettleRetry)', async () => {
    const findActiveByOrderId = vi.fn(async (orderId: string) => activeFor(orderId));
    const attempts = makeAttempts({
      findActiveByOrderId,
      claimStuckUnsettled: vi.fn(async () => [{ attemptId: 'attempt-x', orderId: ORDER_X, settleCount: 1 }]),
    });
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => [{ recTradeId: 'D-rec-x', orderNumber: ORDER_X, attemptCount: 1 }]),
    });
    const res = await sweepSettlements(deps({ attempts, inbox }), OPTS);
    expect(findActiveByOrderId).toHaveBeenCalledTimes(1); // 只 settle 一次(inbox)、stuck 跳過
    expect(attempts.markSettleRetry).not.toHaveBeenCalled();
    expect(res).toMatchObject({ inboxProcessed: 1, deduped: 1, stuckSettled: 0, stuckRetried: 0 });
  });
});

describe('sweepSettlements — ④ 結構化告警 + 摘要', () => {
  it('expired/flagged/errors 皆 0 → 不告警(console.error 不呼)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await sweepSettlements(deps(), OPTS);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('expireStuckAtCeiling > 0 → 結構化告警(console.error 含 counts)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const attempts = makeAttempts({ expireStuckAtCeiling: vi.fn(async () => 2) });
    const res = await sweepSettlements(deps({ attempts }), OPTS);
    expect(res.expiredStuckAtCeiling).toBe(2);
    expect(errSpy).toHaveBeenCalledOnce();
  });

  it('flagNonUnpaidActive > 0(refunded/partiallyPaid 殘留唯一回收)→ 告警 + 計數', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const attempts = makeAttempts({ flagNonUnpaidActive: vi.fn(async () => 1) });
    const res = await sweepSettlements(deps({ attempts }), OPTS);
    expect(res.flaggedNonUnpaid).toBe(1);
    expect(errSpy).toHaveBeenCalledOnce();
  });
});

describe('sweepSettlements — 有界並發(群7;預設順序 / concurrency 可設)', () => {
  it('concurrency=2:兩 inbox 事件皆處理完(摘要 inboxProcessed=2)', async () => {
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => [
        { recTradeId: 'D-rec-x', orderNumber: ORDER_X, attemptCount: 1 },
        { recTradeId: 'D-rec-y', orderNumber: ORDER_Y, attemptCount: 1 },
      ]),
    });
    const res = await sweepSettlements(deps({ inbox }), { ...OPTS, concurrency: 2 });
    expect(res.inboxProcessed).toBe(2);
    expect(inbox.markProcessed).toHaveBeenCalledTimes(2);
  });

  it('🔴 有界並發 exactly-once + max active ≤ concurrency(群7 連線預算、cursor 不漏不重)', async () => {
    const N = 6;
    const events = Array.from({ length: N }, (_, i) => ({
      recTradeId: `D-rec-${i}`,
      orderNumber: `order-${i}`,
      attemptCount: 1,
    }));
    let active = 0;
    let maxActive = 0;
    const attempts = makeAttempts({
      findActiveByOrderId: vi.fn(async (orderId: string) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 1)); // 強制 worker 交錯
        active--;
        return activeFor(orderId);
      }),
    });
    const seen: string[] = [];
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => events),
      markProcessed: vi.fn(async (rec: string) => {
        seen.push(rec);
        return 1;
      }),
    });
    // rec 'D-rec-i' → order-i(模擬該 rec 屬該單)
    const tappay = makeTapPay(async (q) =>
      paidResultFor(q.orderNumber ?? (q.recTradeId ?? '').replace('D-rec-', 'order-')),
    );
    const res = await sweepSettlements(deps({ attempts, inbox, tappay }), { ...OPTS, concurrency: 2 });
    expect(maxActive).toBeLessThanOrEqual(2); // 有界(不爆 pooler ceiling)
    expect(res.inboxProcessed).toBe(N); // 全處理
    expect([...seen].sort()).toEqual(events.map((e) => e.recTradeId).sort()); // 恰一次、不漏不重
  });

  it('🔴 concurrency=NaN(非法注入)→ fail-safe 降為 1、全處理不靜默漏掃(審查側 N4)', async () => {
    const inbox = makeInbox({
      claimDueEvents: vi.fn(async () => [
        { recTradeId: 'D-rec-x', orderNumber: ORDER_X, attemptCount: 1 },
        { recTradeId: 'D-rec-y', orderNumber: ORDER_Y, attemptCount: 1 },
      ]),
    });
    const res = await sweepSettlements(deps({ inbox }), { ...OPTS, concurrency: NaN });
    expect(res.inboxProcessed).toBe(2); // NaN 不致 runBounded 0 worker → 不漏掃
  });

  it('🔴 有界並發下 stuck 同 order 多筆 → check+add 原子、只 settle 一次', async () => {
    const findActiveByOrderId = vi.fn(async (orderId: string) => activeFor(orderId));
    const attempts = makeAttempts({
      findActiveByOrderId,
      claimStuckUnsettled: vi.fn(async () => [
        { attemptId: 'attempt-x1', orderId: ORDER_X, settleCount: 1 },
        { attemptId: 'attempt-x2', orderId: ORDER_X, settleCount: 1 },
      ]),
    });
    const res = await sweepSettlements(deps({ attempts }), { ...OPTS, concurrency: 2 });
    expect(findActiveByOrderId).toHaveBeenCalledTimes(1); // 同步 check+add 原子 → 只 settle 一次
    expect(res).toMatchObject({ stuckSettled: 1, deduped: 1 });
  });
});
