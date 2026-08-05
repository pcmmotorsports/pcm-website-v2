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
const RAW: Record<string, string> = Object.fromEntries(FILES.map((f) => [f, read(f)]));

// 🔴 剝註解後才做斷言。本片的註解**大量引用 token 名與選擇器名**(坑寫在坑旁邊,刻意的),
//    直接對原文比對會命中註解裡那串字、而不是真的規則(brand-page.test.ts 實測踩過)。
const CSS: Record<string, string> = Object.fromEntries(
  FILES.map((f) => [f, RAW[f].replace(/\/\*[\s\S]*?\*\//g, '')]),
);

/**
 * 取某個選擇器的宣告區塊(到第一個 `}` 為止)。
 * 這四支檔的目標規則都是平的(區塊內無巢狀 `{`),所以「切到第一個 }」是對的;
 * 但那是**前提不是保證** —— 若哪天規則被搬進 @media 或巢狀語法,切出來的區塊會跨過內層 `{`
 * 而斷言仍舊「找得到 max-width」⇒ 假綠。故區塊內含 `{` 一律當作前提失效、直接紅。
 */
function block(file: string, selector: string): string {
  const i = CSS[file].indexOf(selector);
  expect(i, `${file} 找不到選擇器 ${selector}(被改名或刪了?)`).toBeGreaterThan(-1);
  const open = CSS[file].indexOf('{', i);
  const close = CSS[file].indexOf('}', open);
  expect(close, `${file} 的 ${selector} 區塊沒有閉合`).toBeGreaterThan(open);
  const body = CSS[file].slice(open + 1, close);
  expect(body, `${file} 的 ${selector} 區塊內出現巢狀 {(本守門的平規則前提已失效、切片邊界不可信)`)
    .not.toMatch(/\{/);
  return body;
}

describe('殼寬度守門 · 檔案本身沒壞', () => {
  it.each(FILES)('%s 的註解符號成對(未閉合的 /* 會讓瀏覽器吞掉後半個檔,而剝註解的守門照樣全綠)', (f) => {
    // 剝註解的正規式碰到未閉合的 `/*` 就從該處起不匹配 ⇒ 常數保留原文、其餘斷言照樣綠;
    // 但真瀏覽器會把 `/*` 之後直到檔尾全當註解 —— 包含規則本體。先確認檔案完整。
    expect(RAW[f].match(/\/\*/g)?.length ?? 0).toBe(RAW[f].match(/\*\//g)?.length ?? 0);
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
  it.each(EXPECTED)('%s = %s', (token, value) => {
    // 只看 :root 段(深色模式段獨立覆寫同名 token,值本來就不同、不該被這裡管)。
    const root = CSS['tokens.css'].slice(0, CSS['tokens.css'].indexOf('[data-theme="dark"]'));
    expect(root, `:root 段找不到 ${token}: ${value}`).toMatch(
      new RegExp(`${token}:\\s*${value};`),
    );
  });

  it('🔴 深色模式段未被本次波及(仍是自己那組值)', () => {
    const dark = CSS['tokens.css'].slice(CSS['tokens.css'].indexOf('[data-theme="dark"]'));
    expect(dark).toMatch(/--c-bg:\s*#0a0a0a/);
    expect(dark).toMatch(/--c-text:\s*#fafafa/);
    expect(dark).toMatch(/--c-text-3:\s*#8b8b94/);
  });
});
