import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// database-types-manual-count.test.ts — `#525`:釘住 `database.types.ts` 檔頭的**手動校正計數**。
//
// 🔴🔴 **為什麼需要它**:那支檔的檔頭逐字自稱
//    「**本行是計數的唯一權威**;下方各段一律寫『見檔頭計數』、不再各自複述數字」——
//    **而全樹零守門在釘它。** 2026-08-16 `#525` 加了第 11 個函式,
//    **那一刻檔頭的「十個函式、共二十六處」當場變成假的**,而**沒有任何東西會紅**。
//    ⇒ 這正是 house 的機制優先律:**發現 AI 會犯的錯,第一選擇是把防護做成機制,不是寫規則文字。**
//
// 🔴 **它守的是「宣稱 vs 事實」,不是格式** ——
//    重 gen 之後有人重貼檔頭卻漏了新增那條、或加了新校正忘了改數字,這格都會紅。
//
// ⚠️ **它守不到的**(照實寫,免得被讀成「校正都對」):
//    · **不驗那些校正本身是否正確**(那要對正式庫 gen 一次才知道)
//    · **不驗 `| null` 補得對不對** —— 只數「宣稱幾處」與「列了幾條」對不對得上
//    · 條目若改用本檔不認得的措辭 ⇒ **本格會紅**(刻意:不認得就吵,不靜默略過)
const TYPES_PATH = join(__dirname, 'database.types.ts');

/** 中文數字 → 阿拉伯(1–99;本檔只需要這個範圍)。**不認得回 null,由呼叫端擲錯。** */
function cjkNumber(raw: string): number | null {
  const digit: Record<string, number> = {
    一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  if (raw in digit) return digit[raw] ?? null;
  if (raw === '十') return 10;
  const m = /^(.?)十(.?)$/.exec(raw);
  if (m) {
    const tens = m[1] === '' ? 1 : (digit[m[1] ?? ''] ?? null);
    const ones = m[2] === '' ? 0 : (digit[m[2] ?? ''] ?? null);
    if (tens === null || ones === null) return null;
    return tens * 10 + ones;
  }
  return null;
}

describe('database.types.ts 檔頭的手動校正計數 = 實際條目', () => {
  const src = readFileSync(TYPES_PATH, 'utf8');

  /** 檔頭那一行:「本體另有**十一個函式、共二十七處**手動校正」 */
  const header = /本體另有\*\*(.+?)個函式、共(.+?)處\*\*手動校正/.exec(src);

  /** 圈號條目:`//   ① …` ~ `//   ⑳ …` */
  const entries = [...src.matchAll(/^\/\/ {3}([①-⑳])\s*(.*)$/gm)];

  it('🔴 前提:檔頭那一行與圈號條目都找得到(找不到 = 本守門瞎了,不是通過)', () => {
    // 🔴 **沒有這一格,下面每一格都會因為「兩邊都是 0」而恆真** ——
    //    那正是本檔要防的那類病的鏡像。
    expect(header, '檔頭計數那一行不見了(被重 gen 沖掉?)').not.toBeNull();
    expect(entries.length, '一條圈號條目都找不到 ⇒ 正規式與檔案格式已脫節').toBeGreaterThan(0);
  });

  it('函式數:檔頭宣稱 = 圈號條目數', () => {
    const claimed = cjkNumber(header?.[1] ?? '');
    expect(claimed, `檔頭的函式數「${header?.[1]}」不是本檔認得的中文數字`).not.toBeNull();
    expect(claimed).toBe(entries.length);
  });

  it('🔴 校正處數:檔頭宣稱 = 逐條加總(措辭不認得就紅,不靜默略過)', () => {
    let sum = 0;
    for (const [, mark, rest] of entries) {
      // 每條的形狀只有兩種:`…**N處**(…` 或 `…**整段**(…`
      if (/\*\*整段\*\*/.test(rest ?? '')) {
        sum += 1;
        continue;
      }
      const m = /\*?\*?(.)處\*?\*?/.exec(rest ?? '');
      const n = m ? cjkNumber(m[1] ?? '') : null;
      // 🔴 **不認得 ⇒ 擲錯,不是跳過** —— 跳過會讓總數少算而**兩邊剛好都變小**,
      //    那就是一個看起來正常的錯數字(本檔存在的理由本身)。
      expect(n, `條目 ${mark} 的校正處數措辭本檔不認得:「${(rest ?? '').slice(0, 40)}」`).not.toBeNull();
      sum += n ?? 0;
    }
    const claimed = cjkNumber(header?.[2] ?? '');
    expect(claimed, `檔頭的處數「${header?.[2]}」不是本檔認得的中文數字`).not.toBeNull();
    expect(sum).toBe(claimed);
  });

  it('正向對照:中文數字解析本身是活的(否則上面兩格可能因為恆 null 而互相遷就)', () => {
    expect(cjkNumber('三')).toBe(3);
    expect(cjkNumber('十')).toBe(10);
    expect(cjkNumber('十一')).toBe(11);
    expect(cjkNumber('二十七')).toBe(27);
    expect(cjkNumber('兩')).toBe(2);
    // 負向:不認得的要回 null,不能瞎猜一個數字
    expect(cjkNumber('壹佰')).toBeNull();
    expect(cjkNumber('')).toBeNull();
  });
});
