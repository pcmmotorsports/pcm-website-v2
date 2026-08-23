import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LINE_SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_EMAIL_BASE_DOMAIN, isSyntheticEmailDomain } from './notification-email';

// synthetic-domain-sql-contract.test.ts — `#858` 片0-a 補洞(codex R1 MF3 → Fable R2 F1 重寫)。
//
// 🔴🔴 **這支檔的第一版【永遠不會紅】,而它的註解卻承諾了那次紅。**
//    第一版只 `readFileSync` 那**一支** migration,然後寫「哪天有人擴了 CHECK,這格會紅」。
//    但**擴 CHECK 的唯一合法路是【新開一支 migration】** —— 已 apply 的檔連註解都不可改
//    (`docs/patterns/guard-and-instrument-traps.md:13339`:APPLIED.tsv 記 sha256,改一個字就撞閘)
//    ⇒ 新檔 `DROP CONSTRAINT` + `ADD` 新版 ⇒ **舊檔一字未動 ⇒ 第一版三格全綠。**
//    ⇒ 它只紅在「有人違規去改舊檔」那條**被禁止的路**上。
//
// 🔴 **形狀(值得記)**:一道守門看的是「**某支檔的內容**」,
//    而它要攔的動作**發生在另一支還不存在的檔裡**。
//    ⇒ 修法 = 不看單一檔,**掃整個目錄、對 constraint 的【名字】做族掃** ——
//      直接對那道 constraint 動手的寫法,**都必須點名它**。
//      ⚠️ 而「**連坐消失**」的那幾種(DROP COLUMN/TABLE CASCADE、改欄型別)**點不到名,本守門攔不到**
//         —— 誠實清單見 `LIMITS` 上方那段。
//
// ⚠️ 本檔**不是**在說 SQL 那份是對的。它在說:**那份與 TS 這份的關係被釘住了,而且釘得住。**
//
// 🔴🔴 **本守門的限度(codex 抓到、`#863` 已立案):純 SQL 的 commit 不跑 vitest**
//    ⇒ **有人只加一支 migration 就 commit 時,本檔【不會被執行】** —— 它擋不住那一次。
//    ⇒ **不要以為它是 commit 前的閘。** 它是「有人跑測試時會叫」的那種守門。
//    (修法在 `#863`,不在本片。)

const MIGRATIONS_DIR = new URL('../../../supabase/migrations/', import.meta.url);
const CONSTRAINT = 'orders_notification_email_valid';

/**
 * 今天**用 DDL 動到**那道 constraint 的 migration 檔名(排序後)。
 *
 * 🔴 **「提到」不算,要「動到」才算**:第一版用 `includes(CONSTRAINT)`,連**註解裡談到它**都算
 *    ⇒ 誤報,而誤報會訓練人略過這道閘。
 *
 * 🔴🔴 **而收窄之後 codex R3 又打中三次,三次同一個形狀:我的尺只認【一種寫法】。**
 *    ① `DROP CONSTRAINT "orders_notification_email_valid"`(**加引號**)⇒ 舊 regex 不認
 *    ② `RENAME CONSTRAINT`                                        ⇒ 舊 regex 不認,
 *       而**改名一次之後,後續所有操作都逃出這個名字族掃**
 *    ③ `DROP COLUMN notification_email CASCADE` / `DROP TABLE … CASCADE` / 改欄型別
 *       ⇒ **這些會真的弄掉那道 CHECK,而它們【不必】出現 constraint 的名字**
 *    ⇒ ①② 已補進下面的 pattern;**③ 補不進來** —— 見下方 `LIMITS`。
 */
function stripSqlNoise(sql: string): string {
  // 🔴 也要剝**字串**,不只註解(codex nit):
  //    `COMMENT ON … IS $$ADD CONSTRAINT orders_notification_email_valid$$` 會被誤判成真的動它。
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, ' ') // dollar-quoted
    .replace(/'(?:[^']|'')*'/g, ' ') // 單引號字串(含 '' 逸出)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/** 認得出來的寫法:`ADD` / `DROP` / `RENAME` CONSTRAINT,名字加不加引號都認。 */
const DDL_TOUCHING = new RegExp(
  `(?:ADD|DROP|RENAME)\\s+CONSTRAINT\\s+(?:IF\\s+EXISTS\\s+)?"?${CONSTRAINT}"?\\b`,
  'i',
);

