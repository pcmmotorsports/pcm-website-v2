import type { IAuthService } from '@pcm/ports';

/**
 * resendSignupConfirmation:重寄註冊驗證信 use-case(`⟦b4-SIGNUPOPEN1⟧` 前置片,2026-09-05)。
 *
 * 形狀逐字對齊 `request-password-reset.ts` —— 同一族(對外寄信、帳號列舉敏感)的兩支
 * 放在一起時,**不同的形狀本身就是一個要解釋的偏離**。
 *
 * 收**已驗證的** email(表單 parse 在 delivery 層完成;對齊 boundaries:use-cases ⊥ schemas)。
 * 🛑「不洩漏帳號是否存在」是呼叫端(server action)的責任、不在本層 ——
 *    本層失敗照樣向上拋 AuthError(對齊 port JSDoc)。
 */
export async function resendSignupConfirmation(
  authService: IAuthService,
  params: { email: string; redirectTo: string },
): Promise<void> {
  return authService.resendSignupConfirmation(params);
}
