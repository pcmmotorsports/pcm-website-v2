// validate-checkout-payment.ts — 結帳付款前的非卡片驗證與錯誤仲裁(M-3 兩步結帳 Slice U3b)
//
// 定位:design §7.1「點擊確認付款時先做純前端檢查,不呼叫 TapPay getPrime,也不呼叫 server action」
//   的純函式核心。UI 接線在 CheckoutView / CheckoutStep2 / CheckoutPaymentFeedback,
//   本檔零 React、零 DOM,可單獨單元測試。
//
// 🔴 發票 / Email 規則的唯一真相 = @pcm/schemas 的 canonical schema(U3a);本檔**不重寫第二套規則**,
//   一律以 `createCheckoutInputSchema(flag).safeParse` 取得 issues 後逐欄轉成 UI 用的 error map。
//
// 🔴 U3a 立的消費端硬規則:**不得以 `issues[0]` 當欄位錯誤來源,必須逐欄建 map**
//   (issue 陣列順序不保證;flag-on 時發票錯誤會排在 notificationEmail 之前,已實測)。
//   見 packages/schemas/src/index.ts 的 CheckoutInvoiceInput 註解。
//
// 🔴 雙通道(鏡像 server `charge-actions.ts:125-142` 的既有語意,不自創第三種形狀):
//   逐欄 `errors` map + 整表層級 `formError`。map 為空**不等於**通過 —— 對不上固定 key 的 issue
//   (例:invoice.type 被竄改、shippingMethod 非法)必須仍然擋下付款(fail-closed),
//   由 `valid` 旗標承擔放行判斷、`formError` 承擔訊息。若改以 `Object.keys(errors).length===0`
//   當放行條件 = fail-open 破口。

import { createCheckoutInputSchema } from '@pcm/schemas';
import type { InvoiceDraft } from '@/components/CheckoutStep2';

/** 錯誤 key 固定集合(plan U3b §⑤)。`card.*` 由 U4a 填入,U3b 只定義不產生。 */
export type CheckoutPaymentErrorKey =
  | 'shipping.address'
  | 'notificationEmail'
  | 'invoice.title'
  | 'invoice.taxId'
  | 'invoice.donateCode'
  | 'card.module'
  | 'card.number'
  | 'card.expiry'
  | 'card.ccv'
  | 'terms';

export type CheckoutPaymentErrors = Partial<Record<CheckoutPaymentErrorKey, string>>;

export type NonCardValidationResult = {
  /** 🔴 放行判斷的唯一依據(非 errors 是否為空;見檔頭雙通道說明)。 */
  valid: boolean;
  errors: CheckoutPaymentErrors;
  /** errors 為空但 valid=false 時承接訊息;否則 null。 */
  formError: string | null;
};

/** 條款未勾的文案 = server `charge-actions.ts:171` 同一句(client/server 不得各說各話)。 */
export const TERMS_REQUIRED_MESSAGE = '請先閱讀並同意服務條款與隱私政策';
/** 對不上固定 key 時的整表層級 fallback = server `charge-actions.ts:142` 同一句。 */
export const GENERIC_CHECKOUT_MESSAGE = '結帳資料有誤,請返回確認';

/** invoice 三個可出錯欄位(切換發票類型時的清除範圍)。 */
const INVOICE_ERROR_KEYS = ['invoice.title', 'invoice.taxId', 'invoice.donateCode'] as const;

/** zod issue path → 固定 error key;對不上回 null(由 valid/formError 走 fail-closed)。 */
function issuePathToKey(path: readonly PropertyKey[]): CheckoutPaymentErrorKey | null {
  const [p0, p1] = path;
  if (p0 === 'addressId') return 'shipping.address';
  if (p0 === 'notificationEmail') return 'notificationEmail';
  if (p0 === 'invoice') {
    if (p1 === 'title') return 'invoice.title';
    if (p1 === 'taxId') return 'invoice.taxId';
    if (p1 === 'donateCode') return 'invoice.donateCode';
  }
  return null;
}

export type ValidateNonCardInput = {
  addressId: string | undefined;
  invoice: InvoiceDraft;
  notificationEmailEnabled: boolean;
  notificationEmail: string;
  agreed: boolean;
};

/**
 * 非卡片欄位驗證(收件地址 / 通知 Email / 當前發票類型必要欄位 / 條款)。
 *
 * 🔴 `shipping.address` 與 `notificationEmail` 在 Step 2 的 UI 上**不可達**
 *   (addressId 恆為 server 來的 UUID;Email 已由 CheckoutView.goNext 在 Step1→2 轉場擋下)。
 *   保留是為鏡像 server 契約的 defense-in-depth,**不宣稱它們擋得住什麼**。
 */
