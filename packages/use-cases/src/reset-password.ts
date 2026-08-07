import type { IAuthService } from '@pcm/ports';

/**
 * resetPassword:忘記密碼 — 設定新密碼 use-case(忘記密碼片新)。
 *
 * 收**已驗證的**新密碼(表單 `@pcm/schemas` parse 在 delivery 層完成)。走
 * IAuthService.updatePassword。依賴注入 client 已帶有效 recovery session(對齊 port JSDoc);
 * 失敗 → domain AuthError,向上拋。
 */
export async function resetPassword(authService: IAuthService, newPassword: string): Promise<void> {
  return authService.updatePassword(newPassword);
}
