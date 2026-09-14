import 'server-only';
import type { EmailOutboxEventType } from './IEmailOutbox';
import type { SendEmailResult } from './IEmailSender';

/**
 * ⟦line-PUSH⟧ 2026-09-14 —— 訂單通知走 LINE 推播(Sean 逐字「我希望之後可以做到訂單確認發送通知」)。
 * plan `docs/plans/2026-09-14-line-friend-and-order-push-plan.md`。
 *
 * 🔴 **結果型別借 `SendEmailResult`,不另造一套**:sweeper 對「送出去了 / 沒送出去、哪個碼」的處置
 *    (計數、`markSent` / `markFailed`、退避、額度告警)一份就好 —— LINE 的 429 落 `http_429`
 *    ⇒ 走既有 `quota_24h` 政策,`quotaFailed` 那顆計數自動算進去。
 * 🛑 **`providerMessageId` 對 LINE 恆 `null`**:push API 回 `{}`,request id 在 header,本 port 不承諾拿得到。
 */
export type LinePushInput = {
  /** LINE userId(`customers.line_user_id`);**不是** email。 */
  to: string;
  /** 純文字(`order-email-copy.ts` 的文案;不做 Flex)。 */
  text: string;
  /** 與 email 同一把:`{eventType}/{outboxId}`。adapter 拿 `outboxId` 當 `X-Line-Retry-Key`(LINE 官方重試冪等 header,24h)。 */
  idempotency: { eventType: EmailOutboxEventType; outboxId: string };
};

export interface ILinePushSender {
  /** 合約同 `IEmailSender.send`:**可預期的失敗走 `failed`,不 throw**;throw = 合約違反。 */
  push(input: LinePushInput): Promise<SendEmailResult>;
}

/**
 * 寄送當下「這張單的客人現在能不能收 LINE」。
 * 🔴 **寄送當下才查,不用排信時凍住的值**(理由同 `IOrderCurrentRecipient`:好友狀態會變,`unfollow` 會清空)。
 * · `friend`      ⇒ 推到 `lineUserId`。
 * · `not_friend`  ⇒ 沒有 userId 或已封鎖 ⇒ 呼叫端**不推**(處置:同「收件人已不是那個」那條路)。
 * · `unavailable` ⇒ 讀不到 ⇒ fail-closed 不推、放回重試。「我不知道」與「他不是好友」是兩件事。
 */
export type LineRecipientResult =
  | { kind: 'friend'; lineUserId: string }
  | { kind: 'not_friend' }
  | { kind: 'unavailable' };

export interface ILineRecipientReader {
  getLineRecipient(input: { orderId: string }): Promise<LineRecipientResult>;
}
