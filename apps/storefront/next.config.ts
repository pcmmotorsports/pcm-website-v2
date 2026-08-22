import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import bundleAnalyzer from '@next/bundle-analyzer';
// 🔴 與 admin 同一顆正式庫閘(MAIN-127 ④;單一事實,不複製 —— 複製的那天起兩道閘就開始漂)。
//    storefront 是「唯一量到實際打過正式庫痕跡」的入口:.env.local ref=2 + SERVICE_ROLE=1,
//    .next/cache/fetch-cache 21 檔含正式庫 ref(2026-08-23 主視窗量測,量具限定=只認 fetch-cache)。
//    ⚠️ 跨 app 相對 import 在 legacy TS-config loader 下是用 cwd 解析的(loader bug):
//    cwd=apps/storefront(正常起法、turbo 亦同)解析得到;cwd≠專案目錄的調用會 fail-safe 崩潰。
import { assertDevDbGate } from '../admin/src/lib/dev-db-guard-gate';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {};

// dev 專屬資料庫閘;為什麼在 config、時序、射程與逃生門語意見 apps/admin/next.config.ts 註解。
const CONFIG_DIR = import.meta.dirname ?? dirname(fileURLToPath(import.meta.url));

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) assertDevDbGate(CONFIG_DIR);
  return withBundleAnalyzer(nextConfig);
}
