// actions.test.ts — loginAction 信任邊界 unit test(M-1-14e-f1-a、#181 Q2=B、架構決策 A delivery 層)
//
// 驗:① server 端 validateLogin strip 未知欄(client 夾帶 tier/wallet 不透傳 use-case)
//     ② 空欄 → presence 專屬「請填寫…」逐欄(Q2=B)、不呼叫 use-case、不 redirect
//     ③ 非空但格式錯(bad email / 短密碼)→ zod 逐欄訊息、不呼叫 use-case、不 redirect
//     ④ AuthError(credentials_invalid)→ formError 頂部帳號層級通道(釘死 2)、不 redirect
//     ⑤ 合法輸入 → signInWithPassword 收乾淨 creds + redirect('/')
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

describe('loginAction(信任邊界 + #181 雙通道)', () => {
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

  it('空欄 → presence 專屬「請填寫…」逐欄(Q2=B)、不呼叫 use-case、不 redirect', async () => {
    const result = await loginAction({ email: '', password: '', remember: true });
    expect(result?.fieldErrors?.email).toBe('請填寫 Email');
    expect(result?.fieldErrors?.password).toBe('請填寫密碼');
    expect(signInSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('非法 email(非空格式錯)→ zod「Email 格式不正確」逐欄、不呼叫 use-case、不 redirect', async () => {
    const result = await loginAction({ email: 'not-an-email', password: 'hunter2hunter' });
    expect(result?.fieldErrors?.email).toBe('Email 格式不正確');
    expect(signInSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('短密碼(<8、非空)→ zod「密碼至少 8 碼」逐欄、不呼叫 use-case', async () => {
    const result = await loginAction({ email: VALID.email, password: 'short' });
    expect(result?.fieldErrors?.password).toBe('密碼至少 8 碼');
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it('全空白密碼 → presence「請填寫密碼」(codex 關卡2 修補)、不呼叫 use-case', async () => {
    const result = await loginAction({ ...VALID, password: '        ' });
    expect(result?.fieldErrors?.password).toBe('請填寫密碼');
    expect(signInSpy).not.toHaveBeenCalled();
  });

  it('remember 非 boolean(異常 client)→ 不洩漏契約外 fieldErrors.remember、回 formError fallback、不呼叫 use-case(codex 關卡2)', async () => {
    const result = await loginAction({ email: VALID.email, password: VALID.password, remember: 'on' });
    expect(result?.fieldErrors).toBeUndefined();
    expect(result?.formError).toBe('請輸入有效的 Email 與密碼');
    expect(signInSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('AuthError(credentials_invalid)→ formError「Email 或密碼錯誤」(頂部帳號層級)、不 redirect', async () => {
    signInSpy.mockRejectedValue(new AuthError('credentials_invalid', 'invalid'));
    const result = await loginAction(VALID);
    expect(result?.formError).toBe('Email 或密碼錯誤');
    expect(result?.fieldErrors).toBeUndefined();
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});
