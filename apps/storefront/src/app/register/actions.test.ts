// actions.test.ts — registerAction 信任邊界 unit test(M-1-14e-f1-b、#181 Q2=B、架構決策 A delivery 層)
//
// 驗:① server 端 validateRegister strip 未知欄(client 夾帶 tier/wallet 不透傳 use-case;agree 不進 use-case)
//     ② agree≠true → zod literal(true) 擋 → fieldErrors.agree、不呼叫 use-case、不 redirect
//     ③ 空 phone → presence 專屬「請填寫手機」(D-g=A 必填 server 權威防線)、不呼叫 use-case
//     ④ 非空但格式錯 phone → zod「手機格式不正確」(逐欄、Q2=B server 也逐欄)、不呼叫 use-case
//     ⑤ 合法輸入 → signUp 收乾淨 AuthSignUpParams + redirect('/')(直登、needsEmailConfirmation=false)
//     ⑥ AuthError(email_already_registered)→ formError 頂部帳號層級通道(釘死 2)、不 redirect
//     ⑦ needsEmailConfirmation=true(Confirm email 重開)→ formError 提示、不 redirect
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

describe('registerAction(信任邊界 + #181 雙通道)', () => {
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

  it('agree≠true → zod literal(true) 擋 → fieldErrors.agree、不呼叫 use-case、不 redirect', async () => {
    const result = await registerAction({ ...VALID, agree: false });
    expect(result?.fieldErrors?.agree).toBeDefined();
    expect(signUpSpy).not.toHaveBeenCalled();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('空 phone → presence 專屬「請填寫手機」(D-g=A server 權威)、不呼叫 use-case', async () => {
    const result = await registerAction({ ...VALID, phone: '' });
    expect(result?.fieldErrors?.phone).toBe('請填寫手機');
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('非空但格式錯 phone → zod「手機格式不正確」(Q2=B server 逐欄)、不呼叫 use-case', async () => {
    const result = await registerAction({ ...VALID, phone: 'abc' });
    expect(result?.fieldErrors?.phone).toBe('手機格式不正確');
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('全空白密碼 → presence「請填寫密碼」(codex 關卡2 修補:不得過 zod min(8) 註冊純空白密碼)、不呼叫 use-case', async () => {
    const result = await registerAction({ ...VALID, password: '        ' });
    expect(result?.fieldErrors?.password).toBe('請填寫密碼');
    expect(signUpSpy).not.toHaveBeenCalled();
  });

  it('AuthError(email_already_registered)→ formError「此 Email 已註冊」(頂部帳號層級)、不 redirect', async () => {
    signUpSpy.mockRejectedValue(new AuthError('email_already_registered', 'dup'));
    const result = await registerAction(VALID);
    expect(result?.formError).toBe('此 Email 已註冊');
    expect(result?.fieldErrors).toBeUndefined();
    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it('needsEmailConfirmation=true(Confirm email 重開)→ formError 提示、不 redirect', async () => {
    signUpSpy.mockResolvedValue({ userId: 'u1', email: VALID.email, needsEmailConfirmation: true });
    const result = await registerAction(VALID);
    expect(result?.formError).toContain('Email 驗證');
    expect(redirectSpy).not.toHaveBeenCalled();
  });
});
