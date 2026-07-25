// @pcm/domain — 9 個 bounded contexts 純邏輯, M-0-04 type stub 階段
//
// re-export 順序對齊依賴關係:shared(無依賴)→ catalog → identity → order → sync → payment

export type * from './shared/types';
export type * from './catalog/types';
export type * from './identity/types';
export type * from './identity/address';
export type * from './identity/vehicle';
export type * from './identity/wallet';
export type {
  AuthCredentials,
  AuthSignUpParams,
  AuthResult,
  AuthErrorCode,
} from './identity/auth';
export type * from './order/types';
export type * from './sync/types';
export type * from './payment/types';

// runtime helper re-export(規則見 ADR-0003 §3.1.1)
export { toMoneyAmount } from './shared/types';
export { resolveEnd, matchFitmentYear, isYearUnrestricted } from './catalog/year-range';
export { computeEffectivePrice } from './catalog/pricing';
export { designTierToSchema, schemaTierToDesign } from './shared/utils';
export { AuthError } from './identity/auth';
// 會員子資源歸屬錯誤(M-1-14e、#176:統一 ownership use-case typed error、取代 plain Error)
export type { NotOwnedResource } from './identity/ownership';
export { NotOwnedError } from './identity/ownership';

// admin 訂單篩選 code 形狀守門(M-4a D-1b;解析層與 adapter .or 內插前共用單一來源)
export { WORKFLOW_STATUS_CODE_RE } from './order/types';

// order entity runtime helper(M-3-S1)
export type { OrderErrorCode } from './order/errors';
export { OrderError } from './order/errors';
export {
  createOrder,
  createOrderItem,
  assertOrderItemInvariant,
  assertOrderInvariant,
} from './order/order';
export { createProductSnapshot, assertProductSnapshot } from './order/snapshot';
export {
  canPaymentTransition,
  canFulfillmentTransition,
  assertPaymentTransition,
  assertFulfillmentTransition,
  withPaymentStatus,
  withFulfillmentStatus,
} from './order/state-machine';
export {
  formatDisplayId,
  isValidDisplayId,
  assertDisplayId,
  parseDisplayId,
} from './order/display-id';
// order 運費規則(M-3-S2-b2、純函式;前台顯示鏡像、權威值由 create_order RPC §7 自算)
// 🔴 **`DEFAULT_SHIPPING_RULE` 刻意不從 barrel 匯出**(codex 關卡2 must-fix):
//   退刷線 Q6=B 要求退款重算只能用訂單凍結規則;若此處匯出,RF5 極易寫成
//   `?? DEFAULT_SHIPPING_RULE` 的 fallback = 悄悄退回「當下運費表」語意、拍板失效。
//   註解攔不住誤用 → **拿掉匯出**才攔得住(機制優先於規則文字)。
//   需要它的只有 `calculateShippingFee` 的預設參數與 #216 drift gate,兩者都在 domain 內部。
export {
  calculateShippingFee,
  FREE_SHIPPING_THRESHOLD,
  HOME_SHIPPING_FEE,
} from './order/shipping';
export type { ShippingRule } from './order/shipping';
// order 退款金額 + 運費重算引擎(M-3 退刷線 RF1、純函式;退款金額唯一 TS 權威)
export { computeRefundQuote } from './order/refund';
export type {
  RefundQuote,
  RefundQuoteInput,
  RefundQuoteLine,
  RefundQuoteRejection,
  RefundQuoteResult,
  RefundRemainingItem,
  RefundRequestItem,
  RefundShippingAdjustment,
} from './order/refund';

// payment 確認 domain 錯誤(M-3 階段②-②b、confirm 失敗分類:unreachable=可重 confirm / rejected=孤兒)
export type { PaymentConfirmErrorCode } from './payment/errors';
export { PaymentConfirmError } from './payment/errors';

// payment 3DS-5a bank_transaction_id 產生器(純函式;5b initiate use-case charge 前產唯一對帳鍵)
export { generateBankTransactionId } from './payment/bank-transaction-id';

// M-3 #250 雙扣 anomaly 主動告警 domain 型別(零 PII 計數摘要 + 固定格式告警訊息)
export type { AnomalyAlertSummary, AnomalyAlertMessage } from './payment/anomaly-alert';

// 商品卡去白邊 bbox 共用 parser(trim 線 S4a;兩條卡片資料路單一收斂來源、plan 2026-07-19 §5)
export type { ImageTrim } from './catalog/image-trim';
export { parseImageTrim } from './catalog/image-trim';
