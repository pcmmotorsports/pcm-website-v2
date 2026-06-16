// route.test.ts — /api/auth/line/callback GET handler 測試(M-1-14e-f2-a2)
//
// node env;mock 'server-only' + next/headers cookies(get/delete)+ next/navigation redirect(throw)+
// @/lib/auth/line(exchange/verify)+ @/lib/auth/line-admin(authenticateLineUser)+ @/lib/supabase/server(verifyOtp)。
// 驗:state 不符 / 缺 code → error redirect;happy path → POST_AUTH_REDIRECT;collision_not_line → error;
//     verifyOtp 錯 → error;且每次都刪 state/nonce cookie(用後即刪)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { redirectSpy, getSpy, deleteSpy, exchangeSpy, verifyIdSpy, authLineSpy, verifyOtpSpy } =
  vi.hoisted(() => ({
    redirectSpy: vi.fn((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    getSpy: vi.fn(),
    deleteSpy: vi.fn(),
    exchangeSpy: vi.fn(),
    verifyIdSpy: vi.fn(),
    authLineSpy: vi.fn(),
    verifyOtpSpy: vi.fn(),
  }));

vi.mock('next/navigation', () => ({ redirect: redirectSpy }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: getSpy, delete: deleteSpy }),
}));
vi.mock('@/lib/auth/line', async (orig) => {
  // 保留真常數(cookie 名 / path)、只 mock fetch 類函式。
  const actual = await orig<typeof import('@/lib/auth/line')>();
  return {
    ...actual,
    exchangeCodeForToken: exchangeSpy,
    verifyIdToken: verifyIdSpy,
  };
});
vi.mock('@/lib/auth/line-admin', () => ({ authenticateLineUser: authLineSpy }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => Promise.resolve({ auth: { verifyOtp: verifyOtpSpy } }),
}));

import { GET } from './route';

// state cookie 值固定、query 帶相同值 → safeEqual 通過。
const STATE = 'state-value-1234';
const NONCE = 'nonce-value-5678';

function cookieStore(stateVal?: string, nonceVal?: string, nextVal?: string) {
  getSpy.mockImplementation((name: string) => {
    if (name === 'line_oauth_state' && stateVal !== undefined) return { value: stateVal };
    if (name === 'line_oauth_nonce' && nonceVal !== undefined) return { value: nonceVal };
    if (name === 'line_oauth_next' && nextVal !== undefined) return { value: nextVal };
    return undefined;
  });
}

function req(query: string) {
  return new Request(`http://localhost:3000/api/auth/line/callback${query}`);
}

beforeEach(() => {
  redirectSpy.mockClear();
  deleteSpy.mockClear();
  exchangeSpy.mockReset().mockResolvedValue({ idToken: 'idtok' });
  verifyIdSpy.mockReset().mockResolvedValue({ sub: 'U' + 'e'.repeat(32), name: 'T', email: null });
  authLineSpy.mockReset().mockResolvedValue({ ok: true, hashedToken: 'htok' });
  verifyOtpSpy.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => vi.clearAllMocks());

describe('/api/auth/line/callback GET', () => {
  it('happy path:state 相符 + 全鏈成功 → redirect POST_AUTH_REDIRECT(/)', async () => {
    cookieStore(STATE, NONCE);
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/');
    expect(exchangeSpy).toHaveBeenCalledWith('abc');
    expect(verifyIdSpy).toHaveBeenCalledWith('idtok', NONCE);
    expect(verifyOtpSpy).toHaveBeenCalledWith({ token_hash: 'htok', type: 'email' });
    // 用後即刪三 cookie:state + nonce + next(#190)
    expect(deleteSpy).toHaveBeenCalledTimes(3);
  });

  it('state 不符 → error redirect、不換 token', async () => {
    cookieStore('DIFFERENT', NONCE);
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
    expect(exchangeSpy).not.toHaveBeenCalled();
    expect(deleteSpy).toHaveBeenCalledTimes(3); // 仍清三 cookie(含 next)
  });

  it('#190:happy path 帶合法 next cookie → 導回 next(/account)', async () => {
    cookieStore(STATE, NONCE, '/account');
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/account');
  });

  it('#190:next cookie 為惡意值 → sink 白名單擋成 /(縱深)', async () => {
    cookieStore(STATE, NONCE, '//evil.com');
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow('NEXT_REDIRECT:/');
  });

  it('缺 code(LINE 取消授權)→ error redirect', async () => {
    cookieStore(STATE, NONCE);
    await expect(GET(req(`?state=${STATE}&error=access_denied`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
    expect(exchangeSpy).not.toHaveBeenCalled();
  });

  it('缺 state cookie(過期/無)→ error redirect', async () => {
    cookieStore(undefined, NONCE);
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
    expect(exchangeSpy).not.toHaveBeenCalled();
  });

  it('collision_not_line(防冒登入)→ error redirect、不發 session', async () => {
    cookieStore(STATE, NONCE);
    authLineSpy.mockResolvedValue({ ok: false, reason: 'collision_not_line' });
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
    expect(verifyOtpSpy).not.toHaveBeenCalled();
  });

  it('verifyOtp 失敗 → error redirect', async () => {
    cookieStore(STATE, NONCE);
    verifyOtpSpy.mockResolvedValue({ error: { message: 'otp invalid' } });
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
  });

  it('LINE token 交換 throw → catch 後 error redirect(不上洩)', async () => {
    cookieStore(STATE, NONCE);
    exchangeSpy.mockRejectedValue(new Error('LINE token exchange failed: 400'));
    await expect(GET(req(`?code=abc&state=${STATE}`))).rejects.toThrow(
      'NEXT_REDIRECT:/login?error=line',
    );
  });
});
