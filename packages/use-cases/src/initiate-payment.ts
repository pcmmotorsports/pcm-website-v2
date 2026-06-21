import type { ITapPayAdapter, IChargeAttemptStore } from '@pcm/ports';
import type {
  InitiatePaymentInput,
  InitiatePaymentOutcome,
  TapPayInitiationResult,
} from '@pcm/domain';
import { generateBankTransactionId } from '@pcm/domain';

/**
 * initiatePayment:3DS charge 啟動半段編排 use-case(M-3 3DS-5b)。
 *
 * 🔴 命名 override(plan §3.3、codex 關卡1 #5):master plan §1/§2 稱「`confirmPayment.initiate`」、本片落地為
 * **獨立檔 `initiatePayment`**(conscious override:不拆改已重測過的同步 `confirm-payment` 路徑;後續 **3DS-6
 * 只能 consume 本 use-case** 當 3DS 入口、勿誤接 confirm-payment)。
 *
 * 編排(plan §3.3):
 * ```
 * 1. begin(orderId) — 複用既有 per-order 鎖 + per-user 閘 + 0b/0c cart dedup
 *    !acquired:
 *      duplicate | needs_settle → settlement_required(交 settleCharge 裁決;對齊 confirmPayment)
 *      else                     → locked(reason)
 * 2. bankTxn = generateBankTransactionId() — §2.2 ≤19 字大寫英數純函式(charge 前產)
 * 3. recordInitiationBankTxn — 🔴 charge 前 durable;RPC false / throw 皆 → init_failed(零 TapPay、安全)
 * 4. initiateThreeDSCharge — throw(status≠0 / 421 / HTTP / 格式)→ charge_unknown
 *      (🔴 bank_txn 已 durable → settleCharge 經 bank_txn 對帳;不 markFailed、pending 續持鎖、勿重刷)
 *    pending_3ds →
 *      recordInitiationRec — best-effort(charge 後、bank_txn 已可對帳):throw/false 只 log
 *      → redirect(redirectUrl = payment_url)
 * ```
 *
 * 🔴 無 markFailed 分支(codex 關卡1 #2):initiate 全程不釋鎖(charge 非成功一律 charge_unknown);
 * failed-釋鎖唯一權威 = settleCharge 經 Record API(record_status -1/5)。`deps` 不含 confirmer
 * (initiate 不 markCharged/confirm — 結算全交 settleCharge)。
 *
 * 信任邊界(守 boundary、不 import @pcm/schemas):
 * - `amount` = server read-back orders.total(client 永不送價、鐵則 12);cardholder 已由 delivery 層 server 組裝(PII #16)。
 * - `frontendRedirectUrl`/`backendNotifyUrl` 由 delivery 層(6)組(use-case 不自組 URL;plan §3.3)。
 * - log 僅 orderId/attemptId + 安全 code 標籤(零 PII/token/prime;🔴 payment_url 含 token query → 絕不 log)。
 *
 * @see docs/specs/2026-06-19-m3-3ds-5ab-charge-initiate-plan.md §3.3
 */
export type InitiatePaymentDeps = {
  tappay: ITapPayAdapter;
  attempts: IChargeAttemptStore;
};

export async function initiatePayment(
  deps: InitiatePaymentDeps,
  input: InitiatePaymentInput,
): Promise<InitiatePaymentOutcome> {
  const { tappay, attempts } = deps;
  const { prime, orderId, amount, cardholder, frontendRedirectUrl, backendNotifyUrl } = input;

  // 1. 佔鎖(複用既有 per-order 鎖 + per-user 閘 + 0b/0c cart dedup)。begin throw(infra)→ 上拋:零 charge 安全。
  const lock = await attempts.begin(orderId);
  if (!lock.acquired) {
    // duplicate/needs_settle(0b cart dedup)≠ 撞鎖 → settlement_required(對齊 confirmPayment;交 settleCharge 裁決)。
    // 🔴 3DS-7 7c-1:把 begin 的 existing_*(D2/D4)上帶到 settlement_required.dedup(供 action 層即時裁決)。
    if (lock.reason === 'duplicate') {
      return {
        kind: 'settlement_required',
        dedup: {
          reason: 'duplicate',
          existingDisplayId: lock.existingDisplayId,
          existingPaid: lock.existingPaid,
        },
      };
    }
    if (lock.reason === 'needs_settle') {
      return {
        kind: 'settlement_required',
        dedup: {
          reason: 'needs_settle',
          existingOrderId: lock.existingOrderId,
          existingDisplayId: lock.existingDisplayId,
          existingRecTradeId: lock.existingRecTradeId,
        },
      };
    }
    return { kind: 'locked', reason: lock.reason };
  }

  // 2. charge 前產唯一 bank_txn(≤19 字大寫英數;DB UNIQUE 部分索引 + TapPay 去重雙保險)。
  const bankTxn = generateBankTransactionId();

  // 3. 🔴 charge 前把 bank_txn durable 寫進 pending attempt。RPC false(未 durable)/ throw 皆 → init_failed:
  //    **零 TapPay 呼叫**(bank_txn 未落地不可送 charge、codex 關卡1 #3)、零扣款(安全);pending 鎖殘留交 expirer/sweeper 清。
  try {
    await attempts.recordInitiationBankTxn(lock.attemptId, orderId, bankTxn);
  } catch {
    return { kind: 'init_failed' };
  }

  // 4. 3DS charge 啟動(帶 three_domain_secure/result_url/bank_transaction_id;adapter 唯 status=0+payment_url+rec → pending_3ds)。
  //    throw(status≠0 / 421 timeout / HTTP / 格式 — adapter §2.1)→ charge_unknown:扣款狀態未知、
  //    🔴 bank_txn 已 durable → settleCharge 經 bank_txn 對帳;**不 markFailed**、pending 續持鎖、勿重刷。
  let initiation: TapPayInitiationResult;
  try {
    initiation = await tappay.initiateThreeDSCharge({
      prime,
      amount,
      orderId,
      cardholder,
      bankTransactionId: bankTxn,
      frontendRedirectUrl,
      backendNotifyUrl,
    });
  } catch {
    return { kind: 'charge_unknown', orderId };
  }

  // 5. charge 後把 rec_trade_id durable 寫進仍 pending 的 attempt(維持 pending、≠ markCharged)。
  //    best-effort:bank_txn 已是對帳鍵 → rec 寫入 throw/false 只 log、不阻跳轉(settleCharge 仍可經 bank_txn 對帳)。
  try {
    await attempts.recordInitiationRec(lock.attemptId, orderId, initiation.recTradeId);
  } catch (err) {
    console.error(
      '[initiatePayment] recordInitiationRec 未落地(bank_txn 已可對帳、不阻跳轉、settleCharge 經 bank_txn 收斂)',
      {
        orderId,
        attemptId: lock.attemptId,
        code: (err as { code?: string } | null)?.code ?? 'transport',
      },
    );
  }

  // 6. 🔴 payment_url 跳轉(含 token query、絕不 log);3DS-6 delivery 層 window.location 消費 redirectUrl。
  return { kind: 'redirect', redirectUrl: initiation.paymentUrl };
}
