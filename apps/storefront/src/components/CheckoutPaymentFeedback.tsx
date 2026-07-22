'use client';

// CheckoutPaymentFeedback.tsx — 付款區的唯一錯誤/狀態訊息出口(M-3 兩步結帳 Slice U3b)
//
// design §7.2 逐字:「付款區同時提供一個 `role="alert"` 的錯誤摘要,避免多個 assertive alert 一起朗讀。」
//   → 本元件是付款動作區**唯一**的 alert 節點,取代 U3b 之前 CheckoutView 內嵌的 stayMessage 區塊
//   (位置與 `.co-submit-error` class 皆不變、零 CSS 變更)。
//
// 🔴 抽出的第二個理由 = 鐵則 6:CheckoutView.tsx 開工時 357 行、硬上限 400,
//   摘要文字仲裁(buildPaymentAlert)與渲染都不留在 View 內。
//
// 🔴 誠實邊界:「付款區唯一 alert」僅在 TapPay `ready==='ready'` 的一般可達路徑成立。
//   `TapPayCardFields` 在 `ready==='error'` 時自帶一個 role="alert"(既有,U2a 之前就存在),
//   窄路徑下仍可能兩個 alert 並存 —— 該既有債由 U4a 併 `card.module` 摘要時收斂
//   (見 manifest open drift `checkoutAllErrorsAtOnce`)。本元件不宣稱全域唯一。

export type CheckoutPaymentFeedbackProps = {
  /** buildPaymentAlert 仲裁後的單一訊息;null = 不渲染任何節點(不留空殼)。 */
  message: string | null;
};

export function CheckoutPaymentFeedback({ message }: CheckoutPaymentFeedbackProps) {
  if (!message) return null;
  return (
    <p className="co-submit-error" role="alert">
      {message}
    </p>
  );
}
