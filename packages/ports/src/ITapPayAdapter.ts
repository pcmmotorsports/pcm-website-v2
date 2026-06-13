import type {
  TapPayChargePayload,
  TapPayChargeResult,
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
