/**
 * @module @pcm/adapters/email/SupabaseEmailOutboxAdapter — email_outbox 狀態機 adapter(M-4a E1b)
 *
 * 實作 `IEmailOutbox`(寫入/認領/標記/假信箱 gate)對表 `public.email_outbox`
 * (migration `20260717020000`、已 apply;ACL=GRANT INSERT/SELECT/UPDATE service_role、plan §4.3)。
 * client 注入 **service_role**(anon/authenticated 對本表零權限);本 class 不持金鑰、不做 authorization,
 * 只能由 server-side 受控模組組裝(export 走 @pcm/adapters/server subpath、composition 於 E2a/E3)。
 *
 * 🔴 REQUIRED-E1b 落表邊界(codex 關卡2 R1 must-fix 後收緊):
 * - enqueue 只收事件來源欄位;payload(`buildOrderCreatedPayload` runtime allowlist)/subject
 *   (固定模板)/dedup_key(=orderId)全在本檔內部重組 → 呼叫端無法偷渡任意物件/字串落表。
 * - markFailed 的 errorCode 落表前過 **runtime allowlist**(TS union 只是編譯期;`as` 硬轉/JS 呼叫
 *   端仍可能塞過 DB regex 的 PII 字串)→ 非 allowlist 一律改寫 `provider_error`。
 * - 🔴 mark* 三出口皆帶 `claimedAttempts` 世代柵欄:lease 回收 + 他人再認領後(attempts 已 +1),
 *   舊持有者延遲到達的標記 `.eq('attempts', 舊世代)` 必 0 列 → 不覆寫別人的在途列(ABA 擋掉)。
 *
 * ⚠️ `email_outbox` 不在生成型別 database.types.ts(該檔落後 live schema=既有 backlog、regen 屬另一
 * slice)→ 本檔用**文件化窄 cast**(先例:helpers/fitment-queries.ts VehicleRpcClient),composition 端
 * `createSupabaseServiceClient() as unknown as EmailOutboxClient`;regen 後可移除。
 *
 * 🔴 PostgREST 限制與對策(語意仍守 REQUIRED-E2a):
 * - 不支援欄對欄比較(`attempts < max_attempts`)→ due 掃描取 `DUE_SCAN_CAP` 大窗、app 層過濾後
 *   才裁 limit(🔴 不可先 limit 再過濾:死列 next_retry_at 恆最老、恆佔滿窗口 → dead letter 積到
 *   limit 件時活信永久餓死;code-reviewer R1 Critical);CAS 用讀到的 `attempts`/`max_attempts`
 *   **字面值**進 WHERE(`eq(attempts, 讀值)` 樂觀鎖 + `lt(attempts, max)`)—— 讀後被任何人動過
 *   該列 → CAS 0 列 = 輸,語意同「guard 在 CAS 內原子生效」(TOCTOU 擋住)。
 * - 不支援 SQL 表達式賦值 → `attempts+1` 由 app 算、配上述樂觀鎖不會丟失更新。
 * - `claimed_at`/`sent_at` 與 due 比較的 `next_retry_at <= now` 皆用 app 時鐘 ISO(DB 只強制
 *   「非 NULL ⟺ sending」、「是 now()」本就是 app 合約;app 鐘落後 DB 鐘時 claimById 可能 miss
 *   剛 insert 的列=僅延遲至 sweeper 補、無正確性破口;偏差遠小於 lease ≥1h 的比較粒度)。
 *
 * 🔴 假信箱 gate(plan §3.4):域名**不複製字面**、由 composition 注入 `LINE_SYNTHETIC_EMAIL_DOMAIN`
 * (單一來源 = apps/storefront/src/lib/auth/line.ts:38;packages 不可反向 import app 層檔案,故走
 * 建構參數、必填無預設)。比對前雙邊正規化(trim+lowercase);否決 MX 即時查詢(網路依賴進寫入路徑)。
 */
import 'server-only';

import type {
  IEmailOutbox,
  EnqueueEmailInput,
  EnqueueEmailResult,
  ClaimedEmailJob,
  EmailOutboxEventType,
  EmailSendErrorCode,
} from '@pcm/ports';
import { buildOrderCreatedPayload, orderCreatedSubject } from './order-email-assembly';

/** PostgREST unique_violation(需再查核同事件才可回 duplicate,見 enqueue)。 */
const PG_UNIQUE_VIOLATION = '23505';

