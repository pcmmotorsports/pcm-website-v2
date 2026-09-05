import { chromium, type FullConfig } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
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
// 🔴 與 `playwright.prod.config.ts` 的 `use.storageState` **同一個字面**;兩邊漂掉的症狀是
//    「cookie 換到了而測試還是被擋」⇒ 兩處都指這裡, 不要各自寫一份路徑。
// 🔴🔴 **這個檔【不可以】落在 `test-results/` 底下**(code-reviewer nit-4):
//    `.github/workflows/e2e-prod.yml` 在失敗時把 `apps/storefront/test-results/` **整包上傳**成 artifact,
//    而這個檔就是一份 storageState = **bypass cookie 的明文**。
//    ⚠️ 今天 CI 不帶 token ⇒ 檔不存在 ⇒ 那是**潛伏**不是現行;而潛伏的洞會在
//    「哪天有人給 CI 帶了 token」那一刻自己打開, 且**沒有東西會叫**。
//    ⇒ ✅ 改寫到系統暫存目錄:它既不在 repo 裡(不會被 commit)、也不在上傳範圍裡。
//    🔵 **不動 `.github/workflows/*.yml`** —— 那是鐵則 12④(平台設定), 要 plan;
//       而把檔搬出上傳範圍是同一個效果、零平台設定改動。
//    🔴 絕對路徑, 不是相對路徑:相對路徑跟著 cwd 跑, 從 repo 根與從 apps/storefront 下指令
//       會落在兩個地方(code-reviewer nit-5)。
export const SHARE_STATE_PATH = path.join(os.tmpdir(), 'pcm-e2e-vercel-share-state.json');

async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use?.baseURL;
  if (!baseURL) {
    throw new Error('[e2e-prod 資料合約] 讀不到 baseURL,無法執行資料合約前置檢查 — 中止整套 E2E');
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    // 🔴🔴 **Vercel preview 的 share token:先換 cookie, 再做任何事**(2026-09-05 線 `-f3`)。
    //   token 只認 `?_vercel_share=` 這個 **query 參數**, 而本套所有 spec 都是 `goto('/xxx')`
    //   ⇒ 沒有這一步, 每一發都會被擋在保護頁, 而**那個紅看起來會像「preview 壞了」**。
    //   ✅ 換完之後把 cookie 寫成 storageState, 由 config 的 `use.storageState` 交給每個測試 context
    //      (Playwright 官方的 auth 形狀:config 只寫路徑, 檔由 globalSetup 在測試開跑前產出)。
    //   🔴 **值只從 env 讀、永不印**:下面所有訊息只講「有沒有帶」與 http 狀態碼, 不含 token。
    //   ⚠️ 一個 share token **綁單一部署**且會過期 ⇒ 它換不到 cookie 時要**明說是這一步失敗**,
    //      否則下一個人會去查資料庫(那是資料合約那段的訊息, 不是這一段的)。
    // 🔴 **兩處條件必須對稱**(code-reviewer 2026-09-05 must-fix-2):config 那邊是
    //   `外部模式 && token`, 而這裡原本只看 token ⇒ shell 裡留著 token 卻跑本機模式時,
    //   它會去對 `localhost:3200/?_vercel_share=…` 換 cookie、換不到、**中止整套**,
    //   而訊息還在講「token 綁單一部署」。⇒ 兩邊吃同一個條件。
    const shareToken =
      process.env.PCM_E2E_BASE_URL?.trim() && process.env.PCM_E2E_SHARE_TOKEN?.trim();
    if (shareToken) {
      const bootstrap = await context.newPage();
      // 🔴🔴 **`goto` 丟出來的例外【字面含整個網址】, 而網址裡有 token。**
      //   實測(code-reviewer 量的, playwright-core 1.60):DNS 壞 / 連不上 / 逾時 ⇒ goto **throw**,
      //   訊息逐字 `page.goto: net::ERR_NAME_NOT_RESOLVED at https://…/?_vercel_share=<token>`,
      //   Call log 再印一次 ⇒ 📌 **token 明文進 runner 輸出 ⇒ CI log、以及貼給人看的那一段。**
      //   ⚠️ 我原本檢查過三條路(訊息 / 檔路徑 / trace)全乾淨, **漏的是第四條:例外自己**。
      //   ⇒ ✅ 包 try/catch, catch 只丟我自己寫的字(含 error 的 name, 不含 message 也不含 URL)。
      try {
        await bootstrap.goto(
          `${new URL('/', baseURL).href}?_vercel_share=${encodeURIComponent(shareToken)}`,
          { waitUntil: 'domcontentloaded', timeout: CONTRACT_NAV_TIMEOUT_MS },
        );
      } catch (e) {
        throw new Error(
          `[e2e-prod share token] 換 cookie 那一發【連不上或逾時】(${(e as Error).name})——` +
            ' 🛑 原始訊息含 token, 已刻意不轉印。先確認那個 baseURL 打得開。',
        );
      }
      // 🔴 **判準用「保護有沒有真的被繞過」, 不用「有幾顆 cookie」**(code-reviewer nit-3):
      //   數 cookie 兩個方向都會錯 —— 別的 cookie(toolbar / 未來的 middleware)會讓它假過;
      //   cookie 落在 `*.vercel.app` 而 baseURL 是自訂網域時又會假不過。
      //   ⇒ 直接問那個要答的問題:**帶著這個 context 打得開受保護的頁嗎**。
      const verify = await bootstrap.goto(new URL('/products', baseURL).href, {
        waitUntil: 'domcontentloaded',
        timeout: CONTRACT_NAV_TIMEOUT_MS,
      });
      if (!verify || !verify.ok()) {
        throw new Error(
          `[e2e-prod share token] cookie 換完了而保護還在(/products http=${verify?.status() ?? 'no-response'})` +
            ' —— 🛑 這【不是】資料的問題:share token 綁單一部署而且會過期,' +
            ' 先確認它配的是這個 baseURL 那顆部署。',
        );
      }
      await bootstrap.close();
      await context.storageState({ path: SHARE_STATE_PATH });
      console.error(
        `[e2e-prod share token] OK — 保護已繞過(/products http=${verify.status()}),` +
          `狀態寫入 ${SHARE_STATE_PATH}(token 與 cookie 值都不印)。`,
      );
    }

    const page = await context.newPage();
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
