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
 *   ②沒有 grant 的角色 ⇒ **查詢直接 42501 失敗**(adapter throw)⇒ fail-closed
 *     (關卡2 R2 更正:原本寫「落在 `'unknown'`」不精確 —— 那是缺鍵才會發生的事);
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
 * - 🔴 **識別字混淆**:PostgreSQL 的 Unicode 跳脫識別字(`U&'\\…'` 形式)可以拼出表名或角色名,
 *   而本檔是**字面**比對 ⇒ 掃不到(關卡2 R2 提出,**評估後不追**)。理由:文字層守門原理上
 *   蓋不完所有等價編碼,再加一層正規式只會讓下一種寫法變成下一個 finding;
 *   而寫得出這種 migration 的人是在刻意規避審查,那已經不是本檔的威脅模型。
 *   要真的關掉這條,得換層 —— 對真 DB 查 `information_schema.role_table_grants` 做 read-back
 *   (需要連線,不屬單元測試層)。
 * - 角色繼承的**間接**取得:已擋 `GRANT service_role TO …` 與 `GRANT pg_read_all_data TO …`
 *   兩條已知路徑,但自訂角色鏈(A 授 B、B 再授 C)仍蓋不住。
 * - 本檔是文字層比對;SQL 語意等價但正規化後仍不同形的寫法(例如動態 SQL 組字串)仍可能繞過。
 */

const MIGRATIONS_DIR = new URL('../supabase/migrations/', import.meta.url);

/**
 * 受守的表與各自唯一允許的那一筆 GRANT(正規化後逐字比對)。
 *
 * 🔴 A9g-3 起**擴成多表**:兩張取消表的授權形狀與 `payment_charge_attempts` 完全相同
 * (RLS enable + 零 policy + `REVOKE ALL` + 只授 service_role SELECT,
 *  `20260730130000:200-203`、`:265-268`),而取消歷程讀不到時的症狀更隱蔽 ——
 * 空陣列與「這張單從沒被取消過」在畫面上長得一模一樣。
 * ⇒ 守門畫在「這一類表」的不變量上,不是只畫在最初那一張
 * (memory `feedback_guard-drawn-at-narrowest-surface-not-invariant`)。
 */
const GUARDED_TABLES = [
  {
    table: 'payment_charge_attempts',
    allowedGrant: 'GRANT SELECT ON TABLE PUBLIC.PAYMENT_CHARGE_ATTEMPTS TO SERVICE_ROLE',
    grantFile: '20260612150000_m3_s2d_charge_attempts.sql',
  },
  {
    table: 'order_cancellations',
    allowedGrant: 'GRANT SELECT ON TABLE PUBLIC.ORDER_CANCELLATIONS TO SERVICE_ROLE',
    grantFile: '20260730130000_m4b_e10_a7_order_cancellations.sql',
  },
  {
    table: 'order_cancellation_items',
    allowedGrant: 'GRANT SELECT ON TABLE PUBLIC.ORDER_CANCELLATION_ITEMS TO SERVICE_ROLE',
    grantFile: '20260730130000_m4b_e10_a7_order_cancellations.sql',
  },
] as const;

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
    // 🔴 也要剝 `/* */` 區塊註解(關卡2 must-fix):`GRANT/*註解*/ SELECT …` 這種寫法
    //    在切句正規式 `GRANT\s` 底下**整段抓不到** ⇒ 危險 GRANT 隱形(codex 記憶體探針實證)。
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"/g, '')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/**
 * 抓出每一段 GRANT 敘述(到下一個 `;`,**或檔尾** —— 少寫分號不該讓它隱形)。
 * 🔴 用 `GRANT\b` 而非 `GRANT\s`(關卡2 must-fix):後者要求 GRANT 後面**緊接空白**,
 * 而「GRANT 後面直接接一個 SQL 區塊註解再接 SELECT」時下一個字元是斜線
 * ⇒ 整段抓不到、危險 GRANT 隱形。
 * (區塊註解在 `normalize()` 已先剝掉,這裡是第二道:兩者任一失效都不至於整條守門失能。)
 */
