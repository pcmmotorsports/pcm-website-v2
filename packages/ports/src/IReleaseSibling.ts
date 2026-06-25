/**
 * IReleaseSibling:立即重刷 preflight 的 release CAS port(M-3 3DS 乙路 R2b、canonical §2.3/§3/§4 R1a3)。
 *
 * 🔴 **server-only payment_confirmer**:實作(`PgReleaseSiblingAdapter`)走 payment_confirmer 窄權連線呼
 * `mark_charge_attempt_released_for_user(p_attempt_id,p_user_id,p_cart_session_id)`(SECDEF、`search_path=''`)。
 * 客人放棄該次付款且 settleCharge 確認當下 `auth_or_pending(4)` 時,把 attempt `pending→released`(退出
 * 去重/in-flight 鎖讓立即重刷;§2.2),留對帳集直到 terminal。
 *
 * 🔴 **四閘 CAS 鎖死歸屬**(DB 端):`customer_user_id=p_user_id` + `order.cart_session_id` 一致 +
 * `order.payment_status=unpaid` + `status='pending'`,任一不符 → rowcount=0。**不信 client 傳的取消訊號**;
 * userId 由 server 驗過的登入態傳入。
 *
 * 回傳 / 例外:`{released:true}`=CAS 成功放行重刷 / `{released:false}`=四閘任一否決(被 markCharged 搶先 /
 * 他 tab 已處理 / order 已 paid → use-case 重 settleCharge 裁決,**非業務 RAISE**);
 * **transport / 回應形狀不符 → throw**(use-case fail-closed hold)。
 */
export interface IReleaseSibling {
  release(
    attemptId: string,
    userId: string,
    cartSessionId: string,
  ): Promise<{ released: boolean }>;
}
