import { describe, expect, it, vi } from 'vitest';
import type { IChargeAttemptStore, ITapPayAdapter, CaptureRecheckCandidate } from '@pcm/ports';
import type { TapPayRecordResult, TapPayTradeRecord } from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';
import { recheckCaptureState } from './recheck-capture-state';

const ORDER_ID = '22222222-2222-2222-2222-222222222222';
const CAND = (over: Partial<CaptureRecheckCandidate> = {}): CaptureRecheckCandidate => ({
  attemptId: 'attempt-1',
  orderId: ORDER_ID,
  recTradeId: 'REC-A',
  ...over,
});

function tradeRecord(over: Partial<TapPayTradeRecord> = {}): TapPayTradeRecord {
  return {
    recTradeId: 'REC-A',
    orderNumber: ORDER_ID,
    merchantId: 'M',
    amount: toMoneyAmount(1000),
    recordStatus: 1,
    isCaptured: true,
    ...over,
  };
}
function recordResult(over: Partial<TapPayRecordResult> = {}, rec: Partial<TapPayTradeRecord> = {}): TapPayRecordResult {
  return { queryStatus: 0, numberOfTransactions: 1, records: [tradeRecord(rec)], ...over };
}
function makeTapPay(recordQuery: () => Promise<TapPayRecordResult>): ITapPayAdapter {
  return { charge: vi.fn(), refund: vi.fn(), recordQuery: vi.fn(recordQuery), initiateThreeDSCharge: vi.fn() };
}
function makeAttempts(over: Partial<IChargeAttemptStore> = {}): IChargeAttemptStore {
  return {
    begin: vi.fn(),
    markCharged: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    findActiveByOrderId: vi.fn(async () => null),
    expireStuckAtCeiling: vi.fn(async () => 0),
    claimStuckUnsettled: vi.fn(async () => []),
    markSettleRetry: vi.fn(async () => 1),
    flagNonUnpaidActive: vi.fn(async () => 0),
    recordInitiationBankTxn: vi.fn(async () => {}),
    recordInitiationRec: vi.fn(async () => {}),
    recordCaptureState: vi.fn(async () => true),
    listForCaptureRecheck: vi.fn(async () => [CAND()]),
    recordReleasedFailureObservation: vi.fn(async () => {}),
    claimExpiredPendingAttempts: vi.fn(async () => []),
    ...over,
  };
}

