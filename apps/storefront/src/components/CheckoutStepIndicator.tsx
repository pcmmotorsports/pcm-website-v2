'use client';

// CheckoutStepIndicator.tsx — 結帳步驟指示器(M-3 兩步結帳 U1)
//
// 自 CheckoutView 抽出(鐵則 6 降體積);step domain 收斂為 `1 | 2` 的單一型別來源。
//
// 🔴 business override `checkoutTwoStepFlow`(Sean 已批准、非 design 原樣搬運):
//   design-reference/components/CheckoutPage.jsx 為三步(收件資料 / 付款方式 / 確認訂單);
//   兩步版真權威 = docs/specs/2026-07-20-m3-two-step-checkout-design.md §5(Step 2 = 發票與付款)。
//   .co-steps / .co-step / .co-step-num / .co-step-label 結構與 CSS 沿用 design 字面、只減一格。
//
// 導覽規則(承既有三步版行為):只有「已完成」步驟可回點;handler 內另有 `step > s.n` 守門
//   (不單靠 disabled 屬性)。
// 🔴 a11y(codex nit + code-reviewer R2 修正):當前步驟原本是「可聚焦、可按、但完全無反應」的
//   button = 看似可操作的無效控制。修法**不是**把它設成 `disabled`——多數螢幕閱讀器不朗讀
//   disabled 控制項、且會移出 tab 順序,`aria-current` 反而永遠念不到(R2 指出的代價)。
//   採業界標準:當前步驟保持可聚焦,以 `aria-current="step"`(我在這一步)+ `aria-disabled`
//   (此刻不可動作)朗讀,handler 由 `step > s.n` 守門 no-op;
//   **未完成步驟**才是真的不可用 → 保留原生 `disabled`(不可 tab、不可點)。

/** 結帳步驟 domain(U1 起只有兩步;唯一型別來源、消費端不得自行擴充第三步)。 */
export type CheckoutStep = 1 | 2;

const STEPS: { n: CheckoutStep; l: string }[] = [
  { n: 1, l: '收件資料' },
  { n: 2, l: '發票與付款' },
];

export type CheckoutStepIndicatorProps = {
  step: CheckoutStep;
  /** 只有已完成步驟會呼叫(回點上一步);當前步驟與未完成步驟皆不觸發。 */
  onStepChange: (step: CheckoutStep) => void;
  /** U5 縱深守門(Fable F1):付款進行中(submitting)即使遮罩被 Esc×2 短暫關閉,步驟列也不作動、
   *  不退回 Step 1;與付款鈕同源 submitting、非第二套鎖來源。遮罩 CheckoutPaymentOverlay 為主鎖。 */
  locked?: boolean;
};

export function CheckoutStepIndicator({ step, onStepChange, locked }: CheckoutStepIndicatorProps) {
  return (
    <div className="co-steps">
      {STEPS.map((s) => {
        const state = step > s.n ? 'is-done' : step === s.n ? 'is-active' : '';
        return (
          <button
            key={s.n}
            className={`co-step ${state}`}
            onClick={() => { if (!locked && step > s.n) onStepChange(s.n); }}
            disabled={step < s.n}
            aria-current={state === 'is-active' ? 'step' : undefined}
            aria-disabled={step <= s.n ? true : undefined}
          >
            <span className="co-step-num">{state === 'is-done' ? '✓' : String(s.n).padStart(2, '0')}</span>
            <span className="co-step-label">{s.l}</span>
          </button>
        );
      })}
    </div>
  );
}
