// 用【真的】supabase-js client 打假的 HTTP 回應(storefront 不准 import @pcm/adapters/server, 改用同一套 supabase-js 的 anon 版;
// 查詢鏈與回應處理跟 service client 相同, 差別只在金鑰),
// 不自己捏 { error: { code } }(Codex R1:那樣會跳過 SDK 對回應的處理, 抓不到 HEAD 沒有錯誤本文那個洞)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createSupabaseAnonClient } from '@pcm/adapters';
import { readDealerApplicationsPendingCount, type PendingCountClient } from './dealer-applications-pending-read';

const requests: { method: string; url: string }[] = [];
function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ method: init?.method ?? 'GET', url: String(input) });
      // 真的 PostgREST 對 HEAD 不回本文(錯誤碼只在 Proxy-Status 標頭)⇒ 假回應也照做
      const isHead = (init?.method ?? 'GET') === 'HEAD';
      return new Response(body === null || isHead ? null : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      });
    }),
  );
}
const client = () => createSupabaseAnonClient() as unknown as PendingCountClient;

beforeEach(() => {
  requests.length = 0;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('經銷商申請待審件數(每日 LINE 摘要用;真 SDK)', () => {
  it('讀到 ⇒ 回件數;是 GET(不是 HEAD)、只取 1 列 id、只數 status=pending', async () => {
    respond(206, [{ id: 'a' }], { 'content-range': '0-0/3' });
    expect(await readDealerApplicationsPendingCount(client())).toBe(3);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.url).toContain('/rest/v1/dealer_applications');
    expect(requests[0]!.url).toContain('status=eq.pending');
    expect(requests[0]!.url).toContain('select=id');
    expect(requests[0]!.url).toContain('limit=1');
  });

  it('沒有待審 ⇒ 0', async () => {
    respond(200, [], { 'content-range': '*/0' });
    expect(await readDealerApplicationsPendingCount(client())).toBe(0);
  });

  it('🔴 表還沒建(PostgREST 404 PGRST205)⇒ undefined(摘要不印, 也不列「讀不到」)', async () => {
    respond(404, { code: 'PGRST205', message: "Could not find the table 'public.dealer_applications' in the schema cache", details: null, hint: null });
    expect(await readDealerApplicationsPendingCount(client())).toBeUndefined();
  });

  it('🔴 其他錯誤(例如 500)⇒ throw(route 接成「讀不到」, 不當成 0)', async () => {
    respond(500, { code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null });
    await expect(readDealerApplicationsPendingCount(client())).rejects.toBeTruthy();
  });
});
