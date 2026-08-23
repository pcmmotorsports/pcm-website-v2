// @vitest-environment node
//
// `#880`:**沒有東西在盯「DB 加了一個 member_tier enum 值」這件事本身。**
//
// 兩份真相,人工同步,中間零比對:
//   packages/domain/src/shared/types.ts          `export type MemberTier = …`   ← 人工
//   supabase/migrations/*.sql                    `member_tier` 的 enum 值        ← 人工
//
// 🔴 **為什麼守門要住在【動 enum 的那條路】而不是讀取端**(`#873` 實測給的理由):
//    讀取端補再多解析,漂移發生時**沒有人會知道** —— `#873` 修的兩處會崩潰(有回饋),
//    而 `#879` 那三處只是**畫面上少一格字**(零回饋)。⇒ 補回饋路徑要先於補讀取端。
//
// 🔴 **這支檔要在誰的手上紅**:在**加 enum 值的那個人**手上。
//    他寫一支 migration `ALTER TYPE … ADD VALUE 'x'` ⇒ 本檔立刻紅,訊息告訴他去改哪一支 TS 檔。
//
// ── ⚠️ 誠實邊界(先讀這段,不要把它讀成「enum 漂移已經被守住了」)──────────────
//  ① 🔴 **它只看得到【寫成 migration】的改動。**
//     有人直接在 Supabase 後台面板改 enum、或走 MCP `apply_migration` 而檔案沒進 repo
//     ⇒ **本檔完全看不到,而且會一直是綠的。**
//     (本 repo 已量過那個形狀:MCP 會自派版本號、台帳與平台紀錄本來就會不同步。)
//  ② 它是**文字比對啟發式,不是 SQL parser** —— 繼承 `sql-scan.ts` 檔頭列的兩種未處理寫法。
//  ③ 它**只守 `member_tier` 這一個 enum**。同款的 `payment_status` / `fulfillment_status` /
//     `invoice_type` / `wallet_entry_type` **都沒有守門**(2026-08-24 實查:
//     `grep -rl "enum-drift" packages/domain/src` ⇒ 只有本檔)。
//     ⇒ **不要因為本檔存在就以為 enum 漂移這一族被處理了。**

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { scanSql } from '../order/sql-scan';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, '../../../../supabase/migrations');
const TYPES_PATH = join(HERE, 'types.ts');

/** 本 repo 實際出現過的兩種形式(2026-08-24 實查 `supabase/migrations/*.sql`):
 *   · `CREATE TYPE member_tier AS ENUM ('a', 'b')`            —— 未加 schema、欄位間可多空白
 *   · `ALTER TYPE public.payment_status ADD VALUE IF NOT EXISTS 'x';` —— 加 schema、帶 IF NOT EXISTS
 * 另外三種**沒出現過但語法存在**,一併認:`ADD VALUE` 不帶 `IF NOT EXISTS`、`RENAME VALUE`、`DROP TYPE`。
 * 🔴 只認自己看過的那一種 = 下一個人換個寫法就靜靜漏掉(今晚 codex 抓過同族:舊守門掃 8 種副檔名、新的只掃 2 種)。
 */
