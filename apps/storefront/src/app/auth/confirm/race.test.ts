// /auth/confirm 與「舊登入的背景換發」的競態重現(2026-09-26 上線後修正, 見 route.ts 檔頭)。
// 用真的 @supabase/ssr createServerClient 與 auth-js, 只把網路回應換成假的:
// 瀏覽器帶著舊帳號 old 已過期的登入, 開了新帳號 new 的確認連結。換發舊登入比驗證連結慢回來。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [...store].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, options?: { maxAge?: number }) => {
      if (options?.maxAge === 0 || value === '') store.delete(name);
      else store.set(name, value);
    },
  }),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock('@/lib/auth/site-login-gate', () => ({ checkSiteAfterLogin: async () => null, siteLoginErrorPath: () => '/login' }));

const REF = 'abcdefghijklmnopqrst';
const KEY = `sb-${REF}-auth-token`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub: string, exp: number) => `${b64({ alg: 'HS256' })}.${b64({ sub, exp, role: 'authenticated' })}.sig`;
const session = (sub: string, expiresIn: number) => {
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  return {
    access_token: jwt(sub, exp),
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: exp,
    refresh_token: `rt-${sub}`,
    user: { id: sub, aud: 'authenticated', email: `${sub}@example.com` },
  };
};
const storedUser = () => {
  const v = store.get(KEY) ?? '';
  return v ? JSON.parse(Buffer.from(v.replace(/^base64-/, ''), 'base64url').toString()).user.id : null;
};
const reply = (body: unknown, ms: number) =>
  new Promise<Response>((r) => setTimeout(() => r(new Response(JSON.stringify(body), { status: 200 })), ms));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${REF}.supabase.co`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  store.clear();
  store.set(KEY, `base64-${b64(session('old', -3600))}`); // 舊帳號, 一小時前就過期
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('grant_type=refresh_token')) return reply(session('old', 3600), 20); // 換發舊登入:慢
      if (url.endsWith('/verify')) return reply(session('new', 3600), 5); // 驗證連結:快
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('/auth/confirm 與舊登入的背景換發', () => {
  it('前提:不先等, 直接 verifyOtp ⇒ 舊帳號後寫, 蓋掉剛確認的新帳號(正式站 09-25 19:33 的狀況)', async () => {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server');
    const supabase = await createServerSupabaseClient();
    await supabase.auth.verifyOtp({ type: 'email', token_hash: 'h1' });
    await new Promise((r) => setTimeout(r, 60));
    expect(storedUser()).toBe('old');
  });

  it('🔴 route:確認完成後 cookie 裡是新帳號, 背景換發不會再蓋回舊帳號', async () => {
    const { GET } = await import('./route');
    await expect(GET(new Request('https://www.pcmmotorsports.com/auth/confirm?token_hash=h1&type=email'))).rejects.toThrow(
      'NEXT_REDIRECT:/?confirmed=1',
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(storedUser()).toBe('new');
  });
});
