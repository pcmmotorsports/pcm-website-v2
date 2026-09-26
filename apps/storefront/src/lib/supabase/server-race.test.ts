// 伺服器端 Supabase client 的「舊登入背景換發」競態(2026-09-26, 計畫 ~/pcm-mailbox/計畫-共用登入client競態-20260926.md 第 2 版, Sean Q27 甲)。
// 用真的 @supabase/ssr createServerClient、auth-js 與 Next 的 ResponseCookies(cookies() 可寫時的底層),只把網路回應換成假的:
// 瀏覽器帶著舊帳號 old 已過期的登入, 這個請求要登入新帳號 new。換發舊登入(20ms)比登入新帳號(5ms)慢回來。
// createServerClient 一建立就掛 onAuthStateChange ⇒ auth-js 在背景讀目前登入 ⇒ 過期就換發並寫回 cookie。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResponseCookies } from 'next/dist/compiled/@edge-runtime/cookies';

const { jar } = vi.hoisted(() => ({ jar: { rc: null as unknown as ResponseCookies } }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({
  // 同 Next 16 MutableRequestCookiesAdapter:底層是一份 ResponseCookies, 讀到的就是剛寫的(刪除 = 值變空字串)
  cookies: async () => ({
    getAll: () => jar.rc.getAll().map(({ name, value }) => ({ name, value })),
    set: (...args: Parameters<ResponseCookies['set']>) => jar.rc.set(...args),
    delete: (...args: Parameters<ResponseCookies['delete']>) => jar.rc.delete(...args),
  }),
}));

import { createServerSupabaseClient, createSignInSupabaseClient } from './server';

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
  const v = jar.rc.get(KEY)?.value ?? '';
  return v ? JSON.parse(Buffer.from(v.replace(/^base64-/, ''), 'base64url').toString()).user.id : null;
};
const reply = (body: unknown, ms: number) =>
  new Promise<Response>((r) => setTimeout(() => r(new Response(JSON.stringify(body), { status: 200 })), ms));
const settle = () => new Promise((r) => setTimeout(r, 60));

type Client = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type SignIn = (c: Client) => Promise<{ error: unknown }>;
// 四個會建立登入狀態的入口, 各自呼叫的 auth-js 方法(參數照正式程式)
const ENTRIES: [string, SignIn][] = [
  ['密碼登入 SupabaseAuthAdapter.ts:79', (c) => c.auth.signInWithPassword({ email: 'new@example.com', password: 'x' })],
  ['Google 與信件連結 auth/callback/route.ts:31', (c) => c.auth.exchangeCodeForSession('code-1')],
  ['LINE 登入 api/auth/line/callback/route.ts:131', (c) => c.auth.verifyOtp({ token_hash: 'h1', type: 'email' })],
  ['確認信 / 邀請 / 重設 auth/confirm/route.ts:37', (c) => c.auth.verifyOtp({ token_hash: 'h1', type: 'email' })],
];

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `https://${REF}.supabase.co`);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  jar.rc = new ResponseCookies(new Headers());
  jar.rc.set(KEY, `base64-${b64(session('old', -3600))}`); // 舊帳號, 一小時前就過期
  jar.rc.set(`${KEY}-code-verifier`, `base64-${b64('verifier-1')}`); // Google 那條要用
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('grant_type=refresh_token')) return reply(session('old', 3600), 20); // 換發舊登入:慢
      if (url.includes('grant_type=password') || url.includes('grant_type=pkce') || url.endsWith('/verify'))
        return reply(session('new', 3600), 5); // 登入新帳號:快
      return new Response('{}', { status: 404 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('伺服器端 client:舊帳號過期登入的背景換發', () => {
  it.each(ENTRIES)('前提:一般的 client 直接登入 ⇒ %s 登入成功, 但 cookie 最後被蓋回舊帳號', async (_name, signIn) => {
    const c = await createServerSupabaseClient();
    expect((await signIn(c)).error).toBeNull();
    await settle();
    expect(storedUser()).toBe('old');
  });

  it('不採用的修法:先 await getSession() ⇒ 換發舊登入時會刪掉 code-verifier, Google 登入直接失敗', async () => {
    const c = await createServerSupabaseClient();
    await c.auth.getSession();
    const { error } = await c.auth.exchangeCodeForSession('code-1');
    expect(String((error as { message?: string } | null)?.message)).toMatch(/code verifier not found/);
  });

  it.each(ENTRIES)('🔴 createSignInSupabaseClient ⇒ %s 成功, cookie 是新帳號', async (_name, signIn) => {
    const c = await createSignInSupabaseClient();
    expect((await signIn(c)).error).toBeNull();
    await settle();
    expect(storedUser()).toBe('new');
  });

  it('🔴 舊登入分成好幾段(.0 .1 .2)也全部刪掉, 不會和新登入混在一起', async () => {
    jar.rc.delete(KEY);
    const big = `base64-${b64({ ...session('old', -3600), pad: 'x'.repeat(7000) })}`;
    [0, 1, 2].forEach((i) => jar.rc.set(`${KEY}.${i}`, big.slice(i * 3180, (i + 1) * 3180)));
    const c = await createSignInSupabaseClient();
    // 登入之前就已經清乾淨(不是靠登入時 ssr 順手覆蓋)
    expect(jar.rc.getAll().filter((x) => x.name.startsWith(KEY) && !x.name.endsWith('code-verifier') && x.value !== '')).toEqual([]);
    expect((await c.auth.signInWithPassword({ email: 'new@example.com', password: 'x' })).error).toBeNull();
    await settle();
    expect(storedUser()).toBe('new');
    expect(jar.rc.getAll().filter((x) => x.name.startsWith(`${KEY}.`) && x.value !== '')).toEqual([]);
  });

  it('🔴 登入還有效(例如同一個確認連結開第二次, 帶著剛建立的新登入)⇒ 不刪', async () => {
    jar.rc.set(KEY, `base64-${b64(session('new', 3600))}`);
    await createSignInSupabaseClient();
    expect(storedUser()).toBe('new');
  });

  it('🔴 120 秒內就會過期的也刪(auth-js 剩 90 秒就背景換發), 然後登入得到新帳號', async () => {
    jar.rc.set(KEY, `base64-${b64(session('old', 100))}`);
    const c = await createSignInSupabaseClient();
    expect(storedUser()).toBeNull();
    await c.auth.signInWithPassword({ email: 'new@example.com', password: 'x' });
    await settle();
    expect(storedUser()).toBe('new');
  });

  it('對照:沒有舊登入 cookie 時, 不做任何事也不會被蓋', async () => {
    jar.rc.delete(KEY);
    const c = await createServerSupabaseClient();
    await c.auth.signInWithPassword({ email: 'new@example.com', password: 'x' });
    await settle();
    expect(storedUser()).toBe('new');
  });
});
