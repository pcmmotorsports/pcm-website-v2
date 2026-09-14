import { execFileSync } from 'node:child_process';
import { test } from '@playwright/test';

/**
 * 鑽機(`scripts/storefront-probe/up.sh`)專用的小工具 —— M-6-05 E2E(Sean 2026-09-14 拍 Q13 甲)。
 *
 * 這一族測試只在鑽機上跑得到:要種子商品、要 proxy.py 那個不驗密碼的假 auth、要
 * `BANK_TRANSFER_CHECKOUT_ENABLED=true`。⇒ 沒有 `E2E_BASE_URL` 就整檔 skip, 不假裝綠。
 *
 * DB 斷言直接 psql 打鑽機的 postgres(埠 = `STOREFRONT_PROBE_PG`, 與 up.sh 同一個變數名),
 * 不經 PostgREST —— 要問的是「訂單真的落地了、寄信線看得到它」, 那是 DB 的事。
 */

export const PROBE_BASE_URL = process.env.E2E_BASE_URL;
export const PROBE_PG_PORT = process.env.STOREFRONT_PROBE_PG ?? '55533';

/** 鑽機種子帳號(`scripts/storefront-probe/seed.sql`);proxy.py 只認 email 存在, 密碼隨便。 */
export const PROBE_USER = { email: 'probe@example.com', password: 'probe-password' } as const;

export function requireProbe() {
  test.skip(!PROBE_BASE_URL, '要 E2E_BASE_URL 指向鑽機(bash scripts/storefront-probe/up.sh)才跑');
}

/** 對鑽機 DB 跑一句 SQL, 回 trim 過的單值字串(-tA)。只給讀用;要寫請走頁面。 */
export function probeSql(sql: string): string {
  return execFileSync(
    'psql',
    ['-h', '127.0.0.1', '-p', PROBE_PG_PORT, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

/** 登入鑽機種子帳號;`next` = 登入後要回去的頁。 */
export async function loginAsProbeUser(page: import('@playwright/test').Page, next: string) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole('textbox', { name: /^Email/ }).fill(PROBE_USER.email);
  await page.getByRole('textbox', { name: /^密碼/ }).fill(PROBE_USER.password);
  await page.getByRole('button', { name: '登入', exact: true }).click();
  await page.waitForURL((u) => u.pathname === next);
}
