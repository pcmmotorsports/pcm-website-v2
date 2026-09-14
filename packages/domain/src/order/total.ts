/**
 * @module @pcm/domain/order/total — `orders.total` 那一條等式的 TS 唯一定義點(#953,plan 2026-09-14 §2-b)
 *
 * 🔴 **SQL 真相 = `orders_total_balances` CHECK**
 *    (`supabase/migrations/20260828100000_m4b_b1_orders_tax_and_invoice_requested.sql:281`
 *    逐字 `CHECK (total = subtotal + shipping_fee - discount_total + tax_total)`;
 *    P1 落地後真相搬到 `pcm_order_total()`,等式一字不變)。
 *    **改一邊必改另一邊** —— `total.test.ts` 的 parity 格把兩邊字面比一次,漂了就紅。
 * 🔴 本檔只收「四個數怎麼加」;**稅怎麼算**不在這裡(`tax.ts` / `manual-order-form.ts` / 兩支 RPC 各自的 `v_tax :=`)。
 * 🔵 五個 TS 落點都呼叫它:`order.ts` createOrder / assertOrderInvariant、`tax.ts` computeTax、
 *    `use-cases/order-email-copy.ts` 信件自檢、`admin manual-order-form.ts` 手動單試算。
 */
export type OrderTotalParts = {
  subtotal: number;
  shippingFee: number;
  discountTotal: number;
  taxTotal: number;
};

/** total = subtotal + shippingFee − discountTotal + taxTotal(與 SQL 那一句**同序**)。 */
export function orderTotal(p: OrderTotalParts): number {
  return p.subtotal + p.shippingFee - p.discountTotal + p.taxTotal;
}
