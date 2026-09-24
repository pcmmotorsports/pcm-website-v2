// lib/display-tier.ts —— 經銷站顯示價格時,查不到等級不退成牌價(B2B 計畫第四版 C 節 4c)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  strict: { ok: true, tier: 'general' } as { ok: boolean; tier: string; reason?: string },
  jar: [{ name: 'sb-abc-auth-token' }] as { name: string }[],
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));
vi.mock('@/lib/tier', () => ({ resolveAuthenticatedTierStrict: async () => h.strict }));
vi.mock('next/navigation', () => ({ redirect: h.redirect }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => h.jar }) }));

import { pathWithQuery, resolveDisplayTierStrict } from './display-tier';

beforeEach(() => {
  h.redirect.mockClear();
  h.strict = { ok: true, tier: 'general' };
  h.jar = [{ name: 'sb-abc-auth-token.0' }];
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
});
afterEach(() => vi.unstubAllEnvs());

describe('resolveDisplayTierStrict', () => {
  // 🔴 Codex R3 必修 3:經銷站查不到就退牌價 ⇒ 經銷商看到一般價、結帳收經銷價。
  it('經銷站查不到等級 ⇒ 導到登入頁說明,帶著目前這一頁', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    h.strict = { ok: false, reason: 'tier', tier: 'general' };
    await expect(resolveDisplayTierStrict('/brands/öhlins')).rejects.toThrow(
      `NEXT_REDIRECT:/login?error=site-unknown&next=${encodeURIComponent('/brands/öhlins')}`,
    );
  });
  // 🔴 Codex 4c R1 必修 1:reason 'auth' 也要擋(只擋 'tier' 的話,已登入經銷商遇到認證錯誤會看到牌價)。
  it('經銷站帶登入 cookie、認證錯誤(reason auth)⇒ 也導向,next 帶完整查詢參數', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    h.strict = { ok: false, reason: 'auth', tier: 'general' };
    const next = '/products?filter=new&page=2&brand=a&brand=b';
    await expect(resolveDisplayTierStrict('/products', { filter: 'new', page: '2', brand: ['a', 'b'] })).rejects.toThrow(
      `NEXT_REDIRECT:/login?error=site-unknown&next=${encodeURIComponent(next)}`,
    );
  });
  // 🔴 Codex 4c R1 必修 1:訪客(沒有登入 cookie)也可能拿到 ok:false,不能被導到「無法確認經銷資格」。
  it('經銷站沒有登入 cookie ⇒ 不導向,照常看牌價', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    h.strict = { ok: false, reason: 'auth', tier: 'general' };
    h.jar = [{ name: 'sb-abc-auth-token-code-verifier' }, { name: 'pcm_cart' }];
    expect(await resolveDisplayTierStrict('/products')).toEqual(h.strict);
    expect(h.redirect).not.toHaveBeenCalled();
  });
  it('pathWithQuery:沒有參數就只有路徑;undefined 略過', () => {
    expect(pathWithQuery('/products')).toBe('/products');
    expect(pathWithQuery('/products/x', { vehicle: 'y', a: undefined })).toBe('/products/x?vehicle=y');
  });
  it('一般站查不到等級 ⇒ 照 0908 拍板回牌價,不導向', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    h.strict = { ok: false, reason: 'auth', tier: 'general' };
    expect(await resolveDisplayTierStrict('/products')).toEqual(h.strict);
    expect(h.redirect).not.toHaveBeenCalled();
  });
  it('查得到 ⇒ 原樣回傳,兩站都不導向', async () => {
    for (const mode of ['b2b', 'retail']) {
      vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode);
      h.strict = { ok: true, tier: 'store' };
      expect(await resolveDisplayTierStrict('/products')).toEqual({ ok: true, tier: 'store' });
    }
    expect(h.redirect).not.toHaveBeenCalled();
  });

  // 清冊:顯示經銷價的三頁都要走這支,不能直接呼叫 lib/tier.ts(那樣經銷站查不到會靜靜退牌價)。
  it('顯示價格的頁面都走 resolveDisplayTierStrict,有查詢參數的要一起傳', () => {
    // 片 5 起 /search、首頁、會員中心也走這支(換經銷價前要先知道等級)。
    for (const rel of ['../app/products/(catalog)/page.tsx', '../app/brands/[slug]/page.tsx', '../app/products/[slug]/page.tsx', '../app/search/page.tsx', '../app/page.tsx', '../app/account/page.tsx']) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 剝註解,只看程式
      expect(src, rel).toContain('resolveDisplayTierStrict(');
      // 目錄與商品頁有查詢參數(篩選、車款),要一起傳進去;品牌頁沒有。
      if (!rel.includes('brands')) expect(src, rel).toMatch(/resolveDisplayTierStrict\([^)]*,/);
      expect(src, rel).not.toMatch(/resolveAuthenticatedTier(Strict)?\(/);
    }
  });
});
