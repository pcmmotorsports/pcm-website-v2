import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright **production build** E2E config(#288-a;plan = docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md v3.2)
 *
 * 為什麼要有第二份 config —— 既有 playwright.config.ts 的 webServer 跑 `next dev`(:28),
 * 而 2026-07-19 那三個商品目錄 bug(61f45b6 品牌 / 630b7a6 分頁 / 49afb07 深連結)
 * **全部只在 `next build && next start` 下重現、`next dev` 看不到**
 * (docs/handoff/2026-07-19-catalog-url-state-three-bugs-handoff.md:88-89)。
 * 單元測試只驗「有沒有呼叫 router API」、驗不到「呼叫後畫面有沒有真的更新」
 * → 這一層在本檔出現前**結構上無守門**。
 *
 * 🔴 reuseExistingServer 必須恆為 false(關卡1 雙審 R2 皆列 must-fix):
 *   command 是「preflight && build && start」**整條**;若 reuse 命中則 build 也不會跑,
 *   突變自驗(故意改壞產品碼、確認測試轉紅)就會連到**舊的、修好的** server → 該紅不紅,
 *   整套反假綠設計失效。故不吃 CI 判斷、不做條件式。
 *   ⚠️ 連帶:**不自寫 port 佔用檢查、不自寫 kill** —— Playwright 在 reuseExistingServer:false
 *   下本就會偵測佔用並失敗;自寫 kill 會誤殺他人程序(關卡1 R3 codex must-fix #6)。
 *
 * 🔴 env 檢查為何掛在 command 最前面(關卡1 R3 兩審獨立命中):
 *   Playwright 1.60 執行序 = webServer plugin setup(整條 command 跑完)→ globalSetup,
 *   所以 env 檢查放 globalSetup **太晚**。詳見 scripts/e2e-prod-preflight.mjs 檔頭。
 *
 * ⚠️ `.next` 與既有 dev e2e(3100)/ 手動 dev 共用 → **不得併跑**,否則互相重建污染。
 *
 * ⚠️ **本機 warm cache 可能蓋掉「資料庫壞 → 測試紅」**(Fable 審查 C1):
 *   `lib/products.ts` 的目錄查詢包在 `unstable_cache`(revalidate 900),而 `next build`
 *   **不清** `.next/cache` → 本機重跑時可能直接供應 stale 結果、根本沒打 DB。
 *   ⇒ 要在本機重現「反假綠」實證,先清 `.next/cache/fetch-cache`。
 *   ✅ **CI 不受影響**:每次 fresh checkout 恆為冷快取。
 *
 * #288-b 補上:globalSetup 資料合約 fail-fast + mobile device project(Pixel 5)。
 * 仍**不含**:品牌 / 分頁 / 選車 / 深連結等篩選行為斷言 —— 那些依序在 #288-c / d / e。
 */
export default defineConfig({
  testDir: './e2e-prod',
  fullyParallel: false, // 共用單一 production server,序列跑避免互相干擾
  forbidOnly: !!process.env.CI,
  retries: 0, // 守門用途:紅就是紅,不靠重試掩蓋 flaky
  reporter: 'list',
  timeout: 60_000,
  // 🔴 globalSetup 資料合約(#288-b,plan §7.1/§10.1):任何 test 開跑前先驗 /products 真有資料,
  //    不成立就以單一講清楚根因的訊息中止整套(避免 c/d/e 多 spec 各自噴逾時看不出根因)。
  //    路徑相對本 config 所在目錄(= apps/storefront),與 testDir './e2e-prod' 同款解析。
  globalSetup: './e2e-prod/global-setup.ts',
  // 🔴 globalTimeout(#288-b,plan §7.1/codex MF-9):globalSetup **不受 per-test timeout 保護**,
  //    以整套上界作第二道防線(第一道 = global-setup.ts 內每個 locator 操作的顯式 timeout)。
  //    值取 10 分鐘:涵蓋 webServer build(≤180s)+ setup + 兩 project smoke,同時仍能界住無限卡死。
  globalTimeout: 600_000,
  use: {
    baseURL: 'http://localhost:3200',
    // 🔴 必須是 retain-on-failure 而非 on-first-retry(code-reviewer MF-6):
    //    retries=0 → 永不重試 → on-first-retry 永遠不會產生 trace,
    //    CI 的「失敗時上傳 trace」步驟就會靜默上傳空目錄 = 步驟名與事實不符。
    trace: 'retain-on-failure',
    navigationTimeout: 60_000,
    actionTimeout: 15_000, // #288-b plan §7.1:page/action/navigation 三者皆須有界(navigation 已於上行)
  },
  // 🔴 mobile 必須用完整 device preset(#288-b,plan §7.3/codex MF-7):
  //    app/layout.tsx:83 以 **UA regex**(/iPhone|Android|Mobile/i)判 isMobile 並輸出 <html data-mobile>,
  //    只改 viewport = data-mobile="false" + mobile 媒體查詢的混血態、與真機不一致。
  //    選 Pixel 5 而非 iPhone:iPhone preset 的 defaultBrowserType = webkit(本機未安裝、會啟動失敗),
  //    Pixel 5 = chromium 系 + isMobile:true + UA 含 Android/Mobile → 觸發 data-mobile="true" 且不需額外瀏覽器。
  //    🔴 未來 #288-c/d/e 若再加別的 device project:preset 的 **UA 必須命中 layout.tsx:83 的
  //    /iPhone|Android|Mobile/i**,否則 runner-smoke 的 `data-mobile` 斷言(以 isMobile fixture 為期望)會**假紅**
  //    —— playwright 內建有少數 preset(如 Blackberry PlayBook / Kindle Fire HDX)isMobile:true 但 UA 不含這些字。
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: {
    // 🔴 preflight 必須在 build 之前(見上)。cwd 預設 = 本 config 所在目錄 = apps/storefront。
    command: 'node scripts/e2e-prod-preflight.mjs && pnpm build && pnpm exec next start --port 3200',
    url: 'http://localhost:3200',
    reuseExistingServer: false,
    // 實測本機 next build:冷啟(清 .next)19s / warm 11s → 180s 約 9x 餘裕。
    timeout: 180_000,
    stderr: 'pipe', // preflight 的錯誤訊息走 stderr,必須看得到
  },
});
