import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A4 版面(Sean 2026-08-17 四條需求裡,本檔守的是**第 1、2、4 條**)的守門。
// ⚠️ 2026-08-17 更新:這一行原本寫「第 1、2 條」,而第 4 條(頁碼)已落地並在本檔有兩格。
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

// 🔴 **`PAGE_DECL` 而不是 `[^}]*`**(2026-08-17,code-reviewer R1 nit):
//    `@page` 現在**裡面有巢狀區塊**(第 4 條的 `@bottom-center`)⇒ `[^}]*` 跨不過它的結束大括號
//    ⇒ 有人多加一個邊距框、或把它往上搬(**合法且無害**),依賴順序的那些格就會紅,
//    **而那個紅不指向任何真問題**。假紅的代價不是浪費時間,
//    是「看過幾次假紅的人會開始改測試而不是改 code」。
//    ⇒ 這個 pattern 允許跨過**一層**巢狀區塊。
const PAGE_DECL = String.raw`@page\s*\{(?:[^{}]|\{[^{}]*\})*`;

describe('A4 版面第 1 條 —— `@page` 逐字照 OD 樣張', () => {
  // 樣張 `shipping-picking-doc-a4.html:21` 逐字:`@page{ size:A4 portrait; margin:12mm 12mm 14mm 12mm; }`
  // 🔴 分開釘 `size` 與 `margin` 兩條,而不是比對整段字串 —— 整段比對會被「多一個空格」弄紅,
  //    那種紅不指向任何真問題,而**看過幾次假紅的人會開始改測試而不是改 code**。
  it('size = A4 portrait', () => {
    expect(CSS).toMatch(new RegExp(PAGE_DECL + String.raw`\bsize:\s*A4 portrait;`));
  });

  it('margin 四個 mm 值與樣張一字不差(12 / 12 / 14 / 12)', () => {
    // ⚠️ 這格會抓到的是**打錯數字**與**刪掉 margin**;抓不到「印出來邊距其實不對」。
    // ⚠️ 而且它量的是**原始檔** —— 產物會被壓成三值(見下方第 4 條 describe 的 ② )。
    expect(CSS).toMatch(new RegExp(PAGE_DECL + String.raw`\bmargin:\s*12mm 12mm 14mm 12mm;`));
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

describe('A4 版面第 4 條 —— 頁碼(`@page` 邊距框)', () => {
  // 🔴 **這一族證不了紙上有沒有頁碼**(檔頭那段對本 describe 一樣適用)。
  //    它證的是唯一一件事:**這段字面不會靜默消失** ——
  //    消失的症狀是「印出來的紙沒有頁碼」,而三綠 / build / 其他單測**一格都不會紅**。
  // 🔴 **紙上到底印不印得出頁碼,目前【未確認】** —— 缺的那道檢查寫在 `print-a4.css`
  //    第 4 條那段註解裡:2026-08-17 Sean 是印過量具、回「一切正確」,
  //    **而量具要的是「照抄紙上那行字」,他給的是總評**;加上 Chrome 自己的頁尾選項
  //    有沒有關掉沒有紀錄 ⇒ **在「生效」與「Chrome 自己印的」兩個世界,那句話是同一句。**
  //    ⇒ 本 describe 更不能被讀成「頁碼驗過了」。它守的只有「字面不會靜默消失」。
  //
  // ── 🔴 落地當天量到、而下一個人會重踩的兩件(2026-08-17,`TURBO_FORCE=1 pnpm build` 之後)──
  //  ① **產物不在 `.next/static/css/`,那個目錄根本不存在** ⇒ 對它下 grep 會拿到 `0`,
  //     而那個 0 是**分母為 0**,不是「被剝掉了」。我當場就被這個 0 騙過一次,
  //     是**正向對照**(同一支 grep 找 `A4 portrait` 也回 0)把它揪出來的。
  //     ✅ 真正的位置:`apps/admin/.next/static/chunks/*.css`。
  //     實測該檔 `A4 portrait` / `bottom-center` / `counter(pages)` 各 1 命中,
  //     **負向對照**:同目錄另一支 chunk 三項全 0 ⇒ 命中不是「哪支都會中」。
  //  ② **產物與原始檔【不逐字相同】**:`margin:12mm 12mm 14mm 12mm` 被壓成
  //     **三值** `margin:12mm 12mm 14mm`(CSS shorthand 三值 = 上 / 左右 / 下,**等價**,不是錯)。
  //     ⇒ 拿本檔守的原始檔字面去 grep 產物會**撲空**。上面那些格量的是**原始檔**,那是刻意的。

  it('`@bottom-center` 在 `@page` 【區塊裡面】,且 content 用 counter(page)', () => {
    // 🔴 **「在裡面」是這一格的重點,不是順便**:`@bottom-center` 掉到 `@page` 外面
    //    是**無效 CSS ⇒ 被瀏覽器整段丟掉**,而檔案讀起來一模一樣、沒有任何東西會紅。
    //    ⇒ 下面這條 regex 的 `[^}]*` 就是在證明「兩者之間沒有結束大括號」。
    // ⚠️ 用 `CSS_RULES`(已剝註解)不用 `CSS`:本檔的註解裡就引了樣張那句
    //    `@bottom-right{content:counter(page)}` ⇒ 對全文比對會被**自己的說明文字**餵成綠的。
    // 🔴 **`content:` 這個 property 名要釘進 regex,不能只釘 `counter(page)`**
    //    —— 這一條是 code-reviewer R1 用突變打出來的,我原本的版本漏了它:
    //      · `content:` 打成 `contnet:`  ⇒ 舊版**全綠**,而紙上沒有頁碼
    //      · content 值拿掉引號(無效宣告被整條丟掉)⇒ 舊版**全綠**,紙上也沒有頁碼
    //    兩者都比「有人刪掉整塊」更可能真的發生,而我當初的突變(刪整塊)
    //    **打在這族最容易被抓到的那一發上** ⇒ 那個綠是量錯東西量出來的。
    expect(CSS_RULES).toMatch(
      new RegExp(PAGE_DECL + String.raw`@bottom-center\s*\{[^}]*content:\s*[^}]*counter\(page\)`),
    );
  });

  it('印的是「第 N 頁 / 共 M 頁」—— 兩個 counter 都在', () => {
    // 只有 `counter(page)` 而沒有 `counter(pages)` 時,紙上是「第 2 頁」而看不出總共幾頁
    // ⇒ **員工不知道自己手上這疊有沒有缺頁**,而那正是 Sean 要頁碼的理由。
    expect(CSS_RULES).toMatch(/@bottom-center\s*\{[^}]*content:\s*[^}]*counter\(pages\)/);
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
