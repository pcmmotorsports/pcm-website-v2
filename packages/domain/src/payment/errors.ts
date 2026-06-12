/**
 * @module @pcm/domain/payment/errors — 付款確認 domain 錯誤
 *
 * 鏡像 identity/auth.ts `AuthError` + order/errors.ts `OrderError` 慣例:domain 命名 code + Error 子類。
 * `PaymentConfirmerAdapter` 把 pg 錯誤分類後 `throw new PaymentConfirmError(code, msg)`;
 * confirm-payment use-case 依 `err.code` 決定孤兒處置(可測、對齊鐵則 10「bug 可追蹤性」、非比 message 字面)。
 *
 * @see packages/domain/src/order/errors.ts:OrderError(同型別慣例)
 * @see docs/specs/2026-06-12-m3-stage2-2-tappay-adapter-plan.md §6 SHOULD ③(confirm 失敗分類)
 */

/**
 * 付款確認錯誤 domain code。
 *
 * - `unreachable`:連線層失敗(connect/transport/timeout、語句被取消等)→ confirm RPC 不確定有無執行、
 *   **可重呼 confirm(冪等)**;charge 已扣款、勿重 charge。
 * - `rejected`:confirm RPC 主動 RAISE(業務拒絕:金額不符 / 非 unpaid / rec 重用…、SQLSTATE P0001)→
 *   **孤兒對帳**、勿重 charge、勿重 confirm(會再被拒)。
 */
export type PaymentConfirmErrorCode = 'unreachable' | 'rejected';

/**
 * PaymentConfirmError:付款確認 domain 錯誤。
 *
 * `code` 為 domain 分類(非 pg 錯誤碼);use-case 只看 `code` 映 ConfirmPaymentOutcome、不解析 message。
 * 🔴 PF-E:RPC RAISE 原文為單一通用訊息(不洩 total/狀態);本 Error 不轉傳 pg 原始 message 給前端。
 */
export class PaymentConfirmError extends Error {
  constructor(
    readonly code: PaymentConfirmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentConfirmError';
  }
}
