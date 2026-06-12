/**
 * @module @pcm/adapters/payment/PgChargeAttemptAdapter — charge 簿記/鎖 RPC 主軌(M-3 ②-③b)
 *
 * **🔴 server-only + @pcm/adapters/server subpath**(同 PaymentConfirmerAdapter:持
 * `PAYMENT_CONFIRMER_DB_URL`、pg 不污染 root barrel;Q1=A 簿記 RPC 沿用 payment_confirmer 同鑰匙)。
 *
 * 連線安全完全複用 `buildPgConfig`(session pooler + 完整 CA 驗證 + host 釘死 + 顯式 servername、
 * ②-②b-fix 全套縱深);per-request `new Client()` + `finally end()`。
 *
 * 呼叫 ②-③a 三支主軌 RPC:`begin_charge_attempt` / `mark_charge_attempt_charged` /
 * `mark_charge_attempt_failed`(雙鍵驗 attemptId+orderId)。
 * 🔴 `fallbackToken` 主軌**刻意不用**(僅備軌 RPC 參數)、絕不入 query/錯誤訊息/log。
 *
 * 錯誤紀律(PF-E):不轉傳 pg 原始 message;throw 通用訊息 + 安全的 SQLSTATE `code` 屬性
 * (供複合 adapter 辨識 P0001 業務拒絕早停重試;SQLSTATE 無 PII/token)。
 *
 * @see supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql
 * @see docs/specs/2026-06-12-m3-stage2-3-charge-action-plan.md §2/§6
 */
import 'server-only';

import { Client } from 'pg';
import type { IChargeAttemptStore } from '@pcm/ports';
import type {
  BeginChargeAttemptResult,
  MarkChargeAttemptChargedInput,
  MarkChargeAttemptFailedInput,
  OrderId,
} from '@pcm/domain';
import { buildPgConfig, type PgClientLike } from './PaymentConfirmerAdapter';

/** SQLSTATE:plpgsql RAISE EXCEPTION 預設碼(②-③a RPC 業務拒絕走此;複合 adapter 據此早停重試)。 */
export const PG_BUSINESS_REJECT = 'P0001';

/** 帶安全 SQLSTATE 的簿記錯誤(message 通用、code 供分類;零 pg 原文/token)。 */
export type ChargeAttemptError = Error & { code?: string };

/** 本層 RPC 回應解析錯誤(branded:sanitizeError 憑類別放行、不靠「無 code」啟發式)。 */
class ChargeAttemptParseError extends Error {}

function defaultClientFactory(connectionString: string): PgClientLike {
  return new Client(buildPgConfig(connectionString)) as unknown as PgClientLike;
}

export class PgChargeAttemptAdapter implements IChargeAttemptStore {
  constructor(
    private readonly connectionString: string,
    private readonly clientFactory: (
      connectionString: string,
    ) => PgClientLike = defaultClientFactory,
  ) {}

  async begin(orderId: OrderId): Promise<BeginChargeAttemptResult> {
    return this.run(async (client) => {
      const res = await client.query('SELECT public.begin_charge_attempt($1::uuid) AS result', [
        orderId,
      ]);
      return parseBeginResult(res.rows);
    });
  }

  async markCharged(input: MarkChargeAttemptChargedInput): Promise<void> {
    // 🔴 fallbackToken 不入主軌 query(僅備軌 RPC 參數);雙鍵驗 attemptId+orderId(round6)。
    await this.run((client) =>
      client.query('SELECT public.mark_charge_attempt_charged($1::uuid, $2::uuid, $3::text)', [
        input.attemptId,
        input.orderId,
        input.recTradeId,
      ]),
    );
  }

  async markFailed(input: MarkChargeAttemptFailedInput): Promise<void> {
    await this.run((client) =>
      client.query('SELECT public.mark_charge_attempt_failed($1::uuid, $2::uuid)', [
        input.attemptId,
        input.orderId,
      ]),
    );
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

/** 解析 begin RPC jsonb `{acquired, attempt_id?, fallback_token?, reason?}`;形狀不符 → throw(action 通用字面)。 */
function parseBeginResult(rows: Array<Record<string, unknown>>): BeginChargeAttemptResult {
  const r = rows[0]?.result as
    | { acquired?: unknown; attempt_id?: unknown; fallback_token?: unknown; reason?: unknown }
    | undefined;
  if (!r || typeof r.acquired !== 'boolean') {
    throw new ChargeAttemptParseError('begin_charge_attempt 回應格式異常');
  }
  if (r.acquired) {
    if (typeof r.attempt_id !== 'string' || typeof r.fallback_token !== 'string') {
      throw new ChargeAttemptParseError('begin_charge_attempt 回應格式異常');
    }
    return { acquired: true, attemptId: r.attempt_id, fallbackToken: r.fallback_token };
  }
  if (r.reason !== 'user_in_flight' && r.reason !== 'order_locked' && r.reason !== 'not_unpaid') {
    throw new ChargeAttemptParseError('begin_charge_attempt 回應格式異常');
  }
  return { acquired: false, reason: r.reason };
}

/** 通用訊息 + 安全 SQLSTATE(零 pg 原文/PII/token;本層 parse 錯誤憑 branded 類別放行 —— pg 也會丟
 *  無 code 的 plain Error〔Connection terminated 等〕、不可用「無 code」啟發式、code-reviewer minor 修)。 */
function sanitizeError(err: unknown): ChargeAttemptError {
  if (err instanceof ChargeAttemptParseError) {
    return err; // 本層 throw(已通用、無 pg 原文)
  }
  const code = (err as { code?: unknown } | null)?.code;
  const e: ChargeAttemptError = new Error(
    `charge 簿記主軌失敗(${typeof code === 'string' ? code : 'transport'})`,
  );
  if (typeof code === 'string') {
    e.code = code;
  }
  return e;
}
