import type { IAuthService } from '@pcm/ports';
import type { AuthResult, AuthSignUpParams } from '@pcm/domain';

/**
 * registerCustomer:會員註冊 use-case(M-1-14e-1b、PRD §8.1)。
 *
 * 收**已驗證的** AuthSignUpParams(表單 `@pcm/schemas` parse / strip 在 delivery 層〔f1 storefront
 * server action、server 端、不信 client〕完成;對齊 boundaries:use-cases ⊥ schemas)。
 * 走 IAuthService.signUp;metadata 型別保證只含 { name, phone }(→ raw_user_meta_data 供 trigger 建 row)。
 * **不顯式 insert customers**(PRD §10 Q2=A、DB handle_new_auth_user trigger 自動建)。
 * 失敗 → domain AuthError(adapter 映射),向上拋。
 */
export async function registerCustomer(
  authService: IAuthService,
  params: AuthSignUpParams,
): Promise<AuthResult> {
  return authService.signUp(params);
}
