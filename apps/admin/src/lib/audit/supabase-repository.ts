import { toInsertRow, type AuditLogInserter, type AuditLogRepository } from './repository';
import type { AuditContext, AuditEntry } from './types';

/**
 * Supabase(service_role / sb_secret_ 金鑰)稽核 repository。
 *
 * 走注入的窄 AuditLogInserter → 不直接綁 @supabase/supabase-js。真 client 由資料存取 slice
 * 以 `@pcm/adapters/server` createSupabaseServiceClient() 適配後注入,例:
 *   const inserter: AuditLogInserter = {
 *     insert: (row) => client.from('admin_audit_log').insert(row),  // 🔴 禁鏈 .select()(REQUIRED-2)
 *   };
 *   new SupabaseAuditLogRepository(inserter);
 *
 * 🔴 REQUIRED-2(Fable verdict Q1②):service_role 無 SELECT → INSERT 必須 return=minimal
 *    (不鏈 .select()、不回讀 id / created_at),否則 RETURNING 需 SELECT → 42501。
 *    本類只依賴 { error } 形狀 → 天然符合;整合測試(接真表)= pending 至 admin_audit_log db push。
 */
export class SupabaseAuditLogRepository implements AuditLogRepository {
  constructor(private readonly inserter: AuditLogInserter) {}

  async record(entry: AuditEntry, context: AuditContext): Promise<void> {
    const { error } = await this.inserter.insert(toInsertRow(entry, context));
    if (error) {
      // 🔴 只帶 message、不把 DB error 原文往上冒到瀏覽器(Fable Q2 殘餘:CHECK violation detail 可能回顯 row 值)。
      throw new Error(`admin_audit_log 寫入失敗:${error.message}`);
    }
  }
}
