import type { IAuthService } from '@pcm/ports';

/**
 * logoutCustomer:會員登出 use-case(M-1-14e-1b、PRD §8.1)。
 *
 * 走 `IAuthService.signOut`(清注入 client 綁定的 session);無輸入、無回傳。
 * 失敗 → domain AuthError(adapter 映射),向上拋。
 */
export async function logoutCustomer(authService: IAuthService): Promise<void> {
  return authService.signOut();
}
