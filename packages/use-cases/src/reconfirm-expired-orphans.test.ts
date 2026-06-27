import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ExpiredOrphanAttempt, SettleChargeOutcome } from '@pcm/domain';
import type { ITapPayAdapter, IChargeAttemptStore, IPaymentConfirmer } from '@pcm/ports';

// 🔴 mock settleCharge:B1b 直接 import settleCharge(非注入)→ hoisted mock 控制其 outcome,
//    專測 reconfirmExpiredOrphans 的「claim→tally→fail-closed→不呼 markSettleRetry」編排層。
//    settleCharge 自身的 Record→收斂(§8 案 -1/5/4/unreachable + order-paid 短路)由 settle-charge.test.ts 涵蓋。
const { settleChargeMock } = vi.hoisted(() => ({ settleChargeMock: vi.fn() }));
vi.mock('./settle-charge', () => ({ settleCharge: settleChargeMock }));

import { reconfirmExpiredOrphans, type ReconfirmExpiredOrphansDeps } from './reconfirm-expired-orphans';

afterEach(() => {
  vi.clearAllMocks();
});

function orphan(orderId: string, over: Partial<ExpiredOrphanAttempt> = {}): ExpiredOrphanAttempt {
  return { attemptId: `att-${orderId}`, orderId, needsManualReview: false, ...over };
}

const PAID: SettleChargeOutcome = { kind: 'paid', idempotent: false, displayId: 'PCM-x' };
const FAILED: SettleChargeOutcome = { kind: 'failed' };
const NO_ATTEMPT: SettleChargeOutcome = { kind: 'no_attempt' };
const PENDING: SettleChargeOutcome = { kind: 'pending', reason: 'auth_or_pending' };

/** deps:settleCharge 已 mock → tappay/confirmer 不被觸碰(空物件);attempts 帶 claim + markSettleRetry 兩 spy。 */
function makeDeps() {
  const claimExpiredPendingAttempts = vi.fn<(limit: number) => Promise<ExpiredOrphanAttempt[]>>();
  const markSettleRetry = vi.fn<() => Promise<number>>().mockResolvedValue(1);
  const flagNonUnpaidActive = vi.fn<() => Promise<number>>().mockResolvedValue(0);
  const attempts = { claimExpiredPendingAttempts, markSettleRetry, flagNonUnpaidActive } as unknown as IChargeAttemptStore;
  const deps: ReconfirmExpiredOrphansDeps = {
    tappay: {} as ITapPayAdapter,
    attempts,
    confirmer: {} as IPaymentConfirmer,
  };
  return { deps, claimExpiredPendingAttempts, markSettleRetry, flagNonUnpaidActive };
}

