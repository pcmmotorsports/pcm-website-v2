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

// #347-B(Sean 拍板 Q-347-B1=B):`order-number-search` 與 `supplier-order-no-search`
// 兩支模組連同它們的匯出**整支刪除** —— 兩個專用搜尋欄退場後全 repo 零 consumer。
// 🔴 它們存在的唯一理由是「值會被內插進 PostgREST 的 GET query string」需要字元集守門
//    (`.or()` 字串內插、`.eq()` 對保留字元不加引號)。關鍵字維度走 `.rpc()` = POST + JSON body,
//    值不進 URL、不參與 filter 語法拼接 ⇒ **那個威脅面本身消失了**,不是把守門拿掉不管。
//    完整對照見 `order/keyword-search.ts` 檔頭那段。

// 建立日期範圍的曆面換算(M-4b #347-3b;台北午夜邊界,adapter 與 3c UI 共用單一來源)
export {
  isoBackToTaipeiYmd,
  recentTaipeiMonthsRange,
  taipeiDayEndExclusiveIso,
  taipeiDayStartIso,
  taipeiYmdFromDayEndExclusive,
  taipeiYmdFromInstantIso,
} from './order/date-range';
// 八維度關鍵字搜尋正規化(M-4b #347-2a;解析層與 adapter `.rpc('admin_search_orders')` 前共用單一來源)
// 🔴 與上面兩支分立、不合併:本支**沒有**字元集守門(走 POST body、值不進 URL),
//    合成一支會讓它繼承那兩支的字元限制,把中文姓名與含標點的品名整組擋掉。
export type { OrderKeywordSearch, OrderKeywordSearchInvalidReason } from './order/keyword-search';
export {
  normalizeOrderKeywordSearch,
  MAX_ORDER_KEYWORD_LENGTH,
  OrderKeywordSearchShapeError,
} from './order/keyword-search';

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
// 🔴 N2(2026-07-30):`formatDisplayId` / `parseDisplayId` **已刪除**、故不再匯出。
//   產號從此只有一個生產者 = DB 的 `pcm_generate_display_id()`;TS 側不該能生單號。
//   驗證改為「新 6 碼 + 舊 PCM-YYYY-NNNN 兩收」(兩格式永久並存,Sean 拍板 Q1=A)。
export { isValidDisplayId, assertDisplayId } from './order/display-id';
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

// M-3 退款線第一片:refund 契約 runtime 值(barrel 為 export type * ⇒ 值必須顯式;比照 AuthError)
export { TAPPAY_REFUND_STATUS, TapPayRefundNotSentError } from './payment/types';

// payment 3DS-5a bank_transaction_id 產生器(純函式;5b initiate use-case charge 前產唯一對帳鍵)
export { generateBankTransactionId } from './payment/bank-transaction-id';

// M-3 #250 雙扣 anomaly 主動告警 domain 型別(零 PII 計數摘要 + 固定格式告警訊息)
export type { AnomalyAlertSummary, AnomalyAlertMessage } from './payment/anomaly-alert';

// 商品卡去白邊 bbox 共用 parser(trim 線 S4a;兩條卡片資料路單一收斂來源、plan 2026-07-19 §5)
export type { ImageTrim } from './catalog/image-trim';
export { parseImageTrim } from './catalog/image-trim';
