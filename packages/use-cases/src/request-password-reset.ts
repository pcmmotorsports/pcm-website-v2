import type { IAuthService } from '@pcm/ports';

/**
 * requestPasswordReset:忘記密碼 — 寄出重設信 use-case(忘記密碼片新)。
 *
 * 收**已驗證的** email(表單 `@pcm/schemas` parse 在 delivery 層完成;對齊 boundaries:
 * use-cases ⊥ schemas)。走 IAuthService.sendPasswordResetEmail。
 * 「不洩漏帳號是否存在」是呼叫端(server action)的責任、不在本層 —— 本層失敗照樣向上拋
 * AuthError(對齊 port JSDoc)。
 */
export async function requestPasswordReset(
  authService: IAuthService,
  params: { email: string; redirectTo: string },
): Promise<void> {
  return authService.sendPasswordResetEmail(params);
}
