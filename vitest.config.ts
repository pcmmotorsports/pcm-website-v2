/**
 * vitest root config(M-1-02 落地、第一個 test slice;#606 改 projects 拆 per-app alias)
 *
 * 對齊 docs/architecture/testing-strategy.md:
 * - §1 同層 *.test.ts(不放 __tests__/ folder)
 * - §2 monorepo 統一、root config + projects(#606 起用 vitest projects,per-app alias)
 * - §3.1 純 stub function 用 vi.fn().mockResolvedValue
 * - §3.3 InMemory adapter 是真實作、非 mock
 * - §4 describe('X') / it('should ...')慣例
 *
 * 設計選擇(本 config 不啟 globals、test 檔顯式 import describe/it/expect/vi):
 * - 對齊 testing-strategy §3.1 範例字面 `import { vi } from 'vitest';`
 * - 顯式 import 邊界清晰、IDE 跳轉 / typecheck 不依賴 ambient types
 *
 * environment: 'node'(domain 邏輯不需 jsdom;個別 component test 檔以
 * `// @vitest-environment jsdom` docblock 切 jsdom 環境)
 *
 * 🔴 #606 projects 結構(2026-08-17):
 * - `@` alias 原本只指 apps/storefront/src ⇒ apps/admin 的 runtime `@/` import
 *   (proxy.ts / sso route 等)在測試裡解析不到、寫不出頁面層測試。
 * - 改為三個 project,alias 各自指自己的 src;**root 層不再放 `@` alias** ——
 *   `extends: true` 繼承時 root config 是 defaults、project 同名鍵覆蓋(Vite merge
 *   語意,codex R1 nit 更正:root 不會反過來蓋掉 project)。移除 root alias 的理由
 *   是【單一事實】:root 若留 `@`→storefront 當預設,未來新增 project 忘了自帶
 *   alias 時會【安靜地】解析到 storefront 的 src —— 正是 #606 這個病的復刻。
 * - `extends: true` 顯式寫、不賭版本預設值(官方 migration 文件顯示這個預設
 *   跨大版會變)⇒ 各 project 繼承 root 的 plugins / environment / env
 *   (TZ 三個 project 各有一支前置錨點守著,含 process.env.TZ 斷言)。
 * - exclude 不依賴繼承的合併語意(concat vs replace 官方未保證)⇒ 每個 project
 *   明寫完整清單(SHARED_EXCLUDE)。
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 共用 exclude(每個 project 逐字全列、不靠繼承合併):
// - Playwright E2E specs 用 @playwright/test runner、非 vitest;vitest include 的 .spec
//   glob 會誤抓 apps/storefront/e2e/*.spec.ts、故排除整個 e2e/(見 apps/storefront/
//   playwright.config.ts、測試基建 T-1)。
// - 🔴 #288-a:`**/e2e/**` **不匹配 `e2e-prod` 這個 segment**(glob 比對整段路徑名),
//   故 production build E2E 的目錄必須另外排除,否則 vitest 會拿它自己的 runner
//   去跑 @playwright/test 的 API = 假紅。見 apps/storefront/playwright.prod.config.ts。
const SHARED_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.turbo/**',
  '**/.next/**',
  'design-reference/**',
  '**/e2e/**',
  '**/e2e-prod/**',
];

export default defineConfig({
  // React component test(.tsx)JSX 轉譯(WO-2 storefront 測試 infra)。
  // 純 TS 測試(domain / adapters)無 JSX、plugin 不影響。各 project extends: true 繼承。
  plugins: [react()],
  test: {
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
    //    (放 root、各 project 繼承;那格前置斷言同時守著「繼承有生效」這件事。)
    env: { TZ: 'Asia/Taipei' },
    // include glob 史(M-1-02-audit E1 修 → #606 拆進 projects):
    // - 原 'packages/**/*.test.ts' 只抓 .ts ⇒ .tsx component test silently skipped;
    //   後擴 {packages,apps,scripts}/**/*.{test,spec}.{ts,tsx}。
    // - #606 拆三個 project 後,三份 include 的聯集必須仍等於上述全域 glob
    //   (storefront + admin + 其餘;「其餘」用 exclude 排掉前兩者、不用列舉法,
    //   新增 app 時自動落入 node project、不會 silently skipped)。
    projects: [
      {
        extends: true,
        resolve: {
          // storefront 元件 runtime import `@/...`(對齊 apps/storefront/tsconfig.json
          // paths `@/*` → `./src/*`)。vitest 不讀 tsconfig paths、需顯式 alias。
          alias: {
            '@': fileURLToPath(new URL('./apps/storefront/src', import.meta.url)),
          },
        },
        test: {
          name: 'storefront',
          include: ['apps/storefront/**/*.{test,spec}.{ts,tsx}'],
          exclude: SHARED_EXCLUDE,
        },
      },
      {
        extends: true,
        resolve: {
          // admin 同款(對齊 apps/admin/tsconfig.json paths `@/*` → `./src/*`)。
          // #606 本體:proxy.ts / sso route 的 `@/` import 從此測得到。
          alias: {
            '@': fileURLToPath(new URL('./apps/admin/src', import.meta.url)),
          },
        },
        test: {
          name: 'admin',
          include: ['apps/admin/**/*.{test,spec}.{ts,tsx}'],
          exclude: SHARED_EXCLUDE,
        },
      },
      {
        extends: true,
        // packages/scripts/其餘 apps(api、sync-engine 現況 0 測試檔且 0 `@/` 使用):
        // 無 `@` alias ⇒ 未來這裡若有人寫 `@/` import 會【大聲地】解析失敗,
        // 不會安靜解析到別的 app 的 src。
        test: {
          name: 'node',
          include: ['{packages,apps,scripts}/**/*.{test,spec}.{ts,tsx}'],
          exclude: [...SHARED_EXCLUDE, 'apps/storefront/**', 'apps/admin/**'],
        },
      },
    ],
  },
});
