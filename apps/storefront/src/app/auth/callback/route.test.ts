// route.test.ts — /auth/callback GET handler 測試(M-1-14e-f1-c、OAuth 換 session)
//
// 驗:① 有 code + exchangeCodeForSession 成功 → redirect POST_AUTH_REDIRECT('/')
//     ② 有 code + 交換失敗 → redirect /login?error=oauth(不上洩原始 error)
//     ③ 無 code → 不呼叫 exchange、redirect /login?error=oauth
// node env;mock '@/lib/supabase/server'(避免載 server-only)+ next/navigation redirect。
// redirect() 實際 throw NEXT_REDIRECT(停止後續執行);mock 以 throw 模擬、確保成功路徑不續落到 fallback redirect。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectSpy, exchangeSpy } = vi.hoisted(() => ({
  // 模擬 next/navigation redirect():實際會 throw 中止 handler、本 mock 以 throw 還原此語意。
  redirectSpy: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  exchangeSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () =>
    Promise.resolve({ auth: { exchangeCodeForSession: exchangeSpy } }),
}));

import { GET } from './route';

beforeEach(() => {
  redirectSpy.mockClear(); // 保留 throw 實作、只清呼叫紀錄
  exchangeSpy.mockReset();
  exchangeSpy.mockResolvedValue({ error: null });
});

afterEach(() => vi.clearAllMocks());

describe('/auth/callback GET', () => {
  it('有 code + 交換成功(無 next)→ redirect POST_AUTH_REDIRECT(/)', async () => {
    await expect(
      GET(new Request('http://localhost:3000/auth/callback?code=abc123')),
    ).rejects.toThrow('NEXT_REDIRECT:/');
    expect(exchangeSpy).toHaveBeenCalledWith('abc123');
    expect(redirectSpy).toHaveBeenCalledWith('/');
  });

  it('#190:有 code + 合法 next → 交換成功導回 next(/account)', async () => {
    await expect(
      GET(new Request('http://localhost:3000/auth/callback?code=abc123&next=%2Faccount')),
    ).rejects.toThrow('NEXT_REDIRECT:/account');
    expect(redirectSpy).toHaveBeenCalledWith('/account');
  });

  it('#190:有 code + 惡意 next(protocol-relative)→ 白名單擋成 /', async () => {
    await expect(
      GET(new Request('http://localhost:3000/auth/callback?code=abc123&next=%2F%2Fevil.com')),
    ).rejects.toThrow('NEXT_REDIRECT:/');
    expect(redirectSpy).toHaveBeenCalledWith('/');
  });

  it('有 code + 交換失敗 → redirect /login?error=oauth', async () => {
    exchangeSpy.mockResolvedValue({ error: { message: 'pkce mismatch' } });
    await expect(
      GET(new Request('http://localhost:3000/auth/callback?code=bad')),
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=oauth');
    expect(exchangeSpy).toHaveBeenCalledWith('bad');
    expect(redirectSpy).toHaveBeenCalledWith('/login?error=oauth');
  });

  it('無 code → 不呼叫 exchange、redirect /login?error=oauth', async () => {
    await expect(
      GET(new Request('http://localhost:3000/auth/callback')),
    ).rejects.toThrow('NEXT_REDIRECT:/login?error=oauth');
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(redirectSpy).toHaveBeenCalledWith('/login?error=oauth');
  });
});
