import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toMoneyAmount,
  PaymentConfirmError,
  type BeginChargeAttemptResult,
  type ConfirmPaymentInput,
  type TapPayChargeResult,
} from '@pcm/domain';
import type { ITapPayAdapter, IPaymentConfirmer, IChargeAttemptStore } from '@pcm/ports';
import { confirmPayment } from './confirm-payment';

const INPUT: ConfirmPaymentInput = {
  prime: 'prime_xyz',
  orderId: 'order-uuid-1',
  amount: { amount: toMoneyAmount(1050), currency: 'TWD' },
  cardholder: { name: '王小明', email: 'a@b.com', phoneNumber: '0912345678' },
};
const ATTEMPT = 'attempt-uuid-1';
const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function chargeResult(over: Partial<TapPayChargeResult> = {}): TapPayChargeResult {
  return {
    status: 'succeeded',
    transactionId: 'D20260612001234567',
    amount: { amount: toMoneyAmount(1050), currency: 'TWD' },
    rawResponse: {},
    ...over,
  };
}

function makeTapPay(charge: () => Promise<TapPayChargeResult>): ITapPayAdapter {
  return { charge: vi.fn(charge), refund: vi.fn() };
}
function makeConfirmer(
  confirm: () => Promise<{ confirmed: boolean; idempotent: boolean }>,
): IPaymentConfirmer {
  return { confirm: vi.fn(confirm) };
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
    ...over,
  };
}
function deps(over: {
  tappay?: ITapPayAdapter;
  confirmer?: IPaymentConfirmer;
  attempts?: IChargeAttemptStore;
} = {}) {
  return {
    tappay: over.tappay ?? makeTapPay(async () => chargeResult()),
    confirmer: over.confirmer ?? makeConfirmer(async () => ({ confirmed: true, idempotent: false })),
    attempts: over.attempts ?? makeAttempts(),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('confirmPayment — 鎖(PF-X2、②-③c-2 織入)', () => {
  it.each(['user_in_flight', 'order_locked', 'not_unpaid'] as const)(
    '🔴 begin !acquired(%s)→ locked + reason、零 charge 零 confirm',
    async (reason) => {
      const d = deps({
        attempts: makeAttempts({ begin: vi.fn(async () => ({ acquired: false as const, reason })) }),
      });
      const out = await confirmPayment(d, INPUT);
      expect(out).toEqual({ kind: 'locked', reason });
      expect(d.tappay.charge).not.toHaveBeenCalled();
      expect(d.confirmer.confirm).not.toHaveBeenCalled();
    },
  );

  it('begin throw(infra)→ 原樣上拋(零 charge 安全、action 吞通用字面)', async () => {
    const d = deps({
      attempts: makeAttempts({
        begin: vi.fn(async () => {
          throw new Error('charge 簿記主軌失敗(transport)');
        }),
      }),
    });
    await expect(confirmPayment(d, INPUT)).rejects.toThrow('主軌失敗');
    expect(d.tappay.charge).not.toHaveBeenCalled();
  });

  it('🔴 順序:先 begin 佔鎖、再 charge(指令「先佔鎖再 charge」字面)', async () => {
    const order: string[] = [];
    const d = deps({
      attempts: makeAttempts({
        begin: vi.fn(async () => {
          order.push('begin');
          return { acquired: true as const, attemptId: ATTEMPT, fallbackToken: TOKEN };
        }),
      }),
      tappay: makeTapPay(async () => {
        order.push('charge');
        return chargeResult();
      }),
    });
    await confirmPayment(d, INPUT);
    expect(order).toEqual(['begin', 'charge']);
  });
});

describe('confirmPayment — 成功(paid)+ PF-X1 簿記', () => {
  it('charge ok + 金額符 + confirm 成功 → paid;markCharged 在 confirm 前(含雙鍵+token)', async () => {
    const order: string[] = [];
    const attempts = makeAttempts({
      markCharged: vi.fn(async () => {
        order.push('markCharged');
      }),
    });
    const confirmer = makeConfirmer(async () => {
      order.push('confirm');
      return { confirmed: true, idempotent: false };
    });
    const d = deps({ attempts, confirmer });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({ kind: 'paid', idempotent: false });
    expect(order).toEqual(['markCharged', 'confirm']); // 🔴 PF-X1:麵包屑先於 confirm
    expect(attempts.markCharged).toHaveBeenCalledWith({
      attemptId: ATTEMPT,
      orderId: 'order-uuid-1',
      recTradeId: 'D20260612001234567',
      fallbackToken: TOKEN,
    });
  });

  it('confirm 重放冪等 → paid(idempotent=true)', async () => {
    const d = deps({ confirmer: makeConfirmer(async () => ({ confirmed: true, idempotent: true })) });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({ kind: 'paid', idempotent: true });
  });

  it('confirm 收到 [orderId, amount, recTradeId=charge.transactionId]', async () => {
    const d = deps();
    await confirmPayment(d, INPUT);
    expect(d.confirmer.confirm).toHaveBeenCalledWith({
      orderId: 'order-uuid-1',
      amount: { amount: 1050, currency: 'TWD' },
      recTradeId: 'D20260612001234567',
    });
  });

  it('🔴 markCharged 全敗 → log critical、續走 confirm;confirm 成功 → 收斂補記一次(round3 MF)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const markCharged = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('charge 簿記雙軌全敗(主軌:transport;備軌:transport)'))
      .mockResolvedValueOnce(undefined); // 收斂補記成功
    const d = deps({ attempts: makeAttempts({ markCharged }) });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({ kind: 'paid', idempotent: false });
    expect(markCharged).toHaveBeenCalledTimes(2); // 主流程 1 + 收斂補記 1
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).not.toContain(TOKEN); // log 零 token
    expect(logged).not.toContain(INPUT.prime); // 零 prime
    expect(logged).not.toContain(INPUT.cardholder.name); // 零 PII(#16)
    expect(logged).not.toContain(INPUT.cardholder.email);
    expect(logged).not.toContain(INPUT.cardholder.phoneNumber);
  });

  it('markCharged P0001(deterministic 拒、複合早停上拋)→ 同樣續走 confirm、log 帶 code', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const markCharged = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(Object.assign(new Error('charge 簿記主軌失敗(P0001)'), { code: 'P0001' }));
    const d = deps({ attempts: makeAttempts({ markCharged }) });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({ kind: 'paid', idempotent: false });
    expect(JSON.stringify(errSpy.mock.calls)).toContain('P0001');
  });

  it('markCharged 成功 → 零收斂補記(只呼 1 次)', async () => {
    const d = deps();
    await confirmPayment(d, INPUT);
    expect(d.attempts.markCharged).toHaveBeenCalledTimes(1);
  });

  it('markCharged 全敗 + 收斂補記仍敗 → 仍回 paid(orders 已權威)、log 兩筆', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const markCharged = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('charge 簿記雙軌全敗(主軌:transport;備軌:transport)'));
    const d = deps({ attempts: makeAttempts({ markCharged }) });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({ kind: 'paid', idempotent: false });
    expect(errSpy).toHaveBeenCalledTimes(2);
  });
});

