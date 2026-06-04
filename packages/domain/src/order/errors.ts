/**
 * @module @pcm/domain/order/errors — 訂單 domain 錯誤
 *
 * 鏡像 identity/auth.ts `AuthError` 慣例:domain 命名 code union + Error 子類。
 * entity guard / build invariant / 雙軸狀態機違反一律 `throw new OrderError(code, msg)`;
 * code 可測、對齊鐵則 10「bug 可追蹤性」(測試斷言 `err.code` 而非脆弱比對 message 字面)。
 *
 * @see packages/domain/src/identity/auth.ts:AuthError(同型別慣例)
 * @see docs/specs/2026-06-04-m3-checkout-plan.md §5 鐵則 12 紅線
 */

/**
 * 訂單錯誤 domain code。
 *
 * - `invalid_quantity`:quantity 非整數 / < 1
 * - `invalid_amount`:金額非整數 / 負數(unitPrice / shippingFee / discountTotal / 計算結果)
 * - `currency_mismatch`:跨 item / order 金額 currency 不一致
 * - `empty_items`:訂單無品項
 * - `subtotal_mismatch`:subtotal ≠ Σ lineTotal(或 lineTotal ≠ unitPrice × qty)
 * - `total_mismatch`:total ≠ subtotal + shippingFee − discountTotal
 * - `invalid_snapshot`:快照欄缺失 / 非字串(title / sku / spec / variantSku / productId)
 * - `invalid_field`:caller 字串 / enum 欄非「純字串」(如 `new String()` wrapper 帶隱藏 toJSON、
 *   會在 `JSON.stringify(order)` 偷渡任意字串;id / customerId / tierAtCheckout / status 等)
 * - `invalid_display_id`:displayId 不符 `PCM-YYYY-NNNN`
 * - `illegal_payment_transition`:付款軸非法轉移(跳級 / 倒退 / 自我 / terminal 後)
 * - `illegal_fulfillment_transition`:出貨軸非法轉移(同上)
 */
export type OrderErrorCode =
  | 'invalid_quantity'
  | 'invalid_amount'
  | 'currency_mismatch'
  | 'empty_items'
  | 'subtotal_mismatch'
  | 'total_mismatch'
  | 'invalid_snapshot'
  | 'invalid_field'
  | 'invalid_display_id'
  | 'illegal_payment_transition'
  | 'illegal_fulfillment_transition';

/**
 * OrderError:訂單 domain 錯誤。
 *
 * `code` 為 domain 命名(非 wire / DB 錯誤碼);use-case / UI 只看 code、不解析 message。
 */
export class OrderError extends Error {
  constructor(
    readonly code: OrderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OrderError';
  }
}
