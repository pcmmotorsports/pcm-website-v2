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
 * 🔴 TapPay 官方 pay-by-prime cardholder 之 name/email/phone_number 皆標必填(*);PCM domain
 * 三欄一律必填(對齊官方 + 移除 email/name 必填而 phone 可選之不對稱)。phoneNumber 來源 = 結帳
 * 地址 phone(②-③ 組裝、恆有);型別層必填 = fail-closed 強制 ②-③ 供 phone、adapter 不送空字串。
 *
 * @see backlog #16 — PII logging mask 規範待 M-3-08 寫實作前補
 * @see M-3-08 ITapPayAdapter 實作:logging 必 mask PII、rawResponse 不可直接寫 log
 */
export type Cardholder = {
  name: string;
  email: string;
  phoneNumber: string;
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
  /**
   * TapPay 回報的「實扣金額」(wire `amount` + `currency` → domain Money)。
   *
   * 🔴 M-3 階段②-② PF-X3 在地金額防竄改縱深(webhook 對帳在 ②-⑥):confirm-payment use-case
   * 比對 `amount === server read-back orders.total`、不符即不 confirm、回孤兒 `amount_mismatch`
   * (全鏈唯一驗「TapPay 真扣了 total」之處)。adapter 邊界 wire→domain:`toMoneyAmount(wire.amount)`
   * + 斷言 `currency='TWD'`(單位斷言;非 TWD 視為金額異常)。整數比對、零浮點。
   */
  amount: Money;
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

// ── M-3 階段②-②b:confirm(付款確認)型別 ────────────────────────────────────

/**
 * ConfirmOrderPaymentInput:payment_confirmer 窄權 confirm RPC 輸入(IPaymentConfirmer port)。
 *
 * 對齊 `confirm_order_payment(p_order_id uuid, p_amount integer, p_rec_trade_id text)`;
 * adapter 取 `amount.amount`(整數元位)餵 p_amount integer、`orderId` 餵 p_order_id、`recTradeId` 餵 p_rec_trade_id。
 */
export type ConfirmOrderPaymentInput = {
  orderId: OrderId;
  /** server read-back orders.total(Money、整數元位、client 永不送價);adapter 取 amount.amount 餵 p_amount。 */
  amount: Money;
  /** TapPay rec_trade_id(charge 成功的 transactionId)。 */
  recTradeId: string;
};

/**
 * ConfirmOrderPaymentResult:confirm RPC 回 DTO(對齊 RPC `RETURNS jsonb {confirmed, idempotent}`)。
 *
 * 🔴 鐵則 12(PF-G):**不帶 total / 價結構**;只回成功與否 + 是否冪等重放。
 */
export type ConfirmOrderPaymentResult = {
  confirmed: boolean;
  /** true = 重放冪等 no-op(已 paid + 同 rec + 同 amount);false = 本次真翻 unpaid→paid。 */
  idempotent: boolean;
};

/**
 * ConfirmPaymentInput:confirm-payment use-case 輸入(編排 begin 佔鎖 → charge → markCharged 雙軌 → PF-X3 → confirm → 收斂補記;②-③c-2)。
 *
 * `amount` = server read-back orders.total(單一金額來源):同時餵 charge amount 與 confirm p_amount,
 * client 永不送價(鐵則 12);PF-X3 = use-case 比對 charge 實扣 == 此 amount。
 */
export type ConfirmPaymentInput = {
  prime: string;
  orderId: OrderId;
  amount: Money;
  cardholder: Cardholder;
};

/**
 * ConfirmPaymentOutcome:confirm-payment use-case 結果(🔴 孤兒單契約、MUST-FIX 2)。
 *
 * - `paid`:charge 成功 + 實扣金額符 + confirm 成功(`idempotent` 標重放 no-op)→ 完成頁。
 * - `charge_failed`:charge 業務失敗(卡拒等、status≠0)、**未扣款**(recordPersisted:true 才可立即重試;false 見變體註解)。
 * - `charge_unknown`:charge transport 失敗(網路/timeout)、扣款狀態未知、**無 rec_trade_id** → 勿重刷
 *   (②-⑥ webhook 經 order_number 對帳自癒)。
 * - `orphan`:charge 已扣款但無法確認(實扣≠total / confirm 連線層失敗 / confirm RPC 拒)→ ②-③ 回
 *   「付款已收、處理中、勿重複付款」+ 寫 charge-attempt 紀錄(`transactionId`+`orderId`);
 *   重試走「重呼 confirm 冪等」**非重 charge**;前端成功真相 = `paid`(非 charge.status)。
 *   `reason` 供 ②-③/②-⑥ 對帳分類(連線層=可重 confirm、RPC 拒/金額不符=孤兒對帳)。
 */
export type ConfirmPaymentOutcome =
  | { kind: 'paid'; idempotent: boolean }
  /**
   * `recordPersisted`(round5 MF1):卡拒後「已知未扣款」是否 durable 落 DB(markFailed 釋鎖成功)。
   * false = 主軌 ×3 全敗、pending 鎖殘留 → ②-③e 映 charge_failed_wait(誠實「未扣款 + 請稍候再試」、
   * 不誘導立即重試;per-user 閘 10 分鐘自動過期、殭屍 pending 列 ②-⑥ 清);true = 可立即重試。
   */
  | { kind: 'charge_failed'; recordPersisted: boolean }
  | { kind: 'charge_unknown'; orderId: OrderId }
  | {
      kind: 'orphan';
      reason: 'amount_mismatch' | 'confirm_unreachable' | 'confirm_rejected';
      transactionId: string;
      orderId: OrderId;
    }
  /**
   * `locked`:佔 charge 鎖失敗、**零扣款**(②-③a begin RPC、PF-X2;plan v6 §2/§6):
   * - `user_in_flight`:同會員另一筆未解決付款 10 分鐘內進行中(Q2=A 閘)→ ②-③e 映
   *   in_flight 態(不帶 displayId、不得回「付款已收」語意 —— 此請求的新單沒刷過卡)。
   * - `order_locked`:同單已有 active attempt(pending/charged)→ 映 processing(勿重複付款)。
   * - `not_unpaid`:order 非 unpaid(已 paid 等;與撞鎖同層級、RPC 不洩具體狀態)→ 映 processing。
   */
  | { kind: 'locked'; reason: ChargeLockReason };

/** begin_charge_attempt 拒絕理由(②-③a RPC `{acquired:false, reason}` 對應、plan v6 §2)。 */
export type ChargeLockReason = 'user_in_flight' | 'order_locked' | 'not_unpaid';

/**
 * BeginChargeAttemptResult:佔 per-order charge 鎖結果(IChargeAttemptStore.begin、②-③a begin RPC DTO)。
 *
 * 🔴 `fallbackToken`:備軌一次性權杖(round4 MF2)— DB 只存 sha256 hash、此明文**只活在 server
 * 記憶體**(use-case → 複合 adapter → 備軌 RPC 參數),絕不回 client、絕不入 log。
 */
export type BeginChargeAttemptResult =
  | { acquired: true; attemptId: string; fallbackToken: string }
  | { acquired: false; reason: ChargeLockReason };

/**
 * MarkChargeAttemptChargedInput:PF-X1 麵包屑寫入(charge 成功、confirm 前;雙鍵驗 attemptId+orderId
 * 對齊 ②-③a RPC、round6)。`fallbackToken` 供備軌(主軌忽略;不入 log)。
 */
export type MarkChargeAttemptChargedInput = {
  attemptId: string;
  orderId: OrderId;
  recTradeId: string;
  fallbackToken: string;
};

/** MarkChargeAttemptFailedInput:卡拒(明確未扣款)釋鎖(雙鍵驗;僅主軌 — 備軌不可釋鎖)。 */
export type MarkChargeAttemptFailedInput = {
  attemptId: string;
  orderId: OrderId;
};
