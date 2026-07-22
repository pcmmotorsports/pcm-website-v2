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
// 🔴 U4a(2026-07-23)起本元件是**付款區唯一** alert:`TapPayCardFields` 內層那顆
//   `role="alert"`(ready==='error' 時)已移除,SDK 失敗改由 `card.module` 併入本元件的共用摘要
//   → design §7.2「避免多個 assertive alert 一起朗讀」在付款區已達成,並有守門測試
//   (該 <p> 不得有 role 屬性 + 元件層 queryAllByRole('alert')===0;突變讓它復活會轉紅)。
//   ⚠️ 仍**不宣稱全域唯一**:Step 1 另有自己的 alert,但兩者分屬不同步驟、不會並存。

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
