import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A4 版面(Sean 2026-08-17 四條需求的第 1、2 條)的守門。
//
// 🔴🔴 **先講這一族【證不了】什麼,免得它被讀成「A4 驗過了」:**
//    這裡全部是**檔案字面**與**掛勾對得上**的檢查。**紙上長什麼樣,一個字都沒有量。**
//    A4 尺寸對不對、12mm 邊距實際印出來多寬、一列會不會被切成兩半 —— **未確認**,
//    要 Sean 用真印表機印一次才驗得掉(已排進他的清單)。
//    ⇒ 這一族的價值只有一個:**這些字面與掛勾【不會靜默消失】** ——
//      而它們消失的症狀是「紙印出來不是 A4」,三綠、build、其他單測**都不會紅**。
//
// 📎 為什麼不寫「`getComputedStyle` 量 `@page`」那種格:`@page` 讀不到 computed style,
//    而 jsdom 連 print media 都沒有。真要量得走真瀏覽器產 PDF —— 那是 Sean 那一關。

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const CSS = read('./print-a4.css');
// 🔴 **規則層要與註解層分開**:本檔的註解裡就寫著 `table-header-group`(解釋為什麼不搬它)
//    ⇒ 直接對全文 `not.toContain` 會被**自己的說明文字**弄紅。
//    📎 這不是我先想到的,是那一格當場紅給我看的 —— 同族坑見
//       `docs/patterns/guard-and-instrument-traps.md`「偵測字串自命中」。
const CSS_RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const LAYOUT = read('./layout.tsx');
const SHIPPING = read('../../components/print/shipping-doc.tsx');
const PICKING = read('../../components/print/picking-doc.tsx');
const GLOBALS = read('../globals.css');

describe('A4 版面第 1 條 —— `@page` 逐字照 OD 樣張', () => {
  // 樣張 `shipping-picking-doc-a4.html:21` 逐字:`@page{ size:A4 portrait; margin:12mm 12mm 14mm 12mm; }`
  // 🔴 分開釘 `size` 與 `margin` 兩條,而不是比對整段字串 —— 整段比對會被「多一個空格」弄紅,
  //    那種紅不指向任何真問題,而**看過幾次假紅的人會開始改測試而不是改 code**。
  it('size = A4 portrait', () => {
    expect(CSS).toMatch(/@page\s*\{[^}]*\bsize:\s*A4 portrait;/);
  });

  it('margin 四個 mm 值與樣張一字不差(12 / 12 / 14 / 12)', () => {
    // ⚠️ 這格會抓到的是**打錯數字**與**刪掉 margin**;抓不到「印出來邊距其實不對」。
    expect(CSS).toMatch(/@page\s*\{[^}]*\bmargin:\s*12mm 12mm 14mm 12mm;/);
  });

  it('🔴 負向對照 —— `@page` 不得住進 `globals.css`(那會讓後台每一頁列印都變 A4)', () => {
    // `@page` 是頁面層 at-rule、**沒有選擇器可以侷限它** ⇒ 唯一的侷限手段就是「哪些路由載入它」。
    // 這一格同時證明上面兩格量的是**這支 route-scoped CSS**,不是碰巧全站都有。
    expect(GLOBALS).not.toContain('@page');
  });
});

describe('A4 版面第 2 條 —— 跨頁表格', () => {
  it('`tr` 有 break-inside / page-break-inside: avoid(樣張 `:130` 逐字)', () => {
    expect(CSS).toMatch(/\btr\s*\{[^}]*break-inside:\s*avoid;/);
    expect(CSS).toMatch(/\btr\s*\{[^}]*page-break-inside:\s*avoid;/);
  });

  it('🔴 刻意【沒有】搬 `thead{display:table-header-group}` —— 它等於 UA 預設', () => {
    // 這一格釘的是一個**刻意的不作為**,而不作為在檔案上看不出來。
    // 依據:`picking-doc.tsx`(錨點 `跨頁表頭:已實測會自動重複`)2026-08-15 真瀏覽器量測
    // 含負向對照(注入 `display:table-row-group !important` ⇒ 第 2 頁欄名整排消失)。
    // ⇒ 搬過來會是一條永遠不會失效的字面。有人「順手補齊樣張」時,這格會紅並把他帶去讀那段。
    expect(CSS_RULES).not.toContain('table-header-group');
    // 正向對照:證明上面那個 0 是「規則層真的沒有」,不是 `CSS_RULES` 被剝成空字串。
    expect(CSS_RULES).toContain('@page');
    expect(PICKING).toContain('跨頁表頭:已實測會自動重複');
  });
});

describe('🔴 掛勾對不上 = CSS 寫了等於沒寫', () => {
  it('`layout.tsx` 真的 import 了 `print-a4.css`', () => {
    // 這是本族**判別力最高**的一格:CSS 檔可以完美無缺而**沒有任何路由載入它**,
    // 而那個狀態下上面每一格都照樣綠。
    expect(LAYOUT).toContain("import './print-a4.css'");
  });

  it('兩張紙的容器都帶 `print-sheet`,而 CSS 裡真的有這個選擇器', () => {
    // workspace-shell 那族踩過的形狀:TSX 的 class 名與 CSS 選擇器對不上 ⇒ 兩邊各自看起來都對。
    expect(SHIPPING).toContain("'print-sheet mx-auto");
    expect(PICKING).toContain("'print-sheet mx-auto");
    expect(CSS).toMatch(/\.print-sheet\s*\{[^}]*padding:\s*0;/);
  });

  it('`print-sheet` 的歸零規則住在 `@media print` 裡(螢幕上的 `p-6` 要留著)', () => {
    // 掉出 @media print ⇒ 螢幕上那張紙會貼著視窗邊緣,而**列印結果一模一樣** ⇒ 沒人會回報。
    const printBlock = CSS.slice(CSS.indexOf('@media print'));
    expect(printBlock).toContain('.print-sheet');
    expect(CSS.slice(0, CSS.indexOf('@media print'))).not.toContain('.print-sheet');
  });
});
