import { test, expect } from '@playwright/test';

/**
 * 首頁 smoke E2E(測試基建 T-1、第一條網站運行測試)
 *
 * 目的:證明 Playwright 能起 storefront dev server、開首頁、驗 SSR 真的渲染成功
 * (build pass ≠ runtime pass、此為第一道 runtime 防線)。
 *
 * 斷言對象 = app/page.tsx 頂層 data-screen-label="Home"(穩定 data 屬性、非視覺文案、
 * 改設計不會誤紅)。products 表空(M-1-16 種子前)不影響此 smoke、HomeSelect 走 empty 分支。
 */
test('首頁能正常開啟並 SSR 渲染', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.ok()).toBeTruthy();
  await expect(page.locator('[data-screen-label="Home"]')).toBeVisible();
});
