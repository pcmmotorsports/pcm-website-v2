// actions.test.ts — resetPasswordAction unit test(忘記密碼接線片)
//
// 驗:①驗證失敗(空密碼/短密碼/confirm 不符)→ fieldErrors、不呼叫 updatePassword
//    ②合法輸入 → updatePassword 收乾淨密碼、成功回空物件
//    ③AuthError(rate_limited / password_same_as_current / 其他)→ 各自 formError 字面、不上洩原始 error
//    ④非 AuthError 例外 → 向上拋(不吞)
// node env(server 邏輯);mock '@/lib/auth/composition'(避免載 server-only)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { updatePasswordSpy } = vi.hoisted(() => ({
  updatePasswordSpy: vi.fn(),
}));

vi.mock('@/lib/auth/composition', () => ({
  getAuthService: () =>
    Promise.resolve({
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      sendPasswordResetEmail: vi.fn(),
      updatePassword: updatePasswordSpy,
    }),
}));

import { resetPasswordAction } from './actions';

beforeEach(() => {
  updatePasswordSpy.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('resetPasswordAction', () => {
  it('空密碼/空 confirm → fieldErrors、不呼叫 updatePassword', async () => {
    const result = await resetPasswordAction({ password: '', confirm: '' });
    expect(result.fieldErrors?.password).toBe('請填寫密碼');
    expect(result.fieldErrors?.confirm).toBe('請再輸入一次密碼');
    expect(updatePasswordSpy).not.toHaveBeenCalled();
  });

  it('短密碼(<8)→ fieldErrors「密碼至少 8 碼」、不呼叫 updatePassword', async () => {
    const result = await resetPasswordAction({ password: 'short', confirm: 'short' });
    expect(result.fieldErrors?.password).toBe('密碼至少 8 碼');
    expect(updatePasswordSpy).not.toHaveBeenCalled();
  });

  it('兩次密碼不一樣 → fieldErrors「兩次輸入的密碼不一樣」、不呼叫 updatePassword', async () => {
    const result = await resetPasswordAction({ password: 'hunter2hunter', confirm: 'different1' });
    expect(result.fieldErrors?.confirm).toBe('兩次輸入的密碼不一樣');
    expect(updatePasswordSpy).not.toHaveBeenCalled();
  });

  it('合法輸入 → updatePassword 收乾淨密碼(不含 confirm)、成功回空物件', async () => {
    updatePasswordSpy.mockResolvedValue(undefined);
    const result = await resetPasswordAction({ password: 'hunter2hunter', confirm: 'hunter2hunter' });
    expect(updatePasswordSpy).toHaveBeenCalledWith('hunter2hunter');
    expect(result).toEqual({});
  });

  it('AuthError(rate_limited)→ formError「操作太頻繁，請稍後再試」', async () => {
    updatePasswordSpy.mockRejectedValue(new AuthError('rate_limited', '429'));
    const result = await resetPasswordAction({ password: 'hunter2hunter', confirm: 'hunter2hunter' });
    expect(result.formError).toBe('操作太頻繁，請稍後再試');
    expect(result.fieldErrors).toBeUndefined();
  });

  it('AuthError(password_same_as_current)→ formError「新密碼不能與目前密碼相同」', async () => {
    updatePasswordSpy.mockRejectedValue(new AuthError('password_same_as_current', 'same'));
    const result = await resetPasswordAction({ password: 'hunter2hunter', confirm: 'hunter2hunter' });
    expect(result.formError).toBe('新密碼不能與目前密碼相同');
  });

  it('AuthError(其他 code)→ formError 預設「設定新密碼失敗，請稍後再試」、不上洩原始 error', async () => {
    updatePasswordSpy.mockRejectedValue(new AuthError('unknown', 'raw supabase message'));
    const result = await resetPasswordAction({ password: 'hunter2hunter', confirm: 'hunter2hunter' });
    expect(result.formError).toBe('設定新密碼失敗，請稍後再試');
    expect(result.formError).not.toContain('raw supabase message');
  });

  it('非 AuthError 例外 → 向上拋(不吞)', async () => {
    updatePasswordSpy.mockRejectedValue(new Error('unexpected'));
    await expect(
      resetPasswordAction({ password: 'hunter2hunter', confirm: 'hunter2hunter' }),
    ).rejects.toThrow('unexpected');
  });
});
