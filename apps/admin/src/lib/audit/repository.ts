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
 * 🔴 REQUIRED-2:insert 回傳**只含 error、無 data**(return=minimal);
 *    實作端 supabase-js `.insert(row)` **禁鏈 `.select()`**。
 *
 * 🔴 **這條規定留著,但理由已經換掉(D0 `20260815020000` 之後)**:
 * 原理由是「service_role 沒有 SELECT 權,鏈了會 42501」—— **apply 之後那個理由不再成立**。
 * ⚠️ 也**不是**「不回讀 = append-only 的手癖防線」:append-only 是「**不能改、不能刪**」,**讀不在裡面**,
 *    用站不住的理由撐一條規定,下一個人一戳就破。
 * ✅ **真正的理由 = 這個 GRANT 有到期日**(見 `20260815020000` 檔頭「外部前提 1」):
 *    規定留著 ⇒ 這個 SELECT 權限**只有一個消費者**(`#27` 檢視頁),要收回時關掉一頁就好;
 *    規定拿掉 ⇒ 每一條 audit insert 路徑(18 支 RPC + app 層)都可能開始回讀,要收回等於全面回歸。
 *    **開一道有到期日的權限時,要讓依賴它的東西數得出來。**
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
