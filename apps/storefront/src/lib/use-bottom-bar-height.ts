// use-bottom-bar-height.ts — 底部固定列「量到多高就留多高」。
//
// 為什麼需要它(2026-09-12 手機走查抓到的洞,375 與 414 都重現):
//   頁面底部的保留區原本是 `mobile-tabbar.css` 裡寫死的 70px,而那個值只對得上**分頁列**(64px)。
//   商品頁把分頁列換成 `.pd-mbb-wrap`(`product-page.css:2011`),那一條**是 flex column、高度會變**:
//     購買列 67px → 按「加入購物車」多一排數量列 = 134px → 上限提示再多一排、而且**隨字數換行**。
//   ⇒ 保留 70、實佔 134 ⇒ 捲到最底時頁尾最後兩行(公司名 + 統編)被**永久蓋住**,捲不出來。
//
// 🛑 **為什麼不改成另一個寫死的數字**:那條列至少四種高度,其中一種取決於提示文字換幾行
//   ⇒ 任何字面都只對其中一種。`product-page.css:2007` 為了同一個理由做過同一個決定,這裡照它。
//
// ⚠️ 這支**不負責畫面**,只負責把量到的高度寫進 `--shell-bottom-bar-h`;
//   吃它的是 `mobile-tabbar.css` 那兩條 `body { padding-bottom }`(手機 @media 與 data-mobile 兜底各一)。
//   寫法比照站台既有的 `--shell-header-h` 單一來源慣例(`tokens.css:25` 逐字「消費端一律 var()」)。

import { useEffect, type RefObject } from 'react';

/** CSS 變數名 —— 與 `mobile-tabbar.css` 的兩條 `body { padding-bottom }` 是同一個字面。 */
export const BOTTOM_BAR_H_VAR = '--shell-bottom-bar-h';

/**
 * 觀察 `ref` 指到的底部固定列,把它的實際高度寫進 `--shell-bottom-bar-h`。
 *
 * 🔴 高度為 0 時**移除**變數而不是寫 `0px`:0 代表那條列現在是 `display: none`
 *    (桌機寬度、或還沒掛上)⇒ 要讓 CSS 的 fallback(分頁列那 64px)接手。
 *    寫 `0px` 會把分頁列的保留區一起歸零 —— 那是拿一個修法製造另一個同型的洞。
 * 🔴 卸載時一定要 `removeProperty`:變數掛在 `documentElement` 上,離開商品頁之後
 *    留著的話,一般頁面會照商品頁那條列的高度留白。
 */
export function useBottomBarHeight(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) return;

    const write = () => {
      // getBoundingClientRect 而不是 offsetHeight:後者是整數,會在小數高度上少留 1px。
      const h = el.getBoundingClientRect().height;
      if (h > 0) root.style.setProperty(BOTTOM_BAR_H_VAR, `${Math.ceil(h)}px`);
      else root.style.removeProperty(BOTTOM_BAR_H_VAR);
    };

    write();

    // ResizeObserver 不存在(舊瀏覽器 / jsdom)⇒ 至少留下首次量到的值,不要整個放棄。
    if (typeof ResizeObserver === 'undefined') {
      return () => root.style.removeProperty(BOTTOM_BAR_H_VAR);
    }
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty(BOTTOM_BAR_H_VAR);
    };
  }, [ref]);
}
