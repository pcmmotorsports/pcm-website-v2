import { describe, it, expect, vi } from 'vitest';
import type { IAuthService } from '@pcm/ports';
import { logoutCustomer } from './logout-customer';

describe('logoutCustomer', () => {
  it('呼叫 IAuthService.signOut', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    const service = {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut,
    } as unknown as IAuthService;
    await logoutCustomer(service);
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('signOut 失敗向上拋', async () => {
    const signOut = vi.fn().mockRejectedValue(new Error('logout'));
    const service = {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut,
    } as unknown as IAuthService;
    await expect(logoutCustomer(service)).rejects.toThrow('logout');
  });
});
