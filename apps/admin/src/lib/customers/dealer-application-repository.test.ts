import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

type Q = Record<string, ReturnType<typeof vi.fn>> & { result: unknown };
const calls: Array<[string, unknown[]]> = [];
let nextResult: unknown = { data: [], error: null };
function builder(): Q {
  const q = {} as Q;
  for (const m of ['select', 'eq', 'order', 'limit', 'maybeSingle', 'in']) {
    q[m] = vi.fn((...args: unknown[]) => {
      calls.push([m, args]);
      return q;
    });
  }
  (q as unknown as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve(nextResult).then(res);
  return q;
}
const from = vi.fn((table: string) => {
  calls.push(['from', [table]]);
  return builder();
});
vi.mock('@pcm/adapters/server', async () => {
  const real = await import('../../../../../packages/adapters/src/supabase/SupabaseDealerApplicationAdapter');
  return { createSupabaseServiceClient: () => ({ from }), SupabaseDealerApplicationAdapter: real.SupabaseDealerApplicationAdapter };
});

import {
  countPendingDealerApplications,
  loadDealerApplications,
} from './dealer-application-repository';

beforeEach(() => {
  calls.length = 0;
  nextResult = { data: [], error: null };
});

describe('經銷商申請的讀取(service_role, 員工用)', () => {
  it('列表:審核中 ⇒ 篩 status=pending、新的在前', async () => {
    nextResult = { data: [{ id: 'a' }], error: null };
    const r = await loadDealerApplications('pending');
    expect(r).toEqual({ ok: true, rows: [{ id: 'a' }] });
    expect(calls).toContainEqual(['from', ['dealer_applications']]);
    expect(calls).toContainEqual(['eq', ['status', 'pending']]);
    expect(calls).toContainEqual(['order', ['created_at', { ascending: false }]]);
  });

  it('列表:全部 ⇒ 不篩狀態', async () => {
    await loadDealerApplications('all');
    expect(calls.some(([m, a]) => m === 'eq' && a[0] === 'status')).toBe(false);
  });

  it('🔴 讀取失敗 ⇒ ok:false(畫面要顯示載入失敗, 不是「目前沒有申請」)', async () => {
    nextResult = { data: null, error: { message: 'boom' } };
    expect(await loadDealerApplications('pending')).toEqual({ ok: false });
  });

  it('待處理件數:讀不到回 null(不是 0)', async () => {
    nextResult = { count: 3, error: null, data: null };
    expect(await countPendingDealerApplications()).toBe(3);
    nextResult = { count: null, error: { message: 'boom' }, data: null };
    expect(await countPendingDealerApplications()).toBeNull();
  });
});

describe('建 client 失敗(例如缺 env)', () => {
  it('🔴 不往外丟, 回載入失敗 / null, 讓頁面顯示錯誤而不是整頁 500', async () => {
    from.mockImplementationOnce(() => {
      throw new Error('SUPABASE env 缺');
    });
    expect(await countPendingDealerApplications()).toBeNull();
    from.mockImplementationOnce(() => {
      throw new Error('SUPABASE env 缺');
    });
    expect(await loadDealerApplications('pending')).toEqual({ ok: false });
  });
});
