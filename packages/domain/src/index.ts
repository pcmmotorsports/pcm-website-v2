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
export { resolveEnd } from './catalog/year-range';
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
export {
  calculateShippingFee,
  FREE_SHIPPING_THRESHOLD,
  HOME_SHIPPING_FEE,
} from './order/shipping';

// payment 確認 domain 錯誤(M-3 階段②-②b、confirm 失敗分類:unreachable=可重 confirm / rejected=孤兒)
export type { PaymentConfirmErrorCode } from './payment/errors';
export { PaymentConfirmError } from './payment/errors';

// payment 3DS-5a bank_transaction_id 產生器(純函式;5b initiate use-case charge 前產唯一對帳鍵)
export { generateBankTransactionId } from './payment/bank-transaction-id';

// M-3 #250 雙扣 anomaly 主動告警 domain 型別(零 PII 計數摘要 + 固定格式告警訊息)
export type { AnomalyAlertSummary, AnomalyAlertMessage } from './payment/anomaly-alert';
