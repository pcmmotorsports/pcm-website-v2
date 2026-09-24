// lib/auth/site-login-gate.ts —— 剛登入時的站別檢查(B2B 計畫第四版 C 節 L2)。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  tierRow: { data: { tier: 'general' } as { tier: string } | null, error: null as { message: string } | null, status: 200 },
  signOut: vi.fn(),
  jar: [] as { name: string }[],
  deleted: [] as { name: string; path?: string }[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user }, error: null }),
      signOut: h.signOut,
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => h.tierRow }) }) }),
  }),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => h.jar,
    delete: (c: { name: string; path?: string }) => h.deleted.push(c),
  }),
}));

import { checkSiteAfterLogin, siteLoginErrorPath } from './site-login-gate';

const setTier = (tier: string) => {
  h.tierRow = { data: { tier }, error: null, status: 200 };
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
  h.user = { id: 'u-1' };
  setTier('general');
  h.signOut.mockReset().mockResolvedValue({ error: null });
  h.jar = [];
  h.deleted = [];
});
afterEach(() => vi.unstubAllEnvs());

describe('checkSiteAfterLogin', () => {
  it('站別對 ⇒ 放行、不登出', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    setTier('store');
    expect(await checkSiteAfterLogin()).toBeNull();
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    setTier('general');
    expect(await checkSiteAfterLogin()).toBeNull();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('經銷站擋一般會員、一般站擋經銷會員 ⇒ 只清本機登出', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    setTier('general');
    expect(await checkSiteAfterLogin()).toBe('site-member-on-b2b');
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    setTier('store');
    expect(await checkSiteAfterLogin()).toBe('site-dealer-on-retail');
    expect(h.signOut).toHaveBeenCalledTimes(2);
    expect(h.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  // 🔴 Codex R3 必修 1:一般站查不到等級也不能放行,否則經銷帳號登得進一般站。
  it('查不到等級 ⇒ 兩站都不放行', async () => {
    h.tierRow = { data: null, error: { message: 'boom' }, status: 503 };
    for (const mode of ['retail', 'b2b']) {
      vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode);
      expect(await checkSiteAfterLogin()).toBe('site-unknown');
    }
  });

  it('剛登入卻讀不到使用者 ⇒ 當成無法確認', async () => {
    h.user = null;
    expect(await checkSiteAfterLogin()).toBe('site-unknown');
  });

  // 🔴 signOut 回錯時 auth-js 不清 cookie ⇒ 要自己刪;只刪登入 cookie 與分段,不刪 code-verifier 與別的 cookie。
  it('不放行時一律直接刪登入 cookie(path=/),signOut 失敗或丟例外也一樣', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    setTier('general');
    h.jar = [
      { name: 'sb-abc-auth-token.0' },
      { name: 'sb-abc-auth-token.1' },
      { name: 'sb-abc-auth-token' },
      { name: 'sb-abc-auth-token-code-verifier' },
      { name: 'pcm_cart' },
    ];
    h.signOut.mockResolvedValue({ error: { name: 'AuthRetryableFetchError', status: 0 } });
    expect(await checkSiteAfterLogin()).toBe('site-member-on-b2b');
    expect(h.deleted).toEqual([
      { name: 'sb-abc-auth-token.0', path: '/' },
      { name: 'sb-abc-auth-token.1', path: '/' },
      { name: 'sb-abc-auth-token', path: '/' },
    ]);

    h.deleted = [];
    h.signOut.mockRejectedValue(new Error('network'));
    expect(await checkSiteAfterLogin()).toBe('site-member-on-b2b');
    expect(h.deleted).toHaveLength(3);
  });

  it('檢查途中丟出沒料到的例外 ⇒ 不往外丟,當成無法確認並刪登入 cookie', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'bogus'); // resolveSiteMode 會丟錯
    h.jar = [{ name: 'sb-abc-auth-token' }];
    expect(await checkSiteAfterLogin()).toBe('site-unknown');
    expect(h.deleted).toEqual([{ name: 'sb-abc-auth-token', path: '/' }]);
  });

  it('放行時不刪任何 cookie', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    setTier('store');
    h.jar = [{ name: 'sb-abc-auth-token' }];
    await checkSiteAfterLogin();
    expect(h.deleted).toEqual([]);
  });
});

describe('siteLoginErrorPath', () => {
  it('帶 next 時過白名單', () => {
    expect(siteLoginErrorPath('site-unknown')).toBe('/login?error=site-unknown');
    expect(siteLoginErrorPath('site-unknown', '/checkout')).toBe('/login?error=site-unknown&next=%2Fcheckout');
    expect(siteLoginErrorPath('site-unknown', '//evil.com')).toBe('/login?error=site-unknown&next=%2F');
  });
});
