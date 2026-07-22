'use client';

// CheckoutMobileBuybar.tsx — 結帳頁手機底部固定操作列(M-3 兩步結帳 Slice U3b 抽出)
//
// 🔴 抽出理由 = 鐵則 6(**非重構需求、行為零變更**):`CheckoutView.tsx` 是付款 orchestrator,
//   U3b 接完非卡片錯誤後頂到 401 行 / 上限 400。本區塊是純 presentational(零 state、零副作用、
//   全部行為由 props 注入)= plan U4a §④ 早已指定的外移候選之一,提前於 U3b 執行。
//   JSX 逐字搬移,class 名、DOM 結構、文案、handler 契約一律不變。
//
// 字面真權威 = design-reference/components/CheckoutPage.jsx 的 co-mobile-buybar 區塊(鐵則 1)。

export type CheckoutMobileBuybarProps = {
  /** 兩步 domain(型別源 CheckoutStepIndicator);決定顯示「目前金額」或「應付總額」與哪顆按鈕。 */
  step: 1 | 2;
  /** 應付總額(server-resolved;零 client 算價)。 */
  total: number;
  /** 送出中(submitting 或 prime 取得中)→ 按鈕文案改「處理中…」。 */
  submitting: boolean;
  /** Step 1 的「下一步」是否 disabled(未選收件地址)。 */
  nextDisabled: boolean;
  /** Step 2 的「確認付款」是否 disabled(**U4a 起只含 submitting**;`!agreed` 於 U3b、
   *  `!tappay.canGetPrime` 於 U4a 先後移除 —— design §7.3「未填完整仍可按、用錯誤導引取代 disabled」)。 */
  payDisabled: boolean;
  onNext: () => void;
  onSubmit: () => void;
};

export function CheckoutMobileBuybar({
  step,
  total,
  submitting,
  nextDisabled,
  payDisabled,
  onNext,
  onSubmit,
}: CheckoutMobileBuybarProps) {
  return (
    <div className="co-mobile-buybar">
      <div className="co-mobile-buybar-info">
        <div className="ap-mono">{step === 2 ? '應付總額' : '目前金額'}</div>
        <div className="co-mobile-buybar-price">NT$ {total.toLocaleString()}</div>
      </div>
      {step === 1 ? (
        <button className="btn-primary co-mobile-buybar-btn" onClick={onNext} disabled={nextDisabled}>
          下一步 <span>→</span>
        </button>
      ) : (
        <button className="btn-primary co-mobile-buybar-btn" onClick={onSubmit} disabled={payDisabled}>
          {submitting ? '處理中…' : '確認付款'}
        </button>
      )}
    </div>
  );
}
