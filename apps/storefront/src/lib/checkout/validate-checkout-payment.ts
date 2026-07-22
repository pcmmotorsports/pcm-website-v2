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
import type { TapPayCardState } from '@/hooks/useTapPayCard';

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

// ─────────────────────────────────────────────────────────────────────────────
// U4a:TapPay 卡片欄驗證(card.number / card.expiry / card.ccv / card.module)
// ─────────────────────────────────────────────────────────────────────────────

/** SDK 載入/設定失敗(`ready==='error'`);= U4a 之前 TapPayCardFields 內層 alert 的同一句,逐字不變。 */
export const CARD_MODULE_ERROR_MESSAGE = '付款模組暫時無法使用,請稍後再試或聯繫客服 LINE';
/** SDK 還在載入就按付款(Sean 2026-07-22 Q4=B:等就好,語氣與「要重打」區分)。 */
export const CARD_MODULE_LOADING_MESSAGE = '付款欄位載入中,請稍候';
/**
 * 三欄看似填妥、TapPay 卻回報不可取 prime(SDK 與欄位狀態不一致)。
 * 🔴 這句是**防死路**用的(Sean Q4=B):U4a 把 `!canGetPrime` 從按鈕鎖移除後,按鈕按得下去;
 *   若這條矛盾態沒有訊息通道,客人會遇到「按了完全沒反應」。鏡像非卡片端的 formError fail-closed。
 */
export const CARD_NOT_READY_MESSAGE = '卡片資訊尚未通過驗證,請重新確認卡號 / 有效期 / 安全碼';

/**
 * 逐欄文案(Sean 2026-07-22 Q2=B:**分兩態**,不分三態)。
 * - status 1(empty)與 3(typing)對客人是同一件事 = 繼續打 → 共用「請輸入完整X」。
 * - status 2(invalid)才是真的不同狀況(打完了但號碼不對)→「X不正確,請重新確認」。
 */
const CARD_FIELD_MESSAGES = {
  number: { incomplete: '請輸入完整卡號', invalid: '卡號不正確,請重新確認' },
  expiry: { incomplete: '請輸入完整有效期', invalid: '有效期不正確,請重新確認' },
  ccv: { incomplete: '請輸入完整安全碼', invalid: '安全碼不正確,請重新確認' },
} as const;

/** fieldStatus 的三個欄位 → 對應的固定 error key(不得改成字串拼接、否則 key 集合不再固定)。 */
const CARD_FIELD_KEYS = {
  number: 'card.number',
  expiry: 'card.expiry',
  ccv: 'card.ccv',
} as const satisfies Record<keyof TapPayCardState['fieldStatus'], CheckoutPaymentErrorKey>;

export type ValidateTapPayInput = {
  ready: TapPayCardState['ready'];
  canGetPrime: TapPayCardState['canGetPrime'];
  fieldStatus: TapPayCardState['fieldStatus'];
  /** 是否已按過確認付款(未按過不提早顯示逐欄紅字;plan U4a §⑤)。 */
  submitAttempted: boolean;
};

/**
 * TapPay 卡片欄驗證(design §7.1 第 2 點:「卡號、有效期、CVV 的 field status／**可取 prime 狀態**」)。
 *
 * 🔴 **card errors 每 render 由 live fieldStatus 衍生、不得永久存 state**(plan §⑤ 硬紅線):
 *   status 2→0 時該欄紅字自然消失,不需要第二套清除路徑,也不會與 SDK 真實狀態脫節。
 *
 * 🔴 `valid` 與 `submitAttempted` **無關**(後者只決定要不要「顯示」)。
 *   放行判斷一律用 `valid`,**不得**用「errors 是否為空」—— 未按過付款時 errors 恆為空但 valid 可能是 false,
 *   拿 map 當放行條件即 fail-open 破口(同 validateNonCardFields 的雙通道規則)。
 */