describe('confirmPayment — charge 側失敗', () => {
  it('卡拒(status=failed)→ markFailed 釋鎖成功 → charge_failed(recordPersisted:true)、不呼 confirm', async () => {
    const d = deps({ tappay: makeTapPay(async () => chargeResult({ status: 'failed' })) });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({ kind: 'charge_failed', recordPersisted: true });
    expect(d.attempts.markFailed).toHaveBeenCalledWith({ attemptId: ATTEMPT, orderId: 'order-uuid-1' });
    expect(d.attempts.markCharged).not.toHaveBeenCalled();
    expect(d.confirmer.confirm).not.toHaveBeenCalled();
  });

  it('🔴 卡拒 + markFailed 全敗 → charge_failed(recordPersisted:false)(round5 MF1、鎖殘留誠實標)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const d = deps({
      tappay: makeTapPay(async () => chargeResult({ status: 'failed' })),
      attempts: makeAttempts({
        markFailed: vi.fn(async () => {
          throw new Error('charge 簿記主軌失敗(transport)');
        }),
      }),
    });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({ kind: 'charge_failed', recordPersisted: false });
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('charge transport throw → charge_unknown;🔴 零標記(pending 續持鎖 fail-closed)、不呼 confirm', async () => {
    const d = deps({
      tappay: makeTapPay(async () => {
        throw new Error('ECONNRESET');
      }),
    });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({ kind: 'charge_unknown', orderId: 'order-uuid-1' });
    expect(d.attempts.markCharged).not.toHaveBeenCalled();
    expect(d.attempts.markFailed).not.toHaveBeenCalled();
    expect(d.confirmer.confirm).not.toHaveBeenCalled();
  });
});

