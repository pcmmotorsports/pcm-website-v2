// /auth/confirm GET(B2B 計畫 §9.9「D4a／D4b 共同」):員工寄出的邀請信與重設密碼信, 客人在另一台瀏覽器開也要能設定密碼。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectSpy, verifySpy } = vi.hoisted(() => ({
  redirectSpy: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  verifySpy: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: redirectSpy }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => Promise.resolve({ auth: { verifyOtp: verifySpy } }),
}));

import { GET } from './route';

const go = (qs: string) => GET(new Request(`https://pcmmotorsports.com/auth/confirm${qs}`));

beforeEach(() => {
  redirectSpy.mockClear();
  verifySpy.mockReset();
  verifySpy.mockResolvedValue({ error: null });
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
