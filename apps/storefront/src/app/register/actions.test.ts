// actions.test.ts — registerAction 信任邊界 unit test(M-1-14e-f1-b、架構決策 A delivery 層)
//
// 驗:① server 端 RegisterInput.parse strip 未知欄(client 夾帶 tier/wallet 不透傳 use-case;agree 不進 use-case)
//     ② agree≠true → zod literal(true) 擋、不呼叫 use-case、不 redirect
//     ③ 空 phone → zod phone regex 擋(D-g=A 必填 server 權威防線)、不呼叫 use-case
//     ④ 合法輸入 → signUp 收乾淨 AuthSignUpParams + redirect('/')(直登、needsEmailConfirmation=false)
//     ⑤ AuthError(email_already_registered)→ 映射用戶字面、不 redirect
//     ⑥ needsEmailConfirmation=true(Confirm email 重開)→ 回提示、不 redirect
// node env;mock '@/lib/auth/composition'(避免載 server-only / @pcm/adapters/server)+ next/navigation redirect。
// registerCustomer 用真實 use-case(只委派 authService.signUp、不 mock)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { signUpSpy, redirectSpy } = vi.hoisted(() => ({
  signUpSpy: vi.fn(),
  redirectSpy: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectSpy,
}));
vi.mock('@/lib/auth/composition', () => ({
  getAuthService: () =>
    Promise.resolve({
      signUp: signUpSpy,
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
    }),
}));

import { registerAction } from './actions';

const VALID = {
  name: '王小明',
  email: 'rider@pcm.com',
  phone: '0912345678',
  password: 'hunter2hunter',
  agree: true,
};

beforeEach(() => {
  signUpSpy.mockReset();
  signUpSpy.mockResolvedValue({ userId: 'u1', email: VALID.email, needsEmailConfirmation: false });
  redirectSpy.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe('registerAction(信任邊界)', () => {
  it('strip 未知欄:client 夾帶 tier/wallet 不透傳 use-case;agree 不進 use-case', async () => {
    await registerAction({ ...VALID, tier: 'store', wallet_balance: 999999 });
    expect(signUpSpy).toHaveBeenCalledTimes(1);
    // 只收 email + password + metadata{name,phone}、無 tier / wallet_balance / agree
    expect(signUpSpy).toHaveBeenCalledWith({
      email: VALID.email,
      password: VALID.password,
      metadata: { name: VALID.name, phone: VALID.phone },
    });
  });

  it('合法輸入 → 直登 redirect(POST_AUTH_REDIRECT=/)', async () => {
    await registerAction(VALID);
    expect(signUpSpy).toHaveBeenCalledTimes(1);
    expect(redirectSpy).toHaveBeenCalledWith('/');
  });

  it('agree≠true → zod literal(true) 擋、不呼叫 use-case、不 redirect', async () => {
    const result = await registerAction({ ...VALID, agree: false });
    expect(result?.error).toBeDefined();
    expect(signUpSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('空 phone → zod phone regex 擋(D-g=A 必填 server 權威)、不呼叫 use-case', async () => {
    const result = await registerAction({ ...VALID, phone: '' });
    expect(result?.error).toBeDefined();
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('AuthError(email_already_registered)→ 映射「此 Email 已註冊」、不 redirect', async () => {
    signUpSpy.mockRejectedValue(new AuthError('email_already_registered', 'dup'));
    const result = await registerAction(VALID);
    expect(result?.error).toBe('此 Email 已註冊');
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('needsEmailConfirmation=true(Confirm email 重開)→ 回提示、不 redirect', async () => {
    signUpSpy.mockResolvedValue({ userId: 'u1', email: VALID.email, needsEmailConfirmation: true });
    const result = await registerAction(VALID);
    expect(result?.error).toContain('Email 驗證');
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});
