// cart.css 手機底部固定結帳列的文字層守門 —— ⟦f3-MOBCHECKOUTFOLD⟧(Sean 2026-09-03 拍 `Q26 = 乙`)。
//
// 🔴 **這支存在的理由**:`CartView.test.tsx` 只驗得到「元素有沒有渲染」,
//    而這條列**在桌機也一定會被渲染**(刻意的:條件渲染會讓 `body:has()` 選不到它)
//    ⇒ 📌 **「它只在手機出現」那一半, 元件測試結構上看不到** —— jsdom 不算 media query。
//    這支釘的就是那一半。
//
// ⚠️ **它擋不住什麼**:文字層看不到 cascade 的實際勝負, 也量不到高度。
//    真瀏覽器實量已做(`storefront-probe`, 2026-09-03 10:0x):
//      390px ⇒ 列高 73.0 · 頁尾與列的間距 +8    880px ⇒ 列高 81.0 · 間距 0
//      1280px ⇒ 列 display:none · body padding-bottom 0
//    🛑 而那些是**當時那一版**的讀數 —— 改了 padding / 字級 / 鈕高就作廢, 要重量。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const RAW = readFileSync(new URL('./cart.css', import.meta.url), 'utf8');
const CSS = RAW.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 🔴🔴 **這兩支 helper 是【第二版】—— 第一版兩個都結構上量不到它們宣稱要量的東西。**
 * (對抗審查 MF2 / MF3,實跑量出來的,不是讀出來的)
 * ```
 * 舊 blockAfter:從第一個 @media 起【固定切 2600 字元】
 *   ⇒ 實測那個視窗橫跨 3 個 @media、到 EOF 只差 127 字元
 *   ⇒ 「只有在 ≤1079 才 flex」實際等價於「在檔案後 31% 的某處」
 * 舊負對照:用 CSS.indexOf('@media') 切「第一個 @media 之前」
 *   ⇒ 實測那只涵蓋前 68%(5702 / 8429)
 *   ⇒ 而它要禁的那條頂層規則若寫在檔案後段, **它看不到、印綠**
 * ```
 * ⇒ 📌 **兩個都不是「漏了一格」, 是【尺的射程比宣稱窄】而它在窄的那一側恆綠。**
 */

/** 把所有 `@media {...}` 區塊整段剝掉,剩下的就是**真正的頂層規則**。 */
function topLevelOnly(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const m = css.indexOf('@media', i);
    if (m < 0) { out += css.slice(i); break; }
    out += css.slice(i, m);
    // 從 @media 的第一個 `{` 起數括號配對,找到它自己的收尾
    const open = css.indexOf('{', m);
    if (open < 0) break;
    let depth = 0, j = open;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') { depth--; if (depth === 0) break; }
    }
    i = j + 1;
  }
  return out;
}

/** 取【某個選擇器所在的那一個】 `@media` 區塊全文(括號配對,不切固定長度)。 */
function mediaBlockContaining(headerStart: string, selector: string): string {
  let i = 0;
  while (i < CSS.length) {
    const m = CSS.indexOf(headerStart, i);
    if (m < 0) return '';
    const open = CSS.indexOf('{', m);
    let depth = 0, j = open;
    for (; j < CSS.length; j++) {
      if (CSS[j] === '{') depth++;
      else if (CSS[j] === '}') { depth--; if (depth === 0) break; }
    }
    const block = CSS.slice(m, j + 1);
    if (block.includes(selector)) return block;
    i = j + 1;
  }
  return '';
}

