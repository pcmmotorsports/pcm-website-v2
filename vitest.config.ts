/**
 * vitest root config(M-1-02 落地、第一個 test slice)
 *
 * 對齊 docs/architecture/testing-strategy.md:
 * - §1 同層 *.test.ts(不放 __tests__/ folder)
 * - §2 monorepo 統一、root config + workspace inheritance
 * - §3.1 純 stub function 用 vi.fn().mockResolvedValue
 * - §3.3 InMemory adapter 是真實作、非 mock
 * - §4 describe('X') / it('should ...')慣例
 *
 * 設計選擇(本 config 不啟 globals、test 檔顯式 import describe/it/expect/vi):
 * - 對齊 testing-strategy §3.1 範例字面 `import { vi } from 'vitest';`
 * - 顯式 import 邊界清晰、IDE 跳轉 / typecheck 不依賴 ambient types
 *
 * environment: 'node'(domain 邏輯不需 jsdom)
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // storefront 元件 runtime import `@/...`(對齊 apps/storefront/tsconfig.json
  // paths `@/*` → `./src/*`)。vitest 不讀 tsconfig paths、需顯式 alias、否則
  // VehicleFinder / BrandIndex 等 runtime `@/` import 的元件 test 會 resolve 失敗。
  // (WO-2 未觸及:FilterSide.tsx 走 props 注入 data、無 runtime `@/` import。)
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/storefront/src', import.meta.url)),
    },
  },
  test: {
    // include glob 擴 .tsx + .spec + apps/**(M-1-02-audit E1 修):
    // - 原 'packages/**/*.test.ts' 只抓 .ts、M-1-03+ storefront / ui React component test (.tsx) 會 silently skipped
    // - 補 .tsx 涵蓋 React component test、補 .spec 對齊 vitest 預設兩者都收慣例、補 apps/** 涵蓋 storefront server-side test
    // - 對齊 testing-strategy.md §1 字面同步擴
    // - scripts/**(Phase 0 P0-A):同步管線腳本(tsx 直跑、非 build 產物)之同層 *.test.ts,
    //   原 glob 掃不到 → scripts 測試 silently skipped;補 scripts/ 讓 supplier-config 等回歸鎖進 CI。
    include: ['{packages,apps,scripts}/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.next/**',
      'design-reference/**',
      // Playwright E2E specs 用 @playwright/test runner、非 vitest;vitest include 的 .spec
      // glob 會誤抓 apps/storefront/e2e/*.spec.ts、故排除整個 e2e/(見 apps/storefront/
      // playwright.config.ts、測試基建 T-1)。
      '**/e2e/**',
      // 🔴 #288-a:`**/e2e/**` **不匹配 `e2e-prod` 這個 segment**(glob 比對整段路徑名),
      // 故 production build E2E 的目錄必須另外排除,否則 vitest 會拿它自己的 runner
      // 去跑 @playwright/test 的 API = 假紅。見 apps/storefront/playwright.prod.config.ts。
      '**/e2e-prod/**',
    ],
    environment: 'node',
    // 🔴 **釘死測試時區 = Asia/Taipei**(#352-b-1 R3):
    //    本專案所有牆鐘語意都是台北(A5a `submitted_at` 由 server 補 +08:00、到貨時間同款),
    //    而 CI 跑在 **UTC** 的 ubuntu ⇒ 任何「算錯時區」的 bug 在 CI 上**恰好可能等價於正確**。
    //    實錘:`new Date(t + (8*60 + getTimezoneOffset())*60_000)` 這個錯式
    //    在 UTC 下產出的正是正確值(offset=0 ⇒ 恰好 +8h)、在台北下少 8 小時
    //    ⇒ 守門在 CI 恆綠、在真實使用者的機器上失效。**這正是本片 R1 那個 bug 的形狀。**
    //    釘死之後:本地與 CI 都在台北牆鐘下驗,整族時區守門才有判別力。
    //    ⚠️ 拿掉這行不會讓任何測試轉紅 —— 它會讓時區類守門**靜默失去判別力**;
    //    故 `receipt-record-form.test.tsx` 有一格**前置斷言**直接檢查現行時區,拿掉這行那格會紅。
    env: { TZ: 'Asia/Taipei' },
  },
  // React component test(.tsx)JSX 轉譯(WO-2 storefront 測試 infra)。
  // 純 TS 測試(domain / adapters)無 JSX、plugin 不影響。
  // 個別 component test 檔以 `// @vitest-environment jsdom` docblock 切 jsdom 環境。
  plugins: [react()],
});
