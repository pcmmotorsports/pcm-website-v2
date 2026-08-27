// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import { HEARTBEAT_TABLE, getHeartbeatStore } from './composition';

// composition.test.ts — storefront 第六道 service_role 門的**射程守門**。
//
// 🔴 **這支的主要職責只有一句:證明那道門只通到一張表。**
//    `composition.ts` 檔頭寫著「只寫 `public.sweeper_heartbeat` 一張表」——
//    ⚠️ **而一句註解擋不住任何人。** 沒有下面那幾格,那句話與「我們打算只寫一張表」是同一個強度。
//    ⇒ 把 `.from()` 的字面改成別張表 ⇒ 這裡要紅。
//
// 🔴 **誠實邊界**:鏈式 mock 只證**送出去的形狀**。
//    **不證** PostgREST 接受這個 upsert、不證欄位真的長這樣、不證 `service_role` 寫得進去。
//    ⚠️ 權限那一格**有另一發證據、不在本檔**:2026-08-28 對正式庫唯讀量到
//    `rolbypassrls(service_role)=true`、RLS on + 3 條 policy(皆 `TO service_role`)、
//    `role_table_grants` 給 `SELECT/INSERT/UPDATE`(無 DELETE/TRUNCATE),`anon`/`authenticated` 零列。

function chain(result: { data?: unknown; error?: unknown } = {}) {
  const calls: { upsert: unknown[][] } = { upsert: [] };
  const self: Record<string, unknown> = {};
  self.select = () => self;
  self.eq = () => self;
  self.maybeSingle = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
  self.upsert = (...args: unknown[]) => {
    calls.upsert.push(args);
    return Promise.resolve({ error: result.error ?? null });
  };
  return { self, calls };
}

beforeEach(() => vi.clearAllMocks());

describe('🔴 射程:這道門只通到 sweeper_heartbeat', () => {
  it('write 只打 sweeper_heartbeat(改成別張表這一格會紅)', async () => {
    const { self } = chain();
    mocks.from.mockReturnValue(self);

    await getHeartbeatStore().write({ job_name: 'pcm-settle-sweep' });

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('sweeper_heartbeat');
    // 常數本身也釘住 —— 有人改常數而沒改註解時,這一格會先紅。
    expect(HEARTBEAT_TABLE).toBe('sweeper_heartbeat');
  });

  it('readFailureCount 只打 sweeper_heartbeat', async () => {
    const { self } = chain({ data: { consecutive_failures: 4 } });
    mocks.from.mockReturnValue(self);

    await getHeartbeatStore().readFailureCount('pcm-email-sweep');

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith('sweeper_heartbeat');
  });

  it('🔴 這道門【不吐 client 出去】—— 型別上只有兩支,實物上也只有兩支', () => {
    const { self } = chain();
    mocks.from.mockReturnValue(self);
    const store = getHeartbeatStore();
    // 多一個能打到別張表的成員 ⇒ 這道門就從「把鑰匙關在裡面的盒子」變成「一把外流的鑰匙」。
    expect(Object.keys(store).sort()).toEqual(['readFailureCount', 'write']);
  });
});

describe('write 的形狀', () => {
  it('🔴 帶 onConflict:job_name —— 少了它 upsert 會退化成 insert、第二輪起撞 PK', async () => {
    const { self, calls } = chain();
    mocks.from.mockReturnValue(self);

    await getHeartbeatStore().write({ job_name: 'pcm-settle-sweep', consecutive_failures: 0 });

    const [row, options] = calls.upsert[0]! as [Record<string, unknown>, Record<string, unknown>];
    expect(row.job_name).toBe('pcm-settle-sweep');
    expect(options.onConflict).toBe('job_name');
  });
});

describe('readFailureCount', () => {
  it('讀到數字 ⇒ 原值回去', async () => {
    const { self } = chain({ data: { consecutive_failures: 4 } });
    mocks.from.mockReturnValue(self);
    await expect(getHeartbeatStore().readFailureCount('pcm-settle-sweep')).resolves.toBe(4);
  });

  it('🔴 沒有那一列 / 讀出錯 / 型別不對 ⇒ 一律 null(呼叫端據此從 0 起算,不得兜出 NaN)', async () => {
    for (const bad of [null, { consecutive_failures: '3' }, { consecutive_failures: null }, {}]) {
      vi.clearAllMocks();
      const { self } = chain({ data: bad });
      mocks.from.mockReturnValue(self);
      await expect(getHeartbeatStore().readFailureCount('pcm-settle-sweep')).resolves.toBeNull();
    }
    // 讀出錯那一條另外走(要留痕)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.clearAllMocks();
    const { self } = chain({ error: { message: 'boom' } });
    mocks.from.mockReturnValue(self);
    await expect(getHeartbeatStore().readFailureCount('pcm-settle-sweep')).resolves.toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
