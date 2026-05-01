import type {
  TapPayChargePayload,
  TapPayChargeResult,
  TapPayRefundPayload,
  TapPayRefundResult,
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
}
