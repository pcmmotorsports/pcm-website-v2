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
/**
 * 🔴🔴 **外部模式(`PCM_E2E_BASE_URL`;2026-09-05 線 `-f3`)**
 *
 * 病:本檔的 `baseURL` 寫死 `http://localhost:3200`, 而 `webServer.reuseExistingServer` **恆為 false**
 *   ⇒ 它每一發都在本機重建重跑 ⇒ 📌 **「合完 main 之後去正式站走一遍」這件事, 這套一格都跑不了。**
 *
 * ✅ 有 `PCM_E2E_BASE_URL` ⇒ ①`baseURL` 用它 ②**整個 `webServer` 不存在**(不建、不起、不佔埠)。
 * 🛑 **沒有它的時候, 行為【一個字都不變】** —— 下面那個 `webServer` 物件逐字沒動, 只是被條件式地
 *   放進 config。⇒ 反假綠設計(reuse 恆 false ⇒ 突變自驗連得到新 server)在本機模式下**原樣還在**。
 * 🔴 而**外部模式下那個設計【本來就不成立】** —— 遠端那台是誰建的、建的是哪一顆 commit,
 *   這支 config 答不出來 ⇒ 📌 **外部模式的綠, 證明的是「那台機器現在的行為」, 不是「這棵樹的碼對」。**
 *   兩者不是同一個宣稱, 不要拿外部的綠當本機的替代品。
 */
const EXTERNAL_BASE_URL = process.env.PCM_E2E_BASE_URL?.trim() || '';
if (EXTERNAL_BASE_URL) {
  // 🔴 **兩種打錯法會【靜靜量到別的地方】或【在錯的層炸】, 各擋一發**(code-reviewer 2026-09-05):
  //   ① 忘了 `https://` ⇒ `global-setup.ts` 的 `new URL('/products', baseURL)` 會丟 `Invalid URL`,
  //      而那時瀏覽器已經開起來了, 訊息不指向根因。
  //   ② 帶路徑(`https://host/tw`)⇒ spec 一律 `goto('/search')`(前導斜線)⇒ **`/tw` 整段被丟掉**,
  //      它打的是 `https://host/search` ⇒ 📌 **量到別的地方而且會綠。**
  let parsed: URL;
  try {
    parsed = new URL(EXTERNAL_BASE_URL);
  } catch {
    throw new Error(
      `[e2e-prod] PCM_E2E_BASE_URL 不是合法網址:「${EXTERNAL_BASE_URL}」—— 少了 https:// 嗎?`,
    );
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error(`[e2e-prod] PCM_E2E_BASE_URL 只收 http/https, 收到「${parsed.protocol}」`);
  }
  if (parsed.pathname !== '/') {
    throw new Error(
      `[e2e-prod] PCM_E2E_BASE_URL 不可以帶路徑(收到「${parsed.pathname}」)——` +
        ' spec 一律以 `/` 開頭 goto, 那段路徑會被【靜靜丟掉】而測試照樣綠。',
    );
  }
  // 🔵 走 stderr:與 preflight 一致, 而且 Playwright 的 reporter 不會把它當測試輸出吃掉。
  //   🔴 「跳過 N 格」那個數字**印的是 0, 而 0 是量到的不是佔位** —— 今天 e2e-prod 底下
  //   三支 spec **全是唯讀**(逐支開檔:goto / 點側欄 / 讀網址與文字), 沒有一格會寫入,
  //   也沒有一格只在本機才有意義。⇒ 哪天有了會寫入的格, 在那一格上加
  //   `test.skip(() => !!process.env.PCM_E2E_BASE_URL, '會寫入 ⇒ 不對外部站跑')`, 並把這裡的 0 改掉。
  console.error(
    `[e2e-prod] 🔴 外部模式:baseURL = ${EXTERNAL_BASE_URL}\n` +
      '[e2e-prod]    不建 server(webServer 整段不存在)· 本片【不因外部模式跳過任何格】\n' +
      '[e2e-prod]      (⚠️ reporter 印的 `1 skipped` 是 multi-category 那支自己的手機版 skip, 與外部模式無關)\n' +
      '[e2e-prod]    ⚠️ 這一發的綠證明的是【那台機器現在的行為】, 不是【這棵樹的碼對】。\n' +
      '[e2e-prod]    ⚠️ globalSetup 若在這裡失敗, 它的訊息會說「疑似 DB 未連通」——\n' +
      '[e2e-prod]      那句是為【本機打我們自己的 DB】寫的;外部模式下真正的成因多半是那台機器或它的快取。',
  );
}

export default defineConfig({
  testDir: './e2e-prod',
  // 🔴🔴 **2026-09-05:這一行是【必要的】, 不是防禦性的** —— 少了它 CI 的 E2E 每一發都紅。
  //   病史:Playwright 的**預設** `testMatch` 同時吃 `.spec.ts` **與 `.test.ts`**
  //   (實測:不加本行時 `playwright test --list` 直接噴
  //    `Error: Vitest cannot be imported in a CommonJS module using require()` at `contract-message.test.ts:1`,
  //    而且 **`Total: 0 tests in 0 files`** ⇒ 🛑 **一支檔載不動, 整套一支都跑不了。**)
  //   ⇒ 而 `e2e-prod/` 裡**現在住著一支 vitest 測試**(`contract-message.test.ts`, `a46b9a8eb`),
  //     它被放在這裡是因為被測的 `contract-message.ts` 在這裡, 而 vitest 的 exclude
  //     2026-09-04 已從「整個 `e2e-prod/`」**收窄成只排 `**/e2e-prod/**/*.spec.ts`**(見 root `vitest.config.ts`)。
  //   🎯 **⇒ 兩道門必須【形狀互補】, 而 09-04 那一片只收窄了其中一道**:
  //     vitest 排 `.spec.ts` / playwright 只收 `.spec.ts` ⇒ 同一個目錄, 兩種副檔名, 各歸各的 runner。
  //   🛑 **不要把它改回「不設 testMatch」** —— 那等於把 `.test.ts` 交給 Playwright, 而它 require 不動 vitest。
  //   ⚠️ 而**它的失敗方式不是漏跑, 是【整套零檔】** ⇒ 記在這裡, 因為零檔在某些 reporter 下看起來像通過。
  testMatch: '**/*.spec.ts',
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
    // 🔴 外部模式吃 env;沒有 env 時**逐字還是原本那個值**。
    baseURL: EXTERNAL_BASE_URL || 'http://localhost:3200',
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
  // 🔴 外部模式**整段拿掉**(不是把 reuseExistingServer 翻成 true)——
  //   翻旗標會讓 Playwright 去「檢查埠、沒人就自己起」, 那在打遠端網址時是錯的動作;
  //   而 `undefined` 的 webServer 是 Playwright 明文支援的「不要管 server」。
  ...(EXTERNAL_BASE_URL ? {} : { webServer: {
    // 🔴 preflight 必須在 build 之前(見上)。cwd 預設 = 本 config 所在目錄 = apps/storefront。
    command: 'node scripts/e2e-prod-preflight.mjs && pnpm build && pnpm exec next start --port 3200',
    url: 'http://localhost:3200',
    reuseExistingServer: false,
    // 實測本機 next build:冷啟(清 .next)19s / warm 11s → 180s 約 9x 餘裕。
    timeout: 180_000,
    stderr: 'pipe', // preflight 的錯誤訊息走 stderr,必須看得到
  } }),
});
