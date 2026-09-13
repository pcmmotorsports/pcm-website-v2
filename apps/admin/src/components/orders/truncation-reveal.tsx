'use client';

import { useEffect } from 'react';

// truncation-reveal.tsx — 滑到【被截斷】的字上，原地顯示全文。
//
// 🔴🔴 **Sean 2026-09-13 逐字，而第二句推翻了第一句的形狀 —— 照第二句：**
//    ① 「我選A 滑過去就能選, 不用按。但是氣泡要離原本文字很近才對, 在正上方顯示」
//    ② **「我突然想到, 為何氣泡這個方式一定要在上或者在下, 不能變成我移動到該文字上,
//         就直接顯示就好了嗎? 然後顏色做得不像氣泡, 像是原本的顏色配置就好」**
//    ⇒ 📌 **定案 = 蓋在原地、用原本的配色。不做「上方/下方的氣泡」、不做深色 tooltip。**
//    ⇒ 範圍他也講了：「**那被截斷的文字, 如客人名稱、或者任何其他的都要有**」
//      ⇒ **不是只有客戶欄** —— 表格裡任何一個被截的元素都算。所以本檔用**全域委派 + 通用偵測**，
//        不是逐欄掛。
//
// 🔴 **為什麼另開一支 `'use client'` 而不是寫進 `orders-table.tsx`**：
//    那支**全檔零 `use client` / 零 hook**（有守門釘著）。這一片要 hover 與量測 ⇒ 非 client 不可。
//    ⇒ 做法是**掛在列表外層、走全域事件委派**，`orders-table.tsx` 的 DOM 一個字都不動。
//    📌 那也讓這一片**可以整支移除**而列表照常運作。
//
// 🛑🛑 **本片【不涵蓋手機】，而那是照實寫不是漏做。**
//    觸控裝置沒有 hover（`orders-table.tsx:673` 逐字「手機槽刻意不給 `title`：觸控裝置沒有 hover
//    ⇒ tooltip 永遠不顯示」）。Sean 拍過「員工幾乎不用手機 ⇒ 只修壞掉、不設計順序」。
//    ⇒ 本檔用 `(hover: hover)` 明確關掉，**不讓它在觸控上掛一個永遠不會開的監聽**。
//    🔴 **代價寫在這裡不藏：被截斷的值，滑鼠以外的方式仍然讀不到全文。**
//
// ⚠️ **不用 `title=`** —— `orders-table.tsx:268` 逐字「G2 那版把說明放 `title=` 裡…**刻意不接回來**」。

/** 表格根。全域委派只在這裡面生效 —— 本片不是全站功能。 */
const ROOT = '.orders-grid';

/**
 * 「這個元素的字被截掉了嗎」。
 *
 * 🔴 **`+ 1` 是承重的**：`scrollWidth` / `clientWidth` 是整數化的，而排版是次像素
 * ⇒ 沒有這 1px 容忍值時，大量**沒有被截**的格子會被判成截斷（實測會讓幾乎每一格都跳）。
 */
function overflowing(el: Element): boolean {
  return el.scrollWidth > el.clientWidth + 1;
}

export function TruncationReveal() {
  useEffect(() => {
    // 🔴 觸控裝置直接不掛 —— 見檔頭。`matchMedia` 在 SSR 不存在，所以這件事只能在 effect 裡做。
    // ⚠️ **`typeof window.matchMedia !== 'function'` 那一段不是防禦性贅字** ——
    //    jsdom **沒有** `matchMedia`，而本元件掛在 `/orders` 頁上
    //    ⇒ 少了它，**每一支 render 整頁的既有測試都會當場 `TypeError` 炸掉**
    //      （實測：`page.test.tsx` / `order-panel-wiring` / `order-keyword-search-wiring` 共 23 格）。
    //    📌 **問不到「這台機器有沒有 hover」時，選擇【不掛】** —— 掛一個問不出前提的監聽，
    //       比不掛更糟：它在觸控上永遠不會開，而沒有人看得出來。
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(hover: hover)').matches) return;

    const layer = document.createElement('div');
    // 🔴🔴 **`pointer-events:none` 是承重的，不是保險絲。**
    //    整列是一個 stretched link（Sean 2026-08-09 實測要求「整列可點進詳情」）
    //    ⇒ 疊層若吃得到滑鼠，員工滑過去之後**那一列就點不進去了** —— 而畫面看起來完全正常。
    layer.style.cssText =
      'position:fixed;z-index:50;pointer-events:none;display:none;' +
      'box-sizing:border-box;white-space:pre;overflow:visible;' +
      // 🔴 配色用【既有 token】—— Sean 逐字「像是原本的顏色配置就好」。不新造顏色、不做深色氣泡。
      'background:var(--card);color:var(--foreground);border:1px solid var(--border);border-radius:4px';
    // 🔴 掛 `<body>`，**不是掛進那一格**：`.orders-grid td` 有 `overflow:hidden`
    //    ⇒ 掛在格子裡的疊層會被切掉，而那正是它要解決的問題。
    document.body.appendChild(layer);

    const hide = () => {
      layer.style.display = 'none';
    };

    const show = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 🔴 **逐項抄來源的排版**，讓它看起來就是「那一格變寬了」而不是另一個東西冒出來。
      for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign'] as const) {
        layer.style[k] = cs[k];
      }
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.minWidth = `${r.width}px`;
      layer.style.height = `${r.height}px`;
      // 內距補回外框那 1px，字才對得齊原位（不補的話全文會比原文右移一格）。
      layer.style.padding = `${Math.max(0, parseFloat(cs.paddingTop) - 1)}px ${parseFloat(cs.paddingRight)}px ${Math.max(0, parseFloat(cs.paddingBottom) - 1)}px ${Math.max(0, parseFloat(cs.paddingLeft) - 1)}px`;
      layer.style.width = 'max-content';
      // 🔴🔴 **`innerText` 不是 `textContent`，而這一條是【量錯過的那個坑】的解藥。**
      //    日期格裡有**兩顆** `<Link>`（桌機面板 / 手機整頁），兩顆都在 DOM 裡、靠 CSS 顯隱
      //    ⇒ `textContent` 會把單號讀**兩次**（2026-09-13 量欄寬時就踩過，量到「26 碼」）。
      //    `innerText` 只回**算出來看得到**的文字 ⇒ 它就是這件事的內建解法。
      layer.textContent = el.innerText;
      layer.style.display = 'block';
    };

    const onOver = (e: Event) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const root = t.closest(ROOT);
      if (!root) return hide();
      // 從滑鼠所在往上找**第一個真的被截**的元素：格子裡的小字被截時要顯示小字那一段，
      // 不是整格 —— 否則會把沒被截的那幾行一起蓋掉。
      let el: Element | null = t;
      while (el && el !== root) {
        if (el instanceof HTMLElement && overflowing(el)) return show(el);
        el = el.parentElement;
      }
      hide();
    };

    document.addEventListener('mouseover', onOver, true);
    // 捲動 / 改變大小之後那個座標就過期了 ⇒ 直接收掉，不做追隨（追隨要 rAF，而它不值得）。
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      layer.remove();
    };
  }, []);

  return null;
}