function grantStatements(normalized: string): string[] {
  return [...normalized.matchAll(/GRANT\b[^;]*/g)].map((m) => m[0].trim());
}

describe('service-role-only 表的授權面守門(A9g-2 立、A9g-3 擴多表)', () => {
  const migrations = readMigrations();

  it('前提:掃得到 migration 檔(否則本檔是恆真的空守門)', () => {
    expect(migrations.length).toBeGreaterThan(50);
  });

  for (const { table, allowedGrant, grantFile } of GUARDED_TABLES) {
    it(`🔴 全庫 migration 裡提到 ${table} 的 GRANT,只准白名單那一筆`, () => {
      const offenders: string[] = [];
      const matched: string[] = [];
      for (const { file, sql } of migrations) {
        for (const stmt of grantStatements(normalize(sql))) {
          // 🔴 用 word boundary 而非 `includes`:`\b` 視 `_` 為單字字元 ⇒ 掃 `order_cancellations`
          //    不會誤命中 `order_cancellations_foo` 這類日後可能出現的衍生表名。
          //    (這兩張表彼此**不是**前綴關係 —— `..._ITEMS` 前一個字是 `N` 不是 `NS` —— 實查確認過,
          //     所以 includes 今天也會對;用 \b 是為了不依賴那個巧合。)
          if (!new RegExp(`\\b${table.toUpperCase()}\\b`).test(stmt)) continue;
          matched.push(`${file}: ${stmt}`);
          if (stmt !== allowedGrant) offenders.push(`${file}: ${stmt}`);
        }
      }
      expect(offenders, `出現白名單以外、觸及 ${table} 的 GRANT`).toEqual([]);
      // 🔴 判別力前提:真的有抓到那一筆。抓不到就代表正規化/切句失效、
      //    上面那條 expect 是拿空集合比空集合 —— 那才是最危險的綠。
      expect(matched).toEqual([`${grantFile}: ${allowedGrant}`]);
    });
  }

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
      // 🔴 關卡2 R2:角色清單寫法(`GRANT a, service_role TO x`)原本繞得過去;
      //    另外 `pg_read_all_data` 是 PG14+ 內建角色,授出去等於全庫 SELECT 且**不帶 BYPASSRLS**
      //    ⇒ 症狀與被授 SELECT 完全相同(零 policy 讀成空)。兩者一起擋。
      expect(normalize(sql), `${file}:把 service_role 授出去等於複製一份沒有 BYPASSRLS 的讀權`)
        .not.toMatch(/GRANT [^;]*\bSERVICE_ROLE\b[^;]* TO /);
      expect(normalize(sql), `${file}:pg_read_all_data 給的是無 BYPASSRLS 的全庫讀權`)
        .not.toMatch(/GRANT [^;]*\bPG_READ_ALL_DATA\b[^;]* TO /);
    }
  });

  it('🔴 全庫 migration 不得把 service_role 的 BYPASSRLS 拔掉(拔掉 = 本表零 policy 直接讀成空)', () => {
    // service_role 失去 BYPASSRLS 後,RLS 零 policy 會 default-deny 成空 rowset、且**不報錯**
    // ⇒ 閘變 `'clear'`。這是與「加 grant」不同的第二條入口(關卡2 R2 codex 探針指出)。
    // 🔴 只鎖**動到 service_role** 的那種:`NOBYPASSRLS` 本身是好東西 ——
    //    `20260611120000:62` 就是拿它建窄權角色 `payment_confirmer`。一律禁會誤擋既有硬化措施。
    for (const { file, sql } of migrations) {
      expect(normalize(sql), `${file}:拔掉 service_role 的 BYPASSRLS 會讓本片的閘靜默失效`).not.toMatch(
        // `ALTER USER` 是 `ALTER ROLE` 的合法別名(關卡2 R2)⇒ 兩個關鍵字都收。
        /(ALTER|CREATE) (ROLE|USER) SERVICE_ROLE[^;]*NOBYPASSRLS/,
      );
    }
  });
});
