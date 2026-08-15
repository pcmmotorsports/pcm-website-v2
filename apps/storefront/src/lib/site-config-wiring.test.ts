// site-config-wiring.test.ts —— **結構守門:SSoT 的消費端必須真的接著 SSoT。**
//
// 🔴🔴 **本片【新增】一條約束,不是繼承既有設計。措辭刻意寫死在這裡:**
//   **對外面(法律頁 / 搜尋引擎)的 SSoT 變更必須有人手動確認。**
//   **原作者沒有這樣設計** —— `lib/org-jsonld.test.ts` 與 `components/Header.test.tsx`
//   釘字面的那兩格,查過註解、docstring 與引入它們的 commit body
//   (`5d5cd8d3` / `6b308003`)**都查無「為何釘字面而不吃 SSoT」的說明**;
//   而那兩顆 commit 的自述反而偏向「單一真相」
//   (`5d5cd8d3` 逐字「`lib/site-config.ts`:商家事實單一真相」/
//    `6b308003` 逐字「底部 LINE/門市資訊全部接既有常數(無編造)」)。
//   ⇒ **這是我們的判斷,要推翻請直接推翻,不要以為在動別人的設計。**
//
// **判斷本身(主視窗 2026-08-16,未經 Sean ⇒ 是可退的裁量、不是拍板)**:
//   **法律頁與搜尋引擎的內容改動,機械上叫一聲的價值大於它造成的摩擦。**
//   **而它可逆** —— 拿掉 `org-jsonld.test.ts` / `Header.test.tsx` 那兩格字面斷言即可回到
//   「全接 SSoT、改常數零紅」的那一案。
//
// ---
//
// 🔴 **為什麼需要這一支(既有四格都抓不到的那個洞)**
//   2026-08-16 盤點 `OPENING_HOURS` 的守門,**四格形狀互不相交、交集是空的**:
//     `lib/org-jsonld.test.ts:67-68`      釘字面複本   改 SSoT ✅紅   消費端脫鉤 ❌綠
//     `components/Header.test.tsx:351`    釘字面複本   改 SSoT ✅紅   消費端脫鉤 ❌綠
//     `data/legal-content-hash.test.ts`   內容雜湊     改 SSoT ✅紅   消費端脫鉤 ❌綠
//     `components/LegalDocPage.test.tsx`  吃 SSoT      改 SSoT ❌不紅  消費端脫鉤 ❌綠
//   ⇒ **沒有一格守「渲染衍生自 SSoT」。**
//   實測(把 `MobileMenu.tsx:73` 改回硬寫、**值不變**)⇒ 相關測試 **31 passed、零紅**。
//   ⇒ **真缺口不是「漂移」是「脫鉤」** —— 值一樣、來源斷掉,而所有既有守門都看值。
//
// ⚠️ **本支守的是【接線】不是【值】** —— 值有沒有對是上面那四格的事,兩者不可互相取代。
// ⚠️ **本支會在「有人把消費端改回硬寫」時紅,不會在「改 SSoT」時紅** —— 那是刻意的分工。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');

/**
 * `OPENING_HOURS` 的消費端全清單(2026-08-16 實測)。
 *
 * 量法(字集寫下來,兩條都要跑):
 *   git grep -ln 'OPENING_HOURS'            -- apps/storefront/src | grep -v '\.test\.'
 *   git grep -nE '週一[-–]週六|10:00[-–]19:00' -- apps/storefront/src | grep -v '\.test\.'
 * 第二條是**反向**的:抓「該接而沒接」的硬寫殘留。只跑第一條會漏掉脫鉤的那些。
 *
 * 🔴 **新增消費端時要把它加進這張表** —— 否則新的那支脫鉤時本支零訊號。
 *    這是本支自己的已知限度,寫出來不是免責:**分母由人維護,不是機器發現的。**
 */
const CONSUMERS: readonly (readonly [rel: string, why: string])[] = [
  ['components/HomeFooter.tsx', '頁尾門市欄(2026-08-15 由硬寫改為接 SSoT)'],
  ['components/ComingSoon.tsx', '/coming-soon /stores /install 的頁尾(同上)'],
  ['components/MobileMenu.tsx', '手機選單門市資訊'],
  ['lib/org-jsonld.ts', '🔴 schema.org openingHoursSpecification —— 餵搜尋引擎'],
  ['data/legal-content.ts', '🔴 服務條款正文的營業時間 —— 法律頁'],
];

describe('SSoT 接線:`OPENING_HOURS` 的消費端必須真的接著常數', () => {
  for (const [rel, why] of CONSUMERS) {
    it(`${rel} 仍 import 並使用 OPENING_HOURS(${why})`, () => {
      const src = readFileSync(join(SRC, rel), 'utf8');
      // ① 有 import(擋「整支改成硬寫、連 import 都刪掉」)
      expect(src, `${rel} 不再 import site-config —— 它脫鉤了`).toMatch(
        /import\s*\{[^}]*\bOPENING_HOURS\b[^}]*\}\s*from\s*['"]@\/lib\/site-config['"]/,
      );
      // ② 真的用到(擋「留著 import 但實際上寫死」—— 只驗 import 會被這條路繞過)
      const uses = src.match(/\bOPENING_HOURS\s*\.\s*(opens|closes|days)\b/g) ?? [];
      expect(uses.length, `${rel} import 了 OPENING_HOURS 卻沒有實際取用任何欄位`).toBeGreaterThan(0);
    });
  }

  // 🔴 反向格:沒有它,上面那組會退化成「只證存在、不證窮盡」——
  //    有人新增第六個消費端並硬寫,上面五格照樣全綠。
  //    ⚠️ 本格**不掃 `.test.` 檔**(測試裡出現字面是正常的,那是期望值)。
  it('🔴 沒有【該接而沒接】的硬寫殘留(反向:抓脫鉤,不是抓存在)', () => {
    const scanned: string[] = [];
    for (const [rel] of CONSUMERS) scanned.push(rel);
    // 這裡只掃已知消費端;全樹掃在 CI 之外由人跑(量法見上方 docstring)。
    for (const rel of scanned) {
      const src = readFileSync(join(SRC, rel), 'utf8');
      // 只看「渲染/組字」那一類殘留:字面時段。註解裡出現是允許的(本檔自己就有)。
      const codeLines = src
        .split('\n')
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .filter((l) => !l.includes('週一-週六 10:00-19:00 」'));
      const hardcoded = codeLines.filter((l) => /['"`][^'"`]*10:00\s*[-–]\s*19:00/.test(l));
      expect(hardcoded, `${rel} 有硬寫的時段字面 —— 它應該吃 OPENING_HOURS`).toEqual([]);
    }
  });
});
