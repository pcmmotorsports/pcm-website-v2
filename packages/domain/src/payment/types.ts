/**
 * @see backlog #11 — TapPay-specific type 位置純度待 M-3-08 重檢。
 *
 * 嚴格 ports 純度應放 packages/ports/src/tappay/types.ts;
 * 本 slice 暫放 domain/payment/types.ts、M-3-08 寫 ITapPayAdapter 實作時跟 adapter 一起重檢、
 * 不單獨開 slice 改。
 */

import type { Money } from '../shared/types';
import type { OrderId } from '../order/types';

/**
 * ChargeStatus: 金流交易結果狀態(domain enum)。
 *
 * 命名為 PCM 業務語意('succeeded' / 'failed')、非 TapPay wire 字串;
 * adapter 邊界做 wire ↔ domain mapping。
 */
export type ChargeStatus = 'succeeded' | 'failed';

/**
 * Cardholder: 持卡人資訊(TapPay charge 必填)。包含 PII(email / phoneNumber)。
 *
 * @see backlog #16 — PII logging mask 規範待 M-3-08 寫實作前補
 * @see M-3-08 ITapPayAdapter 實作:logging 必 mask PII、rawResponse 不可直接寫 log
 */
export type Cardholder = {
  name: string;
  email: string;
  phoneNumber?: string;
};

/**
 * TapPayChargePayload: charge use-case 輸入(M-3-08 結帳用)。
 */
export type TapPayChargePayload = {
  /** TapPay client SDK 產的 prime token */
  prime: string;
  amount: Money;
  orderId: OrderId;
  cardholder: Cardholder;
};

/**
 * TapPayChargeResult: charge use-case 結果。
 *
 * `rawResponse` 保留 TapPay wire 原樣、供 audit log;不在 storefront 顯示。
 */
export type TapPayChargeResult = {
  status: ChargeStatus;
  /** TapPay rec_trade_id 等交易識別字串 */
  transactionId: string;
  /** 原始回應、audit 用、不解析業務語意 */
  rawResponse: unknown;
};

/**
 * TapPayRefundPayload: refund use-case 輸入。
 *
 * `amount` 不填表示全額退、填表示部分退。
 */
export type TapPayRefundPayload = {
  transactionId: string;
  amount?: Money;
};

/**
 * TapPayRefundResult: refund use-case 結果。
 */
export type TapPayRefundResult = {
  status: ChargeStatus;
  refundId: string;
  /** 原始回應、audit 用 */
  rawResponse: unknown;
};
