import { toInsertRow, type AuditLogInserter, type AuditLogRepository } from './repository';
import type { AuditContext, AuditEntry } from './types';

/**
 * Supabase(service_role / sb_secret_ 金鑰)稽核 repository。
 *
 * 走注入的窄 AuditLogInserter → 不直接綁 @supabase/supabase-js。真 client 由資料存取 slice
 * 以 `@pcm/adapters/server` createSupabaseServiceClient() 適配後注入,例:
 *   const inserter: AuditLogInserter = {
 *     insert: (row) => client.from('admin_audit_log').insert(row),  // 🔴 禁鏈 .select()(理由見下)
 *   };
 *   new SupabaseAuditLogRepository(inserter);
 *
 * 🔴 REQUIRED-2:INSERT 必須 return=minimal(不鏈 .select()、不回讀 id / created_at)。
 *    本類只依賴 { error } 形狀 → 天然符合。
 * 🔴 **理由在 D0(`20260815020000`)之後換了、規定沒變** —— 逐字見 `lib/audit/repository.ts`
 *    的 REQUIRED-2 段(**這個 GRANT 有到期日 ⇒ 要讓依賴它的東西數得出來**)。
 *    ⚠️ 原字面寫「service_role 無 SELECT」—— **apply 之後那句是假的**(它會有 SELECT)。
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
