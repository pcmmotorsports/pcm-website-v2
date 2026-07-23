import { chromium, type FullConfig } from '@playwright/test';

/**
 * production-build E2E 資料合約 fail-fast(#288-b;plan = docs/specs/2026-07-20-catalog-prod-build-e2e-plan.md §7.1 / §10.1)
 *
 * 為什麼要有這一層(而非只靠 e2e-prod/runner-smoke.spec.ts):
 *   #288-c/d/e 之後 e2e-prod/ 會長出多條篩選行為 spec。若 DB 未連通 / 冷快取為空,
 *   那一整批 spec 會各自以「找不到商品卡逾時」噴出看不懂根因的失敗。
 *   globalSetup 在**任何 test 開跑前**先驗一次「/products 真有目錄資料」,
 *   不成立就以單一、講清楚根因的訊息中止整套(fail-fast),不逐測空轉。
 *
 * 🔴 執行時機(plan §4,兩審親讀 Playwright 1.60 原始碼確認):
 *   webServer plugin setup(preflight && build && start 整條跑完)→ globalSetup,
 *   所以此處 server 必已 ready、/products 打得到(env 前置檢查另由 preflight 在 build 前擋)。
 *
 * 🔴 逾時(plan §7.1,codex MF-9):globalSetup **不受 per-test timeout 保護**,
 *   手動開 browser 後的 locator 等待可能無限卡住 → 每個操作都掛顯式 timeout;
 *   config 另設 globalTimeout 作第二道界限。
 *
 * 🔴 唯讀 + 零敏感輸出(plan §10.1 資料策略 / §7.1):只讀 /products、只數卡片與件數,
 *   絕不寫任何資料;失敗訊息只含**非敏感計數與 HTTP 狀態碼**,不印 URL / key / email / 資料內容。
 */

const CONTRACT_NAV_TIMEOUT_MS = 45_000; // 打真 DB 的 force-dynamic SSR、cold 首請求可能較慢,留餘裕但有界
const CONTRACT_OP_TIMEOUT_MS = 15_000; // 單一 locator 操作上界(避免元件不存在時無限等)

async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) {
    throw new Error('[e2e-prod 資料合約] 讀不到 baseURL,無法執行資料合約前置檢查 — 中止整套 E2E');
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(CONTRACT_OP_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(CONTRACT_NAV_TIMEOUT_MS);

    const res = await page.goto(new URL('/products', baseURL).href, {
      waitUntil: 'domcontentloaded',
    });
    const status = res?.status();
    if (!res || !res.ok()) {
      throw new Error(
        `[e2e-prod 資料合約] /products 未回 2xx(status=${status ?? 'no-response'})— 中止整套 E2E`,
      );
    }

    // 唯讀:數首屏商品卡 + 解析件數。兩者都在 force-dynamic 的 SSR HTML 內,不需等 client hydration。
    // (與 runner-smoke 同源錨點;此處作為「開跑前」的 fail-fast 閘,smoke 仍在 test 內獨立驗一次。)
    const cardCount = await page.locator('.pp-grid a[href^="/products/"]').count();
    const countText = (await page.locator('.pp-count').innerText().catch(() => '')).trim();
    const total = Number(countText.replace(/[^\d]/g, ''));
    const totalOk = Number.isFinite(total) && total > 0;

    if (cardCount < 1 || !totalOk) {
      throw new Error(
        `[e2e-prod 資料合約] /products 回 2xx 但無目錄資料` +
          `(商品卡=${cardCount}、件數=${totalOk ? total : '不可解析'})` +
          ` — 疑似 DB 未連通或冷快取為空,先中止整套 E2E 避免逐測噴難懂的逾時。`,
      );
    }

    // 成功訊息走 stderr(與 preflight 一致、非測試輸出);只含非敏感計數。
    console.error(
      `[e2e-prod 資料合約] OK — /products 首屏商品卡=${cardCount}、件數=${total},開始執行測試。`,
    );
  } finally {
    await browser.close();
  }
}

export default globalSetup;
