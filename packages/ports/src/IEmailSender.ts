/**
 * IEmailSender:交易信寄送 port(M-4a Email 通知片 E1b;plan v3.1 §3.5-2/§5)。
 *
 * 與告警管道 `IAlertNotifier`(#250、固定收件者、失敗 throw)刻意拆港:本 port 寄**客戶**交易信、
 * 收件者逐封不同、失敗**回結構化結果不 throw**(outbox 狀態機需要錯誤碼落表退避重試,throw 會把
 * 「可重試失敗」與「程式錯誤」混流)。
 *
 * 🔴 REQUIRED-E1b(migration `20260717020000` §⑤/§⑦、plan v3.1 §4 差異表):
 * - `errorCode` 走**有限 allowlist**(`EmailSendErrorCode`,定義見 IEmailOutbox=last_error_code
 *   值域);未知一律 `provider_error`。**禁**由 provider 回應的任意 `.message`/body 轉碼。
 * - 冪等鍵**不收自由字串**(codex 關卡2 R1 must-fix:任意字串會被誤餵 orderId/dedupKey/亂數 →
 *   跨列碰鍵或失去 crash 重送保護)→ 收結構化 `idempotency` 座標,由 adapter 組
 *   `<event_type>/<outbox_id>` 字面(plan §3.5-2)。
 */
import type { EmailOutboxEventType, EmailSendErrorCode } from './IEmailOutbox';

export type SendEmailInput = {
  /** 收件者(已過假信箱 gate 的真實信箱;PII、絕不入 log/錯誤訊息)。 */
  to: string;
  subject: string;
  /** 純文字內文(對齊 EmailAlertNotifierAdapter 慣例;HTML 版留 E3 需要時擴欄)。 */
  text: string;
  /**
   * 🔴 冪等座標(=該封信對應的 outbox 列):adapter 組 `<eventType>/<outboxId>` 當
   * Idempotency-Key。Resend 官方保留 24h(< 重試總跨度)→ 只是第一道網,DB 唯一鍵 +
   * `sent` 狀態不可省。
   */
  idempotency: {
    eventType: EmailOutboxEventType;
    outboxId: string;
  };
};

export type SendEmailResult =
  | { kind: 'sent' }
  | { kind: 'failed'; errorCode: EmailSendErrorCode };

export interface IEmailSender {
  /**
   * 寄一封交易信。可預期失敗(HTTP 非 2xx / transport / 畸形回應)→ 回 `failed` + 錯誤碼,
   * **不 throw**;由 caller(E2a sweeper / E3 after())決定 markFailed 退避。
   */
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
