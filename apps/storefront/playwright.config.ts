import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E config(測試基建 T-1、第一條網站運行測試)
 *
 * 與 vitest 分離:Playwright 只掃 ./e2e(testDir);root vitest.config.ts 已把 e2e 目錄加進
 * exclude,兩 runner 不互踩。ESLint 全域 ignore config / spec 檔(eslint.config.js)、本檔 +
 * e2e spec 不入 lint;storefront tsconfig 仍 typecheck(@playwright/test 自帶型別)。
 *
 * webServer:自動起 storefront `next dev` 於專用 port 3100(避開本機手動 dev 常用的 3000、
 * test 與手動 dev 互不干擾、CI 也乾淨);首頁 force-dynamic SSR。只跑 chromium headless;
 * 跨瀏覽器 + CI gate 留後續 slice(T-2+)。
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec next dev --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
