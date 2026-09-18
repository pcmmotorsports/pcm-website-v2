import { execFileSync } from 'node:child_process';
import { test } from '@playwright/test';

/**
 * 後台鑽機(`scripts/admin-probe/up.sh`)的小工具 —— 形狀抄
 * `apps/storefront/e2e/probe.ts`,**不自己發明一套**。
 *
 * 🛑 沒有 `E2E_ADMIN_BASE_URL` ⇒ 整檔 skip。**不假裝綠。**
 */
export const PROBE_BASE_URL = process.env.E2E_ADMIN_BASE_URL;
export const PROBE_PG_PORT = process.env.ADMIN_PROBE_PG ?? '55534';

export function requireProbe() {
  test.skip(
    !PROBE_BASE_URL,
    '要 E2E_ADMIN_BASE_URL 指向後台鑽機(bash scripts/admin-probe/up.sh)才跑',
  );
}

/** 對鑽機 DB 跑一句 SQL,回 trim 過的單值(-tA)。**只給讀用** —— 要寫請走頁面。 */
export function probeSql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', PROBE_PG_PORT, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}
