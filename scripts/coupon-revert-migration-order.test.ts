/**
 * ⟦b4-COUPONREVERT⟧ 排序守門(2026-09-02 線 `-f3`)。
 *
 * 約定:`20260901021000` 的 apply 前置閘要求 `public.coupon_revert_on_full_refund(uuid)`
 *   在它之前就存在。而那支函式**今天還不存在** —— 它會被寫在一支新的 migration 裡,
 *   而新 migration 自然會拿到一個**更晚**的時戳。
 *
 * 🔴 **這支守的就是那個死結**(codex 2026-09-02 R1 must-fix②):
 *   `db push` 依版本號排序 apply ⇒ 若建立它的 migration 版本號 > `20260901021000`,
 *   ⇒ **會先撞上那道前置閘而中止, 永遠到不了那支 prerequisite。**
 *   而症狀是「apply 卡住而錯誤訊息在講另一件事」—— 一個很難自己看出來的死結。
 *
 * 🎯 **而它今天是綠的, 那是刻意的形狀**:
 *   分母 = 0(還沒有人定義那支函式)⇒ 本守門今天不叫。
 *   它會在**有人第一次建立它**的那一刻叫 —— 而那正是版本號被決定的那一刻。
 *   📌 對照:一道【裝上去就紅】的守門是已知會被關掉的形狀
 *      (`docs/patterns/guard-and-instrument-traps.md`「守門一裝就紅」)。
 *      本支刻意不是那一種 —— 所以它有機會活到它該叫的那一天。
 *
 * 🛑 **射程 —— 它守什麼、不守什麼**:
 *   ✅ 守:如果有 migration 定義了那支函式, 它的版本號要**嚴格小於**閘所在的那一支
 *      (或就是閘所在的那一支自己 —— 合併是合法修法之一)。
 *   ✅ 守:SQL 那一側的函式名與本檔的 `REVERT_FN` 沒有分家(R3 must-fix④)。
 *   ❌ 不守:那支函式**做得對不對**、**有沒有被接上**、**正式庫上是哪一版**。
 *      ⇒ 前兩者要 Sean 先答 `20260829150000:43`「誰在什麼情況下寫它」;
 *        後者只有讀正式庫 `pg_catalog` 才答得出來(本 repo 測試層碰不到正式庫)。
 *   ❌ 不守:**Sean 手貼的順序**。他在 SQL Editor 一支一支貼時可以自己決定順序
 *      ⇒ 那條路不會卡。本支守的是 `db push` 那條路。⇒ **兩條路行為不同, 明寫。**
 *
 * 🔴 **R3(opus, 2026-09-02)抓到而已修的四條 —— 留著, 因為它們會再咬別人**:
 *   ① `>=` 把【閘所在那一支自己】判成違規, 而「與它合併」正是訊息推薦的修法之一 ⇒ 改 `>`。
 *   ② 原本那格叫「突變」而它**把判準重打了一份在測試裡跑** ⇒ 把 `:offenders` 那段
 *      換成 `return []` 也照樣四格全綠。⇒ 抽成具名 `violates()`, 突變格呼叫**同一支**。
 *      📌 **「我有突變測試」與「那個突變到得了生產碼」是兩個宣稱。**
 *   ③ 原本的「正對照」用的是**另一把手打的 regex**, 不是 `definesRe` ⇒ 名字打錯照樣綠。
 *   ④ 「改名要同 commit 改另一邊」原本只有散文、零機制 ⇒ 補一格釘住。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations');

/**
 * 那道前置閘住在哪一支 —— 它要求 prerequisite 先存在。
 *
 * 🔴 **釘【全檔名】不釘版本號前綴** —— 原本寫 `startsWith(GATE_VERSION)`,
 *   而 2026-09-02 做突變驗證時撞到:一旦樹上出現**第二支同版本號**的檔,
 *   `find()` 會撈到哪一支**由 readdir 的順序決定** ⇒ 正對照紅在一個與它無關的理由上。
 *   📌 **⇒ 那次是我自己造的假檔,而下一次可能是真的。前綴不是識別字。**
 */
const GATE_FILE = '20260901021000_m4b_coupon_p3b_create_order_redeem.sql';
const GATE_VERSION = GATE_FILE.slice(0, 14);

/** 前置閘要求的那支函式。改名 ⇒ SQL 那側與這裡要同 commit 一起改(下面有一格釘住它)。 */
const REVERT_FN = 'coupon_revert_on_full_refund';

