// brand-page.test.ts — 品牌頁 CSS 的文字層守門(D2b;2026-08-04)
//
// 對齊 `styles/products-mobile.test.ts` 的既有慣例:有些 CSS 性質**只在特定資料或
// 特定視窗下才看得見**,jsdom 不套 media query、也不算 CSS 權重,元件測試一律綠。
// 這支直接讀 CSS 原文斷言。
//
// 🔴 這支擋的是「現在的資料剛好走不到、所以壞了也沒人知道」那一類:
//    20 家目前**全部都有橫幅照**,所以 `.no-photo` 那條路在正式資料下不可達。
//    但元件支援 band 缺席(D2b 測試有覆蓋),而設計稿對這條路徑留了一個明確的權重陷阱。
//    等哪天真的上架一家沒有官方授權照的品牌,才發現窄螢幕整條帶變全黑 —— 太晚了。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CSS = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'brand-page.css'),
  'utf8',
);

/** 取某個 @media 區塊的內容(大括號配對計數,不是抓到第一個 `}` 就停)。 */
function mediaBlock(query: string): string {
  const start = CSS.indexOf(`@media ${query}`);
  if (start === -1) return '';
  const open = CSS.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') {
      depth--;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }
  return '';
}

describe('品牌頁 CSS · 窄螢幕橫幅', () => {
  const narrow = mediaBlock('(max-width: 960px)');

  it('前提斷言:≤960 區塊抓得到、且大括號有配對到底', () => {
    // 🔴 沒有這條,下面幾條在 mediaBlock 回空字串時會全部「找不到 = 通過」。
    // 也擋「只抓到第一個 } 就停」的切片 bug(切壞的話這個長度會明顯偏小)。
    expect(narrow.length).toBeGreaterThan(400);
    expect(narrow).toContain('.bp-band-inner');
  });

  it('🔴 窄螢幕的幕必須用兩個 class 選擇器 .bp-band.bp-band::after', () => {
    // 設計稿逐字:少寫一個 class 就會被 `.bp-band.no-photo::after`(0-2-0)蓋掉,
    // 窄螢幕變回全黑。20 家目前全有照片 ⇒ 這條路在正式資料下不可達 ⇒ 只能靠這裡守。
    expect(narrow).toContain('.bp-band.bp-band::after');
    // 反面:同一區塊裡不得出現只寫一個 class 的版本(那就是被蓋掉的那種寫法)
    expect(/(^|[^.\w])\.bp-band::after/.test(narrow)).toBe(false);
  });

  it('照片高度與 inner 的 padding-top 綁在一起(220 / 246)', () => {
    // 漸層停點用 px 不用 %,因為帶子高度會隨文案長度變;停點跟 220px 綁死。
    // 改了其中一個沒改另一個 ⇒ 文字會壓在照片上或浮在空白裡,兩個尺寸都要在。
    expect(narrow).toContain('height: 220px');
    expect(narrow).toContain('padding-top: 246px');
    // 幕的停點也必須是 px(用 % 就跟照片對不齊)。
    // ⚠️ 這裡不要用 /linear-gradient\(180deg[^)]*0px/ —— `[^)]*` 跨不過 rgba(...) 自己的
    //    右括號,恆不命中(本條第一版就是這樣紅的,是斷言錯不是 CSS 錯)。
    //    改成直接斷言設計稿的四個字面停點。
    for (const stop of ['.10) 0px', '.26) 128px', '.88) 196px', '#202225 226px']) {
      expect(narrow, `窄螢幕幕的停點 ${stop} 不見了`).toContain(stop);
    }
    // 反面:停點不得改用 %(帶子高度會隨文案長度變,用 % 就跟照片對不齊)
    expect(/linear-gradient\(180deg[\s\S]{0,200}?\d+%\s*,/.test(narrow)).toBe(false);
  });

  it('logo 收到 190px、不得低於 180(細線描邊的 mark 會糊成一團)', () => {
    const m = narrow.match(/\.bp-band-logo img\s*\{[^}]*max-width:\s*(\d+)px/);
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBeGreaterThanOrEqual(180);
  });
});

describe('品牌頁 CSS · 色票 scope', () => {
  it('🔴 設計色票掛在 .bp-page,不是 :root', () => {
    // --c-red 在正式站 tokens.css 已存在且值不同(#dc2626 vs 設計的熔橘 #f26722)。
    // 寫進 :root 會讓現有每一頁的按鈕/價格當場變色 = 未經批准的全站視覺改動。
    expect(CSS).toContain('.bp-page {');
    expect(CSS).not.toMatch(/^\s*:root\s*\{/m);
    const scope = CSS.slice(CSS.indexOf('.bp-page {'), CSS.indexOf('}', CSS.indexOf('.bp-page {')));
    expect(scope).toContain('--c-red: #f26722');
    expect(scope).toContain('--c-graphite: #202225');
  });
});

describe('品牌頁 CSS · 事實列欄數', () => {
  it('欄數吃 --fact-n(3 或 4 都要成立),不是寫死 4', () => {
    expect(CSS).toContain('repeat(var(--fact-n, 4)');
    expect(CSS).not.toMatch(/\.bp-facts-inner\s*\{[^}]*grid-template-columns:\s*repeat\(4/);
  });
});
