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
 * 🔴 `return=minimal` 這條規定在 D0(`20260815020000`)之後**理由換了、規定沒變** ——
 *    逐字見 `lib/audit/repository.ts` 的 REQUIRED-2 段。
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

/**
 * admin_audit_log **讀取**列(`#27` D1a-2)。
 * 🔴 與 `AdminAuditLogInsert` **刻意不共用**:寫入端不帶 `id` / `created_at`(交 DB default、防竄改),
 *    讀取端**一定有**它們 —— 兩者共用一個型別會讓「寫入時可以帶 id」在型別層變成合法。
 * 🔴 欄位取自 `packages/adapters/src/supabase/database.types.ts` 的 `admin_audit_log.Row`,
 *    **不是我自己列的**;可空性也照那份(`before`/`after`/`reason`/`target` 可 null)。
 * ⚠️ `before`/`after` 建表 `20260712210000:26-28` 逐字「**可合法含經銷價 / 成本 / PII**」
 *    ⇒ **列表層不得顯示**(驗收 6),展開層才顯示且要有明確使用者動作(驗收 9)。
 */
export interface AdminAuditLogRow {
  readonly id: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly request_id: string;
  readonly source_app: string;
  readonly created_at: string;
}