/**
 * 🔴🔴 **本守門攔不到的(誠實清單,不要讀成「攔得到的以外都不會發生」)**
 *
 * 1. `ALTER TABLE orders DROP COLUMN notification_email CASCADE` —— **CHECK 跟著沒了,而名字沒出現**
 * 2. `DROP TABLE public.orders CASCADE`
 * 3. 改欄型別 / 重建表 —— 同樣不必點名那道 constraint
 *
 * ⇒ 我原本在下面寫「**任何人要動 CHECK 都必須點名它**」——**那是一句錯誤的安全斷言**,已刪。
 * ⇒ 正確的說法:**本守門攔得到「直接對那道 constraint 動手」的那幾種寫法,攔不到「連坐消失」。**
 */
export const LIMITS = '見上方 docstring:DROP COLUMN/TABLE CASCADE 與改欄型別攔不到';

function filesTouchingConstraint(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => DDL_TOUCHING.test(stripSqlNoise(readFileSync(new URL(f, MIGRATIONS_DIR), 'utf8'))))
    .sort();
}

const BASELINE = [
  '20260718120000_m4a_b1_orders_notification_email.sql', // 建它的那支(:125 ADD CONSTRAINT、:132-133 述詞)
  // 🔴 `20260719120000` 只在**註解**裡提到它 ⇒ 收窄後**不再算**(見 `filesTouchingConstraint` 的理由)
];

const CHECK_SQL = readFileSync(new URL(BASELINE[0]!, MIGRATIONS_DIR), 'utf8');

/** 從 CHECK 述詞裡抓出它實際比對的那個網域字面(等值那一半)。 */
function domainLiteralInCheck(): string {
  const m = CHECK_SQL.match(/split_part\(notification_email, '@', 2\)\), '\.'\) <> '([^']+)'/);
  if (!m) throw new Error('抓不到 CHECK 裡的網域字面 —— 述詞形狀變了,本守門先失效,回去看那支 migration');
  return m[1]!;
}

describe('假信箱規則的第四份:orders.notification_email 的 DB CHECK', () => {
  it('🔴 前提還在:那道 CHECK 真的存在(抓不到就代表本守門在空轉)', () => {
    expect(CHECK_SQL).toContain(`ADD CONSTRAINT ${CONSTRAINT}`);
    expect(domainLiteralInCheck()).toBe('line.pcmmotorsports.local');
  });

  it('🔴🔴 【會紅的那一格】:有人開新 migration 動那道 CHECK ⇒ 檔案集合改變 ⇒ 本格紅', () => {
    // 為什麼掃目錄不掃單檔:**直接**對那道 constraint 動手時必須點名它,而點名會讓那支新檔進入這個集合。
    // 🔴 **不是「任何動它的方式都會被抓到」** —— 那句我寫錯過,見檔頭 `LIMITS`。
    expect(filesTouchingConstraint()).toEqual(BASELINE);
    // 🔴 這一格紅的時候,要做的是:①確認新 migration 把 CHECK 擴到了基底網域
    //    ②把下面那格「已知差距」刪掉 ③更新 `#858` plan 的未做清單 ④把本基線加上那支新檔。
    //    **不是把基線改一改讓它變綠就算了。**
  });

  it('🔴 SQL 那份比對的網域,必須仍在 TS 這份的家族裡(誰改了基底而沒回訪 SQL,這格紅)', () => {
    const sqlDomain = domainLiteralInCheck();
    expect(isSyntheticEmailDomain(`x@${sqlDomain}`)).toBe(true);
    expect(sqlDomain).toBe(LINE_SYNTHETIC_EMAIL_DOMAIN);
  });

  it('🔴 已知差距(**刻意釘住的缺陷,不是通過**):manual 網域 TS 擋、SQL 放行', () => {
    const manual = `manual_x@manual.${SYNTHETIC_EMAIL_BASE_DOMAIN}`;
    expect(isSyntheticEmailDomain(manual)).toBe(true); // TS 這份擋得住
    const sqlDomain = domainLiteralInCheck();
    const manualDomain = `manual.${SYNTHETIC_EMAIL_BASE_DOMAIN}`;
    expect(manualDomain === sqlDomain || manualDomain.endsWith(`.${sqlDomain}`)).toBe(false);
    // 🔴 補這道 CHECK **不是 nice-to-have**:Sean 2026-07-19 `Q1=A` 逐字
    //    「規則只留 DB CHECK 與 app 層鏡像**兩份**,不新增第三份」——
    //    而那個拍板的**前提是兩份同規則**。片0-a 把 app 那份擴成家族、CHECK 停在 line
    //    ⇒ **兩份現在是不同規則** ⇒ 補 CHECK = 把一個拍板的不變式修回來。
  });
});
