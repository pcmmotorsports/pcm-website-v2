import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { PROD_DB_BYPASS_ENV, checkProdDbInDev, describeProdDbInDev } from './src/lib/dev-db-guard';

// PCM 後台 admin — 純殼(M-4a M0-S1)。目前不接資料、不做登入、無 Sentry/自訂 webpack。
// 未來 slice 依需求(SSO 收端 middleware、圖片網域等)再擴,擴時走鐵則 8 重大改動 plan。
const nextConfig: NextConfig = {};

// 🔴 **dev 專屬的資料庫閘。判定與訊息在 `src/lib/dev-db-guard.ts`(有測試),這裡只負責 throw。**
//
// 落點為什麼是本檔(不是 `predev`、不是 `instrumentation.ts`):見 commit body。
// 🔴 **時序是量到的**:Next 16.3.0 `next/dist/server/config.js`
//    `:1404 loadEnvConfig(...)` 早於 `:1453 await import(<next.config>)`
//    ⇒ 本檔 evaluate 時 `.env.local` 已在 `process.env`。**反過來這道閘會恆綠。**
// ⚠️ **已知射程(codex R1)**:程式化啟動 `next({ dev: true, conf })` 會跳過本檔。
//    本 repo 2026-08-22 實查**沒有** custom server(`apps/*/server.*` 不存在、無程式化啟動)
//    ⇒ 今天不可達;**有人日後加 custom server 時,這道閘會安靜失效。**

const ENV_FILES = ['.env.local', '.env.development.local', '.env.development', '.env'];

/** 逃生門是不是被**寫進 .env 檔**(⇒ 會被下一個人不知情地繼承)。字面比對,不解析 .env 語法。 */
function bypassWrittenInEnvFile(dir: string): boolean {
  return ENV_FILES.some((name) => {
    const path = join(dir, name);
    if (!existsSync(path)) return false;
    return new RegExp(`^\\s*(export\\s+)?${PROD_DB_BYPASS_ENV}\\s*=`, 'm').test(
      readFileSync(path, 'utf8'),
    );
  });
}

export default function config(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return nextConfig;
  const verdict = checkProdDbInDev(process.env, {
    bypassFromEnvFile: bypassWrittenInEnvFile(process.cwd()),
  });
  if (verdict.kind === 'blocked') {
    throw new Error(describeProdDbInDev(verdict.matches, verdict.bypassRefused));
  }
  if (verdict.kind === 'bypassed') {
    console.warn(
      `⚠️ ${verdict.matches.map((m) => m.key).join(', ')} 指向非本機資料庫,而 ${PROD_DB_BYPASS_ENV}=1 ⇒ 放行。` +
        '你正在對一個遠端資料庫開一個免登入的後台。',
    );
  }
  return nextConfig;
}
