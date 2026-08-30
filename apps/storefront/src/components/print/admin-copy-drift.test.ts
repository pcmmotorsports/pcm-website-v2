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
// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **本格的定位在 2026-08-30 傍晚【改變了】—— 讀這一段再決定怎麼處理它的紅。**
//
//    Sean 當天傍晚的原話逐字(我問「後台那兩張改了版面,客人那張也一起拿掉嗎」):
//      **「要 拿掉,**
//       **但是我的認定,訂單明細=客人看到的那張,是一樣的東西。」**
//
//    🔴 **後面那一句比前面那件事重要得多** —— 它不是「這一次跟著改」,
//       是**他認為這兩張本來就是同一個東西**。
//       ⇒ **以後後台那張改一次,客人那張就要跟一次 —— 永久。**
//
//    ⇒ 📌 **所以本格不是「監測分岔」的儀表, 它是【那條規矩的執行者】。**
//      🔴 **⇒ 它紅的時候, 正確反應是【去跟上】, 不是【更新基準值】。**
//         更新基準值 = 把兩張紙從此分岔, 而**那要新的拍板, 不是一個人可以決定的事。**
//
//    🛑🛑 **而它執行的【只有三個共用檔那一半】—— 這句話必須跟上面那句一起讀。**
//       版面元件是兩份各自寫的(後台 `picking-doc.tsx` / 這裡 `statement-doc.tsx`)
//       ⇒ **有人只改元件時, 本格照樣是綠的。**
//       🔴 **實錘, 而且是今天**:2026-08-30 傍晚 Sean 拍「那兩句拿掉」, 我改的正是**元件**
//          —— 而本格**一格都沒紅**。元件那一半由
//          `app/account/orders/[displayId]/statement/page.test.tsx` 的反向格承擔。
//       📌 **⇒ 上面那句「規矩的執行者」如果單獨被讀, 它比它做得到的事寬一整層**
//          (code-reviewer 2026-08-30 抓:響亮的那句先出現、射程那句在 18 行之下,
//           **而讀的人不會讀到第 18 行**)。
//
//    ⚠️ **另一件不要誤讀的**:「一樣的東西」**不等於「每一格都要一樣」**。
//       客人那張與後台那張**刻意不同的地方共 9 處**, 清單在
//       `statement-doc.tsx` 檔頭那張「**【全部】偏離**」清單裡, 而其中有 Sean **另外拍過的板**
//       (①狀態欄不印 = 營運數量紅線;付款資訊不印 = 2026-08-30 拍乙)。
//       🛑 **⇒ 不要拿「一樣的東西」當理由把狀態欄或付款欄補回去** —— 那會推翻另外兩個板。
//    (更早的 `Q-容差 = 甲` 逐字「客人下載的明細 = 後台那張,**一模一樣**」是同一條規矩的第一版;
//     傍晚那句把它從「這一次」升成「這兩張是同一個東西」。)
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴🔴 **它紅了要怎麼辦**:紅 = 有人只改了其中一份。
//   正確處置 = **把改動搬到另一份、讓兩份重新一致**。
//   ⛔ **不是**把下面的清單刪一行、或改成「允許不同」讓它變綠。
//   📌 而「兩張紙不一樣」在畫面上、在 typecheck、在 lint、在 build 上**都沒有形狀** ——
//      只有這一格看得到。
//
// ⚠️ **它的射程(照實寫)**:它只比這三個檔。
//   **版面元件是兩份各自寫的** —— 後台 `picking-doc.tsx` 吃 `AdminOrderDetail`、
//   顧客站 `statement-doc.tsx` 吃 `MemberOrderDetail`,兩個型別的欄位不一樣
//   (詳見 `statement-doc.tsx` 檔頭那張「**【全部】偏離**」清單 —— 逐字含那對粗體標記, 拿去 grep 才撈得到 —— ⚠️ 我上一版這裡寫的標題字面已經不存在了,
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
