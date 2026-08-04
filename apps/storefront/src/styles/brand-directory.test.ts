// brand-directory.test.ts — `/brands` 總覽頁 CSS 的文字層守門(D3c-3;2026-08-05)
//
// 沿用 `brand-page.test.ts` / `home.test.ts` 的既有慣例:jsdom 不套 media query、也不算
// CSS 權重 ⇒ 元件測試對這一族恆綠。這支直接讀 CSS 原文斷言。
//
// ⚠️ **它擋不住什麼**:看得到「規則在不在、形狀對不對、順序對不對」,看不到 cascade 的
//    實際勝負(D3b/D3c-1 三個真視覺缺陷全都是文字守門放行、真瀏覽器才抓到的)。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RAW = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'brand-directory.css'), 'utf8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/** 依大括號配對切出每一條規則(含它在哪個 @media 裡、以及原文順序)。 */
type Rule = { selector: string; body: string; at: string[]; index: number };
function cssRules(): Rule[] {
  const out: Rule[] = [];
  const stack: string[] = [];
  let i = 0;
  let buf = '';
  while (i < CSS.length) {
    const ch = CSS[i];
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      if (prelude.startsWith('@')) { stack.push(prelude); i++; continue; }
      let depth = 1;
      let j = i + 1;
      while (j < CSS.length && depth > 0) {
        if (CSS[j] === '{') depth++;
        else if (CSS[j] === '}') depth--;
        j++;
      }
      out.push({
        selector: prelude.replace(/\s+/g, ' ').replace(/,\s*/g, ', '),
        body: CSS.slice(i + 1, j - 1),
        at: [...stack],
        index: out.length,
      });
      i = j;
      continue;
    }
    if (ch === '}') { stack.pop(); buf = ''; i++; continue; }
    buf += ch;
    i++;
  }
  return out;
}
const rules = cssRules();

