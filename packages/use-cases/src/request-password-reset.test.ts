import { describe, it, expect, vi } from 'vitest';
import type { IAuthService } from '@pcm/ports';
import { requestPasswordReset } from './request-password-reset';

const PARAMS = { email: 'a@b.com', redirectTo: 'https://shop.pcmmotorsports.com/reset-password' };

function stubAuth(overrides: Partial<IAuthService>): IAuthService {
  return {
    signUp: vi.fn(),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    updatePassword: vi.fn(),
    ...overrides,
  } as unknown as IAuthService;
}

describe('requestPasswordReset', () => {
  it('轉手 params 給 IAuthService.sendPasswordResetEmail', async () => {
    const sendPasswordResetEmail = vi.fn().mockResolvedValue(undefined);
    const service = stubAuth({ sendPasswordResetEmail });
    await requestPasswordReset(service, PARAMS);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith(PARAMS);
  });

  it('失敗(AuthError)向上拋', async () => {
    const sendPasswordResetEmail = vi.fn().mockRejectedValue(new Error('boom'));
    const service = stubAuth({ sendPasswordResetEmail });
    await expect(requestPasswordReset(service, PARAMS)).rejects.toThrow('boom');
  });
});