export function validateTapPayFields({
  ready,
  canGetPrime,
  fieldStatus,
  submitAttempted,
}: ValidateTapPayInput): { valid: boolean; errors: CheckoutPaymentErrors } {
  const fieldsAllValid =
    fieldStatus.number === 0 && fieldStatus.expiry === 0 && fieldStatus.ccv === 0;
  // fail-closed:loading 不過、status 3(typing)絕不視為 valid、1/2 不過、canGetPrime=false 不過。
  const valid = ready === 'ready' && canGetPrime && fieldsAllValid;

  const errors: CheckoutPaymentErrors = {};

  // 🔴 ready==='error' **不 gate submitAttempted**:U4a 之前 TapPayCardFields 一進畫面就顯示這句,
  //   改成「按了才顯」= 資訊倒退。此分支根本不渲染三個欄位,故不產逐欄錯誤。
  if (ready === 'error') {
    errors['card.module'] = CARD_MODULE_ERROR_MESSAGE;
    return { valid, errors };
  }
  if (!submitAttempted) return { valid, errors };

  if (ready === 'loading') {
    // iframe 尚未掛出、欄位不可能填 → 逐欄紅字無意義,只給模組層訊息。
    errors['card.module'] = CARD_MODULE_LOADING_MESSAGE;
    return { valid, errors };
  }

  for (const field of ['number', 'expiry', 'ccv'] as const) {
    const status = fieldStatus[field];
    if (status === 0) continue;
    errors[CARD_FIELD_KEYS[field]] =
      status === 2 ? CARD_FIELD_MESSAGES[field].invalid : CARD_FIELD_MESSAGES[field].incomplete;
  }
  // 三欄都沒錯卻仍不可取 prime → 必須有話講,否則按鈕按得下去但畫面毫無反應(死路)。
  if (Object.keys(errors).length === 0 && !canGetPrime) {
    errors['card.module'] = CARD_NOT_READY_MESSAGE;
  }
  return { valid, errors };
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
 * 優先序:**formError → 只有 card.module 時念全文 → 逐欄數量摘要 → getPrime 失敗 → 未過期的 charge 訊息**。
 * 摘要採「數量 + 指路」式(Sean 2026-07-22 拍 Q1=A):逐欄紅字已各自顯示,摘要不重複列欄位名。
 *
 * 🔴 **U4a 把 `formError` 提到最前面(排序改動,非新增分支)**。理由:
 *   U3b 時代 `validateNonCardFields` 保證「formError 非 null ⟹ 非卡片 errors 為空」,兩者互斥,
 *   所以數量排前面是安全的。**但 U4a 把卡片錯誤併進同一個 map 之後,互斥就破了** ——
 *   可能同時「formError 非 null」+「卡片 errors 有值」。此時若走數量格式,
 *   **formError 就完全沒有顯示表面**(它是整表層級訊息、沒有任何 inline 紅字位置)
 *   → 會變成「看到卡片紅字、修好、再按、還是被擋,永遠看不到真正原因」。
 *   ⚠️ **誠實範圍(codex 關卡2 更正)**:`formError` 只在「parse 失敗、且該 issue 的 path 對不上
 *   `issuePathToKey` 的固定 key」時才產生。**已驗證的來源只有 `invoice` 子樹上的未映射 path**
 *   (例:`invoice.type` 被竄改)。`addressId` 會被映射成 `shipping.address`、
 *   `shippingMethod` 是寫死的 `'home'` 字面 —— **兩者都產不出 formError**,先前列它們是錯的。
 *   而 `invoice.type` 竄改在今日 UI 不可達(要繞前端直打 server action)
 *   → 這是 **fail-closed 縱深的預防性重排,不是客人現在會遇到的故障**,別講成修了一個實際 bug。
 *   ⚠️ 對「只有非卡片錯誤」的既有情境是 **no-op**(互斥成立時兩種排序等價),已配回歸測試釘住。
 *
 * 🔴 **只有 `card.module` 一鍵時念全文**(Sean 2026-07-22 拍 Q3=B):模組掛掉/載入中/矛盾態
 *   不是客人「需要確認」的事(他做什麼都沒用),念「還有 1 個項目需要確認」是結構上有通知、
 *   語意上退化。與其他錯誤並存時仍走數量格式(那時客人確實有事要做)。
 */
export function buildPaymentAlert({
  errors,
  formError,
  primeError,
  chargeMessage,
  chargeMessageStale,
}: PaymentAlertInput): string | null {
  if (formError) return formError;
  const keys = Object.keys(errors);
  if (keys.length === 1 && keys[0] === 'card.module') return errors['card.module'] ?? null;
  if (keys.length > 0) return `還有 ${keys.length} 個項目需要確認,已在上方標示`;
  if (primeError) return primeError;
  return chargeMessageStale ? null : chargeMessage;
}
