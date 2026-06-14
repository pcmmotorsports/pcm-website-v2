/**
 * @module @pcm/adapters/payment/PgWebhookInboxAdapter — ②-⑥ webhook durable inbox 主軌(M-3 3DS-2a)
 *
 * **🔴 server-only + @pcm/adapters/server subpath**(同 PgChargeAttemptAdapter:持
 * `PAYMENT_CONFIRMER_DB_URL`、pg 不污染 root barrel;webhook route 走 PAYMENT_CONFIRMER_DB_URL 同鑰、零新密鑰)。
 *
 * 連線安全完全複用 `buildPgConfig`(session pooler + 完整 CA 驗證 + host 釘死 + 顯式 servername、②-②b-fix
 * 全套縱深);per-request `new Client()` + `finally end()`。
 *
 * 呼叫 3DS-0a `record_webhook_event` RPC(`INSERT ON CONFLICT(rec_trade_id) DO NOTHING`、回 inserted boolean):
 * notify 不可信、本 adapter 只負責 durable 去重落地、**不做成交判斷**(權威走 settleCharge Record API)。
 *
 * 錯誤紀律(PF-E):不轉傳 pg 原始 message;throw 通用訊息 + 安全 SQLSTATE `code`(零 PII)。route(3DS-2b)
 * 接 throw → 視為「未 durable 落 DB」→ 回 5xx 令 TapPay 重送(at-least-once、不丟失)。
 *
 * @see supabase/migrations/20260613120000_m3_3ds_0a_webhook_events.sql
 * @see docs/specs/2026-06-14-m3-3ds-2-webhook-route-plan.md §3/§4
 * @see packages/ports/src/IWebhookInbox.ts
 */
import 'server-only';

import { Client } from 'pg';
import type { IWebhookInbox } from '@pcm/ports';
import type { WebhookEventInput } from '@pcm/domain';
import { buildPgConfig, type PgClientLike } from './PaymentConfirmerAdapter';

/** 帶安全 SQLSTATE 的 inbox 錯誤(message 通用、code 供辨識;零 pg 原文/PII)。 */
export type WebhookInboxError = Error & { code?: string };

/** 本層 RPC 回應解析錯誤(branded:sanitizeError 憑類別放行、不靠「無 code」啟發式)。 */
class WebhookInboxParseError extends Error {}

function defaultClientFactory(connectionString: string): PgClientLike {
  return new Client(buildPgConfig(connectionString)) as unknown as PgClientLike;
}

export class PgWebhookInboxAdapter implements IWebhookInbox {
  constructor(
    private readonly connectionString: string,
    private readonly clientFactory: (
      connectionString: string,
    ) => PgClientLike = defaultClientFactory,
  ) {}

  /**
   * durable 落 inbox 去重;回 true=首見 / false=重送(0a ON CONFLICT DO NOTHING)。
   *
   * 🔴 7 參數位置對齊 0a RPC 簽名;選填欄(notify 可能缺)以 `?? null` 傳 NULL。
   */
  async recordEvent(input: WebhookEventInput): Promise<boolean> {
    return this.run(async (client) => {
      const res = await client.query(
        'SELECT public.record_webhook_event($1::text, $2::text, $3::text, $4::integer, $5::integer, $6::text, $7::bigint) AS result',
        [
          input.recTradeId,
          input.orderNumber,
          input.rawHash,
          input.reportedStatus ?? null,
          input.amount ?? null,
          input.bankTransactionId ?? null,
          input.transactionTimeMillis ?? null,
        ],
      );
      return parseInsertedResult(res.rows);
    });
  }

  /** per-request 連線生命週期(connect → op → finally end;end throw 吞掉不蓋主錯誤)。 */
  private async run<T>(op: (client: PgClientLike) => Promise<T>): Promise<T> {
    let client: PgClientLike | undefined;
    try {
      client = this.clientFactory(this.connectionString);
      await client.connect();
      return await op(client);
    } catch (err) {
      throw sanitizeError(err);
    } finally {
      if (client) {
        try {
          await client.end();
        } catch {
          /* swallow:連線已斷時 end 可能 throw、不蓋過主錯誤 */
        }
      }
    }
  }
}

/** 解析 record_webhook_event RPC 回的 boolean(inserted);形狀不符 → throw(通用)。 */
function parseInsertedResult(rows: Array<Record<string, unknown>>): boolean {
  const result = rows[0]?.result;
  if (typeof result !== 'boolean') {
    throw new WebhookInboxParseError('record_webhook_event 回應格式異常');
  }
  return result;
}

/** 通用訊息 + 安全 SQLSTATE(零 pg 原文/PII;本層 parse 錯誤憑 branded 類別放行 —— pg 也會丟無 code 的
 *  plain Error、不可用「無 code」啟發式、對齊 PgChargeAttemptAdapter sanitizeError)。 */
function sanitizeError(err: unknown): WebhookInboxError {
  if (err instanceof WebhookInboxParseError) {
    return err; // 本層 throw(已通用、無 pg 原文)
  }
  const code = (err as { code?: unknown } | null)?.code;
  const e: WebhookInboxError = new Error(
    `webhook inbox 落地失敗(${typeof code === 'string' ? code : 'transport'})`,
  );
  if (typeof code === 'string') {
    e.code = code;
  }
  return e;
}
