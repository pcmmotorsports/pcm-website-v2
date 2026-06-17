import type { ITapPayAdapter, IPaymentConfirmer, IChargeAttemptStore } from '@pcm/ports';
import type {
  ConfirmPaymentInput,
  ConfirmPaymentOutcome,
  TapPayChargeResult,
} from '@pcm/domain';
import { PaymentConfirmError } from '@pcm/domain';

/**
 * confirmPayment:成交編排 use-case(M-3 ②-②b 建立、②-③c-2 織入鎖+簿記;plan v6 §6)。
 *
 * 編排 鎖 → charge → 簿記 → confirm,回 **孤兒單契約 ConfirmPaymentOutcome**(🔴 MUST-FIX 2 +
 * PF-X1/X2 落地):
 *
 * ```
 * 1. attempts.begin(佔 per-order 鎖 + per-user 閘)— throw 上拋(零 charge 安全);!acquired → locked
 *    | settlement_required(3DS-0b cart dedup duplicate/needs_settle)
 * 2. tappay.charge — throw → charge_unknown(不標記、pending 續持鎖 fail-closed)
 * 3. status='failed' → markFailed(複合主軌 ×3 釋鎖);全敗 → charge_failed(recordPersisted:false)
 * 4. charge 成功 → 🔴 markCharged(複合雙軌 主×3→備×2)、先於 PF-X3/confirm(PF-X1 麵包屑);
 *    全敗 → log critical 續走(錢已扣不棄單;pending row + TapPay order_number 反查兜底)
 * 5. PF-X3 實扣比對 / 6. confirm(既有邏輯不動)
 * 7. confirm 成功且步驟 4 曾全敗 → 收斂補記一次(round3 MF;orders 已有權威 rec、best-effort)
 * ```
 *
 * 信任邊界(守 boundary A、不 import @pcm/schemas):
 * - `input.amount` = server read-back orders.total(findTotal 窄讀、單一金額來源):同時餵 charge 與
 *   confirm p_amount;PF-X3 = 比對 charge 實扣 `charge.amount` == `amount`(否則孤兒、不 confirm)。
 * - cardholder 已由 delivery 層(②-③d)server 組裝(零信任、PII #16);use-case 只透傳。
 * - log 僅 orderId/attemptId/recTradeId(零 PII/token/prime)。
 *
 * @see docs/specs/2026-06-12-m3-stage2-3-charge-action-plan.md §3/§6
 */
export type ConfirmPaymentDeps = {
  tappay: ITapPayAdapter;
  confirmer: IPaymentConfirmer;
  attempts: IChargeAttemptStore;
};

