import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// 顧客站的「訂單明細」列印頁與後台那張紙【共用三個檔】,而共用的方式是**逐位元組複製**。
// 這一格是那三份副本唯一的繫繩。
//
// 🔴 **為什麼是複製而不是抽共用套件**(2026-08-30 線【客人帳戶區】判,每一格都是當場量的):
//   · `grep '"@pcm/ui"' apps/admin/package.json` ⇒ **零命中** ⇒ 後台今天根本不吃那個套件。
//   · `find packages/ui -name '*.css'` ⇒ **零命中** ⇒ 連「共用套件出 CSS」這條路都還沒有人走過。
//   ⇒ 抽共用 = 把 `@pcm/ui` 接進後台 + 搬 1022 行 CSS + 搬 543 行元件 + 統一兩個不同的型別,
//     那是一次 `apps/admin` 的重構;而本線的派工明寫「要動 `apps/admin` ⇒ 停下來回報」。
//   ⇒ 複製是本線做得到的最小動作。**而複製的代價是漂移,所以代價由這一格承擔。**
//
// 🔴🔴 **它紅了要怎麼辦**:紅 = 有人只改了其中一份。
//   正確處置 = **把改動搬到另一份、讓兩份重新一致**。
//   ⛔ **不是**把下面的清單刪一行、或改成「允許不同」讓它變綠 ——
//      那等於把「兩張紙長得不一樣」這件事關掉,而 Sean 2026-08-30 拍的 `Q-容差 = 甲`
//      逐字是「客人下載的明細 = 後台那張,**一模一樣**」。
//   📌 而「兩張紙不一樣」在畫面上、在 typecheck、在 lint、在 build 上**都沒有形狀** ——
//      只有這一格看得到。
//
// ⚠️ **它的射程(照實寫)**:它只比這三個檔。
//   **版面元件是兩份各自寫的** —— 後台 `picking-doc.tsx` 吃 `AdminOrderDetail`、
//   顧客站 `statement-doc.tsx` 吃 `MemberOrderDetail`,兩個型別的欄位不一樣
//   (詳見 `statement-doc.tsx` 檔頭那張【全部偏離】清單 —— ⚠️ 我上一版這裡寫的標題字面已經不存在了,
//    拿它去 grep 會零命中;R2 抓到。**指標要指到現在的字面,不是我記得的那個。**)。
//   ⇒ **有人只改元件、不改這三個檔時,這一格照樣是綠的。**
//
// 🔴🔴 **而它還有第二個、更難看見的盲區:它看得到【位元組不一樣】,看不到
//   【位元組一樣而行為不同】。**實錘(R1 must-fix,2026-08-30):
//   `print-a4.css` 的 `@media print{ .print-sheet{padding:0} }` 是**無層**規則,
//   在後台永遠贏過 Tailwind 那三條(utilities 住 `@layer utilities`)——
//   **而 storefront 沒有 Tailwind、也沒有那個 layer** ⇒ 同一份位元組搬過來之後,
//   一條無層的 `.stmt-page{padding:24px}` 就贏得過它。
//   📌 **⇒ 複製的代價表有兩行,不是一行:①漂移(本格守得住)②【環境差異】(本格守不住)。**
//   ⇒ 第二行今天靠 `statement.css` 的 `@media screen` 把螢幕規則關在門外,而**那是紀律不是機制**。

const REPO = join(__dirname, '../../../../..');

// [後台正本, 顧客站副本]
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['apps/admin/src/app/print/print-a4.css', 'apps/storefront/src/styles/print-a4.css'],
  [
    'apps/admin/src/components/print/print-assets.ts',
    'apps/storefront/src/components/print/print-assets.ts',
  ],
  [
    'apps/admin/src/lib/print/strip-pictographs.ts',
    'apps/storefront/src/lib/print/strip-pictographs.ts',
  ],
];

const sha = (rel: string) => createHash('sha256').update(readFileSync(join(REPO, rel))).digest('hex');

describe('顧客站列印檔 vs 後台正本', () => {
  // 🔴 分母先釘住 —— 少複製一個檔時,上面那張表會安靜地少一列,而 `it.each` 只會少跑一格
  //    (鐵則 11「我餵幾條 vs 它跑幾支」套在這一層)。
  it('清單長度 = 3', () => {
    expect(PAIRS).toHaveLength(3);
  });

  it.each(PAIRS)('%s 與副本逐位元組相同', (admin, storefront) => {
    expect(sha(storefront)).toBe(sha(admin));
  });

  it('負對照:差一個位元組就不同(證明這把尺不是恆真)', () => {
    const admin = PAIRS[0]![0];
    const mutated = createHash('sha256')
      .update(readFileSync(join(REPO, admin), 'utf8') + ' ')
      .digest('hex');
    expect(mutated).not.toBe(sha(admin));
  });
});
