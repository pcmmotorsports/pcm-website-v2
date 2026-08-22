import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import { checkProdDbInDev, describeProdDbInDev } from './src/lib/dev-db-guard';

// PCM 後台 admin — 純殼(M-4a M0-S1)。目前不接資料、不做登入、無 Sentry/自訂 webpack。
// 未來 slice 依需求(SSO 收端 middleware、圖片網域等)再擴,擴時走鐵則 8 重大改動 plan。
const nextConfig: NextConfig = {};

// 🔴 **dev 專屬的正式庫閘。判定與訊息在 `src/lib/dev-db-guard.ts`(有測試),這裡只負責 throw。**
//
// 為什麼落在 next.config 而不是 `predev` / `instrumentation.ts`(commit body 有完整版):
//   · `predev` ⇒ 分母太窄。文件教的 `npx next dev` 不經過 package.json 的任何 script。
//   · `instrumentation.ts` ⇒ 也是「怎麼啟動都會經過」,而它①今天不存在、要新建
//     ②它也跑在 **production runtime**,壞掉的形態是整個 app 起不來 ⇒ 比本檔多一塊沒必要的爆炸半徑。
//   · 本檔 ⇒ 已經存在;而且**在 server 綁 port 之前**就死,不會有一瞬間打得開的視窗。
//
// 🔴 **時序是量到的,不是假設的**(Next 16.3.0 `next/dist/server/config.js` 實讀):
//    `:1404 loadEnvConfig(...)` 在 `:1453 await import(<next.config>)` **之前**
//    ⇒ 本檔被 evaluate 時,`.env.local` 已經在 `process.env` 裡。**時序反過來的話這道閘會恆綠。**
//
// 🔴 **只在 dev server 這個 phase 擋**:用 Next 自己的 `phase`,不用 `NODE_ENV`
//    —— `next build` / `next start` / Vercel 一律不受影響(那些 phase 不同)。
export default function config(phase: string): NextConfig {
  if (phase !== PHASE_DEVELOPMENT_SERVER) return nextConfig;
  const verdict = checkProdDbInDev(process.env);
  if (verdict.kind === 'blocked') throw new Error(describeProdDbInDev(verdict.matchedKey));
  if (verdict.kind === 'bypassed') {
    console.warn(
      `⚠️ ${verdict.matchedKey} 指向正式庫,而 PCM_ALLOW_PROD_DB_DEV=1 ⇒ 放行。你正在對正式庫開一個免登入的後台。`,
    );
  }
  return nextConfig;
}
