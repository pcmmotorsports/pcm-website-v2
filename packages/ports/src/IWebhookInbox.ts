import type { DueWebhookEvent, WebhookEventInput } from '@pcm/domain';

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

  // ── M-3 3DS-4 sweeper(expire_webhook_events_at_ceiling / claim_due_webhook_events / mark_webhook_*、3DS-4a-1)──

  /**
   * 🔴 ceiling-expirer(claim **前置**、防孤兒;3DS-4a-1)。達 ceiling 且 lease 到期仍未 processed/manual → 轉
   * needs_manual_review。回轉換筆數(>0 = sweeper 告警)。**sweepSettlements 每輪 claim 前必呼**(plan §5.2③)。
   */
  expireEventsAtCeiling(): Promise<number>;

  /**
   * 🔴 原子 lease claim 未處理 inbox(FOR UPDATE SKIP LOCKED + LIMIT;3DS-4a-1)。
   *
   * 每筆 attempt_count++(claim token)+ 5min lease;濾 processed=false AND 非 manual AND attempt_count<ceiling
   * AND lease 到期。回 `DueWebhookEvent[]`(空陣列=本輪無 due);sweeper 各筆呼 settleCharge → mark*。
   */
  claimDueEvents(limit: number): Promise<DueWebhookEvent[]>;

  /**
   * settle 達 terminal/no_attempt 後標 processed;🔴 token guard(`processed=false AND attempt_count=claimedCount AND 非 manual`)。
   *
   * 回 affected(`1`=已標 / `0`=stale〔被另一 run 重領 count 變〕或已轉人工 row late mark = no-op、不覆寫)。
   */
  markProcessed(recTradeId: string, claimedCount: number): Promise<number>;

  /**
   * pending outcome 退避 retry;🔴 token guard 同上 + 退避 next_retry_at + 達 ceiling→needs_manual_review。
   *
   * `reasonCode` 寫 last_error(RPC 端 allowlist 強制、零 PII;非 allowlist→'unknown')。回 affected(`1`/`0` no-op)。
   */
  markRetry(recTradeId: string, claimedCount: number, reasonCode: string): Promise<number>;
}
