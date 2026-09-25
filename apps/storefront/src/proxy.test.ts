// src/proxy.ts —— 每次請求的站別後備檢查(B2B 計畫第四版 C 節 L3)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => ({
  created: 0,
  /** 設了就在 getUser 時模擬權杖換新:呼叫 setAll 寫這些 cookie 與防快取標頭。 */
  refresh: null as { name: string; value: string }[] | null,
  authError: null as { name: string; status?: number } | null,
  user: { id: 'u-1' } as { id: string } | null,
  tierRow: { data: { tier: 'general' }, error: null, status: 200 } as {
    data: { tier: string; disabled_at?: string } | null;
    error: { code?: string; message: string } | null;
    status: number;
  },
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _u: string,
    _k: string,
    opts: { cookies: { setAll: (c: { name: string; value: string; options: object }[], hd: Record<string, string>) => void } },
  ) => {
    h.created++;
    return {
      auth: {
        getUser: async () => {
          if (h.refresh) {
            opts.cookies.setAll(
              h.refresh.map((c) => ({ ...c, options: { path: '/', maxAge: c.value ? 3600 : 0 } })),
              { 'Cache-Control': 'private, no-cache, no-store, must-revalidate, max-age=0' },
            );
          }
          return { data: { user: h.user }, error: h.authError };
        },
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => h.tierRow }) }) }),
    };
  },
}));

import { proxy, config } from './proxy';

const TOKEN = 'sb-abc-auth-token';
const setTier = (tier: string) => {
  h.tierRow = { data: { tier }, error: null, status: 200 };
};
function req(path: string, cookies: string[] = [`${TOKEN}.0=a`, `${TOKEN}.1=b`, `${TOKEN}-code-verifier=v`, 'pcm_cart=c'], headers: Record<string, string> = {}) {
  return new NextRequest(`https://b2b.pcmmotorsports.com${path}`, {
    method: 'next-action' in headers ? 'POST' : 'GET',
    headers: { cookie: cookies.join('; '), ...headers },
  });
}
/** response 上被設成過期的 cookie 名字。 */
const expired = (res: Response) =>
  res.headers
    .getSetCookie()
    .filter((c) => /Max-Age=0/i.test(c))
    .map((c) => ({ name: c.split('=')[0], rootPath: /Path=\/(;|$)/i.test(c) }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
  h.created = 0;
  h.refresh = null;
  h.authError = null;
  h.user = { id: 'u-1' };
  setTier('store');
});
afterEach(() => vi.unstubAllEnvs());

