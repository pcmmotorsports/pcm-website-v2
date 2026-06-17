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
  ActiveChargeAttempt,
  BeginChargeAttemptResult,
  MarkChargeAttemptChargedInput,
  MarkChargeAttemptFailedInput,
  OrderId,
  PaymentStatus,
  StuckChargeAttempt,
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

  /** M-3 3DS-1b:依 orderId 反查 active attempt + order 對帳欄(主軌-only;RPC RETURN NULL → null)。 */
  async findActiveByOrderId(orderId: OrderId): Promise<ActiveChargeAttempt | null> {
    return this.run(async (client) => {
      const res = await client.query(
        'SELECT public.get_active_charge_attempt($1::uuid) AS result',
        [orderId],
      );
      return parseActiveAttempt(res.rows);
    });
  }

  // ── M-3 3DS-4 sweeper(expire_stuck_attempts_at_ceiling / claim_stuck_unsettled_attempts / mark_attempt_settle_retry / flag_non_unpaid_active_attempts、3DS-4a-2)──

  /** 🔴 ceiling-expirer(claim 前置、防孤兒);回轉換筆數(>0 sweeper 告警)。 */
  async expireStuckAtCeiling(): Promise<number> {
    return this.run(async (client) => {
      const res = await client.query(
        'SELECT public.expire_stuck_attempts_at_ceiling() AS result',
        [],
      );
      return parseAttemptAffectedCount(res.rows);
    });
  }

  /** 🔴 原子 lease claim stuck unsettled attempt(SETOF 三欄、claim token=settle_attempt_count);空陣列=本輪無 due。 */
  async claimStuckUnsettled(ageSeconds: number, limit: number): Promise<StuckChargeAttempt[]> {
    return this.run(async (client) => {
      const res = await client.query(
        'SELECT attempt_id, order_id, settle_attempt_count FROM public.claim_stuck_unsettled_attempts($1::integer, $2::integer)',
        [ageSeconds, limit],
      );
      return res.rows.map(parseStuckAttempt);
    });
  }

  /** pending → 退避 retry(token guard + last_settle_error allowlist 零 PII);回 affected(1/0 no-op)。 */
  async markSettleRetry(
    attemptId: string,
    claimedCount: number,
    reasonCode: string,
  ): Promise<number> {
    return this.run(async (client) => {
      const res = await client.query(
        'SELECT public.mark_attempt_settle_retry($1::uuid, $2::integer, $3::text) AS result',
        [attemptId, claimedCount, reasonCode],
      );
      return parseAttemptAffectedCount(res.rows);
    });
  }

  /** 標 refunded/partiallyPaid 殘留 active attempt → needs_manual_review(唯一回收路徑);回標記筆數。 */
  async flagNonUnpaidActive(limit: number): Promise<number> {
    return this.run(async (client) => {
      const res = await client.query(
        'SELECT public.flag_non_unpaid_active_attempts($1::integer) AS result',
        [limit],
      );
      return parseAttemptAffectedCount(res.rows);
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

/**
 * 解析 begin RPC jsonb `{acquired, attempt_id?, fallback_token?, reason?, existing_*?}`;形狀不符 → throw
 * (action 通用字面)。reason 域:acquired:false 的 user_in_flight/order_locked/not_unpaid(ChargeLockReason)
 * + 3DS-0b cart dedup 的 duplicate/needs_settle(各帶 existing_* 欄);未知 reason 仍 throw。
 */
function parseBeginResult(rows: Array<Record<string, unknown>>): BeginChargeAttemptResult {
  const r = rows[0]?.result as
    | {
        acquired?: unknown;
        attempt_id?: unknown;
        fallback_token?: unknown;
        reason?: unknown;
        existing_display_id?: unknown;
        existing_paid?: unknown;
        existing_order_id?: unknown;
        existing_rec_trade_id?: unknown;
        existing_bank_transaction_id?: unknown;
      }
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
  // 🔴 3DS-0b cart-instance dedup outcome(在既有 3-reason 前加 2 分支;形狀不符 → throw)。
  if (r.reason === 'duplicate') {
    // D2:sibling 已 paid。existing_display_id 必字串;existing_paid 必 true(此 reason 的定義)。
    if (typeof r.existing_display_id !== 'string' || r.existing_paid !== true) {
      throw new ChargeAttemptParseError('begin_charge_attempt 回應格式異常');
    }
    return {
      acquired: false,
      reason: 'duplicate',
      existingDisplayId: r.existing_display_id,
      existingPaid: true,
    };
  }
  if (r.reason === 'needs_settle') {
    // D4:sibling 扣款跡象未確認。order_id/display_id 必字串。
    if (typeof r.existing_order_id !== 'string' || typeof r.existing_display_id !== 'string') {
      throw new ChargeAttemptParseError('begin_charge_attempt 回應格式異常');
    }
    // rec_trade_id/bank_transaction_id nullable 慣例:容忍 JSON null(pending orphan 無 rec)+ 缺欄
    //   (bank_transaction_id 欄 0c 才加 → 0b-only 階段 undefined);🔴 但 number/object/false 等錯型別 =
    //   RPC 契約違反、不靜默轉 null → fail-closed throw(codex 關卡2 must-fix;比同檔 parseActiveAttempt
    //   寬鬆 coercion 更嚴、強化 payment 路徑 bug 可追蹤性)。
    const rec = r.existing_rec_trade_id;
    const bank = r.existing_bank_transaction_id;
    if (
      (rec !== null && rec !== undefined && typeof rec !== 'string') ||
      (bank !== null && bank !== undefined && typeof bank !== 'string')
    ) {
      throw new ChargeAttemptParseError('begin_charge_attempt 回應格式異常');
    }
    return {
      acquired: false,
      reason: 'needs_settle',
      existingOrderId: r.existing_order_id,
      existingDisplayId: r.existing_display_id,
      existingRecTradeId: typeof rec === 'string' ? rec : null,
      existingBankTransactionId: typeof bank === 'string' ? bank : null,
    };
  }
  if (r.reason !== 'user_in_flight' && r.reason !== 'order_locked' && r.reason !== 'not_unpaid') {
    throw new ChargeAttemptParseError('begin_charge_attempt 回應格式異常');
  }
  return { acquired: false, reason: r.reason };
}

/** 合法 PaymentStatus 值(對齊 orders.payment_status enum;fail-closed 驗證用)。 */
const PAYMENT_STATUSES: readonly PaymentStatus[] = ['unpaid', 'paid', 'partiallyPaid', 'refunded'];

/** 解析 get_active_charge_attempt RPC jsonb;RPC RETURN NULL → null;形狀不符 → throw(通用)。 */
function parseActiveAttempt(rows: Array<Record<string, unknown>>): ActiveChargeAttempt | null {
  const r = rows[0]?.result;
  if (r === null || r === undefined) {
    return null; // RPC 回 NULL = 無單 / 無 active attempt
  }
  const o = r as Record<string, unknown>;
  if (
    typeof o.attempt_id !== 'string' ||
    (o.status !== 'pending' && o.status !== 'charged') ||
    typeof o.attempt_created_at !== 'string' ||
    typeof o.order_total !== 'number' ||
    typeof o.order_payment_status !== 'string' ||
    !PAYMENT_STATUSES.includes(o.order_payment_status as PaymentStatus) ||
    typeof o.order_display_id !== 'string'
  ) {
    throw new ChargeAttemptParseError('get_active_charge_attempt 回應格式異常');
  }
  return {
    attemptId: o.attempt_id,
    status: o.status,
    recTradeId: typeof o.rec_trade_id === 'string' ? o.rec_trade_id : null,
    bankTransactionId: typeof o.bank_transaction_id === 'string' ? o.bank_transaction_id : null,
    attemptCreatedAt: o.attempt_created_at,
    orderTotal: o.order_total,
    orderPaymentStatus: o.order_payment_status as PaymentStatus,
    orderDisplayId: o.order_display_id,
  };
}

/** 解析 claim_stuck_unsettled_attempts SETOF 一列(attempt_id/order_id/settle_attempt_count);形狀不符 → throw(通用)。 */
function parseStuckAttempt(row: Record<string, unknown>): StuckChargeAttempt {
  if (
    typeof row.attempt_id !== 'string' ||
    typeof row.order_id !== 'string' ||
    typeof row.settle_attempt_count !== 'number' ||
    !Number.isInteger(row.settle_attempt_count) // claim token 必整數(int4);1.5/NaN fail-closed
  ) {
    throw new ChargeAttemptParseError('claim_stuck_unsettled_attempts 回應格式異常');
  }
  return {
    attemptId: row.attempt_id,
    orderId: row.order_id,
    settleCount: row.settle_attempt_count,
  };
}

/** 解析 mark_attempt_settle_retry/flag_non_unpaid_active_attempts RPC 回的 affected integer;形狀不符 → throw(通用)。 */
function parseAttemptAffectedCount(rows: Array<Record<string, unknown>>): number {
  const result = rows[0]?.result;
  if (typeof result !== 'number' || !Number.isInteger(result)) {
    throw new ChargeAttemptParseError('attempt sweeper RPC 回應格式異常');
  }
  return result;
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
