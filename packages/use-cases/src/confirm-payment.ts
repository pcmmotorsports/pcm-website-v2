import type { ITapPayAdapter, IPaymentConfirmer } from '@pcm/ports';
import type {
  ConfirmPaymentInput,
  ConfirmPaymentOutcome,
  TapPayChargeResult,
} from '@pcm/domain';
import { PaymentConfirmError } from '@pcm/domain';

/**
 * confirmPayment:成交編排 use-case(M-3 階段②-②b、plan v6 §7「刷卡 → confirm」)。
 *
 * 薄編排 charge → confirm,回 **孤兒單契約 ConfirmPaymentOutcome**(🔴 MUST-FIX 2:charge 成功但
 * confirm 失敗回明確 outcome、非 generic 失敗 → 防使用者重按付款觸 PF-X2 雙扣)。
 *
 * 信任邊界(守 boundary A、不 import @pcm/schemas):
 * - `input.amount` = server read-back orders.total(單一金額來源、client 永不送價):同時餵 charge 與
 *   confirm p_amount;PF-X3 = 比對 charge 實扣 `charge.amount` == `amount`(否則孤兒、不 confirm)。
 * - cardholder 已由 delivery 層(②-③)從 server session/地址組裝(零信任、PII #16);use-case 只透傳。
 *
 * 失敗語意(plan §4):
 * - charge transport 失敗(throw)→ `charge_unknown`(扣款狀態未知、無 rec_trade_id、勿重刷)。
 * - charge `status='failed'`(卡拒、未扣款)→ `charge_failed`(可安全重試)。
 * - charge 實扣 ≠ total → `orphan/amount_mismatch`(已扣款、不 confirm)。
 * - confirm 失敗(PaymentConfirmError)→ `orphan/confirm_unreachable|confirm_rejected`(帶 transactionId 供對帳)。
 *
 * @see docs/specs/2026-06-12-m3-stage2-2-tappay-adapter-plan.md §4
 */
export type ConfirmPaymentDeps = {
  tappay: ITapPayAdapter;
  confirmer: IPaymentConfirmer;
};

export async function confirmPayment(
  deps: ConfirmPaymentDeps,
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentOutcome> {
  const { tappay, confirmer } = deps;
  const { prime, orderId, amount, cardholder } = input;

  // 1. charge(pay-by-prime)。transport 失敗 → 扣款狀態未知、無 rec_trade_id → 勿重刷(②-⑥ 經 order_number 對帳)。
  let charge: TapPayChargeResult;
  try {
    charge = await tappay.charge({ prime, amount, orderId, cardholder });
  } catch {
    return { kind: 'charge_unknown', orderId };
  }

  // 2. charge 業務失敗(卡拒等、status≠0、未扣款)→ 可安全重試。
  if (charge.status === 'failed') {
    return { kind: 'charge_failed' };
  }

  // 3. 🔴 PF-X3:實扣金額 == server total(整數 + 幣別)否則孤兒(已扣款、**不 confirm**;currency 比對為縱深、
  //    adapter 已斷言 TWD)。全鏈唯一在地驗「TapPay 真扣了 total」之處(webhook 對帳在 ②-⑥)。
  if (charge.amount.currency !== amount.currency || charge.amount.amount !== amount.amount) {
    return { kind: 'orphan', reason: 'amount_mismatch', transactionId: charge.transactionId, orderId };
  }

  // 4. confirm(payment_confirmer 窄權直連)。charge 已扣款 + 金額符 → confirm 失敗 = 孤兒(帶 transactionId)。
  try {
    const result = await confirmer.confirm({ orderId, amount, recTradeId: charge.transactionId });
    // RPC 契約恆回 confirmed:true(業務失敗走 RAISE、由 catch 接);防未來 RPC/version drift 回 false
    // 被誤判 paid → fail-closed 歸孤兒(已扣款、不重刷、對帳處理)。
    if (!result.confirmed) {
      return { kind: 'orphan', reason: 'confirm_rejected', transactionId: charge.transactionId, orderId };
    }
    return { kind: 'paid', idempotent: result.idempotent };
  } catch (err) {
    // 分類(SHOULD ③):unreachable=連線層(可重 confirm 冪等) vs rejected=RPC RAISE(孤兒對帳)。
    const reason =
      err instanceof PaymentConfirmError && err.code === 'unreachable'
        ? 'confirm_unreachable'
        : 'confirm_rejected';
    return { kind: 'orphan', reason, transactionId: charge.transactionId, orderId };
  }
}