describe('cart 固定結帳列 · 桌機不得出現', () => {
  it('基底把它藏起來(沒有這條 ⇒ 桌機也會冒出一條固定列)', () => {
    expect(CSS).toMatch(/\.cart-mobile-buybar\s*\{\s*display:\s*none;\s*\}/);
  });

  it('只有在 ≤1079 的 @media 裡才 display:flex', () => {
    const mobile = mediaBlockContaining('@media (max-width: 1079px)', '.cart-mobile-buybar');
    expect(mobile, '找得到【含這條列的那一個】1079 區塊').not.toBe('');
    expect(mobile).toMatch(/\.cart-mobile-buybar\s*\{[^}]*display:\s*flex/);
  });

  it('🔵 負對照:頂層【任何位置】都不得有 display:flex(不只是第一個 @media 之前)', () => {
    // 🔴 剝掉所有 @media 之後再掃 —— 舊版用 indexOf 切前段, 而那只涵蓋 68%。
    expect(topLevelOnly(CSS)).not.toMatch(/\.cart-mobile-buybar[^{}]*\{[^}]*display:\s*flex/);
  });

  // 🔴🔴 **這一格【翻面過一次】, 而翻它的是 R2 F2 —— 它原本在【把缺陷釘住】。**
  //    我第一版斷言這兩條在 `topLevelOnly(CSS)`(= 頂層)⇒ **正確的修法會讓它紅。**
  //    🛑 而正確的位置是 `@media ≤1079` 之內:藏 TabBar 與長出 buybar 必須是**同一個世界**,
  //       否則 `data-mobile=true` 且 ≥1080 的機器(Android 平板橫向)會兩條都沒有。
  it('🔴 藏 TabBar 的兩條要與 buybar 在【同一個 @media】裡(R2 F1/F2:同一個世界)', () => {
    const mobile = mediaBlockContaining('@media (max-width: 1079px)', '.mobile-tabbar');
    expect(mobile, '找得到含 .mobile-tabbar 的那個 1079 區塊').not.toBe('');
    expect(mobile).toMatch(/body:has\(\.cart-mobile-buybar\)\s+\.mobile-tabbar\s*,/);
    expect(mobile).toMatch(
      /html\[data-mobile="true"\]\s+body:has\(\.cart-mobile-buybar\)\s+\.mobile-tabbar\s*\{/,
    );
    // 🔵 負對照:它們**不得**留在頂層(那正是 R2 抓到的那一版)。
    expect(topLevelOnly(CSS)).not.toMatch(
      /body:has\(\.cart-mobile-buybar\)\s+\.mobile-tabbar/,
    );
  });
});

describe('cart 固定結帳列 · 頁尾要讓位', () => {
  // 🔴 `<HomeFooter />` 是 `</main>` 的後兄弟 ⇒ 只給 .cart-main 加 padding 保護不到它,
  //    而這條列是 position:fixed ⇒ 沒有這條, 手機上版權列會永久壓在列底下。
  // 🔴 **這一格第一版寫成 `toMatch(/body:has\(.cart-mobile-buybar\)/)` 一條, 而突變殺不掉它**:
  //    那條規則有**兩個**選擇器(裸的 `body:has(...)` + `html[data-mobile="true"] body:has(...)`),
  //    把前者改壞、後者仍含同一個字面 ⇒ **regex 照樣命中 ⇒ 全綠。**
  //    ⇒ 📌 **一個「這個字出現過」的斷言, 在同一個字出現兩次時只擋得住【兩個都壞】。**
  //    ✅ 改成**兩個選擇器各釘一次**;突變任一條都會紅(兩發都實測過)。
  // 🔵 **R2 F3(我 5 發突變沒跑到的那一格)**:下面幾格都跑在【整份 CSS】上,
  //    沒有任何一條綁「讓位那條在 `@media ≤1079` 裡」⇒ 把它整條提到頂層 ⇒ **八格全綠**,
  //    而桌機 `/cart` 會拿到 81px 死空間(那時 buybar 是 `display:none`)。
  //    ⇒ 📌 而本檔檔頭把「1280px ⇒ padding-bottom 0」寫成實量不變式 —— **那句先前零守門。**
  it('🔴 讓位那條必須在 @media ≤1079 之內, 不得提到頂層(桌機會拿到 81px 死空間)', () => {
    const mobile = mediaBlockContaining('@media (max-width: 1079px)', 'body:has(.cart-mobile-buybar)');
    expect(mobile, '找得到含讓位那條的 1079 區塊').not.toBe('');
    expect(mobile).toMatch(/padding-bottom:\s*calc\(81px/);
    expect(topLevelOnly(CSS)).not.toMatch(/body:has\(\.cart-mobile-buybar\)\s*,/);
  });

  it('body 讓位那條在 —— 兩個選擇器都要在, 且吃 safe-area(iOS 底部那條)', () => {
    // 裸的那條:`@media` 命中就生效, 不需要 UA hint。
    expect(CSS).toMatch(/(^|\n)\s*body:has\(\.cart-mobile-buybar\)\s*,/);
    // UA hint 那條:真手機上 `data-mobile` 先到時走這條。
    expect(CSS).toMatch(/html\[data-mobile="true"\]\s+body:has\(\.cart-mobile-buybar\)\s*\{/);
    expect(CSS).toMatch(/padding-bottom:\s*calc\(81px \+ env\(safe-area-inset-bottom\)\)/);
  });

  it('🔴 讓位的數字要 ≥ 實量列高 81 —— 寫 80 時真瀏覽器實測頁尾被蓋掉剛好 1px', () => {
    const m = CSS.match(/body:has\(\.cart-mobile-buybar\)[\s\S]{0,200}?padding-bottom:\s*calc\((\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(81);
  });

  // ⛔ ~~`[data-mobile="true"]` 那一路也要有(UA hint / SSR)~~
  // 🔴 **2026-09-03 這條斷言【翻面】了 —— 而翻它的是對抗審查 MF1, 不是我改期望值遷就實作。**
  //    我第一版照本檔既有的「雙寫慣例」加了 `html[data-mobile="true"] .cart-mobile-buybar
  //    { display: flex }`, **而只搬了 `display`**、定位與背景全留在 `@media` 裡
  //    ⇒ Android 平板橫向(1280px 而 UA 命中 mobile)會出現一條**沒有背景、靜態排在頁尾上方的裸列**。
  //    🛑 而審查同時指出:我聲稱抄的 `checkout.css` **對 `.co-mobile-buybar` 根本沒有這一條**,
  //       它逐字寫「不做 `[data-mobile]` 雙寫」⇒ **我抄的是【別的選擇器】的慣例。**
  //    ✅ 整條刪掉, 對齊 checkout。**而守門換成下面那個 describe** —— 它禁的正是我寫過的那個形狀。
  //    ⚠️ 這一格**只涵蓋 buybar 本身**;`body:has()` 那條讓位的雙寫【仍然要有】, 上面那格照舊在守。
});

describe('cart 固定結帳列 · 平板段要與結帳頁同款', () => {
  // 🔴 沒有這一段的話, 平板上購物車那條是手機尺寸(實量 73)而結帳那條是平板尺寸(81)。
  it('600-1079 那段有把 padding / 字級 / 鈕加大', () => {
    const tablet = mediaBlockContaining('@media (min-width: 600px) and (max-width: 1079px)', '.cart-mobile-buybar');
    expect(tablet, '找得到平板那個區塊').not.toBe('');
    expect(tablet).toMatch(/\.cart-mobile-buybar\s*\{\s*padding:\s*14px 24px;\s*\}/);
    expect(tablet).toMatch(/\.cart-mobile-buybar-btn\s*\{[^}]*min-width:\s*170px/);
  });
});

describe('cart 固定結帳列 · data-mobile 兜底不得只搬一半', () => {
  // 🔴 對抗審查 MF1:第一版寫了 `html[data-mobile="true"] .cart-mobile-buybar { display: flex }`
  //    在**頂層**(全寬度生效), 而 position/bottom/z-index/背景/框全留在 @media 裡
  //    ⇒ Android 平板橫向(1280px 且 UA 命中 mobile)會出現**一條沒有背景、靜態排在頁尾上方的裸列**。
  //    ✅ 已刪掉整條, 對齊 `checkout.css`(它對 `.co-mobile-buybar` 刻意不做 data-mobile 雙寫)。
  it('沒有「只給 display 不給定位」的頂層兜底', () => {
    expect(topLevelOnly(CSS)).not.toMatch(
      /html\[data-mobile="true"\]\s*\.cart-mobile-buybar\s*\{[^}]*display:\s*flex/,
    );
  });
});
