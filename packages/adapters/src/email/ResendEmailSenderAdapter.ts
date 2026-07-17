/**
 * @module @pcm/adapters/email/ResendEmailSenderAdapter — 交易信寄送(M-4a Email 通知片 E1b)
 *
 * **🔴 server-only**:持 Resend API key(敏感、絕不進 client bundle)。鏡像 `EmailAlertNotifierAdapter`
 * (原生 fetch、零新依賴、config 注入不直讀 env),差異三點:
 * 1. 收件者逐封不同(客戶交易信、非固定告警收件者)→ `to` 在 send 入參、不在 config。
 * 2. 🔴 帶 `Idempotency-Key: <event_type>/<outbox_id>`(plan §3.5-2;官方保留 24h、只是第一道網,
 *    DB 唯一鍵 + sent 狀態不可省)。既有告警 adapter 無此 header(告警可重複、交易信不可)。
 * 3. 可預期失敗回結構化 `EmailSendErrorCode` 不 throw(outbox 需錯誤碼落表退避;throw 會把
 *    可重試失敗與程式錯誤混流)。
 *
 * 🔴 REQUIRED-E1b:錯誤碼**只**由 HTTP 狀態碼經固定映射表產生(非 allowlist 狀態 → `provider_error`、
 * transport 失敗 → `network_error`);**禁**讀 provider 回應 body/message 轉碼(可能含 PII,
 * DB regex 只是格式 backstop)。錯誤路徑零 PII:不 log 收件者、不把回應內容帶進任何結果。
 */
import 'server-only';

import type { IEmailSender, SendEmailInput, SendEmailResult, EmailSendErrorCode } from '@pcm/ports';
import type { FetchLike } from '../payment/LineAlertNotifierAdapter';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** HTTP 狀態 → 有限錯誤碼映射表(封閉;值受 EmailSendErrorCode union 型別檢查)。 */
const ERROR_CODE_BY_STATUS: Readonly<Record<number, EmailSendErrorCode>> = {
  400: 'http_400',
  401: 'http_401',
  403: 'http_403',
  404: 'http_404',
  408: 'http_408',
  409: 'http_409',
  422: 'http_422',
  429: 'http_429',
  500: 'http_500',
  502: 'http_502',
  503: 'http_503',
  504: 'http_504',
};

export type ResendEmailSenderConfig = {
  /** Resend API key(server-only 密鑰)。 */
  apiKey: string;
  /** 寄件者(需 Resend 已驗證網域;E1 定案 orders@pcmmotorsports.com、由 composition 從 env 注入)。 */
  from: string;
};

export class ResendEmailSenderAdapter implements IEmailSender {
  constructor(
    private readonly cfg: ResendEmailSenderConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    // 🔴 冪等鍵由本 adapter 組字面(codex 關卡2 R1:port 收結構化座標、不收自由字串,
    // 呼叫端無法誤餵 orderId/dedupKey/亂數)。
    const idempotencyKey = `${input.idempotency.eventType}/${input.idempotency.outboxId}`;
    try {
      const res = await this.fetchImpl(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.apiKey}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from: this.cfg.from,
          to: input.to,
          subject: input.subject,
          text: input.text,
        }),
      });
      // 回應形狀驗證留在 try 內(畸形回應/getter 拋錯 → fail closed,不外洩為程式錯誤)。
      if (res?.ok === true) {
        return { kind: 'sent' };
      }
      // 🔴 只看數字狀態碼、不讀回應 body;非映射表內(含畸形回應無 status)→ provider_error 兜底。
      const status = typeof res?.status === 'number' ? res.status : null;
      return {
        kind: 'failed',
        errorCode: status === null ? 'provider_error' : (ERROR_CODE_BY_STATUS[status] ?? 'provider_error'),
      };
    } catch {
      // transport 失敗(DNS / 連線 / 逾時)。🔴 刻意不讀 error.message 轉碼(REQUIRED-E1b)。
      return { kind: 'failed', errorCode: 'network_error' };
    }
  }
}
