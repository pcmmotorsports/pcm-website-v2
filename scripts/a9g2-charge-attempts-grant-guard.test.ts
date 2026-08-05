import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * M-4b E10 A9g-2:`payment_charge_attempts` 授權面守門(關卡2 codex MF2 的機制版)。
 *
 * 🔴 為什麼需要一道**測試**而不是一句註解:後台明細的「在途扣款閘」
 * (`packages/adapters/src/supabase/mappers/order.ts` 的 `mapChargeAttemptGate`)
 * 只有在讀得到這張表時才有意義。本表 RLS enable + **零 policy**
 * (`supabase/migrations/20260612150000_m3_s2d_charge_attempts.sql:115`),因此:
 *   ①service_role(BYPASSRLS + `GRANT SELECT`,`:121`)⇒ 讀得到,閘正常;
 *   ②沒有 grant 的角色 ⇒ 讀不到 ⇒ 落在 fail-closed(`'unknown'`);
 *   ③🔴 **被授了 SELECT 但不 BYPASSRLS 的角色** ⇒ 零 policy 讓它讀到**空陣列且不報錯**
 *     ⇒ 閘變 `'clear'` = 假裝「沒有在途扣款」⇒ 取消入口亮起、送出必被 A8a2 拒。
 * ③是本片唯一一條真 fail-open,只會由「日後某一筆 migration 加 grant」造成。註解攔不住,本檔讓它當場紅。
 *
 * 🔴 **比對策略是「反過來」的**(關卡2 R2 codex MF2/MF3 打掉第一版):第一版用正規式去比對
 * 「GRANT … ON public.payment_charge_attempts TO …」這個**特定形狀**,codex 用記憶體探針實證
 * 四種等價寫法零命中、危險 migration 加進去仍全綠 ——
 * 多表一列(`GRANT SELECT ON a, b TO x`,PostgreSQL 明文允許)/ 加引號識別字(`"public"."…"`)/
 * 點號旁空白 / 省略尾分號 / `SCHEMA "public"` / `SCHEMA private, public`。
 * ⇒ 改成:**先正規化,再要求「凡是提到這張表的 GRANT,逐字等於唯一那一筆白名單」**。
 * 白名單以外的任何寫法(包含還沒被想到的)一律紅,而不是「不認得就放過」。
 *
 * ⚠️ **這道守門攔不住什麼**(先寫清楚,免得被當成比它實際更強的防線):
 * - 不經 migration 的授權(Supabase dashboard 手動 GRANT、psql 直下)—— 檔案裡看不到。
 * - 角色繼承(`GRANT some_role TO other_role`)造成的間接取得。
 * - 本檔是文字層比對;SQL 語意等價但正規化後仍不同形的寫法(例如動態 SQL 組字串)仍可能繞過。
 */

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);
const TABLE = 'payment_charge_attempts';

/** 唯一允許的那一筆(正規化後逐字比對)。 */
const ALLOWED_GRANT = 'GRANT SELECT ON TABLE PUBLIC.PAYMENT_CHARGE_ATTEMPTS TO SERVICE_ROLE';

function readMigrations(): { file: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, sql: readFileSync(new URL(file, MIGRATIONS_DIR), 'utf8') }));
}

/**
 * 正規化:去 `--` 行註解(註解裡的 rollback 草稿不是生效敘述)、去識別字引號、
 * 收掉點號與逗號旁的空白、壓多餘空白、轉大寫。
 * 目的是讓「語意相同但寫法不同」的 GRANT 收斂成同一個字串再比對。
 */
function normalize(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .replace(/"/g, '')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** 抓出每一段 GRANT 敘述(到下一個 `;`,**或檔尾** —— 少寫分號不該讓它隱形)。 */
function grantStatements(normalized: string): string[] {
  return [...normalized.matchAll(/GRANT\s[^;]*/g)].map((m) => m[0].trim());
}

describe('A9g-2 payment_charge_attempts 授權面守門', () => {
  const migrations = readMigrations();

  it('前提:掃得到 migration 檔,且 grep 得到本表(否則本檔是恆真的空守門)', () => {
    expect(migrations.length).toBeGreaterThan(50);
    expect(migrations.filter((m) => m.sql.includes(TABLE)).length).toBeGreaterThan(0);
  });

  it(`🔴 全庫 migration 裡提到 ${TABLE} 的 GRANT,只准白名單那一筆`, () => {
    const offenders: string[] = [];
    const matched: string[] = [];
    for (const { file, sql } of migrations) {
      for (const stmt of grantStatements(normalize(sql))) {
        if (!stmt.includes(TABLE.toUpperCase())) continue;
        matched.push(`${file}: ${stmt}`);
        if (stmt !== ALLOWED_GRANT) offenders.push(`${file}: ${stmt}`);
      }
    }
    expect(offenders, '出現白名單以外、觸及本表的 GRANT').toEqual([]);
    // 🔴 判別力前提:真的有抓到那一筆(`20260612150000:121`)。抓不到就代表正規化/切句失效、
    //    上面那條 expect 是拿空集合比空集合 —— 那才是最危險的綠。
    expect(matched).toEqual([
      `20260612150000_m3_s2d_charge_attempts.sql: ${ALLOWED_GRANT}`,
    ]);
  });

  it('🔴 全庫 migration 不得對任何 schema 做整批 GRANT(會把本表一起授出去、繞過上一條)', () => {
    for (const { file, sql } of migrations) {
      // 不限定 schema 名:`SCHEMA public` / `SCHEMA "public"` / `SCHEMA private, public` 全收。
      expect(normalize(sql), `${file}:整批 GRANT ON ALL TABLES 會連本表一起授權`).not.toMatch(
        /GRANT [^;]*ON ALL TABLES IN SCHEMA/,
      );
    }
  });

  it('🔴 全庫 migration 不得把 service_role 授予別的角色(成員繼承 SELECT 但**不繼承 BYPASSRLS**)', () => {
    // R3 Fable N1 探針:`GRANT service_role TO authenticated` 在前一版守門下 4/4 全綠 = 隱形。
    // 成員拿得到 service_role 的 table 權限(含本表 SELECT),卻**不會**繼承 BYPASSRLS
    // ⇒ 零 policy 讓它讀成空陣列、不報錯 ⇒ 閘變 `'clear'`。這是檔頭 ③ 那條 fail-open 的成員制變體。
    for (const { file, sql } of migrations) {
      expect(normalize(sql), `${file}:把 service_role 授出去等於複製一份沒有 BYPASSRLS 的讀權`)
        .not.toMatch(/GRANT SERVICE_ROLE TO/);
    }
  });

  it('🔴 全庫 migration 不得把 service_role 的 BYPASSRLS 拔掉(拔掉 = 本表零 policy 直接讀成空)', () => {
    // service_role 失去 BYPASSRLS 後,RLS 零 policy 會 default-deny 成空 rowset、且**不報錯**
    // ⇒ 閘變 `'clear'`。這是與「加 grant」不同的第二條入口(關卡2 R2 codex 探針指出)。
    // 🔴 只鎖**動到 service_role** 的那種:`NOBYPASSRLS` 本身是好東西 ——
    //    `20260611120000:62` 就是拿它建窄權角色 `payment_confirmer`。一律禁會誤擋既有硬化措施。
    for (const { file, sql } of migrations) {
      expect(normalize(sql), `${file}:拔掉 service_role 的 BYPASSRLS 會讓本片的閘靜默失效`).not.toMatch(
        /(ALTER|CREATE) ROLE SERVICE_ROLE[^;]*NOBYPASSRLS/,
      );
    }
  });
});
