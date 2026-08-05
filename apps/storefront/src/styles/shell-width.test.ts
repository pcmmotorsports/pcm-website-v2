// shell-width.test.ts — 殼寬度規範與中性色票的文字層守門(全站重設計 第0批 0a;2026-08-05)
//
// 對齊 `styles/brand-page.test.ts` / `styles/products-mobile.test.ts` 的既有慣例:
// 版寬與 token 值只在特定視窗寬度下才看得見,jsdom 不套 media query、也不做 cascade,
// 元件測試對這兩件事一律綠。這支直接讀 CSS 原文斷言。
//
// 🔴 這支擋的是一個**兩面**的不變量,不是一條規則:
//    設計端 R2-1(Sean 2026-08-05 拍板)只把**殼三件套**(頁首 / 選車列 / 頁尾)收成 1440 置中,
//    **商品列表主體維持拉滿**。兩邊吃的是不同的 token(--shell-bar-max vs --shell-max)。
//    最可能的壞法不是「忘了改」,而是後面某一片**順手統一**成同一顆 —— 那會讓 1440 寬的
//    螢幕上列表主體無故縮水,而且只有把瀏覽器拉寬才看得出來。
//    ⇒ 正面(殼=1440)與反面(主體=拉滿)都要釘,只釘一面的話「全部統一成 1440」照樣全綠。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(HERE, f), 'utf8');

const FILES = ['tokens.css', 'header.css', 'filter-cascade.css', 'products-page.css'] as const;
// 🔴 型別寫成**字面聯集鍵**不是 `Record<string, string>`:本 repo 開了 `noUncheckedIndexedAccess`
//    (`tsconfig.base.json:14`),索引簽章取值一律是 `string | undefined` ⇒ 後面每個 `.indexOf`
//    都是 TS 錯。0a 初版(`f8e2d2f`)寫成 `Record<string, string>`,**該 commit 的 typecheck 實際是紅的
//    (11 個 TS2532)** —— 當時回報成「18 tasks 全過」是錯的,在此更正。字面聯集鍵沒有這個問題。
type CssFile = (typeof FILES)[number];
const RAW = Object.fromEntries(FILES.map((f) => [f, read(f)])) as Record<CssFile, string>;

