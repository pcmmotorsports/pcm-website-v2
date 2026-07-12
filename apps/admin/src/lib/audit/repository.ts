import type { AdminAuditLogInsert, AuditContext, AuditEntry } from './types';

/** 稽核 log 寫入埠(append-only;呼叫端只 record、不讀不改)。 */
export interface AuditLogRepository {
  record(entry: AuditEntry, context: AuditContext): Promise<void>;
}

/**
 * 窄結構埠:只描述「把一列 append 進 admin_audit_log」所需的能力。
 * 讓 SupabaseAuditLogRepository 不直接綁 @supabase/supabase-js
 * (真 client 於資料存取 slice 以 `@pcm/adapters/server` createSupabaseServiceClient() 適配後注入)。
 *
 * 🔴 REQUIRED-2(Fable 審 verdict Q1②):service_role 無 SELECT 權限 →
 *    insert 回傳**只含 error、無 data**(return=minimal);實作端 supabase-js `.insert(row)`
 *    禁鏈 `.select()`,否則 RETURNING 需 SELECT → runtime 42501 炸在稽核寫入路徑。
 */
export interface AuditLogInserter {
  insert(row: AdminAuditLogInsert): Promise<{ error: { message: string } | null }>;
}

/** entry + context → INSERT 列(各實作共用;id / created_at 交 DB default)。 */
export function toInsertRow(entry: AuditEntry, context: AuditContext): AdminAuditLogInsert {
  return {
    actor: context.actor,
    action: entry.action,
    target: entry.target ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
    request_id: context.requestId,
    source_app: context.sourceApp,
  };
}
