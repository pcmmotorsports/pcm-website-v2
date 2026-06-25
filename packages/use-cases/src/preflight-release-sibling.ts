import type { ISiblingLookup, IReleaseSibling } from '@pcm/ports';
import type {
  PreflightReleaseSiblingInput,
  PreflightReleaseSiblingOutcome,
  SettleChargeInput,
  SettleChargeOutcome,
  SiblingLookupResult,
} from '@pcm/domain';

/**
 * preflightReleaseSibling:立即重刷 preflight use-case(M-3 3DS 乙路 R2b-2、canonical §2.3)。
 *
 * 客人付款放棄後按「重新付款」→ action 層〔R3 chargePaymentAction〕在 **placeOrder 之前**呼本 use-case,
 * 決定「直接建新單重刷 / 顯既有單 / 確認中稍候」三岔(否則新單先建 = 孤兒)。流程:
 * ```
 * siblingLookup(cartSessionId, own-only) →
 *   none  → proceed                                   (建新單重刷)
 *   paid  → existing_paid                             (顯既有單、零雙扣)
 *   active → settle(existingOrderId):                 〔settleCharge 內部由 payment_confirmer 取 rec/bank〕
 *     paid                      → existing_paid
 *     auth_or_pending(4)        → release CAS:
 *         released:true         → proceed
 *         released:false        → 重 settle:paid→existing_paid / 其餘→hold(§2.3:不建新單)
 *     released_failure_observed
 *     | record_unreachable
 *     | record_unverified       → hold
 *     failed | no_attempt       → proceed             (🔴 Q2=A:確定未成交 → 放行安全)
 * 任一 lookup/release 非預期 throw → hold(fail-closed、不建新單避免孤兒/雙扣)。
 * ```
 *
 * 信任 / 安全邊界:
 * - `siblingLookup` own-only(`auth.uid()` DB 端鎖死);`releaseSibling` 四閘 CAS(customer_user_id +
 *   cart_session_id + order unpaid + status pending,DB 端鎖死)→ **不信 client 傳的 user/order/取消訊號**;
 *   `userId` 由 server 驗過的登入態傳入(input)。
 * - 🔴 **release 三參數順序固定 `(attemptId, userId, cartSessionId)`**(adversarial S1:皆 string、調換無
 *   compile error;DB 四閘會兜底成 released:false=不洩漏但誤導向 hold)— 呼叫點與測試固定此序。
 * - `settle` = 注入函式(包 settleCharge〔SettleChargeDeps 由 composition 提供〕)。注入而非直接 import:
 *   ① 解耦 preflight 與 settleCharge 的 tappay/attempts/confirmer deps;② §2.3 狀態機可對 settle outcome
 *   直接單元測試(不經 Record/RPC mock)。
 *
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §2.3 / §5 / §9 表 R2b
 */
export type PreflightReleaseSiblingDeps = {
  siblingLookup: ISiblingLookup;
  releaseSibling: IReleaseSibling;
  settle: (input: SettleChargeInput) => Promise<SettleChargeOutcome>;
};

export async function preflightReleaseSibling(
  deps: PreflightReleaseSiblingDeps,
  input: PreflightReleaseSiblingInput,
): Promise<PreflightReleaseSiblingOutcome> {
  const { siblingLookup } = deps;
  const { cartSessionId } = input;

  // 1. own-only 反查兄弟單。throw → fail-closed hold(查不到就不建新單、避免孤兒/雙扣)。
  let sibling: SiblingLookupResult;
  try {
    sibling = await siblingLookup.lookup(cartSessionId);
  } catch {
    return { kind: 'hold', reason: 'lookup_unreachable' };
  }

  if (sibling.kind === 'none') {
    return { kind: 'proceed' };
  }
  if (sibling.kind === 'paid') {
    return {
      kind: 'existing_paid',
      existingOrderId: sibling.existingOrderId,
      displayId: sibling.displayId,
    };
  }

  // sibling.kind === 'active':交 settle 即時裁決。
  return adjudicateActive(deps, input, sibling);
}

/** active 兄弟單:settle(existingOrderId)→ 依 outcome 決定 proceed / existing_paid / release / hold。 */
async function adjudicateActive(
  deps: PreflightReleaseSiblingDeps,
  input: PreflightReleaseSiblingInput,
  sibling: Extract<SiblingLookupResult, { kind: 'active' }>,
): Promise<PreflightReleaseSiblingOutcome> {
  const { settle } = deps;
  const { existingOrderId } = sibling;

  let settled: SettleChargeOutcome;
  try {
    settled = await settle({ orderId: existingOrderId });
  } catch {
    // settleCharge 契約本應 fail-closed 回 pending(不 throw);此為縱深 → hold。
    return { kind: 'hold', reason: 'settle_unreachable' };
  }

  switch (settled.kind) {
    case 'paid':
      return { kind: 'existing_paid', existingOrderId, displayId: settled.displayId };
    case 'failed':
    case 'no_attempt':
      // 🔴 Q2=A:failed=已 markFailed 確定 -1/5 未成交(鎖已釋)、no_attempt=無 active 必然未扣款 → 放行重刷。
      return { kind: 'proceed' };
    case 'pending': {
      if (settled.reason === 'auth_or_pending') {
        return releaseThenAdjudicate(deps, input, sibling);
      }
      // released_failure_observed / record_unreachable / record_unverified → hold「確認中、稍候」。
      // 🔴 passthrough 由型別守(adversarial S1 顯式化):`PreflightHoldReason` ⊇ 這三個 pending reason;
      //    `SettleChargeOutcome` 若新增 pending reason 而未同步 `PreflightHoldReason` → 此行 TS compile error
      //    (顯式耦合、防靜默誤分類成 hold)。
      return { kind: 'hold', reason: settled.reason };
    }
    default: {
      // 窮盡守衛(adversarial N2):`SettleChargeOutcome` 未來新增 kind → `settled` 收窄為 never、TS compile
      //   error;runtime 不可達,仍 fail-closed hold(絕不 proceed/existing_paid)。
      const _exhaustive: never = settled;
      void _exhaustive;
      return { kind: 'hold', reason: 'settle_unreachable' };
    }
  }
}

/**
 * auth_or_pending(4)→ release CAS:成功 proceed;rowcount=0(被搶先/他 tab)→ 重 settle 裁決;throw → hold。
 * 🔴 release 參數順序固定 (attemptId, userId, cartSessionId)(S1)。
 */
async function releaseThenAdjudicate(
  deps: PreflightReleaseSiblingDeps,
  input: PreflightReleaseSiblingInput,
  sibling: Extract<SiblingLookupResult, { kind: 'active' }>,
): Promise<PreflightReleaseSiblingOutcome> {
  const { releaseSibling, settle } = deps;

  let released: boolean;
  try {
    const r = await releaseSibling.release(sibling.attemptId, input.userId, input.cartSessionId);
    released = r.released;
  } catch {
    return { kind: 'hold', reason: 'release_unreachable' };
  }

  if (released) {
    return { kind: 'proceed' };
  }

  // rowcount=0:被 markCharged 搶先 / 他 tab 已處理 → 重 settle(§2.3:paid→顯既有 / 其餘→hold、不建新單)。
  let resettled: SettleChargeOutcome;
  try {
    resettled = await settle({ orderId: sibling.existingOrderId });
  } catch {
    return { kind: 'hold', reason: 'settle_unreachable' };
  }
  if (resettled.kind === 'paid') {
    return { kind: 'existing_paid', existingOrderId: sibling.existingOrderId, displayId: resettled.displayId };
  }
  return { kind: 'hold', reason: 'release_lost_race' };
}
