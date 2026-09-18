import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
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

/**
 * 現簽一張**新的** admin session 票,回傳 cookie 的 `name` / `value`。
 *
 * 🔴🔴 **不要去讀 `$ADMIN_PROBE_DIR/session-cookie.txt` 裡【既有】的那一行** ——
 *    票只活 15 分鐘(`ADMIN_SESSION_MAX_AGE_SEC`,Sean `Q-B5b-2=乙` 拍的),
 *    而那個檔是 `up.sh` 在【起鑽機那一刻】寫的
 *    ⇒ **鑽機起超過 15 分鐘之後,檔裡那張就是死票。**
 *
 * 🛑 而死票**不會說自己是死票**:`authorizeAdminMutation()` 的三道閘
 *    (session 自驗 / Origin / 具名 actor)回的是**同一個 `null`**
 *    ⇒ 畫面只印「請先在右上角選擇操作人員」⇒ **從那句話推不出是哪一道**。
 *    🔬 2026-09-18 22:32 實測(`POST /api/session/renew`,同一條路三發):
 *       新票 **200** / 檔裡那張過期 32.0 小時的票 **401** / 完全不帶票 **401**
 *       ⇒ 📌 「好票與壞票長得一樣」是**因為兩次拿的是同一張死票**,不是因為尺沒有判別力。
 *       ⚪ 而那三發同時**排除了「票根本沒送到」**:同一顆 cookie 換成新票就 200。
 */
export function mintProbeCookie(): { readonly name: string; readonly value: string } {
  const script = resolve(__dirname, '../../../scripts/admin-probe/mint-session-cookie.sh');
  const line = execFileSync('bash', [script], { encoding: 'utf8' }).trim();
  const eq = line.indexOf('=');
  if (eq < 1) {
    throw new Error(`mint-session-cookie.sh 沒有印出「名=值」那一行(拿到 ${line.length} 個字元)`);
  }
  return { name: line.slice(0, eq), value: line.slice(eq + 1) };
}
