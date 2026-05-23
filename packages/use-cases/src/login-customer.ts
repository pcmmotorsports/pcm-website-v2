import type { IAuthService } from '@pcm/ports';
import type { AuthCredentials, AuthResult } from '@pcm/domain';

/**
 * loginCustomer:會員登入 use-case(M-1-14e-1b、PRD §8.1)。
 *
 * 收**已驗證的** AuthCredentials(表單 `@pcm/schemas` parse 在 delivery 層〔server 端〕完成;
 * 對齊 boundaries:use-cases ⊥ schemas)。走 IAuthService.signInWithPassword。
 * `remember`(session 持久化)屬 delivery / client 設定、不在本層(由注入的 SupabaseClient 決定)。
 * 失敗 → domain AuthError(如 credentials_invalid),向上拋。
 */
export async function loginCustomer(
  authService: IAuthService,
  credentials: AuthCredentials,
): Promise<AuthResult> {
  return authService.signInWithPassword(credentials);
}
