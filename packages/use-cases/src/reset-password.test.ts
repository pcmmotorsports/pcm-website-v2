import { describe, it, expect, vi } from 'vitest';
import type { IAuthService } from '@pcm/ports';
import { resetPassword } from './reset-password';

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

describe('resetPassword', () => {
  it('轉手新密碼給 IAuthService.updatePassword', async () => {
    const updatePassword = vi.fn().mockResolvedValue(undefined);
    const service = stubAuth({ updatePassword });
    await resetPassword(service, 'newpass123');
    expect(updatePassword).toHaveBeenCalledWith('newpass123');
  });

  it('失敗(AuthError)向上拋', async () => {
    const updatePassword = vi.fn().mockRejectedValue(new Error('boom'));
    const service = stubAuth({ updatePassword });
    await expect(resetPassword(service, 'newpass123')).rejects.toThrow('boom');
  });
});
