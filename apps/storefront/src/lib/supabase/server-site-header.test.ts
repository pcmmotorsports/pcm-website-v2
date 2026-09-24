// lib/supabase/server.ts —— 建單請求要帶 x-pcm-site(B2B D1,Codex D1 計畫 R1 必修 4:兩端分開驗抓不到中間漏接)。
// 走真正的建單組法:getOrderRepo()(lib/auth/composition.ts)→ placeOrder → supabase-js 送出的 HTTP 請求。
// 資料庫端「收到這個標頭會擋」在拋棄式庫實跑(見 scripts/b2b-d1-no-general-fallback-migration.test.ts 檔頭)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined }) }));

const seen: { url: string; site: string | null }[] = [];
beforeEach(() => {
  seen.length = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    seen.push({ url: String(input), site: headers.get('x-pcm-site') });
    return new Response(JSON.stringify({ order_id: 'o-1' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function placeOnce() {
  const { getOrderRepo } = await import('@/lib/auth/composition');
  const repo = await getOrderRepo();
  // 最小的建單輸入(mapper 只要 lines 是陣列、invoice 有 type);只看送出的請求,回應內容不重要。
  await repo
    .placeOrder({ lines: [], invoice: { type: 'personal' }, paymentChannel: 'tappay' } as never)
    .catch(() => undefined);
  return seen.find((r) => r.url.includes('/rest/v1/rpc/create_order'));
}

describe('建單請求帶 x-pcm-site', () => {
  it('經銷站 ⇒ b2b', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    expect((await placeOnce())?.site).toBe('b2b');
  });
  it('一般站 ⇒ retail', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    expect((await placeOnce())?.site).toBe('retail');
  });
});
