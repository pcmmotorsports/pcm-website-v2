// actions.test.ts — requestPasswordResetAction 安全通道 unit test(忘記密碼接線片)
//
// 驗 plan §3-1(本片最高風險守門):驗證通過時,不論 Supabase 回成功 / 帳號不存在 / AuthError
// (含 rate_limited)/ 未知 AuthError,回傳值必須完全相同(空物件)—— 這條收斂若被拆開,
// 這頁就會變成帳號探測器。另驗:①驗證失敗才回 fieldErrors ②resolveSiteUrl() undefined → throw
// (不得靜默成功)③redirectTo 字面正確、不含任何來自 request 的值。
// node env(server 邏輯);mock '@/lib/auth/composition'(避免載 server-only)+ '@/lib/site-url'。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { sendResetSpy, resolveSiteUrlSpy } = vi.hoisted(() => ({
  sendResetSpy: vi.fn(),
  resolveSiteUrlSpy: vi.fn(),
}));

vi.mock('@/lib/auth/composition', () => ({
  getAuthService: () =>
    Promise.resolve({
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      sendPasswordResetEmail: sendResetSpy,
      updatePassword: vi.fn(),
    }),
}));
vi.mock('@/lib/site-url', () => ({
  resolveSiteUrl: resolveSiteUrlSpy,
}));

import { requestPasswordResetAction } from './actions';

beforeEach(() => {
  sendResetSpy.mockReset();
  resolveSiteUrlSpy.mockReset();
  resolveSiteUrlSpy.mockReturnValue('https://shop.pcmmotorsports.com');
});
afterEach(() => vi.clearAllMocks());

describe('requestPasswordResetAction(plan §3-1 帳號列舉守門)', () => {
  it('驗證失敗(空 Email)→ fieldErrors、不呼叫 sendPasswordResetEmail', async () => {
    const result = await requestPasswordResetAction({ email: '' });
    expect(result.fieldErrors?.email).toBe('請填寫 Email');
    expect(sendResetSpy).not.toHaveBeenCalled();
  });

  it('驗證失敗(格式錯)→ fieldErrors、不呼叫 sendPasswordResetEmail', async () => {
    const result = await requestPasswordResetAction({ email: 'not-an-email' });
    expect(result.fieldErrors?.email).toBe('Email 格式不正確');
    expect(sendResetSpy).not.toHaveBeenCalled();
  });

  it('🔴 驗證通過:寄信成功 → 回空物件', async () => {
    sendResetSpy.mockResolvedValue(undefined);
    const result = await requestPasswordResetAction({ email: 'rider@pcm.com' });
    expect(result).toEqual({});
  });

  it('🔴 驗證通過:帳號不存在(Supabase 對此靜默不報錯,同成功路徑)→ 回空物件(與成功案例 byte-identical)', async () => {
    sendResetSpy.mockResolvedValue(undefined);
    const result = await requestPasswordResetAction({ email: 'nobody@pcm.com' });
    expect(result).toEqual({});
  });

  it('🔴 驗證通過:AuthError(rate_limited)→ 仍回空物件(與成功案例 byte-identical、不得透出節流訊號)', async () => {
    sendResetSpy.mockRejectedValue(new AuthError('rate_limited', '429'));
    const result = await requestPasswordResetAction({ email: 'rider@pcm.com' });
    expect(result).toEqual({});
  });

  it('🔴 驗證通過:未知 AuthError → 仍回空物件(不上洩任何錯誤細節)', async () => {
    sendResetSpy.mockRejectedValue(new AuthError('unknown', 'boom'));
    const result = await requestPasswordResetAction({ email: 'rider@pcm.com' });
    expect(result).toEqual({});
  });

  it('resolveSiteUrl() 回 undefined → throw(不得靜默成功、不得呼叫 sendPasswordResetEmail)', async () => {
    resolveSiteUrlSpy.mockReturnValue(undefined);
    await expect(requestPasswordResetAction({ email: 'rider@pcm.com' })).rejects.toThrow();
    expect(sendResetSpy).not.toHaveBeenCalled();
  });

  it('redirectTo 字面正確且不含任何來自 request 的值(只用 resolveSiteUrl() 組)', async () => {
    sendResetSpy.mockResolvedValue(undefined);
    await requestPasswordResetAction({ email: 'rider@pcm.com' });
    expect(sendResetSpy).toHaveBeenCalledWith({
      email: 'rider@pcm.com',
      redirectTo: 'https://shop.pcmmotorsports.com/auth/callback?next=/login/reset',
    });
  });
});
