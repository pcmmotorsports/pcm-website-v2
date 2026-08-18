// invisible-tap-targets.test.ts — 「看不見的東西不准吃點擊」守門。
//
// 🔴 病(2026-08-18 修掉的那個):`.pcard-heart` 是 `opacity: 0` + 只有 `.pcard:hover` 才浮出來,
//    **而觸控裝置沒有 hover ⇒ 它永遠是隱形的**;它又缺 `pointer-events: none`,
//    而 `ProductCard.tsx:155` 的 onClick 會 `preventDefault()`
//    ⇒ 每張商品圖右上角一個 **32×32 看不見的洞,客人點下去商品不會打開**。
//    390×844 實測(6px 網格、1421 取樣點):修前陷阱點 **22**、修後 **0**。
//
// 🔴 **為什麼要用「讀 CSS 字面」守它**:這個 bug 對既有檢查全部隱形 ——
//    typecheck / lint / build / vitest 全綠,畫面上也看不出來(它本來就看不見)。
//    唯一抓得到它的是「在真瀏覽器上逐點問 elementFromPoint」,而那不在 CI 裡。
//
// ⚠️ **本檔守的是「別再被拿掉」,不是「版面現在是對的」** —— 後者要真瀏覽器量。
// ⚠️ 射程:只掃 `product-card.css` 裡**已知的三個 hover-gated 隱形元素**。
//    它**不會**自動發現新增的第四個 —— 那要靠真瀏覽器掃描,或有人記得把新的加進下面這張表。
//    (誠實說:這正是這種守門的天花板,寫在這裡免得有人以為它保證了全站。)
// 📎 `design-reference/styles/product-card.css:78-95` 的 `.pcard-heart` **同樣沒有 pointer-events**
//    ⇒ 日後照鐵則 1 重搬那支檔的人會把這個洞搬回來,**這一格就是攔他的**。
//
// ═══════════════════════════════════════════════════════════════════════════
// 🔴🔴 **給未來把愛心改成「手機常駐顯示」的那個人:這 4 格【預期會紅】,而它們不該被刪掉。**
// ═══════════════════════════════════════════════════════════════════════════
//   背景:`Q1 = 手機上的愛心常駐顯示`(Sean 2026-08-18 親口確認「手機客人要能收藏」;
//   plan `docs/specs/2026-08-18-g3-favorites-plan.md` §1-h)。
//   一旦 `.pcard-heart` 在手機上要**看得見**,它就不能再是 `opacity: 0`
//   ⇒ 本檔第一組(`HOVER_GATED` 逐條)對 `.pcard-heart` 那一格**會紅**。
//
//   🔴 **那時候要做的是【改期望值 + 重新想它在守什麼】,不是刪掉它:**
//   ```
//   它守的病 = 「看不見的東西不准吃點擊」
//   而那個病在 .pcard-dots 與 .pcard-quick 上【仍然成立】—— 那兩個還是 hover-gated
//   ⇒ 把 .pcard-heart 從 HOVER_GATED 那張表移出來，讓另外兩個繼續被守
//   ⇒ 而 .pcard-heart 屆時要換一個新的斷言:「可見」與「可點」必須綁在一起
//      （看得見 ⇒ pointer-events 不得是 none;否則變成【看得見卻按不到】）
//   ```
//   ⚠️ **最容易走錯的那一步**:看到紅、以為守門過時了、整支刪掉
//   ⇒ 那會讓 `.pcard-dots` / `.pcard-quick` 同時失去保護,**而它們是無辜的**。
//
//   📎 這一段寫在這裡而不是只寫在交接檔裡,理由是今天的母題:
//   **改這支檔的人讀的是這支檔,不是別人的檢查點。**

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 剝掉註解再比對 —— 否則上面那段說明自己就會命中(偵測字串自命中)。 */
const read = (f: string) => readFileSync(resolve(HERE, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** `product-card.css` 裡「平常隱形、只有 hover 才浮出來」的元素。 */
const HOVER_GATED = ['.pcard-heart', '.pcard-dots', '.pcard-quick'];

describe('看不見的東西不准吃點擊(product-card.css)', () => {
  it.each(HOVER_GATED)('🔴 %s 的基底規則必須同時有 opacity: 0 與 pointer-events: none', (sel) => {
    const css = read('product-card.css');
    // 基底規則 = 選擇器單獨出現(不是 .pcard:hover xxx 那種)
    const rule = new RegExp(`(^|\\n)\\s*\\${sel}\\s*\\{[^}]*\\}`).exec(css)?.[0];
    expect(rule, `找不到 ${sel} 的基底規則 ⇒ 本條前提失效(被改名?)，不是通過`).toBeTruthy();
    expect(rule, `${sel} 不再是 opacity:0 ⇒ 本格的前提變了，回去重讀本檔檔頭再決定要不要改這張表`)
      .toMatch(/opacity:\s*0\s*;/);
    expect(
      rule,
      `${sel} 看不見卻沒有 pointer-events: none ⇒ 它會在隱形狀態下吃掉客人的點擊`,
    ).toMatch(/pointer-events:\s*none\s*;/);
  });

  it('🔴 `.pcard-heart` 浮出來時要把點擊收回去(否則桌機按不到)', () => {
    const css = read('product-card.css');
    const hoverRule = /\.pcard:hover\s+\.pcard-heart\s*\{[^}]*\}/.exec(css)?.[0];
    expect(hoverRule, '找不到 .pcard:hover .pcard-heart ⇒ 前提失效').toBeTruthy();
    expect(hoverRule, 'hover 態沒有 pointer-events: auto ⇒ 桌機的收藏鈕會按不到')
      .toMatch(/pointer-events:\s*auto\s*;/);
  });
});
