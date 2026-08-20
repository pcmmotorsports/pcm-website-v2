// atomic-field-value.test.ts — 摘要卡「值不准斷在 token 中間」的守門。
//
// 🔴🔴 **這一格守不到什麼(第一句就講,因為它決定了你能不能信它)**:
//    **jsdom 沒有版面引擎** ⇒ 它算不出換行點,所以本檔**證不出「畫面上真的沒有斷在字中間」**。
//    本檔守的是**CSS 字面**:那幾個承重的 class 還在不在、atomic 標記有沒有被拿掉。
//    ⇒ 🔴 **真正的驗證是真瀏覽器量測**,而它是一次性的、不會每天重跑:
//      2026-08-21 W2 在 720 面板實測(拋棄式後台 + Playwright,逐字元 Range 找換行點):
//        修前:斷在 token 中間 **2 處**(`probe@example.c|om` / `網站 · 線上刷|卡`)、折行 3
//        修後:斷在 token 中間 **0 處**、折行 2、溢出 0;餵超長 email ⇒ 仍 0 斷 0 溢出
//      量法與數字全文 = `~/pcm-mailbox/W2-031-值不准斷在token中間-20260821.md`
//    ⇒ **本檔紅了代表「承重的 class 被動了」,而不代表版面壞了;本檔綠了也不代表版面是對的。**
//
// 🔴 為什麼這件事是【正確性】不是版面品味:`break-all` 把時間戳斷成 `2026-08-19 0` / `3:56`
//    ⇒ **「2026-08-19 0」自己是一個看起來合法的值**,員工不會發現畫面壞了。
//    email 斷成 `probe@example.c` / `om` 抄下來寄信是錯的。

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../lib/test-support/strip-comments';

const DIR = dirname(fileURLToPath(import.meta.url));
/** 🔴 對【剝掉註解】的碼跑 —— 上面那些註解裡就寫著 `break-all` 這個字面。 */
const CARDS = stripComments(readFileSync(resolve(DIR, 'order-detail-summary-cards.tsx'), 'utf8'));
const ATOMIC = stripComments(readFileSync(resolve(DIR, 'atomic-field-value.tsx'), 'utf8'));

describe('摘要卡的值不准斷在 token 中間(CSS 字面守門)', () => {
  it('🔴 預設那條路不得再用 `break-all`(它允許在任何字元中間斷)', () => {
    expect(CARDS).not.toMatch(/break-all/);
    // 正向對照:換上去的兩個 class 都在(少任一個,承重就斷了)
    expect(CARDS).toMatch(/break-keep/);
    expect(CARDS).toMatch(/break-words/);
  });

  it('🔴 六個「斷開會讀得通而錯」的欄位必須標 atomic', () => {
    // 逐一釘 label,而不是只數 atomic 出現幾次 ——
    // 只數次數的話,把 atomic 從 email 搬到姓名上,總數不變而守門不會紅。
    for (const label of ['電話', 'Email', '載具', '發票號碼', '付款時間', '發票金額']) {
      const i = CARDS.indexOf(`'${label}'`);
      expect(i, `找不到 label='${label}' 這個 Field`).toBeGreaterThan(-1);
      // 從該 label 往後到這個 <Field> 結束為止,必須出現 atomic
      const seg = CARDS.slice(i, CARDS.indexOf('/>', i) + 2);
      expect(seg, `${label} 這一格沒有標 atomic ⇒ 它會回到「可以斷在字中間」那條路`).toMatch(/atomic/);
    }
  });

  it('🔴 出貨狀態【不得】標 atomic(它本來就帶換行,套上去會被吃掉)', () => {
    const i = CARDS.indexOf("'出貨狀態'");
    expect(i).toBeGreaterThan(-1);
    expect(CARDS.slice(i, CARDS.indexOf('/>', i) + 2)).not.toMatch(/atomic/);
  });

  it('atomic 的殼是「不換行 + 截斷 + tooltip」三件齊,少一件就漏值', () => {
    expect(ATOMIC).toMatch(/whitespace-nowrap/);
    expect(ATOMIC).toMatch(/truncate/);
    // tooltip 是「被截掉的字還讀得到」的唯一出路 ⇒ 它不在就等於把值弄丟了
    expect(ATOMIC).toMatch(/TooltipContent/);
    expect(ATOMIC).toMatch(/from '\.\.\/ui\/tooltip'/);
  });

  it('量具自檢:這把尺讀得到東西,而且分得出兩個世界', () => {
    expect(CARDS.length).toBeGreaterThan(1000);
    // 負向對照:一段不含那些 class 的字串必須不命中(證明上面的 toMatch 不是恆真)
    expect('const X = 1;').not.toMatch(/break-keep/);
    // 正向對照:剝註解器真的有在剝(否則上面第一格會被檔頭註解裡的 break-all 打紅)
    expect(stripComments('// break-all\nconst a=1;')).not.toMatch(/break-all/);
  });
});