/** 可被認領的狀態(migration §⑦:failed 是可重試態、非終態)。 */
const CLAIMABLE_STATUSES = ['pending', 'failed'] as const;

/**
 * due 掃描單次取列上限(恆 ≥ caller limit)。死列(attempts>=max)無法在 PostgREST 端過濾
 * (欄對欄限制)且 next_retry_at 恆最老 → 必須取大窗、app 層過濾後才裁 limit,否則死列佔滿
 * 窗口 = 活信餓死。死列數 > 本上限的世界裡,dead-man 訊號 2(dead letter count)早已連續告警,
 * 正解是清理 job(backlog #281),不是再放大窗口;量級對照:PCM 每日數十封。
 */
const DUE_SCAN_CAP = 200;

/**
 * 🔴 runtime 錯誤碼 allowlist(與 @pcm/ports EmailSendErrorCode union **窮舉**同步:
 * `Record<union, true>` 逼出每一個成員,union 新增碼漏改這裡 typecheck 必紅——codex R2 nit:
 * `satisfies T[]` 只驗「列的都合法」、驗不了完整性,漏列會讓新合法碼被靜默降級)。
 * markFailed 落表前查此表,非成員一律改寫 provider_error(TS union 擋不住 `as`/JS 呼叫端)。
 */
const EMAIL_SEND_ERROR_CODE_FLAGS: Record<EmailSendErrorCode, true> = {
  http_400: true,
  http_401: true,
  http_403: true,
  http_404: true,
  http_408: true,
  http_409: true,
  http_422: true,
  http_429: true,
  http_500: true,
  http_502: true,
  http_503: true,
  http_504: true,
  // E1c(Sean Q6=A):429 三分;退避政策見 @pcm/ports EmailSendErrorCode 逐碼 JSDoc。
  rate_limited: true,
  quota_daily_exceeded: true,
  quota_monthly_exceeded: true,
  network_error: true,
  provider_error: true,
};
const EMAIL_SEND_ERROR_CODE_ALLOWLIST = new Set<string>(Object.keys(EMAIL_SEND_ERROR_CODE_FLAGS));

/** 表投射(對齊 migration 16 欄中寄送所需子集;不取 created_at/sent_at/last_error_code)。 */
const JOB_SELECT =
  'id, event_type, order_id, dedup_key, recipient_email, subject, payload, attempts, max_attempts, request_id';

type OutboxJobRow = {
  id: string;
  event_type: string;
  order_id: string;
  dedup_key: string;
  recipient_email: string;
  subject: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
  request_id: string | null;
};

type OutboxResponse = {
  data: OutboxJobRow[] | null;
  error: { code?: string; message: string } | null;
};

/**
 * email_outbox 查詢鏈最小呼叫面(文件化窄 cast;真 client = service_role SupabaseClient)。
 * thenable = PostgREST builder 本身可 await。
 */
export type EmailOutboxQueryBuilder = PromiseLike<OutboxResponse> & {
  insert(row: Record<string, unknown>): EmailOutboxQueryBuilder;
  select(columns: string): EmailOutboxQueryBuilder;
  update(values: Record<string, unknown>): EmailOutboxQueryBuilder;
  eq(column: string, value: string | number): EmailOutboxQueryBuilder;
  in(column: string, values: readonly string[]): EmailOutboxQueryBuilder;
  lt(column: string, value: string | number): EmailOutboxQueryBuilder;
  lte(column: string, value: string | number): EmailOutboxQueryBuilder;
  order(column: string, opts: { ascending: boolean }): EmailOutboxQueryBuilder;
  limit(count: number): EmailOutboxQueryBuilder;
};

export type EmailOutboxClient = {
  from(table: 'email_outbox'): EmailOutboxQueryBuilder;
};

export type SupabaseEmailOutboxAdapterConfig = {
  /**
   * 合成假信箱網域(必填、無預設):composition 必須 import `LINE_SYNTHETIC_EMAIL_DOMAIN`
   * (line.ts:38、唯一字面來源)傳入;測試才允許自訂假域。
   */
  syntheticEmailDomain: string;
};

/** gate 正規化(比對用;不改寫落表的 recipient_email 原值)。 */
function normalizeForGate(value: string): string {
  return value.trim().toLowerCase();
}

