// client.test.ts — `createSupabaseAnonClient({ fetchTimeoutMs })`:一發假 fetch 永不回 ⇒ 上限到就拋、
// 而**不傳**的時候 fetch 收不到 signal(wallet / auth 那邊行為零改變)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createSupabaseAnonClient } from './client';

type FetchInit = { signal?: AbortSignal | null } | undefined;
const seenInits: FetchInit[] = [];

// 永不回的 fetch —— 只有 signal abort 才會 reject(照 undici 的行為丟 signal.reason)。
const hangingFetch = vi.fn((_input: unknown, init?: FetchInit) => {
  seenInits.push(init);
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });
});

beforeEach(() => {
  seenInits.length = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.test');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubGlobal('fetch', hangingFetch);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('createSupabaseAnonClient · fetchTimeoutMs', () => {
  it('傳 fetchTimeoutMs ⇒ fetch 永不回也會在上限內拋 TimeoutError, 而且是回 { error } 給呼叫端接', async () => {
    const client = createSupabaseAnonClient({ fetchTimeoutMs: 50 });
    const t0 = performance.now();
    const { data, error } = await client.rpc('get_vehicle_taxonomy' as never);
    expect(performance.now() - t0).toBeLessThan(2_000);
    expect(data).toBeNull();
    expect(String(error?.message)).toContain('TimeoutError');
    expect(seenInits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('🔵 負對照:不傳 ⇒ fetch 收到的 init 沒有 signal(舊呼叫端 byte 不變)', async () => {
    const client = createSupabaseAnonClient();
    // 不 await 結果 —— 它永遠不會回, 這一格只看送出去的 init。
    void client.rpc('get_vehicle_taxonomy' as never).then(() => undefined, () => undefined);
    await vi.waitFor(() => expect(seenInits.length).toBe(1));
    expect(seenInits[0]?.signal ?? null).toBeNull();
  });
});
