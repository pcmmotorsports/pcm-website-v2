// usePaymentErrors.ts — 結帳非卡片錯誤的 state lifecycle(M-3 兩步結帳 Slice U3b)
//
// 🔴 抽出理由 = 鐵則 6:CheckoutView.tsx 是付款 orchestrator,開工時 357 行、硬上限 400。
//   U3b 接線實測會頂到 431 → 依 plan §5 預先指定的「第二刀」把錯誤 lifecycle 收進本 hook,
//   View 只留付款流程本身。U4a(card errors)、U5(focus/步驟列鎖)仍要往 View 加行,
//   本片不得把跑道吃光。
//
// 職責邊界:本 hook 只管「錯誤 map / 整表訊息 / 上一輪 charge 訊息是否過期」三份 state 與其清除規則;
//   **不做驗證**(驗證在 lib/checkout/validate-checkout-payment.ts 的純函式)、
//   **不碰付款流程**(getPrime / charge.submit 仍全留在 CheckoutView.handleSubmit)。

import { useCallback, useState } from 'react';
import {
  buildPaymentAlert,
  clearErrorKeys,
  clearInvoiceErrorsOnChange,
  type CheckoutPaymentErrorKey,
  type CheckoutPaymentErrors,
  type NonCardValidationResult,
} from '@/lib/checkout/validate-checkout-payment';
import type { InvoiceDraft } from '@/components/CheckoutStep2';
import type { ChargeState } from '@/hooks/useChargePayment';

export type UsePaymentErrors = {
  errors: CheckoutPaymentErrors;
  /** 按下確認付款後套用驗證結果(逐欄 map + 整表 formError 雙通道)。 */
  applyValidation: (result: NonCardValidationResult) => void;
  /** 修正某欄 → 只清該欄(design §7.2);整表 formError 一併失效。 */
  clearKeys: (keys: readonly CheckoutPaymentErrorKey[]) => void;
  /** 發票內容變動 → 以前後值 diff 決定清哪幾個 key(切類型清三個、同類型只清改動欄)。 */
  clearInvoiceKeys: (prevInvoice: InvoiceDraft, nextInvoice: InvoiceDraft) => void;
  /** 本輪 submit 被驗證擋下 → 淘汰上一輪 charge 訊息(防修完欄位後幽靈重現)。 */
  retireChargeMessage: () => void;
  /** 真正要送出刷卡的前一刻才解除(見 CheckoutView.handleSubmit 的順序註解)。 */
  resumeChargeMessage: () => void;
  /** 付款區唯一 role="alert" 的文字仲裁結果;null = 不渲染。 */
  alertFor: (input: { primeError: string | null; chargeState: ChargeState }) => string | null;
};

/** 發票是否真的被改動(純值比較;不讀 state,故可用於 stable callback 內)。 */
function invoiceFieldsChanged(prev: InvoiceDraft, next: InvoiceDraft): boolean {
  return (
    prev.type !== next.type ||
    prev.title !== next.title ||
    prev.taxId !== next.taxId ||
    prev.donateCode !== next.donateCode
  );
}

/** charge 六態中「可重試、需留頁顯示」的三態才有訊息;其餘(終態/導向/idle/submitting)無。 */
function retryableChargeMessage(state: ChargeState): string | null {
  return state.status === 'error' || state.status === 'wait' || state.status === 'in_flight'
    ? state.message
    : null;
}

export function usePaymentErrors(): UsePaymentErrors {
  const [errors, setErrors] = useState<CheckoutPaymentErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [chargeMessageStale, setChargeMessageStale] = useState(false);

  // 🔴 清除函式一律 **stable callback + functional update**、**不閉包 `errors`**(codex 關卡2 nit):
  //   閉包版在 concurrent / 中止 render 下可能讀到未提交的狀態;穩定 identity 也讓消費端的 effect
  //   可以正常把它列進 deps,不必再用 render 期指派的 ref 繞過。
  const clearInvoiceKeys = useCallback((prevInvoice: InvoiceDraft, nextInvoice: InvoiceDraft) => {
    setErrors((prev) => clearInvoiceErrorsOnChange(prev, prevInvoice, nextInvoice));
    // formError 是整表層級訊息:只有「發票內容真的變了」才失效。
    // auto-fill effect 的 deps 含 `addresses`,父層每次重渲染都會重跑它 ——
    // 無條件清會把 fail-closed 的整表訊息靜默抹掉(code-reviewer nit)。以純值比較判定、不讀 state。
    if (invoiceFieldsChanged(prevInvoice, nextInvoice)) setFormError(null);
  }, []);

  return {
    errors,
    applyValidation: (result) => {
      setErrors(result.errors);
      setFormError(result.formError);
    },
    clearKeys: (keys) => {
      setErrors((prev) => clearErrorKeys(prev, keys));
      setFormError(null);
    },
    clearInvoiceKeys,
    retireChargeMessage: () => setChargeMessageStale(true),
    resumeChargeMessage: () => setChargeMessageStale(false),
    alertFor: ({ primeError, chargeState }) =>
      buildPaymentAlert({
        errors,
        formError,
        primeError,
        chargeMessage: retryableChargeMessage(chargeState),
        // 🔴 淘汰只適用於 `error`(上一輪刷卡失敗、已被新一輪 submit 取代)。
        //   `wait` / `in_flight` 描述的是**當下仍成立的事實**(另一筆付款進行中 / 請稍候),
        //   被 validation 擋一次就讓它消失 = 客人失去唯一提示(code-reviewer nit)。
        chargeMessageStale: chargeMessageStale && chargeState.status === 'error',
      }),
  };
}