const CREATE_RE = /CREATE\s+TYPE\s+(?:public\.)?member_tier\s+AS\s+ENUM\s*\(([^)]*)\)/gi;
const ADD_RE = /ALTER\s+TYPE\s+(?:public\.)?member_tier\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']*)'/gi;
const RENAME_RE = /ALTER\s+TYPE\s+(?:public\.)?member_tier\s+RENAME\s+VALUE\s+'([^']*)'\s+TO\s+'([^']*)'/gi;
const DROP_RE = /DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?member_tier\b/gi;

/** 依版本號順序重放所有 migration,算出「DB 端此刻的 member_tier 值集合」。 */
function replayDbTiers(): { values: string[]; sawCreate: boolean; files: number } {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let current: string[] = [];
  let sawCreate = false;
  for (const f of files) {
    // 🔴 用 `code`(剝註解、**保留字串**)—— enum 的值本身就住在字串裡,用 codeNoLiterals 會把它清空。
    const { code } = scanSql(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
    for (const m of code.matchAll(DROP_RE)) { void m; current = []; }
    for (const m of code.matchAll(CREATE_RE)) {
      sawCreate = true;
      current = [...(m[1] ?? '').matchAll(/'([^']*)'/g)].map((x) => x[1] ?? '');
    }
    for (const m of code.matchAll(ADD_RE)) {
      const v = m[1] ?? '';
      if (!current.includes(v)) current.push(v);
    }
    for (const m of code.matchAll(RENAME_RE)) {
      const i = current.indexOf(m[1] ?? '');
      if (i >= 0) current[i] = m[2] ?? '';
    }
  }
  return { values: current, sawCreate, files: files.length };
}

/** 從 types.ts 解析 TS union 的字面。 */
function tsTiers(): string[] {
  const src = readFileSync(TYPES_PATH, 'utf8');
  const m = /export\s+type\s+MemberTier\s*=\s*([^;]+);/.exec(src);
  if (!m) return [];
  return [...(m[1] ?? '').matchAll(/'([^']*)'/g)].map((x) => x[1] ?? '');
}

describe('#880 · member_tier enum 漂移守門', () => {
  it('🔴 前提①:掃描器真的掃到東西(它壞掉時會安靜地回空集合,而空集合會讓下面每一格失去判別力)', () => {
    const { values, sawCreate, files } = replayDbTiers();
    expect(files, 'migrations 目錄讀不到 .sql ⇒ 路徑錯了').toBeGreaterThan(50);
    expect(sawCreate, '全樹找不到 CREATE TYPE member_tier ⇒ 正則或掃描壞了,不是「真的沒有」').toBe(true);
    expect(values.length, 'DB 端算出零個值 ⇒ 掃描壞了').toBeGreaterThan(0);
  });

  it('🔴 前提②:TS union 解析得到(解析失敗會回空陣列,而空陣列比對空陣列是綠的)', () => {
    expect(tsTiers().length, 'types.ts 解析不到 MemberTier ⇒ 正則或檔案位置變了').toBeGreaterThan(0);
  });

  it('🔴🔴 DB 的 member_tier 值集合 === TS 的 MemberTier union', () => {
    const db = [...replayDbTiers().values].sort();
    const ts = [...tsTiers()].sort();
    expect(
      db,
      '兩份真相漂移了。\n' +
        '· DB 多出來的值 ⇒ 去 packages/domain/src/shared/types.ts 把它加進 MemberTier union,\n' +
        '  並檢查所有 `Record<MemberTier, …>` 查表(少一個鍵 = 畫面上少一格字,不會 throw)。\n' +
        '· TS 多出來的值 ⇒ 那個值在 DB 裡不存在,任何寫入它的路徑都會被 enum 擋下。\n' +
        '⚠️ 而本檔【看不到後台面板直接改的 enum】—— 綠不代表沒漂,見檔頭誠實邊界 ①。',
    ).toEqual(ts);
  });

  it('🔴 對照組:把一個假值塞進 TS 側 ⇒ 比對必須紅(證明上面那格不是恆真)', () => {
    // 🔴 這個哨兵值刻意寫成【不可能是真 tier 的形狀】。
    //    ⚠️ 我第一版用的是 `platinumDealer` —— 而我拿它去做突變測試時,
    //       DB 側【真的】多了那個值 ⇒ 兩邊相等 ⇒ **對照組自己也紅了**。
    //    ⇒ 對照組的假值,不能是任何「有一天可能真的出現」的值。
    const db = [...replayDbTiers().values].sort();
    const fake = [...tsTiers(), '__never_a_real_tier__'].sort();
    expect(db).not.toEqual(fake);
  });
});
