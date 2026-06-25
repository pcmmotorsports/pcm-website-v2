/**
 * @module @pcm/adapters/payment/PgReleaseSiblingAdapter — 立即重刷 release CAS 主軌(M-3 3DS 乙路 R2b)
 *
 * **🔴 server-only + payment_confirmer 窄權**(同 PgChargeAttemptAdapter:持 `PAYMENT_CONFIRMER_DB_URL`、
 * pg 不污染 root barrel;連線安全完全複用 `buildPgConfig`〔session pooler + 完整 CA 驗證 + host 釘死 +
 * 顯式 servername〕;per-request `new Client()` + `finally end()`)。
 *
 * 呼 §4 R1a3 release CAS RPC `mark_charge_attempt_released_for_user(p_attempt_id,p_user_id,p_cart_session_id)`
 * → 回 `{released:boolean}`(true=CAS 成功 pending→released / false=四閘任一否決,**非業務 RAISE**;
 * use-case 據 false 重 settleCharge 裁決,§2.3)。
 *
 * 錯誤紀律(對齊 PgChargeAttemptAdapter PF-E):不轉傳 pg 原始 message;throw 通用訊息 + 安全 SQLSTATE `code`
 * 屬性(零 PII/token)。release RPC 正常不 RAISE 業務拒絕(四閘走 rowcount=0→false);throw 僅 transport/parse。
 *
 * @see supabase/migrations/20260624120002_m3_3ds_r1a3_mark_charge_attempt_released_for_user.sql
 * @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §2.3 / §3 / §4 R1a3
 */
import 'server-only';

import { Client } from 'pg';
import type { IReleaseSibling } from '@pcm/ports';
import { buildPgConfig, type PgClientLike } from './PaymentConfirmerAdapter';

/** 帶安全 SQLSTATE 的 release 錯誤(message 通用、code 供分類;零 pg 原文/token)。 */
export type ReleaseSiblingError = Error & { code?: string };

/** 本層 RPC 回應解析錯誤(branded:sanitizeError 憑類別放行、不靠「無 code」啟發式)。 */
class ReleaseSiblingParseError extends Error {}

function defaultClientFactory(connectionString: string): PgClientLike {
  return new Client(buildPgConfig(connectionString)) as unknown as PgClientLike;
}

export class PgReleaseSiblingAdapter implements IReleaseSibling {
  constructor(
    private readonly connectionString: string,
    private readonly clientFactory: (
      connectionString: string,
    ) => PgClientLike = defaultClientFactory,
  ) {}

  async release(
    attemptId: string,
    userId: string,
    cartSessionId: string,
  ): Promise<{ released: boolean }> {
    return this.run(async (client) => {
      const res = await client.query(
        'SELECT public.mark_charge_attempt_released_for_user($1::uuid, $2::uuid, $3::uuid) AS result',
        [attemptId, userId, cartSessionId],
      );
      return parseReleaseResult(res.rows);
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

/** 解析 release RPC jsonb `{released:boolean}`;形狀不符 → throw(通用、fail-closed)。 */
function parseReleaseResult(rows: Array<Record<string, unknown>>): { released: boolean } {
  const r = rows[0]?.result as { released?: unknown } | undefined;
  if (!r || typeof r.released !== 'boolean') {
    throw new ReleaseSiblingParseError('mark_charge_attempt_released_for_user 回應格式異常');
  }
  return { released: r.released };
}

/** pg 錯誤淨化:本層 parse 錯誤原樣放行(已通用);其餘只回通用訊息 + 安全 SQLSTATE code。 */
function sanitizeError(err: unknown): ReleaseSiblingError {
  if (err instanceof ReleaseSiblingParseError) {
    return err; // 本層 throw(已通用、無 pg 原文/token)
  }
  const code = (err as { code?: unknown } | null)?.code;
  const e: ReleaseSiblingError = new Error(
    `release CAS 主軌失敗(${typeof code === 'string' ? code : 'transport'})`,
  );
  if (typeof code === 'string') {
    e.code = code;
  }
  return e;
}
