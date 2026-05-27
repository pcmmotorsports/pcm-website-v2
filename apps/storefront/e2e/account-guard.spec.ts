import { test, expect } from '@playwright/test';

/**
 * /account server 守門 e2e(測試基建 T-1 地基 → g-1a 第一個真實守門驗證)。
 *
 * 未登入(fresh context、無 session cookie)訪問 /account:server component getUser() 取不到
 * user → redirect('/login')。直打網址也擋(真安全閘、非僅 Header 裝飾)。
 * 驗最終 URL 落在 /login(可帶 query)。
 */
test('未登入訪問 /account 被 server 守門導向 /login', async ({ page }) => {
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login(\?.*)?$/);
});
