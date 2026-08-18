// filter-drawer-width.test.ts — 「`.fd-drawer` 不得再出現 `width: 100vw`」守門。
//
// 🔴 病(2026-08-18 修掉的那個):`@media (max-width: 1079px)` 給 `.fd-drawer`
//    `left: 10px; right: 10px; width: auto` = 左右各留 10px 的浮動面板;
//    而檔案更後面另有一條 `@media (max-width: 640px) { .fd-drawer { width: 100vw; } }`
//    ⇒ 同特異度、在後面 ⇒ 蓋掉 `width: auto` ⇒ 盒子從 left:10 起算、寬 100vw
//    ⇒ 右緣掉在畫面外 10px(390 實測:left 10 / right 400 / width 390)。
//
// 🔴 **為什麼要用「讀 CSS 字面」這種守門**:這個 bug 對既有的每一道檢查都是隱形的 ——
//    `.fd-drawer` 是 `position: fixed`(不參與 document 溢出、不產生橫捲軸)、
//    `FilterDrawer.tsx:152` 開啟時還把 body overflow 設成 hidden、
//    而 typecheck / lint / build / 8685 格 vitest 全綠。**沒有人會紅。**
//    唯一抓得到它的是「在真瀏覽器上量每個元素的 rect」,那不在 CI 裡。
//
// ⚠️ **本檔守的是「別再被寫回來」,不是「版面現在是對的」** —— 後者要真瀏覽器量。
// ⚠️ **射程**:真手機走 `[data-mobile="true"] .fd-drawer`(特異度較高、本來就 width:auto)
//    ⇒ 舊 bug 只咬「桌機 UA 縮到 ≤640」那條路。本守門一併涵蓋兩條。
// 📎 `design-reference/styles/filter-drawer.css` 至今仍有互相打架的那兩條(`:28-40` / `:257-260`)
//    ⇒ 日後照鐵則 1 重搬這支檔的人會把它搬回來,**這一格就是攔他的**。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/** 剝掉註解再比對 —— 否則上面那段說明文字自己就會命中(偵測字串自命中)。 */
const read = (f: string) => readFileSync(resolve(HERE, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('FilterDrawer 面板寬度', () => {
  it('🔴 `.fd-drawer` 的任何一條規則都不得含 `width: 100vw`', () => {
    const css = read('filter-drawer.css');
    const offenders = [...css.matchAll(/\.fd-drawer[^{]*\{[^}]*\}/g)]
      .map((m) => m[0])
      .filter((rule) => /(^|[^-])width:\s*100vw/.test(rule));
    expect(
      offenders,
      '`width: 100vw` 會蓋掉 1079 那塊的 `width: auto`,而該塊同時設了 left/right ⇒ 面板右緣掉出畫面',
    ).toEqual([]);
  });

  it('🔴 正向對照:1079 那塊仍然同時給 left / right / width:auto(前提還在)', () => {
    const css = read('filter-drawer.css');
    const block = /@media\s*\(max-width:\s*1079px\)\s*\{[\s\S]*?\n\}/.exec(css)?.[0];
    expect(block, '找不到 1079 那塊 ⇒ 本檔前提失效,不是通過').toBeTruthy();
    expect(block).toMatch(/left:\s*10px/);
    expect(block).toMatch(/right:\s*10px/);
    expect(block).toMatch(/width:\s*auto/);
  });

  it('🔴 `[data-mobile="true"]` 那條(真手機走的)也必須是 width:auto', () => {
    const css = read('filter-drawer.css');
    const rule = /\[data-mobile="true"\]\s*\.fd-drawer\s*\{[^}]*\}/.exec(css)?.[0];
    expect(rule, '找不到 [data-mobile] 規則 ⇒ 真手機那條路的前提失效').toBeTruthy();
    expect(rule).toMatch(/width:\s*auto/);
    expect(rule).not.toMatch(/(^|[^-])width:\s*100vw/);
  });
});
