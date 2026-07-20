#!/usr/bin/env node
// e2e-prod-preflight.mjs — production-build E2E 的環境前置檢查(#288-a)
//
// 為什麼存在(plan §4,兩審 R3 獨立命中同一條):
//   Playwright 1.60 的執行序是「webServer plugin setup(整條 build+start 跑完)→ globalSetup」,
//   所以 env 檢查**放 globalSetup 太晚**——缺 env 時會先白燒一次 build,才在別處炸出
//   看不懂的執行期錯誤。故本檔掛在 webServer.command 的**最前面**。
//
// 🔴 為什麼改用 @next/env 而非自己解析 env 檔(codex #288-a MF1,已實測坐實):
//   舊版對 ENV_FILES 逐檔各自判斷「是否有非空鍵」再取聯集,這不是 Next 實際的
//   優先序解析,至少三種情況會被誤判:
//     - 高優先檔案該鍵是空值、低優先檔案有值 → Next 實際會被高優先的空值卡住
//       (`process.env → .env.production.local → .env.local → .env.production → .env`,
//       先出現的鍵名就定案),但舊版聯集會看到低優先「非空」而誤判通過
//       (build 之後仍會失敗、白跑一次)
//     - `KEY= # comment` → dotenv 解析後為空字串,舊版逐行 regex 未必按 dotenv
//       同款規則剝除,可能誤判非空
//     - `KEY=$UNSET_VAR` → 舊版只看字面非空,Next 實際會展開(dotenv-expand)成空
//   ⇒ 本版不再自己重寫一份解析規則,改直接呼叫 **Next 自己用來載入 env 的
//     `@next/env`**(`loadEnvConfig`),取它算出來的 `combinedEnv`
//     (已套用 process.env 優先序 + dotenv 解析 + `${VAR}` 展開)。
//     三個邊界情境已用暫時 fixture 目錄實測驗證,皆正確判定為「非空值不成立」。
//
// 🔴 為什麼要求「非空值」而非只要「鍵名存在」(code-reviewer MF-4/MF-5,已實測):
//   GitHub Actions 在 secret 未設定時會把 `${{ secrets.X }}` 內插成**空字串**、
//   而 env var 仍被建立 → 舊版「只驗鍵名」會在**零資料庫設定**時回報通過 = 假綠。
//
// 🔴 安全邊界(硬性):
//   - 只輸出**鍵名**;值只在函式內被判斷「是否非空」,絕不印出、絕不離開該作用域
//   - 絕不寫入/修改任何檔案
//   - 錯誤訊息一律走 stderr(Playwright webServer 預設 pipe stderr、ignore stdout)

import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];

const appDir = dirname(dirname(fileURLToPath(import.meta.url))); // scripts/ 的上一層 = apps/storefront

/**
 * `@next/env` 不是本 repo 的直接依賴(它是 `next` 的 transitive dependency),
 * 但 `next build` / `next start` **就是用它**載入 env —— 要驗得準,必須呼叫
 * 同一份實作,而不是自己重寫一份解析規則或猜 pnpm 虛擬目錄結構。
 * 做法:先用本檔所在位置解析 `next` 套件的實際路徑,再從那裡解析
 * `@next/env`(它是 `next` 的相鄰依賴,對 pnpm 的巢狀 node_modules 一定找得到)。
 */
async function loadNextEnvConfig() {
  const requireFromScript = createRequire(import.meta.url);
  const nextPkgPath = requireFromScript.resolve('next/package.json');
  const requireFromNext = createRequire(nextPkgPath);
  const envEntryPath = requireFromNext.resolve('@next/env');
  const mod = await import(envEntryPath);
  return mod.default ?? mod;
}

// 只走 stderr;loadEnvConfig 內部訊息本身只含檔名/錯誤說明,從不含值,故直接轉印安全。
const quietStderrLog = {
  info: () => {},
  error: (...args) => console.error('[e2e-prod-preflight]', ...args),
};

function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

const { loadEnvConfig } = await loadNextEnvConfig();

// dev=false → 走 production 優先序:
//   process.env(loadEnvConfig 內部保留最高優先)→ .env.production.local → .env.local → .env.production → .env
const { combinedEnv, loadedEnvFiles } = loadEnvConfig(appDir, false, quietStderrLog);

const missing = REQUIRED_KEYS.filter((k) => !isNonEmpty(combinedEnv[k]));

if (missing.length > 0) {
  console.error('');
  console.error('[e2e-prod-preflight] 缺少 production E2E 必要的環境變數(未設定或值為空):');
  for (const k of missing) console.error(`  - ${k}`);
  console.error('');
  console.error(
    `  已查(透過 @next/env \`loadEnvConfig\`,與 next build/start 同一套優先序:` +
      `process.env → ${appDir} 下的 .env.production.local / .env.local / .env.production / .env):`,
  );
  console.error(
    loadedEnvFiles.length > 0
      ? `  實際存在的 env 檔:${loadedEnvFiles.map((f) => f.path).join(', ')}`
      : '  實際存在的 env 檔:(無)',
  );
  console.error('');
  console.error('  🔴 /products 是 force-dynamic:缺這兩個鍵時 build 仍會成功,');
  console.error('     但 next start 收到請求才會炸 → 故在 build 前先擋下。');
  console.error('  (本檢查只判斷「Next 實際會看到的值是否非空」,不讀出也不顯示任何值。)');
  console.error('');
  process.exit(1);
}

console.error(
  `[e2e-prod-preflight] OK — ${REQUIRED_KEYS.length} 個必要鍵在 Next 實際優先序下皆有非空值,繼續 build。`,
);
