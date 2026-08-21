import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ORDER_SEARCH_CAVEAT,
  ORDER_SEARCH_DIMENSIONS,
  ORDER_SEARCH_LABELS,
  ORDER_SEARCH_RPC_MIGRATION,
} from './order-search-dimensions';

// order-search-dimensions.test.ts — 釘住「畫面文案沒有少報、也沒有多報 RPC 的能力」。
//
// 🔴🔴 **本檔第一版被審查線擊破,擊破的方式值得留著**(2026-08-21 MF-1):
//    第一版的 `countBranches` 數的是 `-- #N` **標號註解**,不是分支。審查線跑了五發:
//    ```
//    A 陣列拿掉一維              🔴 紅   ← 我宣稱的那一發,成立
//    B 加一條【真的 UNION 分支】但沒掛標號   🟢 綠  ← 該紅沒紅
//    C 刪掉分支、標號留著                    🟢 綠  ← 該紅沒紅
//    ```
//    ⇒ **B 正是本守門存在的理由**(SQL 長出第 13 維而文案沒跟上),而它綠。
//    ⇒ 病灶一句話:**錨落在「註解也命中」的字串上 ⇒ 改註解不改 code,守門照樣綠。**
//    ⇒ 我當時只表演了「陣列少一個」,**沒表演「SQL 多一條」——單向過關不算表演過。**
//
// 🔴 修法:①先**剝掉所有 `--` 行註解**,讓註解在數法裡完全不存在
//         ②在 `WITH hits AS (…)` 的括號配對區塊內數
//         ③**兩個彼此獨立的數法都要同意**:`UNION 數 + 1` 與「分支形狀」出現次數
//           —— 任一個單獨都可能被繞過,兩個要同時被騙難得多。

const REPO_ROOT = resolve(__dirname, '../../../../..');
const readMigration = () => readFileSync(resolve(REPO_ROOT, ORDER_SEARCH_RPC_MIGRATION), 'utf8');

/** 剝掉 `--` 行註解 —— 這一步是 MF-1 的修法本體,不是清理。 */
const stripLineComments = (sql: string) => sql.replace(/--[^\n]*/g, '');

/** 取 `WITH hits AS ( … )` 的括號配對區塊。 */
function hitsBlock(sql: string): string {
  const i = sql.indexOf('WITH hits AS (');
  if (i < 0) throw new Error('找不到 `WITH hits AS (` —— 函式結構變了,本守門要重寫');
  const open = sql.indexOf('(', i);
  let depth = 0;
  for (let k = open; k < sql.length; k += 1) {
    if (sql[k] === '(') depth += 1;
    else if (sql[k] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, k);
    }
  }
  throw new Error('括號沒有配對');
}

/** 兩個獨立的數法。剝過註解 ⇒ 兩者都不受註解影響。 */
function countBranches(sql: string): { byUnion: number; byShape: number } {
  const block = hitsBlock(stripLineComments(sql));
  return {
    byUnion: (block.match(/^\s*UNION\s*$/gm) ?? []).length + 1,
    byShape: (block.match(/FROM public\.orders o\b/g) ?? []).length,
  };
}

