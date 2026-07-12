// M-4a M0-S2 統一稽核 log 型別。
// 對應 migration supabase/migrations/20260712210000_m4a_admin_audit_log.sql、PRD §6.2 / §6.7。

/**
 * 動作代碼。慣例 `<domain>.<entity>.<verb>`(例 'customer.tier.change'、'order.cancel')。
 * 白名單紀律走呼叫端常數(PRD §6.4);不在 runtime 強制列舉,避免每加動作就改型別。
 */
export type AdminAuditAction = string;

/** 來源 app(對應 migration CHECK source_app IN ('admin','quote'))。 */
export type AuditSourceApp = 'admin' | 'quote';

/** 一筆稽核意圖(呼叫端提供的「發生了什麼」)。 */
export interface AuditEntry {
  readonly action: AdminAuditAction;
  /** 被操作對象,格式約定 `<entity>:<uuid>`(例 `order:${id}`);全域動作可省略。 */
  readonly target?: string;
  /** 變更前快照(可含敏感內部狀態;本表零 client 權限保護)。 */
  readonly before?: unknown;
  /** 變更後快照。 */
  readonly after?: unknown;
  /** 內部原因(不對客;對客文案另走 orders.cancelled_reason)。 */
  readonly reason?: string;
}

/** 稽核情境(由 server 從 session + request 組出,呼叫端不自帶)。 */
export interface AuditContext {
  readonly actor: string;
  readonly requestId: string;
  readonly sourceApp: AuditSourceApp;
}

/**
 * admin_audit_log INSERT 列。
 * 🔴 不含 id / created_at —— 交 DB default(gen_random_uuid / now());
 *    server 不回填時間(防竄改),且對齊 REQUIRED-2 return=minimal(不回讀 id)。
 */
export interface AdminAuditLogInsert {
  readonly actor: string;
  readonly action: string;
  readonly target: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly request_id: string;
  readonly source_app: AuditSourceApp;
}
