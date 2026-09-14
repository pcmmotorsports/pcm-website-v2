/**
 * @module @pcm/adapters/line/LinePushSenderAdapter — ⟦line-PUSH⟧ 訂單通知的 LINE 推播(2026-09-14)
 *
 * **🔴 server-only**:持 LINE Messaging API channel access token(敏感、絕不進 client bundle)。
 *
 * 🔴 **與 `payment/LineAlertNotifierAdapter` 同一支 API、同一個 token、不同對象**:
 *    那支 `to` 寫死在 config(老闆告警);這支 `to` 每一發不同(客人的 `line_user_id`)。
 *    刻意**不去改那支**(它是告警的路,出事時通知我們的那條;動它要另一片 + 它自己的測試)。
 * 🔴 **合約同 `IEmailSender`:可預期的失敗回 `failed` + 碼,不 throw** —— sweeper 對 email / LINE
 *    只有一套處置(計數、mark、退避、額度告警)。
 *    · 429 ⇒ `http_429`(LINE 的月配額 / 速率都回 429;走既有 `quota_24h` 政策 ⇒ `quotaFailed` 會算到它)
 *    · 5xx ⇒ `http_5xx` 對應碼;其餘 4xx ⇒ 對應碼或 `provider_error`
 *    · fetch throw(逾時 / 網路)⇒ `network_error`
 * 🛑 **零 PII / 零密鑰**:不 log、不把 token / userId / 內文放進任何 Error。
 * 🔵 純文字一則,LINE 上限 5000 字;`order-email-copy.ts` 的文案遠小於它,這裡照 `fitToLineBudget` 的精神硬截 + 省略號。
 */
import 'server-only';
import type { ILinePushSender, LinePushInput, SendEmailResult, EmailSendErrorCode } from '@pcm/ports';
import { OUTBOUND_SEND_TIMEOUT_MS } from '../outbound-timeout';

export type FetchLike = (
  input: string,
  // 🔴 `signal` 必填(⟦mail-FETCHTIMEOUT⟧):漏傳的那一支不會型別紅,而它的症狀是「送出去之後永遠不回」。
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
/** LINE text message 上限 5000 字元;留一點餘裕給省略號。 */
const LINE_TEXT_MAX = 4990;

export type LinePushSenderConfig = {
  /** LINE Messaging API channel access token(server-only 密鑰;與告警那支同一顆 env `LINE_CHANNEL_ACCESS_TOKEN`)。 */
  accessToken: string;
};

const STATUS_CODES: Readonly<Record<number, EmailSendErrorCode>> = {
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

export function lineStatusToErrorCode(status: number): EmailSendErrorCode {
  return STATUS_CODES[status] ?? 'provider_error';
}

export class LinePushSenderAdapter implements ILinePushSender {
  constructor(
    private readonly cfg: LinePushSenderConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async push(input: LinePushInput): Promise<SendEmailResult> {
    const text = input.text.length > LINE_TEXT_MAX ? `${input.text.slice(0, LINE_TEXT_MAX)}…` : input.text;
    let res: { ok: boolean; status: number };
    try {
      res = await this.fetchImpl(LINE_PUSH_ENDPOINT, {
        method: 'POST',
        signal: AbortSignal.timeout(OUTBOUND_SEND_TIMEOUT_MS),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.cfg.accessToken}`,
          // 🔵 LINE 官方的重試冪等鍵(同一把 key 24h 內重送不會重複推播)—— 與 email 同一把字面。
          'X-Line-Retry-Key': retryKey(input.idempotency),
        },
        body: JSON.stringify({
          to: input.to,
          messages: [{ type: 'text', text }],
        }),
      });
    } catch {
      return { kind: 'failed', errorCode: 'network_error' };
    }
    // 🔴 **409 = 這把 `X-Line-Retry-Key` 已經被 provider 接受過**(官方重試規則:同一把 key 24h 內重送回 409,
    //    表示第一發已收到、不要再送)⇒ 對本列而言 provider 已接受過一則 ⇒ 回 `sent`,不是失敗。
    //    ⚠️ 「接受過」不等於「這一輪的內容送達了」—— 收到的是第一發的內容;呼叫端對單號那一格照這個處置(sweeper 那段)。
    //    ⛔ 我第一版回 `failed/http_409` ⇒ 回應遺失那一次重試會拿 409、一路重試到 attempts 用完 ⇒
    //      **一則已送達的通知被記成死信**(codex 2026-09-14 R1 must-fix 1)。
    //    🛑 只收斂 **LINE 這一支**,不動 email 共用的 `http_409` 政策(Resend 的 409 有三種、不同命)。
    if (res.status === 409) {
      return { kind: 'sent', providerMessageId: null };
    }
    if (!res.ok) {
      return { kind: 'failed', errorCode: lineStatusToErrorCode(res.status) };
    }
    // 🛑 request id 在 response header,本 FetchLike 不讀 header ⇒ 恆 null(port 有寫);body 不用。
    return { kind: 'sent', providerMessageId: null };
  }
}

/**
 * `X-Line-Retry-Key` 要是 UUID 格式;我們的冪等字面是 `{eventType}/{outboxId}` 而 outboxId 就是 uuid
 * ⇒ 直接用 outboxId(同一列重送 = 同一把 key;不同事件型別是不同列 ⇒ 不會撞)。
 * ⚠️ 官方只保證 24h;窗過之後再重送 = 可能第二則(at-least-once 的既有界線,與 email 那側同一句)。
 */
function retryKey(idem: LinePushInput['idempotency']): string {
  return idem.outboxId;
}