/** 是否為合成假信箱(域名等值比對;無 @ 視為非合成、交由 Resend 4xx → failed 走正常退避)。 */
export function isSyntheticEmail(email: string, syntheticDomain: string): boolean {
  const normalized = normalizeForGate(email);
  const at = normalized.lastIndexOf('@');
  if (at < 0) {
    return false;
  }
  return normalized.slice(at + 1) === normalizeForGate(syntheticDomain);
}

function mapRowToJob(row: OutboxJobRow): ClaimedEmailJob {
  return {
    id: row.id,
    eventType: row.event_type as EmailOutboxEventType,
    orderId: row.order_id,
    dedupKey: row.dedup_key,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    requestId: row.request_id,
  };
}

export class SupabaseEmailOutboxAdapter implements IEmailOutbox {
  constructor(
    private readonly client: EmailOutboxClient,
    private readonly cfg: SupabaseEmailOutboxAdapterConfig,
  ) {}

  async enqueue(input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
    // 🔴 落表三欄全在本邊界內部重組(REQUIRED-E1b):payload 過 runtime allowlist、subject 走
    // 固定模板、dedup_key = orderId(migration §①:order_created 一單一封)。呼叫端無寫入口。
    const payload = buildOrderCreatedPayload({ displayId: input.displayId, paidAt: input.paidAt });
    const dedupKey = input.orderId;
    const skipped = isSyntheticEmail(input.recipientEmail, this.cfg.syntheticEmailDomain);
    const { data, error } = await this.client
      .from('email_outbox')
      .insert({
        event_type: input.eventType,
        order_id: input.orderId,
        dedup_key: dedupKey,
        recipient_email: input.recipientEmail,
        subject: orderCreatedSubject(payload.display_id),
        payload,
        status: skipped ? 'skipped_no_real_email' : 'pending',
        request_id: input.requestId ?? null,
      })
      .select('id');
    if (error) {
      if (error.code === PG_UNIQUE_VIOLATION) {
        return this.resolveUniqueViolation(input);
      }
      throw new Error(`email_outbox enqueue 失敗(${error.code ?? 'unknown'})`);
    }
    const id = data?.[0]?.id;
    if (!id) {
      throw new Error('email_outbox enqueue 失敗(insert 未回列)');
    }
    return skipped ? { kind: 'skipped_no_real_email', id } : { kind: 'enqueued', id };
  }

  /**
   * 23505 查核(codex 關卡2 R1 must-fix:盲目回 duplicate 會把「PK 撞鍵/未來新唯一約束/
   * 跨訂單 dedup 碰撞」全吞成成功 = 永久漏信):撞鍵後回查 (event_type, dedup_key),
   * **存在且 order_id 相同**才是同事件 → duplicate;否則 throw(訊息零 PII)。
   */
  private async resolveUniqueViolation(input: EnqueueEmailInput): Promise<EnqueueEmailResult> {
    const { data, error } = await this.client
      .from('email_outbox')
      .select('id, order_id')
      .eq('event_type', input.eventType)
      .eq('dedup_key', input.orderId)
      .limit(1);
    if (error) {
      throw new Error(`email_outbox 唯一鍵查核失敗(${error.code ?? 'unknown'})`);
    }
    const existing = data?.[0];
    if (!existing) {
      throw new Error('email_outbox enqueue 撞唯一鍵但查無同事件列(23505 非 dedup 鍵)');
    }
    if (existing.order_id !== input.orderId) {
      throw new Error('email_outbox dedup_key 跨訂單碰撞(拒回 duplicate、須人工查核)');
    }
    return { kind: 'duplicate' };
  }

  async claimDue(limit: number): Promise<ClaimedEmailJob[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('email_outbox')
      .select(JOB_SELECT)
      .in('status', CLAIMABLE_STATUSES)
      .lte('next_retry_at', nowIso)
      .order('next_retry_at', { ascending: true })
      // 🔴 取大窗(見 DUE_SCAN_CAP):先 limit 再過濾會被恆最老的死列餓死活信(R1 Critical)。
      .limit(Math.max(limit, DUE_SCAN_CAP));
    if (error) {
      throw new Error(`email_outbox due 掃描失敗(${error.code ?? 'unknown'})`);
    }
    // 欄對欄 guard 的 app 層半段(死列 attempts>=max 不進 CAS;原子性由 CAS 內字面值 guard 收口)。
    const candidates = (data ?? []).filter((row) => row.attempts < row.max_attempts);
    const claimed: ClaimedEmailJob[] = [];
    for (const row of candidates) {
      if (claimed.length >= limit) {
        break;
      }
      const winner = await this.tryClaim(row);
      if (winner) {
        claimed.push(winner);
      }
    }
    return claimed;
  }