describe('reconfirmExpiredOrphans', () => {
  it('claim 多筆 → 依 settleCharge outcome 正確 tally(settled=paid/failed、pending=維持)', async () => {
    const { deps, claimExpiredPendingAttempts } = makeDeps();
    claimExpiredPendingAttempts.mockResolvedValue([orphan('o1'), orphan('o2'), orphan('o3')]);
    const out: Record<string, SettleChargeOutcome> = { o1: PAID, o2: FAILED, o3: PENDING };
    settleChargeMock.mockImplementation(async (_d: unknown, { orderId }: { orderId: string }) => out[orderId]);

    const r = await reconfirmExpiredOrphans(deps, { limit: 50 });

    expect(r).toEqual({ claimed: 3, settled: 2, noAttempt: 0, pending: 1, errors: 0 });
    expect(claimExpiredPendingAttempts).toHaveBeenCalledWith(50);
  });

  it('🔴 不呼 markSettleRetry(B1 與 sweeper 的關鍵差異:throttle 走 B1a last_expired_settle_at 分軌)', async () => {
    const { deps, claimExpiredPendingAttempts, markSettleRetry } = makeDeps();
    claimExpiredPendingAttempts.mockResolvedValue([orphan('o1'), orphan('o2')]);
    settleChargeMock.mockResolvedValue(PENDING); // 即使 pending(sweeper 會 markSettleRetry)B1b 也不呼

    const r = await reconfirmExpiredOrphans(deps, { limit: 10 });

    expect(r.pending).toBe(2);
    expect(markSettleRetry).not.toHaveBeenCalled();
  });

  it('🔴 不動 needs_manual_review(B1 不清 manual:無任何 manual-setting 呼叫)', async () => {
    const { deps, claimExpiredPendingAttempts, markSettleRetry, flagNonUnpaidActive } = makeDeps();
    claimExpiredPendingAttempts.mockResolvedValue([orphan('o1', { needsManualReview: true })]);
    settleChargeMock.mockResolvedValue(PENDING);

    await reconfirmExpiredOrphans(deps, { limit: 10 });

    expect(markSettleRetry).not.toHaveBeenCalled();
    expect(flagNonUnpaidActive).not.toHaveBeenCalled();
  });

  it('claim throw → fail-closed:errors=1、不呼 settleCharge、不中斷 cron', async () => {
    const { deps, claimExpiredPendingAttempts } = makeDeps();
    claimExpiredPendingAttempts.mockRejectedValue(new Error('pg down'));

    const r = await reconfirmExpiredOrphans(deps, { limit: 10 });

    expect(r).toEqual({ claimed: 0, settled: 0, noAttempt: 0, pending: 0, errors: 1 });
    expect(settleChargeMock).not.toHaveBeenCalled();
  });

  it('claim 空 → 全 0、不呼 settleCharge', async () => {
    const { deps, claimExpiredPendingAttempts } = makeDeps();
    claimExpiredPendingAttempts.mockResolvedValue([]);

    const r = await reconfirmExpiredOrphans(deps, { limit: 10 });

    expect(r).toEqual({ claimed: 0, settled: 0, noAttempt: 0, pending: 0, errors: 0 });
    expect(settleChargeMock).not.toHaveBeenCalled();
  });

  it('單筆 settleCharge throw → fail-closed:該筆 errors、其餘照常處理', async () => {
    const { deps, claimExpiredPendingAttempts } = makeDeps();
    claimExpiredPendingAttempts.mockResolvedValue([orphan('o1'), orphan('o2'), orphan('o3')]);
    settleChargeMock.mockImplementation(async (_d: unknown, { orderId }: { orderId: string }) => {
      if (orderId === 'o2') throw new Error('record timeout');
      return PAID;
    });

    const r = await reconfirmExpiredOrphans(deps, { limit: 10 });

    expect(r).toEqual({ claimed: 3, settled: 2, noAttempt: 0, pending: 0, errors: 1 });
  });

  it.each([
    ['paid', PAID, { settled: 1, pending: 0, noAttempt: 0 }],
    ['failed', FAILED, { settled: 1, pending: 0, noAttempt: 0 }],
    ['no_attempt', NO_ATTEMPT, { settled: 0, pending: 0, noAttempt: 1 }],
    ['pending', PENDING, { settled: 0, pending: 1, noAttempt: 0 }],
  ])('outcome %s → tally 正確(no_attempt 單列、不混 settled)', async (_label, outcome, expected) => {
    const { deps, claimExpiredPendingAttempts } = makeDeps();
    claimExpiredPendingAttempts.mockResolvedValue([orphan('o1')]);
    settleChargeMock.mockResolvedValue(outcome);

    const r = await reconfirmExpiredOrphans(deps, { limit: 10 });

    expect(r.settled).toBe(expected.settled);
    expect(r.pending).toBe(expected.pending);
    expect(r.noAttempt).toBe(expected.noAttempt);
    expect(r.errors).toBe(0);
  });

  it('concurrency 非法(NaN/0/負)→ 退化為 1、仍處理全部', async () => {
    const { deps, claimExpiredPendingAttempts } = makeDeps();
    claimExpiredPendingAttempts.mockResolvedValue([orphan('o1'), orphan('o2')]);
    settleChargeMock.mockResolvedValue(PAID);

    const rNaN = await reconfirmExpiredOrphans(deps, { limit: 10, concurrency: Number.NaN });
    expect(rNaN.settled).toBe(2);

    claimExpiredPendingAttempts.mockResolvedValue([orphan('o3'), orphan('o4')]);
    const rZero = await reconfirmExpiredOrphans(deps, { limit: 10, concurrency: 0 });
    expect(rZero.settled).toBe(2);
  });

  it('orderId 全 from DB:settleCharge 只收 {orderId}、無 client 旁路參數(無 recTradeIdHint)', async () => {
    const { deps, claimExpiredPendingAttempts } = makeDeps();
    claimExpiredPendingAttempts.mockResolvedValue([orphan('o1')]);
    settleChargeMock.mockResolvedValue(PAID);

    await reconfirmExpiredOrphans(deps, { limit: 10 });

    expect(settleChargeMock).toHaveBeenCalledTimes(1);
    expect(settleChargeMock).toHaveBeenCalledWith(deps, { orderId: 'o1' });
  });
});