describe('訂單搜尋:畫面文案 vs RPC 能力', () => {
  it('🔴 權威檔真的在(路徑錯掉要紅,不能靜靜讀到空字串)', () => {
    expect(readMigration().length).toBeGreaterThan(1000);
  });

  it('🔴🔴 兩個獨立數法與陣列長度【三者相等】', () => {
    const { byUnion, byShape } = countBranches(readMigration());
    expect({ byUnion, byShape, dims: ORDER_SEARCH_DIMENSIONS.length }).toEqual({
      byUnion: ORDER_SEARCH_DIMENSIONS.length,
      byShape: ORDER_SEARCH_DIMENSIONS.length,
      dims: ORDER_SEARCH_DIMENSIONS.length,
    });
  });

  // 🔴 下面兩格是**量具自己的雙向表演**,不是湊數:
  //    第一版就是因為只表演了一個方向才漏掉 B。
  it('🔴🔴 表演方向一:SQL 多一條【真的】分支(不掛標號)⇒ 數法必須看見它', () => {
    const sql = readMigration();
    const anchor = '    UNION\n    -- #11 供應商單號';
    expect(sql.split(anchor).length - 1).toBe(1); // anchor 唯一,否則突變會插錯地方
    const mutated = sql.replace(
      anchor,
      `    UNION\n    SELECT o.id, o.created_at FROM public.orders o WHERE false\n${anchor}`
    );
    const base = countBranches(sql);
    const after = countBranches(mutated);
    expect({ byUnion: after.byUnion, byShape: after.byShape }).toEqual({
      byUnion: base.byUnion + 1,
      byShape: base.byShape + 1,
    });
  });

  it('🔴🔴 表演方向二:分支【本體】不見了、標號註解還留著 ⇒ 數法必須看見', () => {
    const sql = readMigration();
    const base = countBranches(sql);
    // 拿掉一次「分支形狀」,`-- #N` 標號一個字都沒動 ——
    // 舊版(數標號)在這個世界會回一樣的 12;新版必須少 1。
    const mutated = sql.replace('FROM public.orders o\n      JOIN public.customers c', 'FROM public.orders o2\n      JOIN public.customers c');
    expect(mutated).not.toBe(sql);
    expect(countBranches(mutated).byShape).toBe(base.byShape - 1);
    // 而標號數完全沒變 —— 這行就是舊版為什麼看不見它
    const labels = (t: string) => (t.match(/^ {4}-- #\d+ /gm) ?? []).length;
    expect(labels(mutated)).toBe(labels(sql));
  });


  // 🔴🔴 **R2-2 / R2-3 的修法本體 —— 數量守不住「每條在搜什麼」。**
  //    審查線八發裡有兩發是新法擋不住的:
  //      N3 把 #11 的比對欄位換成別欄 ⇒ 分支數仍 12 🟢 該紅沒紅
  //      N4 把 #3 從電話改成別的欄位  ⇒ 分支數仍 12 🟢 該紅沒紅
  //    ⇒ 失敗情境:某條分支改去搜別的東西,而畫面標籤沒跟著改
  //      ⇒ 員工照標籤打字、得到零筆、學到「這框不準」。**與 MF-2 同族。**
  it('🔴🔴 每一維宣稱的欄位路徑,都真的出現在 `WITH hits` 區塊裡', () => {
    const block = hitsBlock(stripLineComments(readMigration()));
    const missing = ORDER_SEARCH_DIMENSIONS.filter((d) => !block.includes(d.sql));
    expect(missing.map((d) => `${d.label}(${d.sql})`)).toEqual([]);
  });

  it('🔴 上一格的量具要分得開:餵一個不存在的欄位必須被抓出來', () => {
    const block = hitsBlock(stripLineComments(readMigration()));
    expect(block.includes('zzz_not_a_real_column')).toBe(false);
  });

  it('🔴 欄位路徑取自【資料】不是註解 —— 剝掉註解之後它必須還在', () => {
    // 若哪天有人把 `sql` 搬回行尾註解,本格會紅:註解剝掉後陣列裡就沒有那個值了。
    expect(ORDER_SEARCH_DIMENSIONS.every((d) => typeof d.sql === 'string' && d.sql.length > 0)).toBe(true);
    expect(ORDER_SEARCH_LABELS.length).toBe(ORDER_SEARCH_DIMENSIONS.length);
  });

  // 🔴 **R2-3:MF-4 那格【不刪了】** —— 審查線核出我的理由只對了一部分:
  //    改成 COMMENT 分母命中 9/12(零命中的是 舊單號 / 收件電話 / 收件地址)
  //    ⇒ 「永遠紅」只在兩邊都不改時成立,而 **9/12 是有判別力的**。
  //    ⇒ 從「部分判別力」掉到「零」不是誠實,是把一格能用的守門丟掉。
  //    ⇒ 本格改成:**在 COMMENT 找得到的那幾維,必須真的找得到**(把分母寫死成清單,
  //      而不是「全部」)—— 分母是量出來的,不是估的。
  it('⚠️ 權威 COMMENT 裡叫得出名字的那幾維,名字不得漂掉(分母 = 實測 9/12,非全部)', () => {
    const sql = readMigration();
    const IN_COMMENT = ['訂單編號', '會員姓名', '會員電話', '收件人', '料號', '品名', '規格', '品牌', '供應商單號'];
    expect(IN_COMMENT.length).toBe(9);
    expect(IN_COMMENT.filter((n) => !sql.includes(n))).toEqual([]);
    // 這三維 COMMENT 裡叫別的名字 ⇒ 刻意不放進分母,並把這件事寫在這裡而不是留給下一個人猜
    expect(['舊單號', '收件電話', '收件地址'].every((n) => IN_COMMENT.includes(n))).toBe(false);
  });

  it('🔴 清單沒有重複、沒有空字串(重複會讓某一維悄悄少算)', () => {
    expect(new Set(ORDER_SEARCH_LABELS).size).toBe(ORDER_SEARCH_LABELS.length);
    expect(ORDER_SEARCH_LABELS.every((d) => d.trim() !== '')).toBe(true);
  });

  // 🔴 MF-2:多報比少報更快摧毀信任 —— 員工搜一次零筆,就學到「這框不準」。
  it('🔴🔴 不得出現裸的「供應商」—— #11 只比對 supplier_order_no,供應商【名字】搜不到', () => {
    const sql = readMigration();
    // 權威:片 B-2 才重建供應商名(同檔 `:365-367`)
    expect(sql).toContain('在片 B-2 重建');
    expect(ORDER_SEARCH_LABELS).toContain('供應商單號');
    expect(ORDER_SEARCH_LABELS).not.toContain('供應商');
  });

  // 🔴 MF-3:權威 COMMENT 逐字要求「畫面須標明」,而它原本只寫在程式註解裡。
  it('🔴🔴 品牌限定必須存在,且它是 COMMENT 逐字要求的(不是我自己想加的貼心話)', () => {
    expect(readMigration()).toContain('畫面須標明');
    expect(ORDER_SEARCH_CAVEAT).toContain('現在的');
    expect(ORDER_SEARCH_CAVEAT).toContain('品牌');
  });

  // ⚠️ **本格是字面守門,它守不到「那句話真的畫在螢幕上」** —— 只守元件有引用這個常數。
  //    真的要守渲染結果得跑 jsdom render;這裡刻意不做,而**限定寫在這裡不寫在別處**。
  it('⚠️ 元件有引用 CAVEAT 與 DIMENSIONS(字面守門,限定見上方註解)', () => {
    const tsx = readFileSync(resolve(__dirname, 'order-keyword-search.tsx'), 'utf8');
    expect(tsx).toContain('ORDER_SEARCH_LABELS');
    expect(tsx).toContain('ORDER_SEARCH_CAVEAT');
  });
});