describe('proxy 站別後備檢查', () => {
  it('沒有登入 cookie ⇒ 不查(訪客零成本)', async () => {
    const res = await proxy(req('/products', ['pcm_cart=c', `${TOKEN}-code-verifier=v`]));
    expect(h.created).toBe(0);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('經銷站 + store ⇒ 放行,不刪 cookie', async () => {
    const res = await proxy(req('/products'));
    expect(h.created).toBe(1);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(expired(res)).toEqual([]);
  });

  // 20260926100000:工作階段還在而帳號已停用 ⇒ 兩站都登出並說明;一般站不可以落到「查不到就放行」
  it('停用 ⇒ 兩站都導到登入頁「此帳號已停用」,刪登入 cookie', async () => {
    for (const mode of ['b2b', 'retail']) {
      vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode);
      h.tierRow = { data: { tier: 'store', disabled_at: '2026-09-26T02:00:00+00:00' }, error: null, status: 200 };
      const res = await proxy(req('/products'));
      expect(res.status).toBe(307);
      const to = new URL(res.headers.get('location')!);
      expect(to.pathname + to.search).toBe('/login?error=site-disabled');
      expect(expired(res).map((c) => c.name)).toEqual([`${TOKEN}.0`, `${TOKEN}.1`]);
    }
  });

  // 🔴 計畫 E 節:經銷商被降級、一般會員剛被核准 ⇒ 下一個請求就登出並說明。
  it('經銷站 + 一般會員 ⇒ 導到登入頁「沒有經銷資格」,只刪登入 cookie(含分段、path=/),不刪 code-verifier', async () => {
    setTier('general');
    const res = await proxy(req('/products'));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname + new URL(res.headers.get('location')!).search).toBe(
      '/login?error=site-dealer-revoked',
    );
    expect(expired(res)).toEqual([
      { name: `${TOKEN}.0`, rootPath: true },
      { name: `${TOKEN}.1`, rootPath: true },
    ]);
  });

  it('一般站 + store ⇒ 導到登入頁「經銷資格已開通」', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    const res = await proxy(req('/'));
    expect(res.headers.get('location')).toContain('/login?error=site-dealer-approved');
    expect(expired(res)).toHaveLength(2);
  });

  it('經銷站查不到等級:可重試 ⇒ 503、不刪 cookie;不可重試 ⇒ 登出導到登入頁', async () => {
    h.tierRow = { data: null, error: { message: 'down' }, status: 503 };
    const retry = await proxy(req('/products'));
    expect(retry.status).toBe(503);
    expect(expired(retry)).toEqual([]);

    h.tierRow = { data: null, error: null, status: 200 }; // 查無此列
    const gone = await proxy(req('/products'));
    expect(gone.headers.get('location')).toContain('/login?error=site-unknown');
    expect(expired(gone)).toHaveLength(2);
  });

  it('一般站查不到等級 ⇒ 放行(一般站本來就顯示一般價)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    h.tierRow = { data: null, error: { message: 'down' }, status: 503 };
    const res = await proxy(req('/'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  // Fable L3 R2 consider 1:登入單純過期不是「查不到經銷資格」,不能叫客人聯絡業務。
  it('經銷站登入過期(AuthApiError 400、沒有 user)⇒ 當訪客放行,不導到 site-unknown', async () => {
    h.user = null;
    h.authError = { name: 'AuthApiError', status: 400 };
    const res = await proxy(req('/products'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
  it('帶著 cookie 但登入系統說沒有 session ⇒ 當訪客放行', async () => {
    h.user = null;
    h.authError = { name: 'AuthSessionMissingError' };
    const res = await proxy(req('/products'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  // 🔴 計畫 L3 細節 4:server action 被導向,瀏覽器會重送並顯示錯誤。
  it('帶 Next-Action 的請求 ⇒ 不導向,清掉 request 與 response 的登入 cookie 後放行', async () => {
    setTier('general');
    const res = await proxy(req('/cart', undefined, { 'next-action': 'abc' }));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(expired(res).map((c) => c.name)).toEqual([`${TOKEN}.0`, `${TOKEN}.1`]);
    const forwarded = res.headers.get('x-middleware-request-cookie') ?? '';
    expect(forwarded).not.toContain(`${TOKEN}.0`);
    expect(forwarded).toContain('pcm_cart=c');
  });

  // 🔴 Codex L3 R1 必修 1/4:權杖換新會改變分段(.0/.1 縮成不分段),新名字也要刪。
  it('正確帳號換新權杖 ⇒ 新 cookie 寫給瀏覽器與後面的頁面,帶防快取標頭', async () => {
    h.refresh = [{ name: TOKEN, value: 'new' }, { name: `${TOKEN}.0`, value: '' }, { name: `${TOKEN}.1`, value: '' }];
    const res = await proxy(req('/products'));
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${TOKEN}=new`))).toBe(true);
    expect(res.headers.get('x-middleware-request-cookie')).toContain(`${TOKEN}=new`);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });
  it('錯站帳號換新權杖後 ⇒ 導向時連新名字一起刪', async () => {
    setTier('general');
    h.refresh = [{ name: TOKEN, value: 'new' }];
    const res = await proxy(req('/products'));
    expect(res.status).toBe(307);
    expect(expired(res).map((c) => c.name).sort()).toEqual([TOKEN, `${TOKEN}.0`, `${TOKEN}.1`]);
  });
  it('錯站帳號換新權杖後的 action ⇒ 轉送給 action 的 cookie 裡沒有任何登入 cookie', async () => {
    setTier('general');
    h.refresh = [{ name: TOKEN, value: 'new' }];
    const res = await proxy(req('/cart', undefined, { 'next-action': 'abc' }));
    const forwarded = res.headers.get('x-middleware-request-cookie') ?? '';
    expect(forwarded).not.toMatch(/sb-abc-auth-token(\.\d)?=/);
    expect(forwarded).toContain(`${TOKEN}-code-verifier=v`);
  });
  it('換新權杖後查等級暫時失敗 ⇒ 503 仍帶著新權杖', async () => {
    h.refresh = [{ name: TOKEN, value: 'new' }];
    h.tierRow = { data: null, error: { message: 'down' }, status: 503 };
    const res = await proxy(req('/products'));
    expect(res.status).toBe(503);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${TOKEN}=new`))).toBe(true);
  });
  // 🔴 Codex L3 R1 必修 3:action 收到 HTML 503 只會顯示框架錯誤。
  it('經銷站暫時查不到等級時的 action ⇒ 放行,不回 503、不刪 cookie', async () => {
    h.tierRow = { data: null, error: { message: 'down' }, status: 503 };
    const res = await proxy(req('/account', undefined, { 'next-action': 'abc' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
    expect(expired(res)).toEqual([]);
  });

  // 🔴 /login 精確比對(避免迴圈);/login/reset、/auth/confirm 照 §9.9 不分流;登入入口自己會檢查。
  it('排除的路徑不查;/login/forgot 不排除', async () => {
    setTier('general');
    for (const p of ['/login', '/login/reset', '/auth/confirm', '/auth/callback', '/api/auth/line/callback']) {
      const res = await proxy(req(p));
      expect(res.headers.get('x-middleware-next'), p).toBe('1');
    }
    expect(h.created).toBe(0);
    const forgot = await proxy(req('/login/forgot'));
    expect(forgot.status).toBe(307);
  });

  it('matcher 不含靜態檔與圖片', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test('/products')).toBe(true);
    expect(re.test('/_next/static/chunks/a.js')).toBe(false);
    expect(re.test('/images/logo.png')).toBe(false);
  });

  // 🔴 Codex L3 R1 必修 2:頁面排除不等於 action 排除;只有 /login/reset 的 action 不查(重設密碼送出鈕)。
  it('action:/login、/auth/callback 照樣檢查;只有 /login/reset 不查', async () => {
    setTier('general');
    for (const p of ['/login', '/auth/callback']) {
      const res = await proxy(req(p, undefined, { 'next-action': 'abc' }));
      expect(expired(res).length, p).toBe(2);
    }
    h.created = 0;
    const reset = await proxy(req('/login/reset', undefined, { 'next-action': 'abc' }));
    expect(h.created).toBe(0);
    expect(expired(reset)).toEqual([]);
  });

  // B2B 入口:經銷站 /dealer-apply 一律導回一般站(申請中的人在經銷站會被登出);要在任何登入判斷之前。
  it('經銷站 /dealer-apply ⇒ 導到 www 的 /dealer-apply(沒登入也一樣,不查等級);一般站不導', async () => {
    const res = await proxy(req('/dealer-apply?edit=1', ['pcm_cart=c']));
    expect(res.headers.get('location')).toBe('https://www.pcmmotorsports.com/dealer-apply?edit=1');
    expect(h.created).toBe(0);
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    const retail = await proxy(req('/dealer-apply', ['pcm_cart=c']));
    expect(retail.headers.get('location')).toBeNull();
  });
});
