/**
 * @module @pcm/adapters/payment/PaymentConfirmerAdapter — payment_confirmer 窄權 confirm RPC 實作(M-3 階段②-②b)
 *
 * **🔴 server-only + 走 @pcm/adapters/server subpath**(非 root barrel):
 * - 持 `PAYMENT_CONFIRMER_DB_URL`(raw DB credential、敏感度 ≥ service_role)→ 結構守門 = eslint
 *   no-restricted-imports 擋全 storefront import @pcm/adapters/server、只剩 composition root 唯一受控門。
 * - `pg`(node-postgres)只在本 subpath import → 不污染 root barrel 的 tree-shaking(lib/products.ts 零 pg)。
 *
 * **連線模型(SHOULD ①③⑦)**:
 * - **pg 直連 5432**(非 6543 pooler);pooler 呼 SECURITY DEFINER 已 4 次證必斷(connectionString 由 Sean
 *   端設直連 + `sslmode=require`、Supabase 直連需 SSL;adapter 不解析/不改寫連線字串)。
 * - per-request `new Client()` + `finally end()`(Edge Function 持久連線池方案明記 Phase 2);
 *   `connectionTimeoutMillis` + `query_timeout` 防卡。
 *
 * **失敗分類(SHOULD ③、孤兒契約縱深)**:
 * - SQLSTATE P0001(confirm RPC 業務 RAISE)→ `PaymentConfirmError('rejected')`(孤兒、不重 charge/confirm)。
 * - 其餘(連線拒/timeout/語句取消/未連上/回應格式異常)→ `PaymentConfirmError('unreachable')`(可重呼 confirm 冪等)。
 * - 🔴 PF-E:不轉傳 pg 原始 message(通用訊息、不洩內部狀態/total)。
 *
 * @see docs/specs/2026-06-12-m3-stage2-2-tappay-adapter-plan.md §3/§6
 * @see packages/ports/src/IPaymentConfirmer.ts
 * @see supabase/migrations/20260611120000_m3_s2c_confirm_payment_rpc.sql
 */
import 'server-only';

import { Client } from 'pg';
import type { IPaymentConfirmer } from '@pcm/ports';
import type { ConfirmOrderPaymentInput, ConfirmOrderPaymentResult } from '@pcm/domain';
import { PaymentConfirmError } from '@pcm/domain';

/** pg Client 最小介面(可注 fake、單元測不開真連線)。 */
export type PgClientLike = {
  connect(): Promise<void>;
  query(text: string, values: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
};

/** SQLSTATE:plpgsql `RAISE EXCEPTION` 預設碼(confirm RPC 業務拒絕走此)。 */
const PG_RAISE_EXCEPTION = 'P0001';

/**
 * 預設 pg client factory:直連 5432(非 pooler)。
 * 🔴 connectionString 須含 `sslmode=require`(Supabase 直連需 SSL、Sean 端設);
 * query_timeout(12s)> 伺服器 statement_timeout(8s)→ 令伺服器端先 timeout(語句取消會 rollback、可重試)。
 */
function defaultClientFactory(connectionString: string): PgClientLike {
  return new Client({
    connectionString,
    connectionTimeoutMillis: 8000,
    query_timeout: 12000,
  }) as unknown as PgClientLike;
}

export class PaymentConfirmerAdapter implements IPaymentConfirmer {
  constructor(
    private readonly connectionString: string,
    private readonly clientFactory: (
      connectionString: string,
    ) => PgClientLike = defaultClientFactory,
  ) {}

  async confirm(input: ConfirmOrderPaymentInput): Promise<ConfirmOrderPaymentResult> {
    const client = this.clientFactory(this.connectionString);
    try {
      await client.connect();
      const res = await client.query(
        'SELECT public.confirm_order_payment($1::uuid, $2::integer, $3::text) AS result',
        // 🔴 鐵則 12:p_amount = server read-back orders.total 整數(amount.amount、無浮點);client 永不送價。
        [input.orderId, input.amount.amount, input.recTradeId],
      );
      return parseConfirmResult(res.rows);
    } catch (err) {
      throw classifyPgError(err);
    } finally {
      // 🔴 SHOULD ③:finally 永遠釋放連線(connect 失敗時 end() 也可能 throw、吞掉不掩蓋主錯誤)。
      try {
        await client.end();
      } catch {
        /* swallow: 連線已斷時 end 可能 throw、不蓋過 confirm 的真實結果/錯誤 */
      }
    }
  }
}

/** 解析 confirm RPC 回的 jsonb `{confirmed, idempotent}`;形狀不符 → unreachable(可重 confirm 不重 charge)。 */
function parseConfirmResult(
  rows: Array<Record<string, unknown>>,
): ConfirmOrderPaymentResult {
  const result = rows[0]?.result as { confirmed?: unknown; idempotent?: unknown } | undefined;
  if (!result || typeof result.confirmed !== 'boolean' || typeof result.idempotent !== 'boolean') {
    throw new PaymentConfirmError('unreachable', 'confirm RPC 回應格式異常');
  }
  return { confirmed: result.confirmed, idempotent: result.idempotent };
}

/**
 * 分類 pg 錯誤(SHOULD ③):P0001(RPC RAISE 業務拒絕)→ rejected;其餘 → unreachable。
 * parseConfirmResult 已 throw 的 PaymentConfirmError 原樣傳遞。
 */
function classifyPgError(err: unknown): PaymentConfirmError {
  if (err instanceof PaymentConfirmError) {
    return err;
  }
  const code = (err as { code?: unknown } | null)?.code;
  if (code === PG_RAISE_EXCEPTION) {
    return new PaymentConfirmError('rejected', '付款確認被拒(業務規則)');
  }
  return new PaymentConfirmError('unreachable', '付款確認連線失敗(可重試)');
}
