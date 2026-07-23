// focus-first-error.ts — 結帳付款第一錯誤聚焦(M-3 兩步結帳 Slice U4b)
//
// 定位:design §7.2 末三條——「完成錯誤集合後,捲動並聚焦第一個可聚焦錯誤;其他紅字仍保留」+
//   「TapPay iframe 無法直接聚焦內部 input 時,聚焦該欄的可存取容器並捲至該區」。
//   本檔是純 DOM 副作用函式(零 React),React 接線在 hooks/useFirstErrorFocus.tsx、驗證在
//   validate-checkout-payment.ts。抽出理由 = 鐵則 6:聚焦邏輯不塞進已達上限的 CheckoutView。
//
// 🔴 只讀 errors + 對既有節點 focus/scrollIntoView,**不改任何 state、不 query iframe document**(plan U4b ⑥)。

import type { CheckoutPaymentErrorKey, CheckoutPaymentErrors } from './validate-checkout-payment';

/**
 * U4b 新建的可聚焦容器 DOM id(單一真相,供 registry + TapPayCardFields + CheckoutStep2ReviewSections 共用,
 * 避免 registry 與元件各寫一份字面而漂移;尤其防「wrapper id `checkout-card-number` vs 紅字 span id
 * `checkout-card-number-error` 只差尾綴」的誤指陷阱)。
 */
export const PAYMENT_FOCUS_TARGET_IDS = {
  /** 收件摘要「編輯」鈕(shipping.address / notificationEmail 導引回 Step1;Step2 無此兩欄位)。 */
  shippingSummaryEdit: 'checkout-shipping-summary-edit',
  /** 付款模組外層(.co-card-form;card.module = SDK 載入中/失敗/矛盾態的可聚焦容器)。 */
  paymentModule: 'checkout-payment-module',
  /** 三卡欄各自的可聚焦容器(iframe 無法直接聚焦內部 input → 聚焦此外層 role=group 容器)。 */
  cardNumber: 'checkout-card-number',
  cardExpiry: 'checkout-card-expiry',
  cardCcv: 'checkout-card-ccv',
} as const;

/**
 * 固定聚焦順序(plan U4b ⑤ 逐字);key → 可聚焦容器 DOM id。
 * 🔴 invoice.* / terms 沿用既有欄位 id(CheckoutStep2 / CheckoutStep2ReviewSections 產生);
 *   整合測試會實測「聚焦落在正確元素」→ 任何 id 漂移會被抓到。
 */
export const PAYMENT_ERROR_FOCUS_ORDER: readonly (readonly [CheckoutPaymentErrorKey, string])[] = [
  ['shipping.address', PAYMENT_FOCUS_TARGET_IDS.shippingSummaryEdit],
  ['notificationEmail', PAYMENT_FOCUS_TARGET_IDS.shippingSummaryEdit],
  ['invoice.title', 'checkout-invoice-title'],
  ['invoice.taxId', 'checkout-invoice-tax-id'],
  ['invoice.donateCode', 'checkout-invoice-donate-code'],
  ['card.module', PAYMENT_FOCUS_TARGET_IDS.paymentModule],
  ['card.number', PAYMENT_FOCUS_TARGET_IDS.cardNumber],
  ['card.expiry', PAYMENT_FOCUS_TARGET_IDS.cardExpiry],
  ['card.ccv', PAYMENT_FOCUS_TARGET_IDS.cardCcv],
  ['terms', 'checkout-agree'],
];

/**
 * 依固定順序,聚焦並捲動到第一個「有錯 **且真的可聚焦**」的欄位;其餘紅字不動。
 *
 * 🔴 codex 關卡1:`focus()` 後必須驗 `doc.activeElement === el` —— 節點存在但 disabled / hidden /
 *   inert / 被 CSS 隱藏 / 誤指到不可聚焦的 `<span>`(id 尾綴陷阱)時,`focus()` 是 no-op,
 *   不可就此停手,要繼續找下一個候選,否則違反「第一個**可聚焦**錯誤」。
 * 🔴 節點不存在(如發票類型未選 company → title input 不在 DOM)→ 跳下一個、不 throw。
 * 🔴 formError-only 情境(valid=false 但 errors map 為空;今日 UI 不可達)→ 無 keyed target、回 null。
 *
 * @param errors 完整合併錯誤 map(卡片 + 非卡片)。
 * @param doc 注入點(測試用);預設 document。
 * @returns 聚焦成功的 error key;全部無錯或都不可聚焦 → null。
 */
export function focusFirstPaymentError(
  errors: CheckoutPaymentErrors,
  doc: Document = document,
): CheckoutPaymentErrorKey | null {
  for (const [key, id] of PAYMENT_ERROR_FOCUS_ORDER) {
    if (errors[key] === undefined) continue;
    const el = doc.getElementById(id);
    if (!el) continue;
    // 🔴 preventScroll(Fable N1):先無捲動聚焦,再由 scrollIntoView({block:'center'}) 統一捲動,
    //   避免瀏覽器 focus 預設的 nearest-scroll 與 center-scroll 兩段跳動。
    el.focus({ preventScroll: true });
    if (doc.activeElement !== el) continue; // 存在但不可聚焦 → 找下一個
    el.scrollIntoView?.({ block: 'center' });
    return key;
  }
  return null;
}
