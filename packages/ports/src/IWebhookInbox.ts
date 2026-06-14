import type { WebhookEventInput } from '@pcm/domain';

/**
 * IWebhookInbox:②-⑥ webhook durable inbox port(M-3 3DS-2a;master plan v5 §3.2)。
 *
 * 實作 = `PgWebhookInboxAdapter`(@pcm/adapters/server、payment_confirmer 窄權直連、複用 buildPgConfig
 * 連線縱深)→ 呼 3DS-0a `record_webhook_event` RPC(`INSERT ON CONFLICT(rec_trade_id) DO NOTHING`)。
 *
 * 信任模型:notify **不可信**(無簽章)→ 本 port 只負責「durable 記錄收到了」(去重落地)、**不做成交判斷**
 * (成交權威走 settleCharge 內 Record API)。route(3DS-2b)durable insert 失敗 → 回 5xx 令 TapPay 重送
 * (絕不「沒落 DB 卻回 200」丟失);PII 由 route 先算 rawHash、本 port 零原文。
 */
export interface IWebhookInbox {
  /**
   * durable 落 inbox 去重;回 `true`=首見(需排程 settleCharge)/ `false`=重送(已存、no-op)。
   *
   * 失敗(連線/RPC RAISE)→ throw(通用訊息、零 pg 原文 PF-E);caller 視為「未 durable 落 DB」→ 回 5xx。
   */
  recordEvent(input: WebhookEventInput): Promise<boolean>;
}
