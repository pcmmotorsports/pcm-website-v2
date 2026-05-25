// actions.test.ts — loginAction 信任邊界 unit test(M-1-14e-f1-a、架構決策 A delivery 層)
//
// 驗:① server 端 LoginInput.parse strip 未知欄(client 夾帶 tier/wallet 不透傳 use-case)
//     ② 非法輸入(bad email / 短密碼)被 zod 擋、不呼叫 use-case、不 redirect
//     ③ AuthError 映射用戶字面、不 redirect
//     ④ 合法輸入 → signInWithPassword 收乾淨 creds + redirect('/')
// node env(server 邏輯);mock '@/lib/auth/composition'(避免載 server-only / @pcm/adapters/server)+ next/navigation redirect。
// loginCustomer 用真實 use-case(只委派 authService.signInWithPassword、不 mock)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { signInSpy, redirectSpy } = vi.hoisted(() => ({
  signInSpy: vi.fn(),
  redirectSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
}));
vi.mock('@/lib/auth/composition', () => ({
  getAuthService: () =>
    Promise.resolve({
      signUp: vi.fn(),
      signInWithPassword: signInSpy,
      signOut: vi.fn(),
    }),
}));

import { loginAction } from './actions';

const VALID = { email: 'rider@pcm.com', password: 'hunter2hunter', remember: true };

beforeEach(() => {
  signInSpy.mockReset();
  signInSpy.mockResolvedValue({ userId: 'u1', email: VALID.email, needsEmailConfirmation: false });
  redirectSpy.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('loginAction(信任邊界)', () => {
  it('strip 未知欄:client 夾帶 tier/wallet_balance 不透傳 use-case', async () => {
    await loginAction({ ...VALID, tier: 'store', wallet_balance: 999999 });
    expect(signInSpy).toHaveBeenCalledTimes(1);
    // 只收 email + password、無 tier / wallet_balance / remember
    expect(signInSpy).toHaveBeenCalledWith({ email: VALID.email, password: VALID.password });
  });

  it('合法輸入 → 登入成功 redirect(POST_AUTH_REDIRECT=/)', async () => {
    await loginAction(VALID);
    expect(signInSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith('/');
  });

  it('非法 email → zod 擋、不呼叫 use-case、不 redirect', async () => {
    const result = await loginAction({ email: 'not-an-email', password: 'hunter2hunter' });
    expect(result?.error).toBeDefined();
    expect(signInSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('短密碼(<8)→ zod 擋、不呼叫 use-case', async () => {
    const result = await loginAction({ email: VALID.email, password: 'short' });
    expect(result?.error).toBeDefined();
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it('AuthError(credentials_invalid)→ 映射用戶字面、不 redirect', async () => {
    signInSpy.mockRejectedValue(new AuthError('credentials_invalid', 'invalid'));
    const result = await loginAction(VALID);
    expect(result?.error).toBe('Email 或密碼錯誤');
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});