describe('recheckCaptureState', () => {
  it('is_captured=true ⇒ 寫 captured,計進 captured', async () => {
    const attempts = makeAttempts();
    const res = await recheckCaptureState(
      { attempts, tappay: makeTapPay(async () => recordResult()) },
      { cutoffDays: 3, limit: 25 },
    );
    expect(attempts.recordCaptureState).toHaveBeenCalledWith('attempt-1', ORDER_ID, 'captured');
    expect(res).toMatchObject({ scanned: 1, recordCalls: 1, recordFailures: 0, captured: 1, stillAuthorized: 0 });
  });

  it('is_captured=false ⇒ 仍寫 authorized(只更新 read_at ⇒ 排到隊尾)', async () => {
    const attempts = makeAttempts();
    const res = await recheckCaptureState(
      { attempts, tappay: makeTapPay(async () => recordResult({}, { isCaptured: false })) },
      { cutoffDays: 3, limit: 25 },
    );
    expect(attempts.recordCaptureState).toHaveBeenCalledWith('attempt-1', ORDER_ID, 'authorized');
    expect(res).toMatchObject({ captured: 0, stillAuthorized: 1 });
  });

  // 🔴 本片的核心宣稱:任何單列失敗都不中止整輪,而失敗的列維持 authorized(下輪還撈得到)。
  it('🔴 Record throw ⇒ 該列跳過、不中止整輪,而且【不會】寫入任何值', async () => {
    const attempts = makeAttempts({
      listForCaptureRecheck: vi.fn(async () => [CAND({ attemptId: 'a1' }), CAND({ attemptId: 'a2' })]),
    });
    const recordQuery = vi
      .fn<() => Promise<TapPayRecordResult>>()
      .mockRejectedValueOnce(new Error('tappay down'))
      .mockResolvedValueOnce(recordResult());
    const res = await recheckCaptureState(
      { attempts, tappay: makeTapPay(recordQuery) },
      { cutoffDays: 3, limit: 25 },
    );
    expect(res).toMatchObject({ scanned: 2, recordCalls: 2, recordFailures: 1, captured: 1 });
    // 第一列失敗 ⇒ 沒有寫入 ⇒ 它維持 authorized ⇒ 下一輪還撈得到
    expect(attempts.recordCaptureState).toHaveBeenCalledTimes(1);
    expect(attempts.recordCaptureState).toHaveBeenCalledWith('a2', ORDER_ID, 'captured');
  });

  it('🔴 Record 不是恰一筆 ⇒ 當作沒讀到,不採信第一筆', async () => {
    const attempts = makeAttempts();
    const res = await recheckCaptureState(
      { attempts, tappay: makeTapPay(async () => recordResult({ numberOfTransactions: 2 })) },
      { cutoffDays: 3, limit: 25 },
    );
    expect(res).toMatchObject({ recordFailures: 1, captured: 0 });
    expect(attempts.recordCaptureState).not.toHaveBeenCalled();
  });

  it('寫入回 false / throw ⇒ 計進 writeFailures,不中止', async () => {
    const attempts = makeAttempts({
      listForCaptureRecheck: vi.fn(async () => [CAND({ attemptId: 'a1' }), CAND({ attemptId: 'a2' })]),
      recordCaptureState: vi
        .fn<(a: string, o: string, s: 'authorized' | 'captured') => Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockRejectedValueOnce(new Error('rpc down')),
    });
    const res = await recheckCaptureState(
      { attempts, tappay: makeTapPay(async () => recordResult()) },
      { cutoffDays: 3, limit: 25 },
    );
    expect(res).toMatchObject({ scanned: 2, recordCalls: 2, writeFailures: 2, captured: 0 });
  });

  // 🔴 節流:limit 是傳給 SQL 的,不是靠集合天然小。
  it('🔴 cutoffDays / limit 原樣傳給掃描端(節流寫在 SQL 的 LIMIT 裡)', async () => {
    const attempts = makeAttempts({ listForCaptureRecheck: vi.fn(async () => []) });
    const res = await recheckCaptureState(
      { attempts, tappay: makeTapPay(async () => recordResult()) },
      { cutoffDays: 7, limit: 25 },
    );
    expect(attempts.listForCaptureRecheck).toHaveBeenCalledWith(7, 25);
    // 空集合 ⇒ 一發 Record 都不打
    expect(res).toEqual({ scanned: 0, recordCalls: 0, recordFailures: 0, captured: 0, stillAuthorized: 0, writeFailures: 0, leadingFailures: 0 });
  });
});

// 🔴 W5 R1 MF-1:失敗路徑零寫入 ⇒ read_at 不更新 ⇒ 永久失敗的列每輪都在隊首。
//    我們**沒有修掉那個飢餓**(要修得加一次 schema),而是讓它**看得見**。這一格釘住那個訊號。
describe('recheckCaptureState — 🔴 隊首失敗訊號(飢餓看得見)', () => {
  it('第一次成功【之前】連續失敗幾列 ⇒ leadingFailures;之後的失敗不算', async () => {
    const attempts = makeAttempts({
      listForCaptureRecheck: vi.fn(async () => [
        CAND({ attemptId: 'a1' }), // 失敗(隊首)
        CAND({ attemptId: 'a2' }), // 失敗(仍在隊首段)
        CAND({ attemptId: 'a3' }), // 成功
        CAND({ attemptId: 'a4' }), // 失敗(成功之後 ⇒ 不算隊首)
      ]),
    });
    const recordQuery = vi
      .fn<() => Promise<TapPayRecordResult>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(recordResult())
      .mockRejectedValueOnce(new Error('down'));
    const res = await recheckCaptureState(
      { attempts, tappay: makeTapPay(recordQuery) },
      { cutoffDays: 3, limit: 25 },
    );
    expect(res).toMatchObject({ scanned: 4, recordFailures: 3, captured: 1 });
    // 🔴 3 次失敗,而只有前 2 次是「卡在隊首」—— 兩個數字不同才有判別力
    expect(res.leadingFailures).toBe(2);
  });

  it('負對照:全部成功 ⇒ leadingFailures = 0', async () => {
    const attempts = makeAttempts({
      listForCaptureRecheck: vi.fn(async () => [CAND({ attemptId: 'a1' }), CAND({ attemptId: 'a2' })]),
    });
    const res = await recheckCaptureState(
      { attempts, tappay: makeTapPay(async () => recordResult()) },
      { cutoffDays: 3, limit: 25 },
    );
    expect(res).toMatchObject({ captured: 2, recordFailures: 0, leadingFailures: 0 });
  });
});
