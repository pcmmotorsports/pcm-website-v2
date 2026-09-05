import { chromium, type FullConfig } from '@playwright/test';
import { contractFailureMessage } from './contract-message';

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

    // 唯讀:數首屏商品卡 + 解析件數。
    // 🔴 2026-07-24 實測坑:/products 現有 loading.tsx skeleton(06110a8 起走 Suspense streaming),
    // domcontentloaded 當下可能還停在骨架(0 張真卡、無 .pp-count 元素),真內容隨後才流入替換。
    // .count() 本身不會重試,必須先等第一張真卡 visible 才能數,否則會在骨架態誤判「無目錄資料」。
    // (與 runner-smoke.spec.ts:41 等的是同一件事,但寫法刻意不同:那邊逾時直接讓 expect 判紅,
    // 這裡吞掉逾時、改由下面的訊息分岔自己講清楚根因——guard 的價值就在這句話,不能省。)
    // 用 CONTRACT_NAV_TIMEOUT_MS(非 OP_TIMEOUT_MS):目錄持續匯入變大,冷 RPC 逼近 15s 時
    // 舊寫法會在真資料还没流完就假紅;此處等的是「同一次冷請求」的資料,理應套用同一冷啟預算。
    const cards = page.locator('.pp-grid a[href^="/products/"]');
    const cardsRendered = await cards
      .first()
      .waitFor({ state: 'visible', timeout: CONTRACT_NAV_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    const cardCount = await cards.count();
    // 🔴🔴 **件數這一格要指名【看得見的那一顆】—— 因為串流當下 `.pp-count` 會【短暫有兩顆】。**
    //   🔬 2026-09-05 逐格量到(production build,`next start`;dev server 上**量不到**):
    //      卡片可見那一刻 `document.querySelectorAll('.pp-count')` = **2 顆**,
    //      兩顆的字都是「24479 件商品」、祖先鏈逐字相同,差別只有 `看得見=true/false`;
    //      再等 3 秒 ⇒ 剩 **1 顆**。(= Suspense 串流把新的插進來、舊的還沒被移掉的重疊窗口。)
    //   🛑 而 Playwright 的 strict mode 對「兩顆」是**丟例外**,上面那一行的
    //      `.catch(() => '')` 把那個例外**吞成空字串** ⇒ 訊息印「`.pp-count` 的原文是 ""」,
    //      而那句的語意是「那一刻抓不到那個元素」⇒ 📌 **一個純時序問題長得像資料壞掉,
    //      而它中止的是【整套】E2E。**
    //   ⚠️ 這一格不是「偶爾 flaky」:同一顆 hash 連跑**五發全中止**,而同日稍早**兩發跑過去** ——
    //      ⇒ 跑過去的那兩發是**運氣**,不是綠。
    //   ✅ 修法:`:visible` + `.first()`(兩個都要 —— `:visible` 挑掉舊的那顆,
    //      `.first()` 讓「萬一兩顆都可見」也不會再丟 strict 例外),再照上面數卡片的 idiom 等一次。
    //      逾時仍讀不到時 `countText` 照舊是空字串 ⇒ **底下三分岔的訊息一個字都不用改**。
    const countLoc = page.locator('.pp-count:visible').first();
    await countLoc.waitFor({ state: 'visible', timeout: CONTRACT_NAV_TIMEOUT_MS }).catch(() => {});
    const countText = (await countLoc.innerText().catch(() => '')).trim();
    const total = Number(countText.replace(/[^\d]/g, ''));
    const totalOk = Number.isFinite(total) && total > 0;

    // 🔴 挑哪一句抽進 `contract-message.ts` —— 三個分支寫在這個 async 函式裡時,
    //    要驗「哪個世界印哪一句」得起一顆真瀏覽器 ⇒ **實際上沒有人在驗它**,
    //    而 2026-09-04 那四發紅全部落在最泛用的那一句(「疑似 DB 未連通」),
    //    🛑 **而同一發裡商品卡渲染了 100 張。** 行為零改動, 動的只有訊息。
    const failure = contractFailureMessage({
      cardCount,
      totalOk,
      total,
      cardsRendered,
      countText,
      navTimeoutMs: CONTRACT_NAV_TIMEOUT_MS,
    });
    if (failure) {
      throw new Error(failure);
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
