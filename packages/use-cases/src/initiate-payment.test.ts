import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toMoneyAmount,
  type BeginChargeAttemptResult,
  type InitiatePaymentInput,
  type TapPayInitiationResult,
} from '@pcm/domain';
import type { ITapPayAdapter, IChargeAttemptStore } from '@pcm/ports';
import { initiatePayment } from './initiate-payment';

const ATTEMPT = 'attempt-uuid-1';
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const REC = 'D20260619001234567';
const PAYMENT_URL = 'https://sandbox.tappaysdk.com/tpc/3dauth?token=SECRET_TOKEN_QUERY';

const INPUT: InitiatePaymentInput = {
  prime: 'prime_xyz',
  orderId: 'order-uuid-1',
  amount: { amount: toMoneyAmount(1050), currency: 'TWD' },
  cardholder: { name: '王小明', email: 'a@b.com', phoneNumber: '0912345678' },
  frontendRedirectUrl: 'https://pcm.example/checkout/callback?order=order-uuid-1',
  backendNotifyUrl: 'https://pcm.example/api/checkout/tappay-notify/SECRET',
};

function initiationResult(over: Partial<TapPayInitiationResult> = {}): TapPayInitiationResult {
  return {
    status: 'pending_3ds',
    paymentUrl: PAYMENT_URL,
    recTradeId: REC,
    bankTransactionId: 'P01234567890ABCDEF',
    ...over,
  };
}

function makeTapPay(
  initiate: () => Promise<TapPayInitiationResult> = async () => initiationResult(),
): ITapPayAdapter {
  // charge(同步)/ refund / recordQuery 為其他片 port 方法;initiatePayment 只呼 initiateThreeDSCharge、stub 滿足介面。
  return {
    charge: vi.fn(),
    refund: vi.fn(),
    recordQuery: vi.fn(),
    initiateThreeDSCharge: vi.fn(initiate),
  };
}

function makeAttempts(over: Partial<IChargeAttemptStore> = {}): IChargeAttemptStore {
  return {
    begin: vi.fn<(orderId: string) => Promise<BeginChargeAttemptResult>>(async () => ({
      acquired: true,
      attemptId: ATTEMPT,
      fallbackToken: TOKEN,
    })),
    markCharged: vi.fn(async () => {}),
    markFailed: vi.fn(async () => {}),
    findActiveByOrderId: vi.fn(async () => null),
    expireStuckAtCeiling: vi.fn(async () => 0),
    claimStuckUnsettled: vi.fn(async () => []),
    markSettleRetry: vi.fn(async () => 1),
    flagNonUnpaidActive: vi.fn(async () => 0),
    recordInitiationBankTxn: vi.fn(async () => {}),
    recordInitiationRec: vi.fn(async () => {}),
    ...over,
  };
}

