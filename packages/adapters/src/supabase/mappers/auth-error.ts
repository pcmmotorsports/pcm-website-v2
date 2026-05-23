import { AuthError, type AuthErrorCode } from '@pcm/domain';

/**
 * Supabase auth error → domain AuthError 映射(M-1-14e-1)。
 *
 * 對齊 ADR-0003 §3.3:Supabase error code wire 字串只在本 adapter mapper 出現、不上洩 use-case / UI。
 * 映射依 supabase-js v2 `AuthError.code`(字串);未知 / 缺 code → 'unknown'(保留原 message 供 debug)。
 *
 * @see packages/domain/src/identity/auth.ts AuthError / AuthErrorCode
 */

/** 只取映射需要的欄位、不硬綁 supabase-js AuthError 型別(對齊既有 mapper 純函式慣例)。 */
export interface SupabaseAuthErrorLike {
  code?: string;
  message?: string;
}

/**
 * Supabase wire error code(LHS、只出現在本 adapter mapper)→ domain AuthErrorCode(RHS、刻意不同字面)。
 * 真做 boundary translation:domain / use-case / UI 不依賴 Supabase 字面(ADR-0003 §3.3)。
 * `invalid_grant` 為舊 GoTrue / OAuth token endpoint code(v2 已改吐 `invalid_credentials`),
 * 多映一條屬防禦性容錯、不影響 v2 行為。
 */
const SUPABASE_CODE_MAP: Record<string, AuthErrorCode> = {
  invalid_credentials: 'credentials_invalid',
  invalid_grant: 'credentials_invalid',
  user_already_exists: 'email_already_registered',
  email_exists: 'email_already_registered',
  weak_password: 'password_too_weak',
  email_not_confirmed: 'email_confirmation_required',
};

export function mapSupabaseAuthError(error: SupabaseAuthErrorLike): AuthError {
  const code: AuthErrorCode = error.code
    ? (SUPABASE_CODE_MAP[error.code] ?? 'unknown')
    : 'unknown';
  return new AuthError(code, error.message ?? '認證失敗');
}