describe('confirmPayment — 孤兒單(orphan、已扣款不重刷)', () => {
  it('PF-X3 實扣 ≠ total → orphan/amount_mismatch、不呼 confirm;markCharged 已先落(PF-X1)', async () => {
    const d = deps({
      tappay: makeTapPay(async () =>
        chargeResult({ amount: { amount: toMoneyAmount(1000), currency: 'TWD' } }),
      ),
    });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({
      kind: 'orphan',
      reason: 'amount_mismatch',
      transactionId: 'D20260612001234567',
      orderId: 'order-uuid-1',
    });
    expect(d.attempts.markCharged).toHaveBeenCalledTimes(1); // 麵包屑先於 PF-X3(round3 MF 分支枚舉)
    expect(d.confirmer.confirm).not.toHaveBeenCalled();
  });

  it('confirm 連線層失敗(unreachable)→ orphan/confirm_unreachable + transactionId', async () => {
    const d = deps({
      confirmer: makeConfirmer(async () => {
        throw new PaymentConfirmError('unreachable', '連線失敗');
      }),
    });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({
      kind: 'orphan',
      reason: 'confirm_unreachable',
      transactionId: 'D20260612001234567',
      orderId: 'order-uuid-1',
    });
  });

  it('confirm RPC 拒(rejected)→ orphan/confirm_rejected + transactionId', async () => {
    const d = deps({
      confirmer: makeConfirmer(async () => {
        throw new PaymentConfirmError('rejected', '被拒');
      }),
    });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({
      kind: 'orphan',
      reason: 'confirm_rejected',
      transactionId: 'D20260612001234567',
      orderId: 'order-uuid-1',
    });
  });

  it('confirm 非 PaymentConfirmError 的 throw → 視為 confirm_rejected(保守、不重刷)', async () => {
    const d = deps({
      confirmer: makeConfirmer(async () => {
        throw new Error('unexpected');
      }),
    });
    const out = await confirmPayment(d, INPUT);
    expect(out).toMatchObject({ kind: 'orphan', reason: 'confirm_rejected' });
  });

  it('confirm 回 confirmed:false(RPC drift 防呆)→ orphan/confirm_rejected、不誤判 paid', async () => {
    const d = deps({ confirmer: makeConfirmer(async () => ({ confirmed: false, idempotent: false })) });
    const out = await confirmPayment(d, INPUT);
    expect(out).toEqual({
      kind: 'orphan',
      reason: 'confirm_rejected',
      transactionId: 'D20260612001234567',
      orderId: 'order-uuid-1',
    });
  });

  it('confirm 失敗(孤兒)時不做收斂補記(只 confirm 成功才補;orphan 走 ②-⑥)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const markCharged = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('charge 簿記雙軌全敗(主軌:transport;備軌:transport)'));
    const d = deps({
      attempts: makeAttempts({ markCharged }),
      confirmer: makeConfirmer(async () => {
        throw new PaymentConfirmError('unreachable', '連線失敗');
      }),
    });
    const out = await confirmPayment(d, INPUT);
    expect(out).toMatchObject({ kind: 'orphan', reason: 'confirm_unreachable' });
    expect(markCharged).toHaveBeenCalledTimes(1); // 零收斂補記
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});