/** 只認【定義】不認提及:`CREATE FUNCTION` / `CREATE OR REPLACE FUNCTION`。 */
function definesRe(name: string): RegExp {
  return new RegExp(
    String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?${name}\b`,
    'i',
  );
}

function sqlFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
}

function read(file: string): string {
  return readFileSync(join(MIGRATIONS, file), 'utf8');
}

/** 檔名前綴的 14 碼版本號;拿不到就回 null(讓呼叫端自己決定怎麼辦)。 */
function versionOf(file: string): string | null {
  // 🔵 `?? null` 不是囉唆:tsconfig 開了 noUncheckedIndexedAccess ⇒ `m[1]` 是 `string | undefined`。
  return /^(\d{14})_/.exec(file)?.[1] ?? null;
}

/**
 * 🔴 **生產判準本體 —— 只有這一支**。
 *   下面的守門格與突變格都呼叫它 ⇒ 突變才到得了它。
 *
 * @returns true = 這支檔違規(定義了退回函式, 而它 apply 不到)。
 */
function violates(file: string): boolean {
  const v = versionOf(file);
  // 🔴 拿不到版本號 ⇒ 判成違規, 不是放行。
  //    db push 對一支不照命名慣例的檔會怎麼排序, 本支答不出來 ⇒ fail-closed。
  if (v === null) return true;
  // 🔵 **嚴格大於**(R3 must-fix①):`v === GATE_VERSION` 代表退回函式被**合併進閘那一支**,
  //    而那正是閘的錯誤訊息列為合法的兩個修法之一 ⇒ 用 `>=` 會叫走那條路的人
  //    去做他剛做完的事。
  return v > GATE_VERSION;
}

describe('⟦b4-COUPONREVERT⟧ 退回函式的 migration 必須排在前置閘之前', () => {
  it('守:任何定義 coupon_revert_on_full_refund 的 migration, 版本號都不得晚於前置閘那一支', () => {
    const re = definesRe(REVERT_FN);
    const offenders = sqlFiles().filter((f) => re.test(read(f))).filter(violates);

    expect(
      offenders,
      `這些 migration 定義了 ${REVERT_FN}, 而版本號晚於前置閘所在的 ${GATE_VERSION}。` +
        ` db push 依序 apply 會先撞上 ${GATE_VERSION} 的前置閘而中止, 永遠到不了它們。` +
        ` 修法:把定義它的那支改成更小的版本號, 或與 ${GATE_VERSION} 合併成同一支。`,
    ).toEqual([]);
  });

  it('🔴 釘住:SQL 那一側的前置閘引用的函式名, 必須與本檔的 REVERT_FN 逐字相同', () => {
    // R3 must-fix④:沒有這一格, 有人在 SQL 裡改名 ⇒ 本檔繼續守一個沒有人用的名字,
    // 永久空轉而全綠 —— 而「空轉的守門」與「守住了」印同一個綠。
    expect(
      sqlFiles(),
      `找不到 ${GATE_FILE} ⇒ 前置閘搬家或改名了, 本支要跟著改`,
    ).toContain(GATE_FILE);
    expect(
      read(GATE_FILE),
      `前置閘那一支裡找不到 ${REVERT_FN} ⇒ SQL 側與本檔分家了, 兩邊要同 commit 改`,
    ).toContain(REVERT_FN);
  });

  it('🟢 正對照:definesRe 這把尺對【真的有定義】的函式會命中(拿同一支檔的 create_order 打)', () => {
    // R3 must-fix③:正對照必須用【同一把尺】, 不是另一把手打的 regex ——
    // 否則 REVERT_FN 打錯字 / definesRe 被改壞時, 這一格照樣綠。
    expect(definesRe('create_order').test(read(GATE_FILE)), 'definesRe 對真的 CREATE FUNCTION 應該命中').toBe(true);
  });

  it('🔵 負對照:同一把尺問一個現造的函式名 ⇒ 零命中(尺不亂報)', () => {
    const re = definesRe('zz_not_a_fn_20260902');
    expect(sqlFiles().filter((f) => re.test(read(f)))).toEqual([]);
  });

  it('🔴 突變:餵假檔名給【生產判準 violates() 本身】—— 三個方向都要答對', () => {
    // R3 must-fix②:這一格現在呼叫 violates(), 與上面那條守門是【同一支】。
    // ⇒ 把 violates() 改成 `return false` ⇒ 這一格會紅。(改判準而測試不紅 = 假突變)
    expect(violates('20260999999999_later.sql'), '更晚的版本號必須違規').toBe(true);
    expect(violates('20260901000000_earlier.sql'), '更早的版本號必須放行').toBe(false);
    expect(violates(`${GATE_VERSION}_merged_into_the_gate.sql`), '與閘合併(同版本號)必須放行').toBe(false);
    expect(violates('no_version_prefix.sql'), '拿不到版本號必須 fail-closed 判違規').toBe(true);
  });
});
