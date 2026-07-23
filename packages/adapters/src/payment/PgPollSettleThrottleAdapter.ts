/**
 * @module @pcm/adapters/payment/PgPollSettleThrottleAdapter — poll-settle throttle 主軌(M-3 3DS-S2b)
 *
 * **🔴 server-only + @pcm/adapters/server subpath**(同 PgChargeAttemptAdapter:持 `PAYMENT_CONFIRMER_DB_URL`
 * raw DB credential、pg 不污染 root barrel)。連線安全完全複用 `buildPgConfig`(session pooler + 完整 CA 驗證 +
 * host 釘死 + 顯式 servername);per-request `new Client()` + `finally end()`。
 *
 * 呼 3DS-S2b 窄權 RPC `claim_order_poll_settle(orderId, throttleSeconds)`(payment_confirmer 唯一可呼;
 * 原子 per-order throttle)。🔴 **最終 predicate(R1c2 `20260624120009` CREATE OR REPLACE)**:
 * `(pending/charged 受 非manual + ceiling<8) OR (released 繞 manual/ceiling)`,**所有狀態**仍受 `order unpaid` + 節流窗限制。
 * RETURNS boolean:true=放行(caller 可呼 settleCharge)/ false=被 throttle(skip)。
 *
 * 錯誤紀律(對齊 PgChargeAttemptAdapter PF-E):不轉傳 pg 原始 message;throw 通用訊息(零 PII/credential)。
 *
 * @see supabase/migrations/20260621120000_m3_3ds_s2b_poll_settle_throttle.sql(基線)
 * @see supabase/migrations/20260624120009_m3_3ds_r1c2_poll_settle_released_predicate.sql(最終 released 繞閘版)
 * @see docs/specs/2026-06-21-m3-3ds-s2b-poll-settle-throttle-plan.md §6.2
 */
import 'server-only';

import { Client } from 'pg';
import type { IPollSettleThrottle } from '@pcm/ports';
import type { OrderId } from '@pcm/domain';
import { buildPgConfig, type PgClientLike } from './PaymentConfirmerAdapter';

/** 本層 RPC 回應解析錯誤(branded:sanitizeError 憑類別放行、不靠「無 code」啟發式)。 */
class PollSettleParseError extends Error {}

function defaultClientFactory(connectionString: string): PgClientLike {
  return new Client(buildPgConfig(connectionString)) as unknown as PgClientLike;
}

export class PgPollSettleThrottleAdapter implements IPollSettleThrottle {
  constructor(
    private readonly connectionString: string,
    private readonly clientFactory: (
      connectionString: string,
    ) => PgClientLike = defaultClientFactory,
  ) {}

  /** 原子 per-order throttle claim;RPC 回 boolean(true=放行 / false=被 throttle);非 boolean → throw 通用。 */
  async claimPollSettle(orderId: OrderId, throttleSeconds: number): Promise<boolean> {
    return this.run(async (client) => {
      const res = await client.query(
        'SELECT public.claim_order_poll_settle($1::uuid, $2::integer) AS result',
        [orderId, throttleSeconds],
      );
      const result = res.rows[0]?.result;
      if (typeof result !== 'boolean') {
        throw new PollSettleParseError('claim_order_poll_settle 回應格式異常');
      }
      return result;
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

/** 通用訊息(零 pg 原文/PII/credential);本層 parse 錯誤憑 branded 類別原樣放行(pg 也丟無 code 的 plain Error)。 */
function sanitizeError(err: unknown): Error {
  if (err instanceof PollSettleParseError) {
    return err; // 本層 throw(已通用、無 pg 原文)
  }
  return new Error('poll-settle throttle 主軌失敗');
}