describe('品牌總覽 CSS · 檔案本身', () => {
  it('🔴 註解符號成對(未閉合的 /* 會讓瀏覽器吞掉後半個檔,而剝註解的守門照樣全綠)', () => {
    const open = RAW.match(/\/\*/g)?.length ?? 0;
    const close = RAW.match(/\*\//g)?.length ?? 0;
    expect(open, `/* 有 ${open} 個、*/ 有 ${close} 個`).toBe(close);
    expect(open).toBeGreaterThan(0);
  });

  // 🔴 這條是 `brand-page.test.ts` 那個實錘的複製:剝註解的正規式碰到 `**products**/` 這種
  //    「內文自帶 */」會提早收掉註解,於是剝完仍留著大量中文說明 —— 而所有結構斷言照樣綠。
  it('🔴 剝完註解後不該還留著中文(留著 = 有個註解提早閉合了)', () => {
    expect(CSS.match(/[一-鿿]/g) ?? [], '剝註解後仍有中文 ⇒ 某個 /* 被內文的 */ 提早收掉').toEqual([]);
  });

  it('🔴 色票 scope 在 `.bd-page`、檔內零 `:root`(進 :root 會改到正式站每一頁)', () => {
    expect(CSS, '本檔出現 :root ⇒ 色票外洩到全站').not.toMatch(/:root/);
    const scope = rules.filter((r) => r.selector === '.bd-page' && r.at.length === 0);
    expect(scope, '找不到 .bd-page 色票區').toHaveLength(1);
    expect(scope[0]!.body).toMatch(/--bd-ember\s*:/);
    expect(scope[0]!.body).toMatch(/--bd-graphite\s*:/);
  });

  // 🔴 關卡2 R2 must-fix C:R1 補的兩條「站台沒有、設計稿靠全域 reset」的修法**自己零守門**
  //    —— 刪掉整條、10/10 全綠。而這兩條正是我自己認證過「欄數/卡高/overflowX 全看不到」的。
  it('🔴 `.bd-grid` 自帶 `ul` reset(storefront 全樹沒有 ul reset,少了就吃 UA 的 40px 縮排)', () => {
    const grid = rules.filter((r) => r.selector === '.bd-grid' && r.at.length === 0);
    expect(grid, '找不到 .bd-grid 基礎規則').toHaveLength(1);
    const body = grid[0]!.body;
    // 實測沒補時:padding-inline-start 40px、margin-block 16px、list-style disc
    expect(body, 'padding 沒歸零 ⇒ 整片格子右移 40px').toMatch(/padding\s*:\s*0/);
    expect(body, 'margin 沒歸零 ⇒ 上下多 1em').toMatch(/margin\s*:\s*0/);
    expect(body, 'list-style 沒關 ⇒ 每張卡前面冒一顆圓點').toMatch(/list-style\s*:\s*none/);
  });

  it('🔴 焦點環有補、而且 scope 在 `.bd-page` 內(設計稿是全域,storefront 沒有)', () => {
    const focus = rules.filter((r) => r.selector.includes(':focus-visible') && r.selector.includes('.bd-page'));
    expect(focus, '找不到 .bd-page 內的 :focus-visible ⇒ 鍵盤焦點環退回瀏覽器預設').toHaveLength(1);
    expect(focus[0]!.body).toMatch(/outline\s*:\s*2px solid var\(--bd-ember-ink\)/);
    expect(focus[0]!.body).toMatch(/outline-offset\s*:\s*3px/);
  });

  // 🔴 設計稿那些**極通用**的裸 class(`.grid` / `.brand` / `.wrap` …)一律加了 `bd-` 前綴。
  //    退回裸名的話,`/brands` 之外的頁面不會壞、但下一個人在別處加同名 class 時會踩到
  //    一組只在這頁載入的規則 —— 兩邊都不會紅。
  it('🔴 沒有裸的通用 class(全部都在 `bd-` 前綴底下)', () => {
    // 🔴 比對形狀 = 「`.name` 後面不再接 `-` 或字母數字」,**不要求它是複合選擇器的開頭**
    //    (關卡2 R1 nit:第一版寫 `(^|[\s>+~])` 起頭 ⇒ `ul.grid` / `li.brand` 這種
    //    「元素 + 裸 class」整族漏抓)。`.bd-grid` 不會被誤抓:它裡面沒有 `.grid` 這個片段。
    const BARE = ['grid', 'brand', 'wrap', 'eyebrow', 'outro', 'directory', 'intro'];
    for (const r of rules) {
      for (const bare of BARE) {
        expect(
          new RegExp(`\\.${bare}(?![-\\w])`).test(r.selector),
          `${r.selector} 用了裸 .${bare} ⇒ 全域 stylesheet 的命名地雷`,
        ).toBe(false);
      }
    }
  });
});

describe('品牌總覽 CSS · 版面', () => {
  // 🔴 `at` 比**整條 at-rule**、不是子字串(關卡2 R1 nit:`includes('900')` 日後會被
  //    `1900px` / `2900px` 之類誤命中,而那正是「量到別條規則卻全綠」的形狀)。
  const colsOf = (selector: string, maxWidth: number | null) =>
    rules.filter(
      (r) => r.selector === selector
        && (maxWidth === null
          ? r.at.length === 0
          : r.at.some((a) => a.replace(/\s+/g, '') === `@media(max-width:${maxWidth}px)`))
        && /grid-template-columns/.test(r.body),
    );

  // 🔴 家數與欄數是綁在一起的(設計稿 :66-67:20 要能被欄數整除,否則最後一排缺角)。
  it('🔴 hero 牆的三個欄數 = 10 / 5 / 4,格子的三個 = 5 / 4 / 2', () => {
    const pick = (rs: Rule[]) => rs[0]?.body.match(/repeat\((\d+)|:\s*(1fr 1fr)/)?.slice(1).find(Boolean);
    expect(pick(colsOf('.bd-hero-wall', null)), 'hero 牆基礎欄數').toBe('10');
    expect(pick(colsOf('.bd-hero-wall', 1100)), '≤1100 的牆欄數').toBe('5');
    expect(pick(colsOf('.bd-hero-wall', 900)), '≤900 的牆欄數').toBe('4');
    expect(pick(colsOf('.bd-grid', null)), '格子基礎欄數').toBe('5');
    expect(pick(colsOf('.bd-grid', 1200)), '≤1200 的格子欄數').toBe('4');
    expect(pick(colsOf('.bd-grid', 700)), '≤700 的格子欄數').toBe('1fr 1fr');
  });

  // 🔴 **順序就是行為**:兩條 `max-width` 的牆欄數同權重 ⇒ 靠順序決勝。
  //    900 若排在 1100 前面,手機上會被 1100 的 5 欄蓋回去 —— 而規則「都在檔案裡」、
  //    上面那條逐塊比對的斷言**照樣全綠**。
  it('🔴 ≤900 的牆規則排在 ≤1100 之後(排反了手機會吃到 5 欄)', () => {
    const at1100 = colsOf('.bd-hero-wall', 1100)[0]!.index;
    const at900 = colsOf('.bd-hero-wall', 900)[0]!.index;
    expect(at900 > at1100, `≤900(第 ${at900} 條)必須在 ≤1100(第 ${at1100} 條)之後`).toBe(true);
  });

  it('🔴 ≤700 的格子規則排在 ≤1200 之後(同上,排反了手機會吃到 4 欄)', () => {
    expect(colsOf('.bd-grid', 700)[0]!.index > colsOf('.bd-grid', 1200)[0]!.index).toBe(true);
  });
});

describe('品牌總覽 CSS · 泛白狀態', () => {
  const empties = rules.filter((r) => r.selector.includes('.is-empty'));

  it('🔴 `.is-empty` 五條都在(整段刪掉的話語意仍不可點、但看起來與可點卡一模一樣)', () => {
    expect(empties.length, '.is-empty 規則數').toBe(5);
    const body = empties.map((r) => r.body).join(' ');
    expect(body, 'logo 沒有去飽和').toMatch(/filter\s*:\s*grayscale\(1\)/);
    expect(body, 'logo 沒有轉淡').toMatch(/opacity\s*:\s*\.55/);
    expect(body, '兩個入口的字沒有轉淡').toMatch(/color\s*:\s*var\(--bd-mute\)/);
    expect(body, '編號國別那列沒有轉淡').toMatch(/opacity\s*:\s*\.6/);
    expect(body, '游標沒改').toMatch(/cursor\s*:\s*default/);
    expect(body, '熔橘頂線沒關掉 ⇒ 泛白卡 hover 仍會有「可以點」的回饋').toMatch(/content\s*:\s*none/);
  });

  // 🔴 D3c-1 兩次翻車的形狀:同階靠順序 ⇒ 有人搬動規則就反轉。本檔一律寫成
  //    「同前綴 + 多一個 class」(`.bd-brand.is-empty …`),嚴格更高、與順序無關。
  it('🔴 每一段選擇器都以 `.bd-brand.is-empty` 起頭(嚴格更高,不靠順序)', () => {
    for (const r of empties) {
      for (const part of r.selector.split(',').map((s) => s.trim())) {
        expect(part.startsWith('.bd-brand.is-empty'), `${part} 前綴不對 ⇒ 勝負會變成靠順序`).toBe(true);
      }
    }
  });

  // 🔴🔴 **本檔最重要的一條**(關卡2 R2 must-fix A/B):泛白卡的兩格是 `<span>`,
  //    裸 `:hover` / `:focus-visible` 對它照樣命中 ⇒ 滑過一張不可點的卡會翻白 =
  //    給了「可以點」的回饋(真瀏覽器實測 transparent → rgb(255,255,255))。
  //    綁到 `a` 之後泛白卡根本不進那些規則 —— 這比「再寫一條 `.is-empty` 覆寫」穩,
  //    因為覆寫要贏權重也要贏順序,而綁型別是**結構上不可能命中**。
  //    ⚠️ 擋不住什麼:只認選擇器字面有沒有綁 `a`;有人改成 `article:hover` 之類仍會過。
  it('🔴 每一條 hover / focus-visible 都綁在 `a` 上(泛白卡是 `<span>`,不綁就會吃到)', () => {
    const interactive = rules.filter((r) => /:hover|:focus-visible/.test(r.selector));
    expect(interactive.length, '一條互動規則都沒有 ⇒ 這條守門恆真').toBeGreaterThanOrEqual(4);
    for (const r of interactive) {
      for (const part of r.selector.split(',').map((s) => s.trim())) {
        expect(
          /(^|[\s>+~(])a[.:[]/.test(part) || part.includes(':has(a:hover)') || part.startsWith('.bd-page :focus-visible'),
          `${part} 的 hover/focus 沒綁 a ⇒ 泛白卡的 <span> 也會命中`,
        ).toBe(true);
      }
    }
  });

  it('🔴 `.bd-sr-only` 是「看不見但唸得到」,而且全檔只有一條(避免被更具體的覆寫掀開)', () => {
    const all = rules.filter((r) => r.selector.includes('.bd-sr-only'));
    expect(all, '碰到 .bd-sr-only 的規則不只一條').toHaveLength(1);
    const body = all[0]!.body;
    expect(body, 'display:none / visibility:hidden 會讓報讀器一起看不到 = 完全沒效果')
      .not.toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
    expect(body).toMatch(/position\s*:\s*absolute/);
    expect(body).toMatch(/clip-path\s*:\s*inset\(50%\)/);
  });
});
