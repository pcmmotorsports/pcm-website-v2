import { toInsertRow, type AuditLogRepository } from './repository';
import type { AdminAuditLogInsert, AuditContext, AuditEntry } from './types';

/**
 * 記憶體內稽核 repository = 真實作(testing-strategy §3.3,非 mock)。
 * 供單測與 admin_audit_log 表落地前的本機執行;程序重啟即失、**不作正式持久化**。
 */
export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly rows: AdminAuditLogInsert[] = [];

  record(entry: AuditEntry, context: AuditContext): Promise<void> {
    this.rows.push(toInsertRow(entry, context));
    return Promise.resolve();
  }

  /** 測試 / 檢視用:已記錄列的唯讀快照。 */
  get recorded(): readonly AdminAuditLogInsert[] {
    return this.rows;
  }
}
