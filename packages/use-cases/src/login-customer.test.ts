import { describe, it, expect, vi } from 'vitest';
import type { IAuthService } from '@pcm/ports';
import type { AuthCredentials, AuthResult } from '@pcm/domain';
import { loginCustomer } from './login-customer';

const OK: AuthResult = { userId: 'u1', email: 'a@b.com', needsEmailConfirmation: false };
const CREDS: AuthCredentials = { email: 'a@b.com', password: 'pw12345678' };

describe('loginCustomer', () => {
  it('轉手已驗證的 AuthCredentials 給 IAuthService.signInWithPassword、回傳其結果', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue(OK);
    const service = { signUp: vi.fn(), signInWithPassword, signOut: vi.fn() } as unknown as IAuthService;
    const res = await loginCustomer(service, CREDS);
    expect(res).toEqual(OK);
    expect(signInWithPassword).toHaveBeenCalledWith(CREDS);
  });

  it('signInWithPassword 失敗(AuthError)向上拋', async () => {
    const signInWithPassword = vi.fn().mockRejectedValue(new Error('bad'));
    const service = { signUp: vi.fn(), signInWithPassword, signOut: vi.fn() } as unknown as IAuthService;
    await expect(loginCustomer(service, CREDS)).rejects.toThrow('bad');
  });
});