  async claimById(id: string): Promise<ClaimedEmailJob | null> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.client
      .from('email_outbox')
      .select(JOB_SELECT)
      .eq('id', id)
      .in('status', CLAIMABLE_STATUSES)
      .lte('next_retry_at', nowIso)
      .limit(1);
    if (error) {
      throw new Error(`email_outbox claimById 讀取失敗(${error.code ?? 'unknown'})`);
    }
    const row = data?.[0];
    if (!row || row.attempts >= row.max_attempts) {
      return null;
    }
    return this.tryClaim(row);
  }

  /**
   * 逐列 CAS 認領(REQUIRED-E2a 原子決策點):
   * `SET status='sending', claimed_at=now, attempts=讀值+1
   *  WHERE id=? AND status IN (pending,failed) AND attempts = 讀值 AND attempts < max(讀值)`
   * 0 列 = 搶輸/已被動過(TOCTOU:他人先推進 attempts → eq 失配 → 不會突破上限)。
   */
  private async tryClaim(row: OutboxJobRow): Promise<ClaimedEmailJob | null> {
    const { data, error } = await this.client
      .from('email_outbox')
      .update({
        status: 'sending',
        claimed_at: new Date().toISOString(),
        attempts: row.attempts + 1,
      })
      .eq('id', row.id)
      .in('status', CLAIMABLE_STATUSES)
      .eq('attempts', row.attempts)
      .lt('attempts', row.max_attempts)
      .select(JOB_SELECT);
    if (error) {
      throw new Error(`email_outbox 認領失敗(${error.code ?? 'unknown'})`);
    }
    const winner = data?.[0];
    return winner ? mapRowToJob(winner) : null;
  }

  async markSent(id: string, claimedAttempts: number): Promise<boolean> {
    return this.leaveSending(id, claimedAttempts, {
      status: 'sent',
      sent_at: new Date().toISOString(),
    });
  }

  async markFailed(
    id: string,
    claimedAttempts: number,
    errorCode: EmailSendErrorCode,
    nextRetryAt: Date,
  ): Promise<boolean> {
    // 🔴 runtime allowlist(TS union 只是編譯期;過 DB regex 的 PII 字串在此被改寫)。
    const safeCode: EmailSendErrorCode = EMAIL_SEND_ERROR_CODE_ALLOWLIST.has(errorCode)
      ? errorCode
      : 'provider_error';
    return this.leaveSending(id, claimedAttempts, {
      status: 'failed',
      last_error_code: safeCode,
      next_retry_at: nextRetryAt.toISOString(),
    });
  }

  async markSkippedOrderIneligible(id: string, claimedAttempts: number): Promise<boolean> {
    // 🔴 S3=A 不可翻轉終態:零訊號零對帳補救 → 必寫稽核碼(migration §⑧)。
    return this.leaveSending(id, claimedAttempts, {
      status: 'skipped_order_ineligible',
      last_error_code: 'order_ineligible',
    });
  }

  /**
   * 離開 sending 的唯一出口:一律連帶 `claimed_at = NULL`(雙向 CHECK 的 app 義務;漏清 →
   * 每次標記都 check_violation → 列卡 sending → lease 回收重認領 = 系統性重複寄信)。
   * 述詞鎖 `status='sending'` **+ `attempts = claimedAttempts` 世代柵欄**(codex 關卡2 R1
   * must-fix:lease 回收→他人再認領後 attempts 已 +1,舊持有者延遲標記必 0 列、不覆寫
   * 別人的在途列 = ABA 擋掉)。false 讓 caller 知道所有權已失、不得重試覆寫。
   */
  private async leaveSending(
    id: string,
    claimedAttempts: number,
    values: Record<string, unknown>,
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from('email_outbox')
      .update({ ...values, claimed_at: null })
      .eq('id', id)
      .eq('status', 'sending')
      .eq('attempts', claimedAttempts)
      .select('id');
    if (error) {
      throw new Error(`email_outbox 標記失敗(${error.code ?? 'unknown'})`);
    }
    return (data?.length ?? 0) === 1;
  }
}