// 🔴 剝註解後才做斷言。本片的註解**大量引用 token 名與選擇器名**(坑寫在坑旁邊,刻意的),
//    直接對原文比對會命中註解裡那串字、而不是真的規則(brand-page.test.ts 實測踩過)。
const CSS = Object.fromEntries(
  FILES.map((f) => [f, RAW[f].replace(/\/\*[\s\S]*?\*\//g, '')]),
) as Record<CssFile, string>;

/**
 * 去掉所有**帶區塊的 at-rule**(`@media` / `@supports` / `@container` / `@layer` / `@keyframes` …),
 * 只留最外層、全斷點無條件生效的規則。用大括號走訪器記深度,不用 `[^}]*`
 * —— at-rule 區塊內一定有內層 `{`,正規式切法會停在第一條規則的 `}`。
 *
 * 🔴 為什麼需要它(0a 補審 R1 Important #3):`block()` 原本直接對整份 CSS 做 `indexOf(selector)`,
 *    取的是**第一次出現**。真正會假綠的變體是「`max-width: var(--shell-bar-max)` 那行**連同規則**
 *    被搬進某個 `@media`」—— `indexOf` 命中 media 內那條平規則,巢狀 `{` 那道前提斷言不觸發、
 *    正面斷言照樣全綠,而事實是只有那個斷點才收 1440。⇒ 切片來源先收斂成最外層,逃逸就不存在。
 *    (⚠️ 註:單純「刪掉最外層那條、只剩 `header.css` media 裡那條 `padding` 規則」pre-fix 也會紅,
 *     那不是這個洞的例子 —— 本片複審實測更正,不要再照舊字面寫。)
 *
 * 🔴 不只剝 `@media`:`products-page.css:189,192` 現成就有兩個 `@keyframes`。今天它們裡面沒有
 *    目標選擇器所以沒造成假綠,但「只剝我當下想得到的那一種 at-rule」正是下次復發的形狀。
 *
 * 已知邊界:深度計數對**字串內的大括號**沒有防護(`content: "}"` 會讓計數提早歸零)。
 * 那個前提由下面「四支檔內沒有含大括號的字串」那條斷言釘住,不是靠祈禱。
 */
function topLevel(file: CssFile): string {
  const src = CSS[file];
  let out = '';
  let i = 0;
  for (;;) {
    const at = src.indexOf('@', i);
    if (at === -1) return out + src.slice(i);
    out += src.slice(i, at);
    const open = src.indexOf('{', at);
    const semi = src.indexOf(';', at);
    // 無區塊的 at-rule(`@import url(...);` / `@charset "utf-8";`):吃到 `;` 為止。
    if (open === -1 || (semi !== -1 && semi < open)) {
      if (semi === -1) return out;
      i = semi + 1;
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    // 未閉合 ⇒ 丟掉其後全文 ⇒ 選擇器找不到 ⇒ 紅在 block() 的前提斷言(fail-closed 方向)。
    if (end === -1) return out;
    i = end + 1;
  }
}

/**
 * 取某個**最外層**選擇器的宣告區塊(到第一個 `}` 為止)。
 * 這四支檔的目標規則都是平的(區塊內無巢狀 `{`),所以「切到第一個 }」是對的;
 * 但那是**前提不是保證** —— 若哪天規則改用巢狀語法,切出來的區塊會跨過內層 `{`
 * 而斷言仍舊「找得到 max-width」⇒ 假綠。故區塊內含 `{` 一律當作前提失效、直接紅。
 */
function block(file: CssFile, selector: string): string {
  const src = topLevel(file);
  const i = src.indexOf(selector);
  expect(i, `${file} 的最外層找不到選擇器 ${selector}(被改名、刪了、或被搬進某個 at-rule?)`)
    .toBeGreaterThan(-1);
  const open = src.indexOf('{', i);
  // 🔴 沒有這道的話:選擇器命中但其後無 `{` ⇒ open = -1 ⇒ `indexOf('}', -1)` 從 0 起搜、
  //    `close > open` 恆真 ⇒ 切出來的是**檔頭到第一個 `}`**,與目標規則完全無關。
  //    (nit #7 只補了 darkAt 那一處,這是同族的另一處 —— 只補手碰過的行的形狀。)
  expect(open, `${file} 的 ${selector} 之後沒有 {`).toBeGreaterThan(i);
  const close = src.indexOf('}', open);
  expect(close, `${file} 的 ${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  const body = src.slice(open + 1, close);
  expect(body, `${file} 的 ${selector} 區塊內出現巢狀 {(本守門的平規則前提已失效、切片邊界不可信)`)
    .not.toMatch(/\{/);
  return body;
}

describe('殼寬度守門 · 檔案本身沒壞', () => {
  it.each(FILES)('%s 的註解符號成對且順序正確(未閉合的 /* 會讓瀏覽器吞掉後半個檔,而剝註解的守門照樣全綠)', (f) => {
    // 剝註解的正規式碰到未閉合的 `/*` 就從該處起不匹配 ⇒ 常數保留原文、其餘斷言照樣綠;
    // 但真瀏覽器會把 `/*` 之後直到檔尾全當註解 —— 包含規則本體。先確認檔案完整。
    //
    // 🔴 0a 補審 nit #5:只比**數量**的話「錯位平衡」會漏 —— `*/ … /*` 這種先閉後開的排法
    //    數量一樣是 1:1,但真瀏覽器眼中是「檔尾有一段沒閉合的註解」。故改成掃一遍記狀態:
    //    每個 `*/` 前面必須有一個還沒閉的 `/*`,掃完不得還開著。
    const src = RAW[f];
    let open = false;
    for (let i = 0; i < src.length - 1; i++) {
      if (!open && src[i] === '/' && src[i + 1] === '*') { open = true; i++; }
      else if (src[i] === '*' && src[i + 1] === '/') {
        expect(open, `${f} 在位置 ${i} 出現沒有對應 /* 的 */(錯位平衡,數量比對看不出來)`).toBe(true);
        open = false;
        i++;
      }
    }
    expect(open, `${f} 檔尾還有一個沒閉合的 /*(其後的規則全被瀏覽器當註解吞掉)`).toBe(false);
    // 已知偏差(可接受、方向安全):`content: "*/"` 這種字串裡的註解符號會被誤判成 ORPHAN ⇒ **假紅**。
    // 四支檔目前無此字串,而假紅會被人看到、假綠不會。
  });

  // 🔴 `topLevel()` / `block()` 的大括號走訪器**對字串內的 `{` `}` 沒有防護** —— 一個
  //    `content: "}"` 就能讓深度提早歸零、把 at-rule 的後半段洩回「最外層」文本 ⇒ 那個方向是**假綠**。
  //    走訪器不去解析字串(那等於自己寫一個 CSS parser),改成把「不存在這種字串」釘成明文前提:
  //    哪天真有人寫了,這條當場紅、下一個人才會知道走訪器的地基變了。
  it.each(FILES)('%s 前提 — 檔內沒有含大括號的字串(走訪器的深度計數會被它騙成假綠)', (f) => {
    const strings = CSS[f].match(/"[^"\n]*"|'[^'\n]*'/g) ?? [];
    expect(
      strings.filter((s) => /[{}]/.test(s)),
      `${f} 出現含大括號的字串 ⇒ topLevel()/block() 的深度計數不再可信`,
    ).toEqual([]);
  });
});

describe('R2-1 版寬規範 · 殼收 1440 / 主體拉滿(兩面都要釘)', () => {
  it('🔴 --shell-bar-max 定義為 1440px,且 --shell-max 仍是 none(兩顆並存、不是取代)', () => {
    expect(CSS['tokens.css']).toMatch(/--shell-bar-max:\s*1440px/);
    // 反面:主體那顆若被「順手」改成 1440,列表就跟著縮了 —— 而所有吃 --shell-bar-max 的斷言全綠。
    expect(CSS['tokens.css'], '--shell-max 被改值 ⇒ 商品列表主體不再拉滿').toMatch(/--shell-max:\s*none/);
  });

  it('🔴 殼三件套之一:頁首 .pcm-header-inner 吃 --shell-bar-max', () => {
    expect(block('header.css', '.pcm-header-inner')).toMatch(/max-width:\s*var\(--shell-bar-max\)/);
  });

  it('🔴 殼三件套之一:選車列 .cft-inner 吃 --shell-bar-max', () => {
    expect(block('filter-cascade.css', '.cft-inner')).toMatch(/max-width:\s*var\(--shell-bar-max\)/);
  });

  it('🔴 反面 — 商品列表主體 .pp-layout 仍吃 --shell-max 拉滿,不得被統一成殼寬', () => {
    // 設計端 products-list-handoff R2-1 逐字:「商品列表主體(側欄+格線)= 維持拉滿,不設上限」。
    // 這條是上面三條的反面;沒有它,「全站統一成 --shell-bar-max」會是一次全綠的迴歸。
    const body = block('products-page.css', '.pp-layout');
    expect(body, '.pp-layout 被改吃殼寬 ⇒ 1440 以上螢幕列表主體無故縮水').toMatch(
      /max-width:\s*var\(--shell-max\)/,
    );
    expect(body).not.toMatch(/--shell-bar-max/);
  });

  // 🔴 上面那條的守門面**比不變量窄**(0a 補審複審 must-fix M-1)。
  //    不變量是「整個商品列表頁的主體不設寬度上限」,而那條只切 `.pp-layout` 那一塊。
  //    實測會漏的兩種寫法:①在 `.pp-layout.has-side`(`products-page.css:8`,更高權重)加
  //    `max-width: var(--shell-bar-max)` ②在檔尾追加第二條 `.pp-layout { … bar-max }`(同權重、序在後)。
  //    兩者 cascade 都贏、1440+ 列表真的縮水,而上面四條斷言全綠。
  //    ⇒ 反面守門要畫在「這支檔的任何一處都不得出現殼寬 token」這個**面**上。
  //    (實查:`products-page.css` 現況 `--shell-bar-max` 出現 0 次,加這條不會誤紅。)
  it('🔴 反面(面層)— products-page.css 整支檔任何一處都不得出現 --shell-bar-max', () => {
    expect(
      CSS['products-page.css'],
      '列表頁 CSS 出現殼寬 token ⇒ 不管掛在哪個選擇器上,主體都可能被收窄',
    ).not.toMatch(/--shell-bar-max/);
  });
});

describe('R2-2 中性色八顆已換成首頁新語言值', () => {
  // 逐顆釘值:改常數不會讓既有測試轉紅(期望值不符才會紅、前提消失不會),
  // 所以這八顆若被誰改回舊值或再漂一次,只有這裡看得見。
  const EXPECTED: Array<[string, string]> = [
    ['--c-bg', '#ffffff'],
    ['--c-surface', '#ffffff'],
    ['--c-surface-2', '#f3f3f4'],
    ['--c-surface-3', '#e9e9eb'],
    ['--c-border', '#e5e5e7'],
    ['--c-border-strong', '#d3d4d6'],
    ['--c-text', '#121214'],
    ['--c-text-2', '#52545a'],
    ['--c-text-3', '#6e6e73'],
    ['--c-text-inverse', '#ffffff'],
  ];
  // 🔴 0a 補審 nit #7:`indexOf` 查無會回 -1,`slice(0, -1)` 是「整檔少最後一字」、
  //    `slice(-1)` 是「只有最後一字」—— 兩邊都不會報錯,而 :root/深色 兩段的區分等於失效。
  //    深色段選擇器哪天改名(或深色模式整段被拿掉),要當場紅在這裡、不是靜默換一個意思。
  const darkAt = () => {
    const i = CSS['tokens.css'].indexOf('[data-theme="dark"]');
    expect(i, 'tokens.css 找不到 [data-theme="dark"] ⇒ :root 段與深色段的切點不存在,本組斷言的前提已失效')
      .toBeGreaterThan(-1);
    return i;
  };

  it.each(EXPECTED)('%s = %s', (token, value) => {
    // 只看 :root 段(深色模式段獨立覆寫同名 token,值本來就不同、不該被這裡管)。
    const root = CSS['tokens.css'].slice(0, darkAt());
    expect(root, `:root 段找不到 ${token}: ${value}`).toMatch(
      new RegExp(`${token}:\\s*${value};`),
    );
  });

  it('🔴 深色模式段未被本次波及(仍是自己那組值)', () => {
    const dark = CSS['tokens.css'].slice(darkAt());
    expect(dark).toMatch(/--c-bg:\s*#0a0a0a/);
    expect(dark).toMatch(/--c-text:\s*#fafafa/);
    expect(dark).toMatch(/--c-text-3:\s*#8b8b94/);
  });
});
