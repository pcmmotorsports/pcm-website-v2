import { describe, it, expect } from 'vitest';
import { AuthError } from '@pcm/domain';
import { mapSupabaseAuthError } from './auth-error';

describe('mapSupabaseAuthError', () => {
  it('Supabase invalid_credentials → domain credentials_invalid、保留原 message', () => {
    const e = mapSupabaseAuthError({ code: 'invalid_credentials', message: 'bad creds' });
    expect(e).toBeInstanceOf(AuthError);
    expect(e.code).toBe('credentials_invalid');
    expect(e.message).toBe('bad creds');
  });

  it('legacy invalid_grant 也轉成 credentials_invalid', () => {
    expect(mapSupabaseAuthError({ code: 'invalid_grant' }).code).toBe('credentials_invalid');
  });

  it('user_already_exists / email_exists → email_already_registered', () => {
    expect(mapSupabaseAuthError({ code: 'user_already_exists' }).code).toBe('email_already_registered');
    expect(mapSupabaseAuthError({ code: 'email_exists' }).code).toBe('email_already_registered');
  });

  it('weak_password → password_too_weak / email_not_confirmed → email_confirmation_required', () => {
    expect(mapSupabaseAuthError({ code: 'weak_password' }).code).toBe('password_too_weak');
    expect(mapSupabaseAuthError({ code: 'email_not_confirmed' }).code).toBe('email_confirmation_required');
  });

  it('未知 code → unknown', () => {
    expect(mapSupabaseAuthError({ code: 'some_future_code' }).code).toBe('unknown');
  });

  it('缺 code → unknown;缺 message 用 fallback', () => {
    const e = mapSupabaseAuthError({});
    expect(e.code).toBe('unknown');
    expect(e.message).toBe('認證失敗');
  });
});
