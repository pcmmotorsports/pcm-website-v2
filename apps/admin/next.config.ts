import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { assertDevDbGate } from './src/lib/dev-db-guard-gate';

// PCM 後台 admin — 純殼(M-4a M0-S1)。目前不接資料、不做登入、無 Sentry/自訂 webpack。
// 未來 slice 依需求(SSO 收端 middleware、圖片網域等)再擴,擴時走鐵則 8 重大改動 plan。
const nextConfig: NextConfig = {};

// 🔴 **dev 專屬的資料庫閘。判定在 `src/lib/dev-db-guard.ts`、接線在 `src/lib/dev-db-guard-gate.ts`(皆有測試),
//    這裡只負責把 config 自己的目錄交給它。** storefront 的 next.config.ts 接同一顆。
//
// 落點為什麼是本檔(不是 `predev`、不是 `instrumentation.ts`):見 commit body(faa31274)。
// 🔴 **時序是量到的**:Next 16.3.0 `next/dist/server/config.js`
//    `:1404 loadEnvConfig(...)` 早於 `:1453 await import(<next.config>)`
//    ⇒ 本檔 evaluate 時 `.env.local` 已在 `process.env`。**反過來這道閘會恆綠。**
// ⚠️ **已知射程(codex R1)**:程式化啟動 `next({ dev: true, conf })` 會跳過本檔。
//    本 repo 2026-08-22 實查**沒有** custom server(`apps/*/server.*` 不存在、無程式化啟動)
//    ⇒ 今天不可達;有人日後加 custom server 時,本閘會安靜失效 ——
//    但 proxy.ts 的 DB 本機條件(R2 ⑤)跑在 app 層、任何啟動路徑都經過,補掉其中 auth 那一半。
//
// 🔴 **目錄用 config 檔自己的位置,不用 `process.cwd()`(R2 MF-1)**:
//    Next 載 .env* 的基準是專案目錄(= 本檔所在目錄),cwd 只是「人從哪裡打指令」——
//    兩者不同時(如 `next dev apps/admin` 從 repo 根跑),讀 cwd 會把檔面的逃生門誤判成指令列的。
//    ⚠️ 2026-08-23 量到:今天那種調用因 legacy TS-config loader 的相對 import 解析 bug 而
//    fail-safe 崩潰(Cannot find module),本行護的是未來 loader 修好之後的世界。
//    `import.meta.dirname` 在 Next 的 SWC-CJS 轉譯路徑量測過存在(2026-08-23 探針);
//    `??` 後備給只保證 `import.meta.url` 的載入器(vitest / vite-node)。
const CONFIG_DIR = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) assertDevDbGate(CONFIG_DIR);
  return nextConfig;
}
