'use client';
// CheckoutCouponField.tsx — 結帳頁的券碼欄(⟦b4-COUPONFIELD⟧ 片 B)。
//
// plan:`docs/plans/2026-09-11-storefront-coupon-code-field-plan.md` §3(2 + 5 + 7)。
// 稿:`design-reference/components/CheckoutPage.jsx` N°05 · COUPON + `styles/account.css:173-212` 的 `.cart-coupon*`
//     (稿把券的樣式定義在 cart 那一族、checkout 只覆寫圓角 `checkout.css:348`)⇒ 本檔沿用同一組類名,不自創第二套。
//
// 🔴 **本檔不打任何 API、不算折扣** —— 它只有「打字」與「按套用」兩個出口(`onCodeChange` / `onApply`)。
//    真的去問 DB 是片 C(接線)+ 片 D(RPC 解除封鎖)。⇒ `onApply` 沒給 ⇒ 鈕 disabled,
//    **不做一顆按了沒反應的鈕**(那正是 plan 問題④在講的東西)。
//
// 🔵 錯誤字用站上既有的 `auth-field-err`(CheckoutStep2 的發票三格就是它)—— 不新造第二種錯誤樣式。
//
// 🔴 Q2 = 甲(主視窗 2026-09-14 裁):**按「套用」才算**,不打字即時算 —— 稿就是這樣,而且每打一個字問一次 DB 太貴。

import type { CouponRejectReason } from '@pcm/domain';

/** 券碼欄今天的四種樣子。`checking` 是片 C 之後才會出現的過場。 */
export type CouponFieldState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'applied'; discount: number }
  | { kind: 'rejected'; reason: CouponRejectReason; minSpend?: number; subtotal?: number };

/**
 * 券被擋下來時對客人講的話(Q1,主視窗 2026-09-14 裁)。
 *
 * 🔴🔴 **三種理由【刻意】收成同一句「這張券不能用」:`not_found` / `inactive` / `exhausted`。**
 * 理由不是文案偏好,是安全:`redeem_coupon` 對「查無此碼」與「這張券存在但停用 / 被領完」回不同 reason
 * (`20260831160000:202,266` 等),照實講等於一個**券碼存在性 oracle** —— 亂打碼的人可以用回應差異
 * 把有效券碼枚舉出來。⇒ 這三種對外必須**長得一模一樣**。
 * 🔵 `already_used_by_account` 照實講不洩漏:它只在**本人用過**時才回,對第三者永遠不會出現。
 * 🛑 之後有人要「講清楚一點」時,先讀這一段 —— 分開講這三句就是把券碼交出去。
 */
export function couponRejectMessage(
  reason: CouponRejectReason,
  opts?: { minSpend?: number; subtotal?: number },
): string {
  switch (reason) {
    case 'expired':
      return '這張券已經過期了';
    case 'tier_conflict':
      return '這張券不適用你目前的會員價';
    case 'already_used_by_account':
      return '你已經用過這張券了';
    case 'below_min_spend': {
      const min = opts?.minSpend;
      const sub = opts?.subtotal;
      if (typeof min !== 'number') return '這張券有最低消費門檻,目前還沒達到';
      const gap = typeof sub === 'number' ? Math.max(min - sub, 0) : undefined;
      const minText = `NT$ ${min.toLocaleString('en-US')}`;
      return gap === undefined
        ? `訂單滿 ${minText} 才能用這張券`
        : `訂單滿 ${minText} 才能用這張券,還差 NT$ ${gap.toLocaleString('en-US')}`;
    }
    // 🔴 下面三種共用同一句 —— 見上面那段,不要拆開。
    case 'not_found':
    case 'inactive':
    case 'exhausted':
      return '這張券不能用';
  }
}

export function CheckoutCouponField({
  code,
  onCodeChange,
  onApply,
  state = { kind: 'idle' },
  disabled = false,
}: {
  code: string;
  onCodeChange: (v: string) => void;
  /** 🔴 沒給 ⇒ 鈕 disabled(片 B 就是這一態:框在、還沒接線)。 */
  onApply?: () => void;
  state?: CouponFieldState;
  disabled?: boolean;
}) {
  const busy = state.kind === 'checking';
  const canApply = onApply !== undefined && !disabled && !busy && code.trim() !== '';
  return (
    <div className="cart-coupon co-coupon">
      <label htmlFor="checkout-coupon-code">COUPON</label>
      <div className="cart-coupon-row">
        <input
          id="checkout-coupon-code"
          name="couponCode"
          type="text"
          inputMode="text"
          autoComplete="off"
          placeholder="輸入優惠碼"
          aria-label="優惠碼"
          value={code}
          disabled={disabled || busy}
          onChange={(e) => onCodeChange(e.target.value)}
          // 🔵 Enter 不送出整張結帳表單 —— 那會在客人以為「套用」時直接付款。
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (canApply) onApply?.();
            }
          }}
        />
        <button type="button" onClick={() => onApply?.()} disabled={!canApply}>
          {busy ? '確認中…' : '套用'}
        </button>
      </div>
      {state.kind === 'applied' ? (
        <div className="cart-coupon-ok" role="status">
          已套用,折抵 NT$ {state.discount.toLocaleString('en-US')}
        </div>
      ) : null}
      {state.kind === 'rejected' ? (
        <div className="auth-field-err" role="alert">
          {couponRejectMessage(state.reason, { minSpend: state.minSpend, subtotal: state.subtotal })}
        </div>
      ) : null}
    </div>
  );
}
