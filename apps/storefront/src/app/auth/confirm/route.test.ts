// /auth/confirm GET(B2B 計畫 §9.9「D4a／D4b 共同」):員工寄出的邀請信與重設密碼信, 客人在另一台瀏覽器開也要能設定密碼。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectSpy, verifySpy, siteCheckSpy } = vi.hoisted(() => ({
  redirectSpy: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  verifySpy: vi.fn(),
  siteCheckSpy: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: redirectSpy }));
// 資安修正片 2:註冊確認(type=email)要跑站別檢查;站別檢查本身在 site-login-gate.test.ts 測。
vi.mock('@/lib/auth/site-login-gate', () => ({
  checkSiteAfterLogin: siteCheckSpy,
  siteLoginErrorPath: (code: string) => `/login?error=${code}`,
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => Promise.resolve({ auth: { verifyOtp: verifySpy } }),
}));

import { GET } from './route';

const go = (qs: string) => GET(new Request(`https://pcmmotorsports.com/auth/confirm${qs}`));

beforeEach(() => {
  redirectSpy.mockClear();
  verifySpy.mockReset();
  verifySpy.mockResolvedValue({ error: null });
  siteCheckSpy.mockReset().mockResolvedValue(null);
});

describe('/auth/confirm', () => {
  it.each(['invite', 'recovery'])('type=%s ⇒ server 端 verifyOtp 建立登入, 導到設定密碼頁', async (type) => {
    await expect(go(`?token_hash=h1&type=${type}`)).rejects.toThrow('NEXT_REDIRECT:/login/reset');
    expect(verifySpy).toHaveBeenCalledWith({ type, token_hash: 'h1' });
  });

  it('🔴 驗證失敗 ⇒ 設定密碼頁一律顯示「連結不能用了」(不能沿用瀏覽器原本登入的帳號)', async () => {
    verifySpy.mockResolvedValue({ error: { message: 'expired' } });
    await expect(go('?token_hash=h1&type=recovery')).rejects.toThrow('NEXT_REDIRECT:/login/reset?expired=1');
  });

  it('🔴 其他 type(signup / magiclink / email_change)或缺 token ⇒ 不驗證', async () => {
    for (const qs of ['?token_hash=h1&type=magiclink', '?token_hash=h1&type=email_change', '?type=invite', '']) {
      await expect(go(qs)).rejects.toThrow('NEXT_REDIRECT:/login/reset?expired=1');
    }
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('🔴 不收 next / redirect_to 參數(固定導到 /login/reset, 不能被拿來導到外站)', async () => {
    await expect(go('?token_hash=h1&type=invite&next=https://evil.example&redirect_to=//evil.example')).rejects.toThrow(
      'NEXT_REDIRECT:/login/reset',
    );
  });
});

// 資安修正片 2(2026-09-26,計畫 ~/pcm-mailbox/計畫-資安修正-註冊登入-20260926.md §四):
// 註冊確認信改走這裡(token_hash, 換裝置開信也能用)。
describe('/auth/confirm · 註冊確認(type=email)', () => {
  it('驗證成功、站別通過 ⇒ 回首頁並帶 confirmed=1', async () => {
    await expect(go('?token_hash=h1&type=email')).rejects.toThrow('NEXT_REDIRECT:/?confirmed=1');
    expect(verifySpy).toHaveBeenCalledWith({ type: 'email', token_hash: 'h1' });
    expect(siteCheckSpy).toHaveBeenCalledTimes(1);
  });

  it('🔴 站別檢查回錯 ⇒ 照它的錯誤頁導, 不顯示確認成功', async () => {
    siteCheckSpy.mockResolvedValue('site-member-on-b2b');
    await expect(go('?token_hash=h1&type=email')).rejects.toThrow('NEXT_REDIRECT:/login?error=site-member-on-b2b');
  });

  it('🔴 驗證失敗 ⇒ 登入頁說明連結已失效, 不跑站別檢查、不顯示成功', async () => {
    verifySpy.mockResolvedValue({ error: { message: 'expired' } });
    await expect(go('?token_hash=h1&type=email')).rejects.toThrow('NEXT_REDIRECT:/login?error=confirm');
    expect(siteCheckSpy).not.toHaveBeenCalled();
  });

  it('🔴 邀請與重設密碼不跑站別檢查(正在設定密碼的經銷會員不能被登出)', async () => {
    await expect(go('?token_hash=h1&type=invite')).rejects.toThrow('NEXT_REDIRECT:/login/reset');
    await expect(go('?token_hash=h1&type=recovery')).rejects.toThrow('NEXT_REDIRECT:/login/reset');
    expect(siteCheckSpy).not.toHaveBeenCalled();
  });

  it('type=email 也不收 next / redirect_to(固定站內路徑)', async () => {
    await expect(go('?token_hash=h1&type=email&next=https://evil.example')).rejects.toThrow('NEXT_REDIRECT:/?confirmed=1');
  });
});
