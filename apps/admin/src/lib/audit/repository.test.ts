import { describe, it, expect } from 'vitest';
import { toInsertRow, type AuditLogInserter } from './repository';
import { InMemoryAuditLogRepository } from './in-memory-repository';
import { SupabaseAuditLogRepository } from './supabase-repository';
import type { AuditContext, AuditEntry } from './types';

const ctx: AuditContext = { actor: 'sean', requestId: 'req_x', sourceApp: 'admin' };

describe('toInsertRow', () => {
  it('should map a full entry + context to an insert row', () => {
    const entry: AuditEntry = {
      action: 'customer.tier.change',
      target: 'customer:abc',
      before: { tier: 'general' },
      after: { tier: 'store' },
      reason: '通過經銷審核',
    };
    expect(toInsertRow(entry, ctx)).toEqual({
      actor: 'sean',
      action: 'customer.tier.change',
      target: 'customer:abc',
      before: { tier: 'general' },
      after: { tier: 'store' },
      reason: '通過經銷審核',
      request_id: 'req_x',
      source_app: 'admin',
    });
  });

  it('should null out omitted optional fields', () => {
    const row = toInsertRow({ action: 'order.cancel' }, ctx);
    expect(row.target).toBeNull();
    expect(row.before).toBeNull();
    expect(row.after).toBeNull();
    expect(row.reason).toBeNull();
  });

  it('should not include id or created_at (交 DB default;server 不回填時間)', () => {
    const row = toInsertRow({ action: 'x' }, ctx);
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('created_at');
  });
});

describe('InMemoryAuditLogRepository', () => {
  it('should record entries and expose them via recorded', async () => {
    const repo = new InMemoryAuditLogRepository();
    await repo.record({ action: 'order.cancel', target: 'order:1' }, ctx);
    expect(repo.recorded).toHaveLength(1);
    expect(repo.recorded[0]).toMatchObject({
      action: 'order.cancel',
      target: 'order:1',
      actor: 'sean',
    });
  });
});

describe('SupabaseAuditLogRepository', () => {
  it('should insert the mapped row via the injected inserter (return=minimal, no .select())', async () => {
    const calls: unknown[] = [];
    const inserter: AuditLogInserter = {
      insert: (row) => {
        calls.push(row);
        return Promise.resolve({ error: null });
      },
    };
    await new SupabaseAuditLogRepository(inserter).record(
      { action: 'order.cancel', target: 'order:9' },
      ctx,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      action: 'order.cancel',
      request_id: 'req_x',
      source_app: 'admin',
    });
  });

  it('should throw when the inserter returns an error', async () => {
    const inserter: AuditLogInserter = {
      insert: () => Promise.resolve({ error: { message: 'permission denied' } }),
    };
    await expect(
      new SupabaseAuditLogRepository(inserter).record({ action: 'x' }, ctx),
    ).rejects.toThrow(/admin_audit_log 寫入失敗/);
  });

  // 🔴 整合測試(接真 admin_audit_log 表 via createSupabaseServiceClient)= pending:
  //    表尚未 db push(統一批次佇列 5 支之一)+ admin 尚未接 @pcm/adapters/server 依賴。
  //    表落地 + client 注入後解除,驗:真 INSERT 落地、service_role 無 SELECT 下 return=minimal 不炸 42501。
  it.todo('integration: 真 Supabase service client 寫入 admin_audit_log(pending 表 db push)');
});
