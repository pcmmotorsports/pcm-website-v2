import { describe, it, expect } from 'vitest';
import {
  toInsertRow,
  type AuditLogInserter,
  type AuditLogSelector,
} from './repository';
import { InMemoryAuditLogRepository } from './in-memory-repository';
import { SupabaseAuditLogReader, SupabaseAuditLogRepository } from './supabase-repository';
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

/**
 * `#27` D1a-2 讀取面。
 *
 * 🔴 **這一族最重要的不是「讀得到」,是「讀不到的時候會不會假裝讀到了」。**
 *   `20260815020000` 未 apply 時這條路會回 `42501` ——
 *   若 adapter 把 error 吞成空陣列,畫面會顯示「目前沒有任何紀錄」,
 *   **而真相是「讀不到」**。那正是 plan 驗收 8 要防的**空清單假象**。
 *   ⚠️ 而且 `AUDIT_UI_ENABLED` 旗標**擋不到這個** —— 旗標擋的是「路徑到得了」,
 *      這格擋的是「旗標開了但 apply 有問題」。**兩層不同,不可互相取代。**
 */
describe('SupabaseAuditLogReader', () => {
  const row = {
    id: '11111111-2222-4333-8444-555555555555',
    actor: 'sean',
    action: 'customer.tier.change',
    target: 'customer:abc',
    before: { tier: 'normal' },
    after: { tier: 'vip' },
    reason: null,
    request_id: 'req-1',
    source_app: 'admin',
    created_at: '2026-08-15T00:00:00Z',
  };

  function reader(impl: AuditLogSelector['select']) {
    return new SupabaseAuditLogReader({ select: impl });
  }

  it('回傳 selector 給的列', async () => {
    const got = await reader(async () => ({ data: [row], error: null })).listRecent(10);
    expect(got).toEqual([row]);
  });

  it('data 為 null(PostgREST 合法回法)⇒ 空陣列,不是炸掉', async () => {
    expect(await reader(async () => ({ data: null, error: null })).listRecent(10)).toEqual([]);
  });

  it('🔴 error 一律往上丟,**不得吞成空陣列**(驗收 8 的資料層根)', async () => {
    const r = reader(async () => ({ data: null, error: { message: 'permission denied for table admin_audit_log' } }));
    await expect(r.listRecent(10)).rejects.toThrow('admin_audit_log 讀取失敗');
  });

  it('🔴 error 的訊息不把 DB 原文整包冒到上層之外(只帶 message)', async () => {
    const r = reader(async () => ({ data: null, error: { message: '42501' } }));
    await expect(r.listRecent(10)).rejects.toThrow(/admin_audit_log 讀取失敗:42501/);
  });

  // 🔴 上限自驗 = 信任邊界的輸入驗證(理由不依賴 PostgREST 會怎麼回,見 `supabase-repository.ts` 該格註解)。
  //    ⚠️ 原註解那句因果宣稱已刪 —— 未量過、且以一句話涵蓋四個值。
  it.each([0, -1, 1.5, Number.NaN])('limit=%o ⇒ 直接拒,不送出查詢', async (bad) => {
    let called = false;
    const r = reader(async () => {
      called = true;
      return { data: [], error: null };
    });
    await expect(r.listRecent(bad as number)).rejects.toThrow('必須是正整數');
    expect(called, '前提:拒收時不該送出查詢').toBe(false);
  });

  // 🔴 正向對照:證明上面那些 reject **不是因為 listRecent 恆 reject**。
  it('🔴 limit=1 ⇒ 正常送出(正向對照:證明上面那族有判別力)', async () => {
    let seen: number | undefined;
    const r = reader(async (limit) => {
      seen = limit;
      return { data: [row], error: null };
    });
    await expect(r.listRecent(1)).resolves.toHaveLength(1);
    expect(seen, 'limit 應原樣傳給 selector,不被 adapter 改寫').toBe(1);
  });
});
