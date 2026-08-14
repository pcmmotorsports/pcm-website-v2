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
  // 🔴 `return=minimal` 的**理由**在 D0(`20260815020000`)之後換了(GRANT 有到期日),**規定沒變** ——
  //    逐字見 `repository.ts` 的 REQUIRED-2 段。這格釘的是規定,不是那個舊理由。
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

  // 🔴 整合測試(接真 admin_audit_log 表 via createSupabaseServiceClient)= pending。
  //    ⚠️ **兩個擋路理由裡的第一個已為假**(2026-08-11 晚重 gen):`admin_audit_log`
  //    現在就在 `database.types.ts` 裡 ⇒ 表活在正式庫、不是「尚未 db push」。
  //    剩下的擋路理由只有:admin 尚未接 @pcm/adapters/server 依賴。
  //    client 注入後解除,驗:真 INSERT 落地、return=minimal 不炸 42501。
  //    ⚠️ **原字面寫「service_role 無 SELECT 下」—— D0(`20260815020000`)apply 後那句就是假的**
  //       (它會有 SELECT)。規定仍留著,理由見 `repository.ts` 的 REQUIRED-2 段。
  it.todo('integration: 真 Supabase service client 寫入 admin_audit_log(pending:admin 未接 adapters/server)');
});
