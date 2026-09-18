import { defineConfig, devices } from '@playwright/test';

/**
 * 後台(admin)E2E — 只跑在**鑽機**上(`bash scripts/admin-probe/up.sh`)。
 *
 * 🔴 **沒有 `webServer`,而那是刻意的**:後台鑽機不是一個 `next dev` 就起得來的東西 ——
 *    它是一整條鏈(拋棄式 postgres + replay 全部 migrations + PostgREST 替身 + proxy)。
 *    ⇒ 讓 Playwright 自己起會得到一個**連不上 DB 的站**,而那種站每一格都會紅得莫名其妙。
 *    ⇒ ✅ 由 `up.sh` 起、這裡只連上去;沒有 `E2E_ADMIN_BASE_URL` ⇒ **整族 skip,不假裝綠**。
 *
 * 跑法:
 *   bash scripts/admin-probe/up.sh
 *   E2E_ADMIN_BASE_URL=http://127.0.0.1:3011 ADMIN_PROBE_PG=55534 pnpm --filter @pcm/admin test:e2e
 *   (換過埠的話兩個都要帶同一組 —— 見 `scripts/admin-probe/env.sh` 那段「起與收要帶同一組」)
 */
const externalBaseUrl = process.env.E2E_ADMIN_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // 🔴 同一台鑽機、同一個庫 ⇒ 平行跑會互相踩到種子
  // 🔴🔴 **`fullyParallel: false` 只管【單一檔內】的順序, 不管【跨檔】**(2026-09-19 補)——
  //    少了這一行, Playwright 仍然會用多個 worker **同時跑不同的 spec 檔**,
  //    而這幾支共用同一台鑽機、同一個庫, **甚至同一張單**
  //    (`shipping-create-box` 與 `payment-record` 兩支都動 `PCM-2026-1007`)。
  //    ⇒ 📌 那會長成最難查的一種紅:**每一支自己跑都綠, 一起跑才紅, 而且紅的位置會飄。**
  //    🔬 由兩個【互相獨立】的來源同時量到同一件事(窗A 的失敗訊息盤點 + R1 對抗審查 C3)
  //       ⇒ 才動這一行。單一來源時我不會動設定檔。
  workers: 1,
  retries: 0, // 🛑 不重試:一支會偶爾紅的測試, 重試只會把它藏起來
  reporter: [['list']],
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:3011',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
