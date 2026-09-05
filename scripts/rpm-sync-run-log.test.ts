import { describe, expect, it, vi } from 'vitest';
import {
  closeSyncRun,
  currentRunRef,
  openSyncRun,
  type SyncRunLogClient,
} from './rpm-sync-run-log';

/**
 * 🔴 替身要記下【它被餵了什麼】—— 不是只回一個值。
 *    只斷言回傳值的話,「欄位寫錯」與「欄位寫對」印同一個 id。
 */
function makeClient(opts: {
  insertError?: string;
  insertThrows?: boolean;
  updateError?: string;
  returnNoRow?: boolean;
}) {
  const calls = {
    table: [] as string[],
    inserted: [] as Record<string, unknown>[],
    updated: [] as Record<string, unknown>[],
    eq: [] as [string, number][],
  };
  const client: SyncRunLogClient = {
    from(table: string) {
      calls.table.push(table);
      return {
        insert(row: Record<string, unknown>) {
          if (opts.insertThrows) throw new Error('boom');
          calls.inserted.push(row);
          return {
            select() {
              return {
                async single() {
                  if (opts.insertError) return { data: null, error: { message: opts.insertError } };
                  if (opts.returnNoRow) return { data: null, error: null };
                  return { data: { id: 4242 }, error: null };
                },
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          calls.updated.push(patch);
          return {
            async eq(col: string, val: number) {
              calls.eq.push([col, val]);
              return { error: opts.updateError ? { message: opts.updateError } : null };
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

describe('rpm-sync-run-log · 開工那一端', () => {
  it('寫成功 ⇒ 回 id, 而且欄位就是那三個', async () => {
    const { client, calls } = makeClient({});
    const id = await openSyncRun(client, 'samco', '123/1');
    expect(id).toBe(4242);
    expect(calls.table).toEqual(['supplier_sync_runs']);
    expect(calls.inserted).toEqual([{ supplier_slug: 'samco', run_ref: '123/1' }]);
    // 🔴 開工那一列【不准】自己帶 completed_at / outcome —— 帶了就等於出生就是「跑完了」
    expect(Object.keys(calls.inserted[0]!)).not.toContain('completed_at');
    expect(Object.keys(calls.inserted[0]!)).not.toContain('outcome');
  });

  it('🔴 寫不進去 ⇒ 回 null 而【不丟例外】(觀測不得讓同步變脆)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeClient({ insertError: 'permission denied' });
    await expect(openSyncRun(client, 'dbk', null)).resolves.toBeNull();
    // 🟢 而它必須【大聲】—— 安靜地少一班留痕, 與正常跑完在告警上同形
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]?.[0])).toContain('與「從來沒跑過」同形');
    err.mockRestore();
  });

  it('🔴 丟例外 ⇒ 也是回 null, 不往上炸', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeClient({ insertThrows: true });
    await expect(openSyncRun(client, 'dbk', null)).resolves.toBeNull();
    err.mockRestore();
  });

  it('🔴 沒有 error 而也沒有回傳列 ⇒ 一樣當失敗(不可以回 undefined.id)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = makeClient({ returnNoRow: true });
    await expect(openSyncRun(client, 'dbk', null)).resolves.toBeNull();
    err.mockRestore();
  });
});

describe('rpm-sync-run-log · 收工那一端', () => {
  it('回填成功 ⇒ 兩欄一起寫, 而且鎖在那一列的 id 上', async () => {
    const { client, calls } = makeClient({});
    await closeSyncRun(client, 4242, 'completed', null);
    expect(calls.eq).toEqual([['id', 4242]]);
    const patch = calls.updated[0]!;
    expect(patch.outcome).toBe('completed');
    // 🔴 三態的形狀:回填時兩欄都要有(DB 的 CHECK 也擋, 這裡是第二層)
    expect(typeof patch.completed_at).toBe('string');
  });

  it('outcome=failed 也寫得進去(失敗 ≠ 逾時, 兩者要分得開)', async () => {
    const { client, calls } = makeClient({});
    await closeSyncRun(client, 7, 'failed', 'orphan 閘擋下');
    expect(calls.updated[0]!.outcome).toBe('failed');
    expect(calls.updated[0]!.note).toBe('orphan 閘擋下');
  });

  it('🔴🔴 回填失敗 ⇒ 必須 throw —— 安靜失敗會製造一個【假的被砍告警】', async () => {
    const { client } = makeClient({ updateError: 'deadlock detected' });
    await expect(closeSyncRun(client, 4242, 'completed', null)).rejects.toThrow(/收工回填失敗/);
  });

  it('id 是 null(開工沒寫成)⇒ 不做任何 update, 也不算錯', async () => {
    const { client, calls } = makeClient({});
    await expect(closeSyncRun(client, null, 'completed', null)).resolves.toBeUndefined();
    expect(calls.updated).toEqual([]);
    expect(calls.table).toEqual([]);
  });
});

describe('rpm-sync-run-log · currentRunRef', () => {
  it('在 Actions 上 ⇒ 回 <run_id>/<attempt>', () => {
    expect(currentRunRef({ GITHUB_RUN_ID: '99', GITHUB_RUN_ATTEMPT: '2' } as NodeJS.ProcessEnv)).toBe('99/2');
  });
  it('沒有 attempt ⇒ 補 1(不是 undefined)', () => {
    expect(currentRunRef({ GITHUB_RUN_ID: '99' } as NodeJS.ProcessEnv)).toBe('99/1');
  });
  it('🟢 不在 Actions 上 ⇒ null, 而那不是錯', () => {
    expect(currentRunRef({} as NodeJS.ProcessEnv)).toBeNull();
  });
});
