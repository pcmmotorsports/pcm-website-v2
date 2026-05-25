// route.test.ts — /api/auth/line/start GET handler 測試(M-1-14e-f2-a1)
//
// 驗:產 state + nonce → 寫兩個短效 cookie(httpOnly/sameSite=lax/path 限縮)→ redirect LINE authorize URL。
// node env;mock 'server-only'(line.ts 讀 secret)+ next/headers cookies()(假 store + set spy)+
// next/navigation redirect(throw 還原中止語意、同 /auth/callback 測試慣例)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { redirectSpy, setSpy } = vi.hoisted(() => ({
  redirectSpy: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  setSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect: redirectSpy }));
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ set: setSpy }),
}));

import { GET } from './route';

const ENV_KEYS = ['LINE_CHANNEL_ID', 'LINE_CHANNEL_SECRET', 'LINE_REDIRECT_URI'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  redirectSpy.mockClear();
  setSpy.mockClear();
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.LINE_CHANNEL_ID = '1234567890';
  process.env.LINE_CHANNEL_SECRET = 'secret-xyz';
  process.env.LINE_REDIRECT_URI = 'http://localhost:3000/api/auth/line/callback';
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.clearAllMocks();
});

describe('/api/auth/line/start GET', () => {
  it('寫 state + nonce cookie 後 redirect LINE authorize', async () => {
    await expect(GET()).rejects.toThrow(/NEXT_REDIRECT:https:\/\/access\.line\.me\/oauth2\/v2\.1\/authorize/);

    // 兩個 cookie 都寫:state + nonce
    expect(setSpy).toHaveBeenCalledTimes(2);
    const names = setSpy.mock.calls.map((c) => c[0]);
    expect(names).toContain('line_oauth_state');
    expect(names).toContain('line_oauth_nonce');

    // cookie 選項:httpOnly + sameSite=lax + path 限縮 + maxAge
    for (const call of setSpy.mock.calls) {
      const opts = call[2];
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/api/auth/line');
      expect(opts.maxAge).toBe(600);
      expect(typeof call[1]).toBe('string');
      expect((call[1] as string).length).toBeGreaterThan(0);
    }

    // redirect URL 帶上與 cookie 同一份 state / nonce
    const redirectedTo = redirectSpy.mock.calls[0]?.[0];
    expect(redirectedTo).toBeDefined();
    const url = new URL(redirectedTo as string);
    const stateCall = setSpy.mock.calls.find((c) => c[0] === 'line_oauth_state');
    const nonceCall = setSpy.mock.calls.find((c) => c[0] === 'line_oauth_nonce');
    expect(url.searchParams.get('state')).toBe(stateCall?.[1]);
    expect(url.searchParams.get('nonce')).toBe(nonceCall?.[1]);
  });

  it('缺 LINE env → throw(fail fast、不 redirect)', async () => {
    delete process.env.LINE_CHANNEL_ID;
    await expect(GET()).rejects.toThrow('LINE_CHANNEL_ID not set');
    expect(redirectSpy).not.toHaveBeenCalled();
    expect(setSpy).not.toHaveBeenCalled();
  });
});
