// actions.test.ts — resetPasswordAction unit test(忘記密碼接線片)
//
// 驗:①驗證失敗(空密碼/短密碼/confirm 不符)→ fieldErrors、不呼叫 updatePassword
//    ②合法輸入 → updatePassword 收乾淨密碼、成功回空物件
//    ③AuthError(rate_limited / password_same_as_current / 其他)→ 各自 formError 字面、不上洩原始 error
//    ④非 AuthError 例外 → 向上拋(不吞)
// node env(server 邏輯);mock '@/lib/auth/composition'(避免載 server-only)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@pcm/domain';

const { updatePasswordSpy, clearSpy, userRef } = vi.hoisted(() => ({
  updatePasswordSpy: vi.fn(),
  clearSpy: vi.fn(),
  userRef: { value: { email: 'rider@pcm.com' } as null | { email?: string } },
}));
// 資安修正片 3:設定新密碼後解除登入限次。Email 只取登入狀態。
vi.mock('@/lib/auth/login-throttle', () => ({ clearLoginAttempts: clearSpy }));
vi.mock('@/lib/auth/verified-user', () => ({
  getVerifiedUser: async () => ({ supabase: {}, user: userRef.value, error: null }),
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

import { resetPasswordAction, retryUnlockAction } from './actions';

beforeEach(() => {
  updatePasswordSpy.mockReset();
  clearSpy.mockReset().mockResolvedValue(true);
  userRef.value = { email: 'rider@pcm.com' };
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

// 2026-09-26:與註冊頁同一句, 顯示在「密碼」欄(Supabase 外洩密碼保護 422 weak_password)。
describe('弱密碼 / 外洩密碼', () => {
  it('AuthError(password_too_weak)→ 密碼欄顯示換密碼的提示', async () => {
    updatePasswordSpy.mockRejectedValue(new AuthError('password_too_weak', 'weak'));
    const result = await resetPasswordAction({ password: 'hunter2hunter', confirm: 'hunter2hunter' });
    expect(result).toEqual({
      fieldErrors: { password: '這組密碼太常見或曾在其他網站外洩，請換一組比較難猜的密碼（至少 8 碼，混合英文和數字）。' },
    });
  });
});

describe('resetPasswordAction · 解除登入限次(資安修正片 3)', () => {
  const OK = { password: 'newpassword1', confirm: 'newpassword1' };

  it('🔴 密碼改好 ⇒ 用登入狀態裡的 Email 解除, 不讀表單', async () => {
    const result = await resetPasswordAction({ ...OK, email: 'attacker@evil.com' });
    expect(result).toEqual({});
    expect(clearSpy).toHaveBeenCalledWith('rider@pcm.com');
  });

  it('🔴 解除失敗 ⇒ 回 unlockFailed(密碼已經改好, 不是 formError)', async () => {
    clearSpy.mockResolvedValue(false);
    expect(await resetPasswordAction(OK)).toEqual({ unlockFailed: true });
  });

  it('改密碼失敗 ⇒ 不解除', async () => {
    updatePasswordSpy.mockRejectedValue(new AuthError('rate_limited', 'x'));
    await resetPasswordAction(OK);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('登入狀態裡沒有 Email ⇒ 當成成功, 不呼叫', async () => {
    userRef.value = {};
    expect(await resetPasswordAction(OK)).toEqual({});
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('retryUnlockAction:同樣只用登入狀態裡的 Email', async () => {
    expect(await retryUnlockAction()).toBe(true);
    expect(clearSpy).toHaveBeenCalledWith('rider@pcm.com');
    clearSpy.mockResolvedValue(false);
    expect(await retryUnlockAction()).toBe(false);
  });
});