export async function confirmPayment(
  deps: ConfirmPaymentDeps,
  input: ConfirmPaymentInput,
): Promise<ConfirmPaymentOutcome> {
  const { tappay, confirmer, attempts } = deps;
  const { prime, orderId, amount, cardholder } = input;

  // 1. 🔴 先佔鎖再 charge(PF-X2;指令字面)。begin throw(infra)→ 上拋:零 charge、action 吞通用字面。
  const lock = await attempts.begin(orderId);
  if (!lock.acquired) {
    // 🔴 codex K1 must-fix 2:duplicate/needs_settle(3DS-0b cart-instance dedup)≠ 撞鎖,不得 alias 成
    //    locked(silent drift)→ 獨立 outcome settlement_required(非 locked 非 paid;②-③ 映「狀態確認中」)。
    //    TODO(3DS-1b settleCharge):option A per-call cart_session_id(每次新 UUID)下 begin dedup 恆 0
    //    sibling → 此分支 dormant/unreachable;#3DS-7 client cart key 整合後由 settleCharge 完整消費 D2/D4。
    if (lock.reason === 'duplicate' || lock.reason === 'needs_settle') {
      return { kind: 'settlement_required' };
    }
    return { kind: 'locked', reason: lock.reason };
  }

  // 2. charge(pay-by-prime)。transport 失敗 → 扣款狀態未知 → 不標記(pending 續持鎖、fail-closed)、
  //    勿重刷(②-⑥ webhook 經 order_number 對帳自癒)。
  let charge: TapPayChargeResult;
  try {
    charge = await tappay.charge({ prime, amount, orderId, cardholder });
  } catch {
    return { kind: 'charge_unknown', orderId };
  }

  // 3. charge 業務失敗(卡拒、未扣款)→ 釋鎖(複合主軌 ×3;備軌不可釋鎖)。
  //    釋鎖全敗 → recordPersisted:false(round5 MF1:「已知未扣款」未 durable、pending 鎖殘留 →
  //    ②-③e 映 charge_failed_wait、不誘導立即重試)。
  if (charge.status === 'failed') {
    try {
      await attempts.markFailed({ attemptId: lock.attemptId, orderId });
      return { kind: 'charge_failed', recordPersisted: true };
    } catch {
      console.error('[confirmPayment] markFailed 全敗(未扣款;pending 鎖殘留、②-⑥ 清)', {
        orderId,
        attemptId: lock.attemptId,
      });
      return { kind: 'charge_failed', recordPersisted: false };
    }
  }

  // 4. 🔴 PF-X1 麵包屑:雙軌 markCharged(複合內 主×3 退避→備×2)、**先於** PF-X3/confirm。
  //    雙軌全敗 = pg pooler + PostgREST 同時死(罕見)→ log critical 續走(錢已扣、不棄完成機會;
  //    pending row〔order_id+時間〕+ TapPay 側 order_number↔rec 連結 → ②-⑥ 確定性恢復、plan v6 §3)。
  let breadcrumbPersisted = true;
  try {
    await attempts.markCharged({
      attemptId: lock.attemptId,
      orderId,
      recTradeId: charge.transactionId,
      fallbackToken: lock.fallbackToken,
    });
  } catch (err) {
    breadcrumbPersisted = false;
    // 雙軌 transport 耗盡 或 P0001 deterministic 拒(複合早停上拋)皆續走(錢已扣不棄單);
    // code 為安全 SQLSTATE/錯誤碼(零 pg 原文/token)、供 ops 分流。
    console.error(
      '[confirmPayment] 🔴 markCharged 失敗、rec 未落 attempts(pending row + TapPay order_number 可反查、②-⑥)',
      {
        orderId,
        attemptId: lock.attemptId,
        recTradeId: charge.transactionId,
        code: (err as { code?: string } | null)?.code ?? 'transport',
      },
    );
  }

  // 5. 🔴 PF-X3:實扣金額 == server total(整數 + 幣別)否則孤兒(已扣款、**不 confirm**;currency 比對
  //    為縱深、adapter 已斷言 TWD)。全鏈唯一在地驗「TapPay 真扣了 total」之處(webhook 對帳在 ②-⑥)。
  if (charge.amount.currency !== amount.currency || charge.amount.amount !== amount.amount) {
    return { kind: 'orphan', reason: 'amount_mismatch', transactionId: charge.transactionId, orderId };
  }

  // 6. confirm(payment_confirmer 窄權直連)。charge 已扣款 + 金額符 → confirm 失敗 = 孤兒(帶 transactionId)。
  try {
    const result = await confirmer.confirm({ orderId, amount, recTradeId: charge.transactionId });
    // RPC 契約恆回 confirmed:true(業務失敗走 RAISE、由 catch 接);防未來 RPC/version drift 回 false
    // 被誤判 paid → fail-closed 歸孤兒(已扣款、不重刷、對帳處理)。
    if (!result.confirmed) {
      return { kind: 'orphan', reason: 'confirm_rejected', transactionId: charge.transactionId, orderId };
    }
    // 7. 收斂補記(round3 MF):步驟 4 曾全敗而 confirm 成功 → orders.tappay_rec_trade_id 已為權威
    //    紀錄、attempt 補收斂 charged(best-effort、再敗只 log;閘已 join orders、paid 即放行不誤卡)。
    if (!breadcrumbPersisted) {
      try {
        await attempts.markCharged({
          attemptId: lock.attemptId,
          orderId,
          recTradeId: charge.transactionId,
          fallbackToken: lock.fallbackToken,
        });
      } catch {
        console.error(
          '[confirmPayment] 收斂補記仍敗(orders.tappay_rec_trade_id 已為權威紀錄、attempt 留 ②-⑥ 收斂)',
          { orderId, attemptId: lock.attemptId },
        );
      }
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
