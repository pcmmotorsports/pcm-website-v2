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

/** 券碼欄今天的四種樣子。`checking` 是片 C 之後才會出現的過場。 */
export type CouponFieldState =
  | { kind: 'idle' }
  /** 片 C:客人按了套用 —— 碼記下來了, 而**折多少要等結帳那一刻 DB 回答**(這裡不試算, 理由見 CheckoutView)。 */
  | { kind: 'pending' }
  | { kind: 'checking' }
  | { kind: 'applied'; discount: number }
  /**
   * 片 D:結帳那一刻被 `create_order` 拒絕 —— 訊息已經由 `lib/checkout/coupon-reject.ts` 翻好。
   * 🔴 2026-09-14 codex R3 nit:⛔ ~~原本還有一個 `rejected`(帶 domain 理由、逐理由各講一句)~~ —— 沒有任何呼叫端,
   *    而那組逐理由文案正是跨片審查判 high 的東西(細分理由 = 券碼存在性 oracle)。留著會有人哪天接回去 ⇒ 刪。
   */
  | { kind: 'rejected-message'; message: string };

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
      {state.kind === 'pending' ? (
        <div className="cart-coupon-ok" role="status">
          結帳時會套用這張券
        </div>
      ) : null}
      {state.kind === 'applied' ? (
        <div className="cart-coupon-ok" role="status">
          已套用,折抵 NT$ {state.discount.toLocaleString('en-US')}
        </div>
      ) : null}
      {state.kind === 'rejected-message' ? (
        <div className="auth-field-err" role="alert">
          {state.message}
        </div>
      ) : null}
    </div>
  );
}
