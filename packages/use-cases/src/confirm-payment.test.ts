import { describe, it, expect, vi } from 'vitest';
import {
  toMoneyAmount,
  PaymentConfirmError,
  type ConfirmPaymentInput,
  type TapPayChargeResult,
} from '@pcm/domain';
import type { ITapPayAdapter, IPaymentConfirmer } from '@pcm/ports';
import { confirmPayment } from './confirm-payment';

const INPUT: ConfirmPaymentInput = {
  prime: 'prime_xyz',
  orderId: 'order-uuid-1',
  amount: { amount: toMoneyAmount(1050), currency: 'TWD' },
  cardholder: { name: '王小明', email: 'a@b.com', phoneNumber: '0912345678' },
};

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

describe('confirmPayment — 成功(paid)', () => {
  it('charge ok + 金額符 + confirm 成功 → paid(idempotent=false)', async () => {
    const tappay = makeTapPay(async () => chargeResult());
    const confirmer = makeConfirmer(async () => ({ confirmed: true, idempotent: false }));
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toEqual({ kind: 'paid', idempotent: false });
  });

  it('confirm 重放冪等 → paid(idempotent=true)', async () => {
    const tappay = makeTapPay(async () => chargeResult());
    const confirmer = makeConfirmer(async () => ({ confirmed: true, idempotent: true }));
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toEqual({ kind: 'paid', idempotent: true });
  });

  it('confirm 收到 [orderId, amount, recTradeId=charge.transactionId]', async () => {
    const tappay = makeTapPay(async () => chargeResult());
    const confirmer = makeConfirmer(async () => ({ confirmed: true, idempotent: false }));
    await confirmPayment({ tappay, confirmer }, INPUT);
    expect(confirmer.confirm).toHaveBeenCalledWith({
      orderId: 'order-uuid-1',
      amount: { amount: 1050, currency: 'TWD' },
      recTradeId: 'D20260612001234567',
    });
  });
});

describe('confirmPayment — charge 側失敗', () => {
  it('charge 業務失敗(status=failed)→ charge_failed、不呼 confirm', async () => {
    const tappay = makeTapPay(async () => chargeResult({ status: 'failed' }));
    const confirmer = makeConfirmer(async () => ({ confirmed: true, idempotent: false }));
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toEqual({ kind: 'charge_failed' });
    expect(confirmer.confirm).not.toHaveBeenCalled();
  });

  it('charge transport throw → charge_unknown(無 rec_trade_id)、不呼 confirm', async () => {
    const tappay = makeTapPay(async () => {
      throw new Error('ECONNRESET');
    });
    const confirmer = makeConfirmer(async () => ({ confirmed: true, idempotent: false }));
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toEqual({ kind: 'charge_unknown', orderId: 'order-uuid-1' });
    expect(confirmer.confirm).not.toHaveBeenCalled();
  });
});

describe('confirmPayment — 孤兒單(orphan、已扣款不重刷)', () => {
  it('PF-X3 實扣 ≠ total → orphan/amount_mismatch、不呼 confirm', async () => {
    const tappay = makeTapPay(async () =>
      chargeResult({ amount: { amount: toMoneyAmount(1000), currency: 'TWD' } }),
    );
    const confirmer = makeConfirmer(async () => ({ confirmed: true, idempotent: false }));
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toEqual({
      kind: 'orphan',
      reason: 'amount_mismatch',
      transactionId: 'D20260612001234567',
      orderId: 'order-uuid-1',
    });
    expect(confirmer.confirm).not.toHaveBeenCalled();
  });

  it('confirm 連線層失敗(unreachable)→ orphan/confirm_unreachable + transactionId', async () => {
    const tappay = makeTapPay(async () => chargeResult());
    const confirmer = makeConfirmer(async () => {
      throw new PaymentConfirmError('unreachable', '連線失敗');
    });
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toEqual({
      kind: 'orphan',
      reason: 'confirm_unreachable',
      transactionId: 'D20260612001234567',
      orderId: 'order-uuid-1',
    });
  });

  it('confirm RPC 拒(rejected)→ orphan/confirm_rejected + transactionId', async () => {
    const tappay = makeTapPay(async () => chargeResult());
    const confirmer = makeConfirmer(async () => {
      throw new PaymentConfirmError('rejected', '被拒');
    });
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toEqual({
      kind: 'orphan',
      reason: 'confirm_rejected',
      transactionId: 'D20260612001234567',
      orderId: 'order-uuid-1',
    });
  });

  it('confirm 非 PaymentConfirmError 的 throw → 視為 confirm_rejected(保守、不重刷)', async () => {
    const tappay = makeTapPay(async () => chargeResult());
    const confirmer = makeConfirmer(async () => {
      throw new Error('unexpected');
    });
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toMatchObject({ kind: 'orphan', reason: 'confirm_rejected' });
  });

  it('confirm 回 confirmed:false(RPC drift 防呆)→ orphan/confirm_rejected、不誤判 paid', async () => {
    const tappay = makeTapPay(async () => chargeResult());
    const confirmer = makeConfirmer(async () => ({ confirmed: false, idempotent: false }));
    const out = await confirmPayment({ tappay, confirmer }, INPUT);
    expect(out).toEqual({
      kind: 'orphan',
      reason: 'confirm_rejected',
      transactionId: 'D20260612001234567',
      orderId: 'order-uuid-1',
    });
  });
});
