// line-cta-above-buybar.test.ts — 手機上 LINE 圓鈕不得被底部那條買氣列蓋住。
//
// 🔴 **病(A 窗 2026-09-16 站上實測,已上線)**:加入購物車後,`.pd-mbb-wrap` 長出
//    「已加入・數量 − +」那一排不透明白面板 ⇒ 那條列從 67px 變 134px 以上,
//    而 `.line-cta-fab` 的手機位置是**寫死的** `bottom: calc(82px + …)` ⇒ 整顆被蓋住。
//    面板 z50 / 本鈕 z49,只差 1。在本鈕範圍取 9 個點做命中測試 ⇒ **沒有一點摸得到它**,
//    正中心摸到的是「+」⇒ 📌 **客人照剛才看到的位置按 LINE,實際是加購一件,而畫面不會講。**
//
// ✅ **修法**:改吃 `--shell-bottom-bar-h` —— 那條列**自己量自己**寫進來的實際高度
//    (`lib/use-bottom-bar-height.ts`,`ProductPage.tsx` 已經在寫;`mobile-tabbar.css` 的
//     `body { padding-bottom }` 吃的是同一個變數)⇒ 不自創第二把尺。
//
// 🔴 **本檔守【兩條路】,因為這個修法要兩邊同時成立才有效**:
//    ① CSS 那條:手機規則的 `bottom` 必須吃那個變數(寫死的數字只對得上那條列的其中一種高度)
//    ② TSX 那條:**那個變數要真的有人寫** —— `ProductPage` 仍然要把 ref 掛在 `.pd-mbb-wrap` 上
//       並呼叫 `useBottomBarHeight`。少了它,CSS 永遠吃 fallback ⇒ **修法是死的,而 ① 照樣綠。**
//
// ⚠️ **本檔擋不住什麼**:文字層看不到 cascade 的實際勝負,也量不到真實像素。
//    「按不按得到」那一半只有真瀏覽器的 `elementFromPoint` 答得出來(A 窗那 9 點就是)。
//    ⇒ 本檔守的是「**別再被改回寫死的數字**」,不是「現在的版面是對的」。

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BOTTOM_BAR_H_VAR } from '@/lib/use-bottom-bar-height';

/** 剝掉註解再比對 —— 否則上面那段說明與 CSS 裡的 ⛔ 舊字面自己就會命中(偵測字串自命中)。 */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = strip(readFileSync(new URL('./line-cta.css', import.meta.url), 'utf8'));
const TSX = readFileSync(new URL('../components/ProductPage.tsx', import.meta.url), 'utf8');

/** 取 `@media (max-width: 1079px)` 那一整塊(自己數大括號,regex 不會配平)。 */
function mobileBlock(css: string): string {
  const m = /@media\s*\(max-width:\s*1079px\)\s*\{/.exec(css);
  if (!m) return '';
  let depth = 0;
  let i = m.index + m[0].length - 1;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) break;
  }
  return css.slice(m.index, i + 1);
}

describe('LINE 圓鈕要跟著底部那條列一起往上,不能寫死高度', () => {
  it('🟢 正對照:先確認我讀到的是那支檔、那顆鈕(桌機的 bottom 沒被我動到)', () => {
    expect(CSS, '找不到 .line-cta-fab ⇒ 改名了?本檔每一格的前提都失效').toContain('.line-cta-fab');
    const base = /(^|\})\s*\.line-cta-fab\s*\{[^}]*\}/.exec(CSS)?.[0];
    expect(base, '找不到基底規則 ⇒ 前提失效').toBeTruthy();
    expect(base, '桌機那顆的位置被順手改掉了 ⇒ 這一改不該碰它').toMatch(/bottom:\s*24px/);
  });

  it('🔴 ① CSS:手機規則的 bottom 必須吃 --shell-bottom-bar-h,不得是寫死的數字', () => {
    const block = mobileBlock(CSS);
    expect(block, '找不到 @media (max-width: 1079px) 區塊 ⇒ 前提失效,這一發作廢').not.toBe('');
    const rule = /\.line-cta-fab\s*\{[^}]*\}/.exec(block)?.[0];
    expect(rule, '手機區塊裡沒有 .line-cta-fab ⇒ 前提失效').toBeTruthy();
    expect(
      rule,
      `手機的 bottom 沒有吃 ${BOTTOM_BAR_H_VAR} ⇒ 它又變成一個寫死的數字,`
        + '而底部那條列至少四種高度(見 use-bottom-bar-height.ts 檔頭)⇒ 任何字面都只對其中一種。',
    ).toContain(`var(${BOTTOM_BAR_H_VAR}`);
    // 🔵 fallback 不可拿掉:變數只有商品頁會寫,其他頁要有東西接手。
    expect(rule, 'fallback 被拿掉了 ⇒ 沒有那條列的頁面上這顆會貼到畫面最底').toMatch(
      /var\(--shell-bottom-bar-h,\s*calc\(/,
    );
  });

  it('🔴 ② TSX:那個變數要真的有人寫(少了它,①綠而修法是死的)', () => {
    expect(TSX, 'ProductPage 不再呼叫 useBottomBarHeight ⇒ 變數沒人寫,LINE 鈕會回到 fallback 位置').toContain(
      'useBottomBarHeight(',
    );
    // ref 要掛在那條會長高的 wrap 上 —— 掛錯元素的話量到的不是那條列的高度。
    expect(
      TSX,
      'ref 不在 .pd-mbb-wrap 上 ⇒ 量到的不是那條會長高的列,LINE 鈕不會跟著上移',
    ).toMatch(/className="pd-mbb-wrap"\s+ref=\{/);
  });

  it('🔴 不是靠 z-index 解的 —— 那只解一半(看得見,但它會蓋住買氣列)', () => {
    const block = mobileBlock(CSS);
    const rule = /\.line-cta-fab\s*\{[^}]*\}/.exec(block)?.[0] ?? '';
    expect(
      rule,
      '手機規則裡出現 z-index ⇒ 有人改用「壓在面板上」來解。'
        + '那會讓這顆蓋住「加入購物車 / 立即購買」,是把一個病換成另一個病。',
    ).not.toMatch(/z-index/);
  });
});
