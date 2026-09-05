// logo-tap-target.test.ts — 首頁 logo 的命中區 ≥44(靠 `::after` 外擴, 本體不動)。
//
// 🔴 **為什麼要有這一格**:`⟦f3-MOBTAP44⟧` 甲堆(沒有可見文字的圖示鈕, 44 這條規則對它成立)
//    最後一顆就是它 —— 390×844 量到本體 **65.25×34** ⇒ **高度差 10px**。
//    寬度 65.25 本來就過關 ⇒ **只外擴上下**, 不去碰不需要碰的方向。
//
// 🔴🔴 **算式要減邊框 —— 而這一課是同一天在隔壁那顆學到的**(`home.test.ts` 的 `.b-select-arrow`):
//    絕對定位 `::after` 的 `top/bottom/left/right` **相對的是 padding box**。
//    那顆有 `border: 1px` ⇒ padding box 比本體小 2px ⇒ 少減它會多算 2px,
//    而**碼與守門用同一個少算的算式時, 兩邊會一起說 44**。
//    🔵 `.pcm-logo` 實測 `border` 0/0、`padding` 0/0 ⇒ 這裡減出來是 0;
//       **而算式仍然把它寫進去** —— 📌 **哪天有人給 logo 加一條邊框, 這一格要會叫。**
//
// ⚠️ **本檔證不到什麼**:它讀的是 **CSS 字面**, 看不到瀏覽器。
//    「外擴之後會不會踩到別人的點擊」那一半**不在這裡** —— 那是真瀏覽器的事,
//    2026-09-05 的讀數寫在 `header.css` 那段註解裡(上下各探 5px ⇒ 最近可點祖先 = 無)。
//
// 📎 另外兩顆(`.b-hero-tick` / `.b-select-arrow`)的同款守門住在 `home.test.ts` ——
//    **刻意不搬過來**:它們與 home.css 的其他守門住在一起, 搬家會讓那邊的人找不到。
//    ⚠️ 代價是**同一條算式有兩份**;兩邊漂掉時沒有東西會叫。改任一邊請一起看。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(HERE, 'header.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

describe('⟦f3-MOBTAP44⟧ 首頁 logo 的命中區', () => {
  it('🔴 命中區高 ≥44(本體 34, 靠 ::after 外擴;算式含邊框)', () => {
    const box = /\.pcm-logo\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    const after = /\.pcm-logo::after\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(box, '找不到 .pcm-logo 本體').not.toBe('');
    expect(after, '命中區 ::after 整條不見了 ⇒ logo 退回 34 高').not.toBe('');
    expect(box, '本體要 position: relative,否則 absolute 的 ::after 會定位到外層容器').toMatch(
      /position:\s*relative/,
    );

    // 🔴 本體高度來自 `.pcm-logo img` 的 `height`(a 本身是 flex, 高度由圖撐出來)
    //   ⇒ 量的是**那一項**, 不是憑記憶寫 34。
    const imgRule = /\.pcm-logo img\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    const h = Number(/height:\s*([0-9.]+)px/.exec(imgRule)?.[1]);
    expect(Number.isFinite(h), '抓不到 .pcm-logo img 的 height ⇒ 這一格量不到東西').toBe(true);

    const T = Number(/top:\s*(-?[0-9.]+)px/.exec(after)?.[1]);
    const B = Number(/bottom:\s*(-?[0-9.]+)px/.exec(after)?.[1]);
    const bw = Number(/border(?:-top)?:\s*([0-9.]+)px/.exec(box)?.[1] ?? '0');
    expect([T, B, bw].every(Number.isFinite), '算式成分抓不到').toBe(true);
    expect(h - 2 * bw + -T + -B, '命中區高 < 44(記得 ::after 相對 padding box, 要減邊框)')
      .toBeGreaterThanOrEqual(44);
  });

  it('🔵 ::after 不得有可見樣式 —— 它是命中區不是裝飾', () => {
    const after = /\.pcm-logo::after\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(after, '找不到 ::after').not.toBe('');
    // 🔴 這一格擋的是「有人拿它當視覺元素用」⇒ 那會改到畫面, 而本片的前提是【視覺零改動】。
    expect(after, '::after 有背景 ⇒ 它不再是純命中區').not.toMatch(/background(?!-clip)/);
    expect(after, '::after 有邊框 ⇒ 它不再是純命中區').not.toMatch(/border(?!-radius)\s*:/);
  });
});
