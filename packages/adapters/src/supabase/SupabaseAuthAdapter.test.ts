import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AuthError } from '@pcm/domain';
import { SupabaseAuthAdapter } from './SupabaseAuthAdapter';

type AuthStub = Partial<SupabaseClient['auth']>;

function makeAdapter(auth: AuthStub): SupabaseAuthAdapter {
  return new SupabaseAuthAdapter({ auth } as unknown as SupabaseClient);
}

const USER = { id: 'uuid-1', email: 'a@b.com' };
const SESSION = { access_token: 't' };
const SIGNUP_PARAMS = {
  email: 'a@b.com',
  password: 'pw12345678',
  metadata: { name: 'N', phone: '0912345678' },
};

describe('SupabaseAuthAdapter.signUp', () => {
  it('成功回 AuthResult、有 session 時 needsEmailConfirmation=false', async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { user: USER, session: SESSION }, error: null });
    const res = await makeAdapter({ signUp }).signUp(SIGNUP_PARAMS);
    expect(res).toEqual({ userId: 'uuid-1', email: 'a@b.com', needsEmailConfirmation: false });
  });

  it('metadata 只送 { name, phone }(不夾帶 tier / id 等多餘欄)', async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { user: USER, session: SESSION }, error: null });
    await makeAdapter({ signUp }).signUp(SIGNUP_PARAMS);
    expect(signUp).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'pw12345678',
      options: { data: { name: 'N', phone: '0912345678' } },
    });
  });

  it('session=null → needsEmailConfirmation=true(未來重開 email 驗證 #173 情境)', async () => {
    const signUp = vi.fn().mockResolvedValue({ data: { user: USER, session: null }, error: null });
    const res = await makeAdapter({ signUp }).signUp(SIGNUP_PARAMS);
    expect(res.needsEmailConfirmation).toBe(true);
  });

  it('error → throw 映射後的 AuthError(email_already_registered)', async () => {
    const signUp = vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'user_already_exists', message: 'exists' },
    });
    await expect(makeAdapter({ signUp }).signUp(SIGNUP_PARAMS)).rejects.toMatchObject({
      code: 'email_already_registered',
    });
  });
});

describe('SupabaseAuthAdapter.signInWithPassword', () => {
  it('成功回 AuthResult', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: { user: USER, session: SESSION }, error: null });
    const res = await makeAdapter({ signInWithPassword }).signInWithPassword({ email: 'a@b.com', password: 'pw12345678' });
    expect(res).toEqual({ userId: 'uuid-1', email: 'a@b.com', needsEmailConfirmation: false });
  });

  it('invalid_credentials error → throw AuthError', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials', message: 'bad' },
    });
    await expect(makeAdapter({ signInWithPassword }).signInWithPassword({ email: 'a@b.com', password: 'x' }))
      .rejects.toBeInstanceOf(AuthError);
  });
});

describe('SupabaseAuthAdapter.signOut', () => {
  it('成功 resolve undefined', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null });
    await expect(makeAdapter({ signOut }).signOut()).resolves.toBeUndefined();
  });

  it('error → throw AuthError', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: { code: 'unknown', message: 'boom' } });
    await expect(makeAdapter({ signOut }).signOut()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('SupabaseAuthAdapter.sendPasswordResetEmail', () => {
  const PARAMS = { email: 'a@b.com', redirectTo: 'https://shop.pcmmotorsports.com/reset-password' };

  it('成功 resolve undefined、轉呼 resetPasswordForEmail(email, { redirectTo })', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({ data: {}, error: null });
    await expect(makeAdapter({ resetPasswordForEmail }).sendPasswordResetEmail(PARAMS)).resolves.toBeUndefined();
    expect(resetPasswordForEmail).toHaveBeenCalledWith('a@b.com', { redirectTo: PARAMS.redirectTo });
  });

  it('error(over_email_send_rate_limit) → throw AuthError(rate_limited)', async () => {
    const resetPasswordForEmail = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'over_email_send_rate_limit', message: 'rate limited' },
    });
    await expect(makeAdapter({ resetPasswordForEmail }).sendPasswordResetEmail(PARAMS))
      .rejects.toMatchObject({ code: 'rate_limited' });
  });
});

describe('SupabaseAuthAdapter.updatePassword', () => {
  it('成功 resolve undefined、轉呼 updateUser({ password })', async () => {
    const updateUser = vi.fn().mockResolvedValue({ data: { user: USER }, error: null });
    await expect(makeAdapter({ updateUser }).updatePassword('newpass123')).resolves.toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith({ password: 'newpass123' });
  });

  it('error(same_password) → throw AuthError(password_same_as_current)', async () => {
    const updateUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { code: 'same_password', message: 'same as current' },
    });
    await expect(makeAdapter({ updateUser }).updatePassword('newpass123'))
      .rejects.toMatchObject({ code: 'password_same_as_current' });
  });
});
