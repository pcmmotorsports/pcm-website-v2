// mobile-tabbar.css 的文字層守門 —— 2026-08-06 第5批(Q5=A)新增。
//
// 🔴 **這支存在的理由**:`MobileTabBar.test.tsx` 的五條 hidden 斷言守的全是
//    「`className` 有沒有掛上 `is-hidden`」,而 **class 有掛 ≠ CSS 認帳**。
//    R2 對抗審查抓到:`.mobile-tabbar.is-hidden` = (0,2,0) 打不過同檔的
//    `html[data-mobile="true"] .mobile-tabbar { display: flex }` = (0,2,1)
//    ⇒ 藏 TabBar 在真手機 UA 上**從上線起就是 no-op**(真瀏覽器
//    `getComputedStyle().display` 實測回 `flex`,修法套上去才變 `none`)。
//    元件測試與 jsdom 對 cascade 完全盲,五條全綠、真手機上三頁全壞。
//
// ⚠️ **它擋不住什麼**:文字層一樣看不到 cascade 的實際勝負。這裡只釘「兩條選擇器都在」,
//    真正的勝負要靠真瀏覽器量(本片已量:ua=true 且掛 is-hidden ⇒ none;拿掉 is-hidden ⇒ flex)。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const CSS = readFileSync(new URL('./mobile-tabbar.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

describe('mobile-tabbar · 藏 TabBar 那條要真的贏得了 cascade', () => {
  it('🔴 .is-hidden 必須同時寫裸選擇器與 data-mobile 兜底', () => {
    expect(
      CSS,
      '.is-hidden 少了 data-mobile 兜底 ⇒ 被 (0,2,1) 的 display:flex 蓋掉,三頁的藏 TabBar 全失效',
    ).toMatch(
      /\.mobile-tabbar\.is-hidden,\s*html\[data-mobile="true"\] \.mobile-tabbar\.is-hidden\s*\{[^}]*display:\s*none/,
    );
  });

  // 前提:被它蓋的那條仍在。哪天 data-mobile 兜底整組被拿掉了,上面那條就沒必要 ——
  // 這條會紅,提醒回頭簡化,而不是留一條沒人知道為什麼要寫兩份的規則。
  it('前提 — data-mobile 兜底的 display:flex 仍在(否則上面那條的理由已消失)', () => {
    expect(CSS, 'data-mobile 兜底不見了 ⇒ 回頭把 .is-hidden 簡化回單一選擇器').toMatch(
      /html\[data-mobile="true"\] \.mobile-tabbar\s*\{[^}]*display:\s*flex/,
    );
  });
});
