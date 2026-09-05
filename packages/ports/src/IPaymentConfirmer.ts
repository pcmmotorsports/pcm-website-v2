import type { ConfirmOrderPaymentInput, ConfirmOrderPaymentResult, OrderId } from '@pcm/domain';

/**
 * IPaymentConfirmer:付款確認 port(M-3 階段②-②b)。
 *
 * 對齊 `confirm_order_payment(p_order_id, p_amount, p_rec_trade_id)` SECURITY DEFINER RPC
 * (migration 20260611120000)。實作 = `PaymentConfirmerAdapter`(payment_confirmer 窄權 DB 角色、
 * **pg 走 Supabase session pooler**〔直連 host IPv6-only、Vercel 連不到;以 payment_confirmer 直接登入
 * 無 SET ROLE、實測 pooler 呼 SECDEF 不斷〕+ 完整 CA 驗證、非 Supabase JS client、非 service_role)。
 *
 * 與 IOrderRepository 分離:confirm 走 payment_confirmer 窄權(只 EXECUTE confirm RPC、無 table 權限)、
 * 非 authenticated/service_role;故獨立 port(對齊安全鑰匙=丙、付款確認與建單 trust boundary 不同)。
 *
 * 失敗契約(SHOULD ③ 分類):
 * - 連線層失敗(connect/transport/timeout)→ throw `PaymentConfirmError('unreachable')`(可重呼 confirm 冪等)。
 * - confirm RPC RAISE(業務拒絕、SQLSTATE P0001)→ throw `PaymentConfirmError('rejected')`(孤兒對帳、不重 charge)。
 *
 * @see packages/adapters/src/payment/PaymentConfirmerAdapter.ts
 * @see supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql
 */
export interface IPaymentConfirmer {
  /**
   * 呼 confirm_order_payment RPC 翻 unpaid→paid(冪等)。
   *
   * 成功 → `{ confirmed, idempotent }`(idempotent=true 為重放 no-op);
   * 失敗 → throw `PaymentConfirmError`(分類見上;**不轉傳 pg 原始 message**、PF-E 通用)。
   */
  confirm(input: ConfirmOrderPaymentInput): Promise<ConfirmOrderPaymentResult>;
  /**
   * 呼 record_pending_invoice RPC 在成交(paid)點冪等記「該單待開票」(M-3 3DS-1b、S1=B、master plan §5)。
   *
   * 回 `true`=首記 / `false`=重入 no-op(ON CONFLICT DO NOTHING、order_id 冪等鍵);
 *
 * 🔴🔴 **2026-09-04:`false` 現在有【第三個來源】** —— `orders.invoice_requested = false`
 *    (= 這張單決定不開發票)⇒ 那支函式**安靜回 `false`**, 不建待開票列、不丟例外
 *    (`20260904224500` 那支 migration 改的;呼叫端是 best-effort, 丟例外會讓每一張正常的
 *     不開發票訂單被當成故障重試)。
 * ⚠️ **⇒ 所以「`false` = 重入」這句話【現在是假的】** —— 它可能是重入, 也可能是【不需要開票】。
 *    🛑 **今天沒有人讀這個回傳值**(`settleCharge` 是 `Promise<void>`)⇒ 疊第三個意思不痛;
 *    🔴 **而第一個要讀它的人打開的是【這裡】, 不是那支 migration** ⇒ 那句話必須寫在這裡。
 *    ⇒ 📌 **有人開始讀它的那一天, 先把這三種分開再讀。**0c RPC 內 fail-closed
   * 驗 orders.payment_status='paid'(非 paid → throw)。settleCharge **best-effort** 呼(throw 只 log、不翻 paid);
   * 同 payment_confirmer 窄權連線(0c 已 GRANT)。
   */
  recordPendingInvoice(orderId: OrderId): Promise<boolean>;
}
