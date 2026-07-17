/**
 * IEmailSender:交易信寄送 port(M-4a Email 通知片 E1b;plan v3.1 §3.5-2/§5)。
 *
 * 與告警管道 `IAlertNotifier`(#250、固定收件者、失敗 throw)刻意拆港:本 port 寄**客戶**交易信、
 * 收件者逐封不同、失敗**回結構化結果不 throw**(outbox 狀態機需要錯誤碼落表退避重試,throw 會把
 * 「可重試失敗」與「程式錯誤」混流)。
 *
 * 🔴 REQUIRED-E1b(migration `20260717020000` §⑤/§⑦、plan v3.1 §4 差異表):
 * - `errorCode` 走**有限 allowlist**(`EmailSendErrorCode`,定義見 IEmailOutbox)。
 *   ⚠️ **前版寫「= `last_error_code` 值域」= 假字面**(E2a-a 關卡2 codex must-fix;與
 *   `IEmailOutbox.ts` 同款、上輪只補了那一檔 = 同款前科第 6 次):`last_error_code` 欄另可合法
 *   存 adapter 內部寫死的稽核碼 `order_ineligible`(S3=A 抑制終態)與 `lease_reclaimed`(E2a-a
 *   lease 回收)——兩者皆**非「sender 產出的寄送失敗」**、不經本 union。
 *   **本 union = sender 產出的失敗碼值域**;欄的真實值域 = 本 union ∪ {`order_ineligible`,
 *   `lease_reclaimed`}(🔴 日後若要把 `last_error_code` **讀回**成型別,不得直接套本 union、會漏兩碼)。
 *   **非 allowlist HTTP status / 其他無法歸類的失敗 → `provider_error`**
 *   (⚠️ codex 關卡2 R2 nit:前版「未知一律 `provider_error`」與下方破例的「**未知 429 `name` →
 *   `http_429`**」字面衝突 —— 未知 429 是**明列例外**、不落 `provider_error`)。
 *   **原則:禁**由 provider 回應的任意 `.message`/body 轉碼。
 *   🔴 **`.message` 永不參與轉碼、永不外傳 —— 此條無例外。**
 * - 🔴 **窄幅破例(E1c;Sean 2026-07-17 Q6=A 授權)**:僅 `status === 429` 時,adapter 得解析 body
 *   判別三種 429(rate limit / 日額度 / 月額度)。**精確範圍(codex 關卡2 nit)**:`json()` 會解析
 *   **整份** body;解析後**僅存取頂層 `name`**,且**只有 `name` 可影響分類結果**;其他欄位
 *   (尤其 `message`)不得存取、不得進入任何 sink。邊界與殘餘風險見 `ResendEmailSenderAdapter`
 *   檔頭「§ 窄幅破例」。**定性 = 授權下的破例、不是「原則從未被違反」**(codex 關卡1 must-fix:
 *   後者是話術 —— `res.json()` 必然緩衝整份 body,「不讀」≠「不使用」)。
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
