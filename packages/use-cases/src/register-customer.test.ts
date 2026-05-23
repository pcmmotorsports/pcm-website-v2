import { describe, it, expect, vi } from 'vitest';
import type { IAuthService } from '@pcm/ports';
import type { AuthResult, AuthSignUpParams } from '@pcm/domain';
import { registerCustomer } from './register-customer';

// 守 boundary(A 決策):use-case 只收已驗證的 domain 型別、轉手給 port。
// 表單 parse / strip 未知欄 / 不信 client 的 runtime 測試屬 delivery 層(f1 server action)。

const OK: AuthResult = { userId: 'u1', email: 'a@b.com', needsEmailConfirmation: false };
const PARAMS: AuthSignUpParams = {
  email: 'a@b.com',
  password: 'pw12345678',
  metadata: { name: '張三', phone: '0912345678' },
};

describe('registerCustomer', () => {
  it('轉手已驗證的 AuthSignUpParams 給 IAuthService.signUp、回傳其結果', async () => {
    const signUp = vi.fn().mockResolvedValue(OK);
    const service = { signUp, signInWithPassword: vi.fn(), signOut: vi.fn() } as unknown as IAuthService;
    const res = await registerCustomer(service, PARAMS);
    expect(res).toEqual(OK);
    expect(signUp).toHaveBeenCalledWith(PARAMS);
  });

  it('signUp 失敗(AuthError)向上拋', async () => {
    const signUp = vi.fn().mockRejectedValue(new Error('boom'));
    const service = { signUp, signInWithPassword: vi.fn(), signOut: vi.fn() } as unknown as IAuthService;
    await expect(registerCustomer(service, PARAMS)).rejects.toThrow('boom');
  });
});
