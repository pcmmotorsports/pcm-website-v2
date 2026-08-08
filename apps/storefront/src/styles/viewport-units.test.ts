// viewport-units.test.ts — 「手機看得到的整頁容器不得用 100vh」守門。
//
// 🔴 機制:iOS Safari 的 `100vh` 是 **large viewport**(工具列收起時的高度)。工具列露出時
//    它比看得見的區域還高 ⇒ 整頁容器在頁尾之後撐出一段**捲得到、卻什麼都沒有**的空白,
//    固定在底部的 TabBar 就會看起來「浮在白區上面、沒貼住視窗底」
//    (Sean 2026-08-09 手機實測回報 D-310-A Bug 1 的症狀)。`100svh` 取 small viewport,不會多撐。
//
// ⚠️ **誠實邊界**:本片沒有 iOS 裝置可驗(Chromium 的 vh==svh、量不出差別)⇒ svh 是**候選修法**,
//    可反駁預測寫在 D-314-STOP。本檔守的是「已經換過去的別被換回來」,不是「這樣就修好了」。
//
// 例外:`filter-side.css` 的 `.fs-side` 用 `calc(100vh - …)` **刻意保留** ——
//    它在 ≤1023 是 `display: none`(`filter-responsive.css` / `products-page.css` 三處),
//    是桌機側欄,手機根本不渲染,vh 在那裡是對的。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f: string) => readFileSync(resolve(HERE, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** 手機也看得到的「整頁容器」— 換過 svh 的那批。 */
const PAGE_WRAPPERS: { file: string; sel: string }[] = [
  { file: 'auth.css', sel: '.ap-page' },
  { file: 'auth.css', sel: '.auth-main' },
  { file: 'checkout.css', sel: '.co-page' },
  { file: 'error.css', sel: '.err-page' },
  { file: 'coming-soon.css', sel: '.cs-page' },
];

describe('整頁容器的視窗高度單位(iOS 工具列)', () => {
  it.each(PAGE_WRAPPERS)('🔴 $file 的 $sel 用 svh、不用 vh', ({ file, sel }) => {
    const css = read(file);
    const rule = new RegExp(`\\${sel}\\s*\\{[^}]*\\}`).exec(css)?.[0];
    expect(rule, `找不到 ${sel} 的規則 ⇒ 本條前提失效(選擇器被改名?)`).toBeTruthy();
    expect(rule, `${sel} 有 min-height 卻不是 svh`).toMatch(/min-height:\s*(calc\()?100svh/);
    expect(rule, `${sel} 用回 100vh ⇒ iOS 工具列露出時頁尾之後會多出一段空白`).not.toMatch(/100vh/);
  });

  it('🔴 這五支樣式檔裡不得再出現 min-height: 100vh(含 calc)', () => {
    const offenders: string[] = [];
    for (const f of ['auth.css', 'checkout.css', 'error.css', 'coming-soon.css', 'account.css']) {
      for (const m of read(f).matchAll(/min-height:\s*(?:calc\()?100vh/g)) {
        offenders.push(`${f} @${m.index}`);
      }
    }
    expect(offenders, `還有 min-height:100vh:${offenders.join(', ')}`).toEqual([]);
  });

  it('🔴 桌機側欄的 vh **刻意保留**(它在手機是 display:none,不是漏改)', () => {
    // 這條是反向的:如果有人「順手」把 fs-side 也改成 svh,代表他沒讀懂例外、
    // 也代表下一個人會以為手機上有這個側欄。
    const side = read('filter-side.css');
    // 🔴 這裡原本寫成「檔案裡存在某條 height: calc(100vh」= **存在性斷言、零判別力**:
    //    該檔有兩條(`.fs-side` 與 cascade 變體),改掉其中一條另一條照樣讓它綠。
    //    突變 M3(把第一條改成 svh)當場證明它殺不死 ⇒ 改成「整份檔案不得出現 svh」。
    expect(side, '.fs-side 的高度被改成 svh ⇒ 它是桌機側欄、手機 display:none,不該跟著改')
      .not.toMatch(/svh/);
    const vhCount = [...side.matchAll(/height:\s*calc\(100vh/g)].length;
    expect(vhCount, `.fs-side 家族的 calc(100vh 高度剩 ${vhCount} 條(預期 2:基礎 + cascade 變體)`).toBe(2);
    const hidden = read('filter-responsive.css');
    expect(hidden, '.fs-side 不再是手機隱藏 ⇒ 上一條的例外理由失效,要重新評估').toMatch(
      /\.fs-side\s*\{\s*display:\s*none/,
    );
  });
});
