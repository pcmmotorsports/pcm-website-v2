import type {
  TapPayChargePayload,
  TapPayChargeResult,
  TapPayInitiationPayload,
  TapPayInitiationResult,
  TapPayRefundPayload,
  TapPayRefundResult,
  TapPayRecordQuery,
  TapPayRecordResult,
} from '@pcm/domain';

/**
 * ITapPayAdapter: TapPay 金流 port。
 *
 * 對齊 PHASE-1-MILESTONES §6 M-3-08(TapPay sandbox 整合)。
 *
 * @see backlog #11 — TapPay-specific type 位置純度待 M-3-08 重檢
 */
export interface ITapPayAdapter {
  charge(payload: TapPayChargePayload): Promise<TapPayChargeResult>;
  /**
   * 3DS charge 啟動(M-3 3DS-5a):組 3DS body(`three_domain_secure` / `result_url` / caller 帶入唯一
   * `bankTransactionId`)→ 回 `payment_url` 跳轉網址 + `rec_trade_id`,**不請款、無實扣金額**。
   *
   * 🔴 與同步 `charge` 語意不同(獨立方法、不 overload):同步回「已扣款」、3DS 回「啟動待 OTP」。
   * 🔴 唯 `status===0 && payment_url && rec_trade_id` 回 `pending_3ds`;其餘(status≠0、含 421/timeout
   * 等模糊態 / HTTP 非 2xx / 格式異常)**一律 throw**(use-case 映 charge_unknown、不釋鎖;結算交 settleCharge /
   * Record API 唯一權威)。PII 零 log(payment_url 含 token query → 不入 log)。
   *
   * @see docs/specs/2026-06-19-m3-3ds-5ab-charge-initiate-plan.md §2.1
   */
  initiateThreeDSCharge(payload: TapPayInitiationPayload): Promise<TapPayInitiationResult>;
  refund(payload: TapPayRefundPayload): Promise<TapPayRefundResult>;
  /**
   * Record API 反查(M-3 3DS-1a):依交易識別鍵查 TapPay 交易紀錄、忠實解析 trade_records 白名單欄。
   *
   * 🔴 **不下裁決**(無「已付款」判斷):top status / record_status / is_captured / amount 等原值回給
   * 3DS-1b settleCharge,由 1b 套全條件判 paid(§1 step 2)。Record 失敗 / HTTP 非 2xx / 格式異常 → throw
   * (1b 映 pending 保留、不誤判 failed)。
   *
   * @see docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §1 / §7
   */
  recordQuery(query: TapPayRecordQuery): Promise<TapPayRecordResult>;
}