function deps(over: { tappay?: ITapPayAdapter; attempts?: IChargeAttemptStore } = {}) {
  return {
    tappay: over.tappay ?? makeTapPay(),
    attempts: over.attempts ?? makeAttempts(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('initiatePayment — begin 佔鎖(複用 PF-X2 + 0b/0c cart dedup)', () => {
  it.each(['user_in_flight', 'order_locked', 'not_unpaid'] as const)(
    '🔴 begin !acquired(%s)→ locked + reason、零 bank_txn 寫入、零 TapPay',
    async (reason) => {
      const d = deps({
        attempts: makeAttempts({ begin: vi.fn(async () => ({ acquired: false as const, reason })) }),
      });
      const out = await initiatePayment(d, INPUT);
      expect(out).toEqual({ kind: 'locked', reason });
      expect(d.attempts.recordInitiationBankTxn).not.toHaveBeenCalled();
      expect(d.tappay.initiateThreeDSCharge).not.toHaveBeenCalled();
    },
  );

  it('🔴 begin duplicate(0b D2)→ settlement_required(非 locked/redirect)、零 charge', async () => {
    const d = deps({
      attempts: makeAttempts({
        begin: vi.fn(async () => ({
          acquired: false as const,
          reason: 'duplicate' as const,
          existingDisplayId: 'PCM-2026-0009',
          existingPaid: true as const,
        })),
      }),
    });
    const out = await initiatePayment(d, INPUT);
    // 🔴 3DS-7 7c-1:上帶 dedup(existing_*)。
    expect(out).toEqual({
      kind: 'settlement_required',
      dedup: { reason: 'duplicate', existingDisplayId: 'PCM-2026-0009', existingPaid: true },
    });
    expect(d.tappay.initiateThreeDSCharge).not.toHaveBeenCalled();
  });

  it('🔴 begin needs_settle(0b D4)→ settlement_required、零 charge', async () => {
    const d = deps({
      attempts: makeAttempts({
        begin: vi.fn(async () => ({
          acquired: false as const,
          reason: 'needs_settle' as const,
          existingOrderId: 'order-uuid-9',
          existingDisplayId: 'PCM-2026-0009',
          existingRecTradeId: null,
          existingBankTransactionId: null,
        })),
      }),
    });
    const out = await initiatePayment(d, INPUT);
    // 🔴 3DS-7 7c-1:上帶 dedup(existing_*);needs_settle 不帶 existingBankTransactionId(settleCharge 重查自取)。
    expect(out).toEqual({
      kind: 'settlement_required',
      dedup: {
        reason: 'needs_settle',
        existingOrderId: 'order-uuid-9',
        existingDisplayId: 'PCM-2026-0009',
        existingRecTradeId: null,
      },
    });
    expect(d.tappay.initiateThreeDSCharge).not.toHaveBeenCalled();
  });

  it('🔴 begin throw(infra)→ 上拋(零 charge 安全、action 吞通用字面)', async () => {
    const d = deps({
      attempts: makeAttempts({
        begin: vi.fn(async () => {
          throw new Error('charge 簿記主軌失敗(transport)');
        }),
      }),
    });
    await expect(initiatePayment(d, INPUT)).rejects.toThrow('主軌失敗');
    expect(d.tappay.initiateThreeDSCharge).not.toHaveBeenCalled();
  });
});

describe('initiatePayment — bank_txn charge 前 durable(codex 關卡1 #3)', () => {
  it('🔴 recordInitiationBankTxn 回 false→throw → init_failed、零 TapPay 呼叫、不 markFailed', async () => {
    const d = deps({
      attempts: makeAttempts({
        recordInitiationBankTxn: vi.fn(async () => {
          throw new Error('record_charge_bank_txn 未 durable');
        }),
      }),
    });
    const out = await initiatePayment(d, INPUT);
    expect(out).toEqual({ kind: 'init_failed' });
    expect(d.tappay.initiateThreeDSCharge).not.toHaveBeenCalled(); // 零 TapPay
    expect(d.attempts.markFailed).not.toHaveBeenCalled(); // 不釋鎖
  });

  it('🔴 recordInitiationBankTxn transport throw → init_failed、零 TapPay', async () => {
    const d = deps({
      attempts: makeAttempts({
        recordInitiationBankTxn: vi.fn(async () => {
          throw Object.assign(new Error('charge 簿記主軌失敗(transport)'), { code: 'ECONNRESET' });
        }),
      }),
    });
    const out = await initiatePayment(d, INPUT);
    expect(out).toEqual({ kind: 'init_failed' });
    expect(d.tappay.initiateThreeDSCharge).not.toHaveBeenCalled();
  });

  it('🔴 bank_txn 寫入用 generateBankTransactionId 產的 19 字大寫英數、且原樣餵 initiateThreeDSCharge', async () => {
    const attempts = makeAttempts();
    const tappay = makeTapPay();
    await initiatePayment({ attempts, tappay }, INPUT);
    const bankArg = vi.mocked(attempts.recordInitiationBankTxn).mock.calls[0]!;
    expect(bankArg[0]).toBe(ATTEMPT);
    expect(bankArg[1]).toBe(INPUT.orderId);
    expect(bankArg[2]).toMatch(/^[A-Z0-9]{19}$/); // §2.2 格式
    // 同一 bank_txn 原樣透傳 charge(adapter 不自產)
    const chargeArg = vi.mocked(tappay.initiateThreeDSCharge).mock.calls[0]![0];
    expect(chargeArg.bankTransactionId).toBe(bankArg[2]);
  });
});

describe('initiatePayment — initiateThreeDSCharge', () => {
  it('🔴 happy:pending_3ds → redirect(redirectUrl=payment_url)、rec durable、不 markFailed', async () => {
    const attempts = makeAttempts();
    const tappay = makeTapPay();
    const out = await initiatePayment({ attempts, tappay }, INPUT);
    expect(out).toEqual({ kind: 'redirect', redirectUrl: PAYMENT_URL });
    // rec charge 後 durable(維持 pending)
    expect(attempts.recordInitiationRec).toHaveBeenCalledWith(ATTEMPT, INPUT.orderId, REC);
    // initiate 全程不釋鎖、不 confirm(deps 無 confirmer)
    expect(attempts.markFailed).not.toHaveBeenCalled();
    expect(attempts.markCharged).not.toHaveBeenCalled();
  });

  it('🔴 charge 啟動 body 含 three_domain_secure 入參 + result_url(frontend/backend)+ amount/cardholder', async () => {
    const attempts = makeAttempts();
    const tappay = makeTapPay();
    await initiatePayment({ attempts, tappay }, INPUT);
    const arg = vi.mocked(tappay.initiateThreeDSCharge).mock.calls[0]![0];
    expect(arg.prime).toBe(INPUT.prime);
    expect(arg.orderId).toBe(INPUT.orderId);
    expect(arg.amount).toEqual(INPUT.amount);
    expect(arg.cardholder).toEqual(INPUT.cardholder);
    expect(arg.frontendRedirectUrl).toBe(INPUT.frontendRedirectUrl);
    expect(arg.backendNotifyUrl).toBe(INPUT.backendNotifyUrl);
  });

  it('🔴 initiateThreeDSCharge throw(status≠0/timeout/HTTP/格式)→ charge_unknown、不 markFailed、bank_txn 已 durable', async () => {
    const attempts = makeAttempts();
    const tappay = makeTapPay(async () => {
      throw new Error('TapPay 3DS 啟動非成功(status/timeout/格式)');
    });
    const out = await initiatePayment({ attempts, tappay }, INPUT);
    expect(out).toEqual({ kind: 'charge_unknown', orderId: INPUT.orderId });
    expect(attempts.recordInitiationBankTxn).toHaveBeenCalledTimes(1); // bank_txn 已 durable(settleCharge 對帳)
    expect(attempts.markFailed).not.toHaveBeenCalled(); // 🔴 不釋鎖、pending 續持鎖
    expect(attempts.recordInitiationRec).not.toHaveBeenCalled(); // charge 未成功 → 無 rec 寫入
  });
});

describe('initiatePayment — recordInitiationRec best-effort(charge 後、bank_txn 已可對帳)', () => {
  it('🔴 rec 寫入 throw(未 durable)→ 只 log 仍 redirect、payment_url 不入 log', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const attempts = makeAttempts({
      recordInitiationRec: vi.fn(async () => {
        throw new Error('record_charge_pending_rec 未 durable');
      }),
    });
    const out = await initiatePayment({ attempts, tappay: makeTapPay() }, INPUT);
    expect(out).toEqual({ kind: 'redirect', redirectUrl: PAYMENT_URL }); // 仍跳轉
    expect(errSpy).toHaveBeenCalledTimes(1);
    // 🔴 log 不含 payment_url(含 token query)/ prime / cardholder
    const logged = JSON.stringify(errSpy.mock.calls[0]);
    expect(logged).not.toContain(PAYMENT_URL);
    expect(logged).not.toContain('SECRET_TOKEN_QUERY');
    expect(logged).not.toContain(INPUT.prime);
  });
});