export function validateNonCardFields({
  addressId,
  invoice,
  notificationEmailEnabled,
  notificationEmail,
  agreed,
}: ValidateNonCardInput): NonCardValidationResult {
  const schema = createCheckoutInputSchema(notificationEmailEnabled);
  const parsed = schema.safeParse({
    addressId,
    shippingMethod: 'home', // Q1=A 僅宅配;UI 無此選項故不可能出錯,真出錯走 formError fail-closed
    invoice,
    ...(notificationEmailEnabled ? { notificationEmail } : {}),
  });

  const errors: CheckoutPaymentErrors = {};
  if (!parsed.success) {
    // 🔴 逐欄建 map(非 issues[0]);同一欄有多個 issue 時取「屬於該欄的第一個」,不吃陣列順序。
    for (const issue of parsed.error.issues) {
      const key = issuePathToKey(issue.path);
      if (key && errors[key] === undefined) errors[key] = issue.message;
    }
  }
  if (!agreed) errors.terms = TERMS_REQUIRED_MESSAGE;

  const valid = parsed.success && agreed;
  const formError = valid || Object.keys(errors).length > 0 ? null : GENERIC_CHECKOUT_MESSAGE;
  return { valid, errors, formError };
}

/** 移除指定 key(🔴 真的 delete,不可設成 undefined —— 否則錯誤計數與 `in` 檢查仍會算到)。 */
export function clearErrorKeys(
  errors: CheckoutPaymentErrors,
  keys: readonly CheckoutPaymentErrorKey[],
): CheckoutPaymentErrors {
  const next: CheckoutPaymentErrors = { ...errors };
  for (const key of keys) delete next[key];
  return next;
}

/**
 * 發票內容變動時的錯誤清除(design §7.2「使用者修正某欄時,只清除該欄錯誤」)。
 * - type 變了 → 清三個 invoice key(舊類型的錯誤對新類型無意義、且欄位已從畫面消失)。
 * - type 沒變 → **只清值真的變動的那一欄**(不得整批清,否則跨欄錯誤會被誤殺)。
 *
 * 🔴 地址自動帶入的 effect 也共用本函式做前後值 diff —— 不可改成「一律清三個」:
 *   `addresses` 陣列參照變動但發票值沒變時會誤清仍然有效的錯誤。
 */
export function clearInvoiceErrorsOnChange(
  errors: CheckoutPaymentErrors,
  prevInvoice: InvoiceDraft,
  nextInvoice: InvoiceDraft,
): CheckoutPaymentErrors {
  if (prevInvoice.type !== nextInvoice.type) return clearErrorKeys(errors, INVOICE_ERROR_KEYS);
  const changed: CheckoutPaymentErrorKey[] = [];
  if (prevInvoice.title !== nextInvoice.title) changed.push('invoice.title');
  if (prevInvoice.taxId !== nextInvoice.taxId) changed.push('invoice.taxId');
  if (prevInvoice.donateCode !== nextInvoice.donateCode) changed.push('invoice.donateCode');
  return changed.length > 0 ? clearErrorKeys(errors, changed) : errors;
}

export type PaymentAlertInput = {
  errors: CheckoutPaymentErrors;
  formError: string | null;
  /** getPrime 失敗訊息(View 自有 state)。 */
  primeError: string | null;
  /** charge hook 的可重試訊息(error / wait / in_flight);其餘狀態傳 null。 */
  chargeMessage: string | null;
  /** 🔴 上一輪 charge 訊息是否已被本輪 submit 淘汰(見 CheckoutView.handleSubmit 順序註解)。 */
  chargeMessageStale: boolean;
};

/**
 * 付款區**唯一** `role="alert"` 的文字仲裁(design §7.2「避免多個 assertive alert 一起朗讀」)。
 *
 * 優先序:逐欄錯誤摘要 → 整表 formError → getPrime 失敗 → 未過期的 charge 訊息。
 * 摘要採「數量 + 指路」式(Sean 2026-07-22 拍 Q1=A):逐欄紅字已各自顯示,摘要不重複列欄位名。
 */
export function buildPaymentAlert({
  errors,
  formError,
  primeError,
  chargeMessage,
  chargeMessageStale,
}: PaymentAlertInput): string | null {
  const count = Object.keys(errors).length;
  if (count > 0) return `還有 ${count} 個項目需要確認,已在上方標示`;
  if (formError) return formError;
  if (primeError) return primeError;
  return chargeMessageStale ? null : chargeMessage;
}
