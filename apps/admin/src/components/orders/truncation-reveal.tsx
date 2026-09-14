'use client';

import { useEffect } from 'react';

// truncation-reveal.tsx — 滑到【被截斷】的字上,原地顯示全文,而且**可以框選複製**。
//
// 🔴🔴 **Sean 2026-09-13 逐字(第二句推翻第一句的形狀,照第二句)**:
//    ① 「我選A 滑過去就能選, 不用按。但是氣泡要離原本文字很近才對, 在正上方顯示」
//    ② 「為何氣泡這個方式一定要在上或者在下, 不能變成我移動到該文字上, 就直接顯示就好了嗎?
//        然後顏色做得不像氣泡, 像是原本的顏色配置就好」
//    ⇒ 定案 = **蓋在原地、用原本的配色、滑過去就能選**。範圍:「被截斷的文字, 如客人名稱、或者任何其他的都要有」
//    ⇒ 全域委派 + 通用偵測,不逐欄掛。
// 🔴 2026-09-14 Sean:「自動延伸切斷的文字的功能不見」⇒ 上一版 `pointer-events:none` 讓它**看得到選不到**。
//    本版照 `方向稿說明-v10.md §11` 重做:`user-select:text`、滑進氣泡不收、氣泡沒選取時點一下 = 點原格、
//    捲動一律收、Esc 先收氣泡。參考實作 `generator/build-v10.py` 的 `ftip`。
//
// 🔴 **為什麼另開一支 `'use client'`**:`orders-table.tsx` 全檔零 `use client` / 零 hook(有守門)。
//    本片掛在列表外層走全域事件委派,列表 DOM 一個字不動 ⇒ 可整支移除而列表照常。
//    `root` 可換 ⇒ 客戶 / 商品清單也掛得上。
//
// 🛑 **不涵蓋手機**(觸控沒有 hover;Sean 拍過「員工幾乎不用手機」)。`(hover: hover)` 不成立就整支不掛。
// ⚠️ **不用 `title=`**(`orders-table.tsx` 逐字「刻意不接回來」)。

/** 氣泡沒選取時,單擊等多久才當成「點原格」—— 要留給雙擊 / 三擊(選字 / 選整串)先發生。 */
const CLICK_THROUGH_DELAY_MS = 260;
/** 氣泡比原格往左上外擴的量(稿:left-6 / top-4),讓文字落在原位而氣泡有一圈自己的底。 */
const PAD_X = 6;
const PAD_Y = 4;
/** 氣泡右側多留的空,讓最後一個字不貼邊(稿 `.ftip{padding:0 10px 0 0}`)。 */
const PAD_R = 10;

/**
 * 「這個元素的字被截掉了嗎」。只在 overflow 不是 visible 時才算 —— 可見溢出不是截斷。
 * 🔴 `+ 1` 是承重的:`scrollWidth` / `clientWidth` 是整數化的,而排版是次像素
 *    ⇒ 沒有這 1px 容忍值時,大量沒被截的格子會被判成截斷。
 *    `scrollHeight` 那一半才抓得到 line-clamp(兩行截)。
 */
function overflowing(el: HTMLElement): boolean {
  const cs = getComputedStyle(el);
  if (cs.overflowX === 'visible' && cs.overflowY === 'visible') return false;
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

/** 往上找第一個有不透明底色的祖先 —— 氣泡要「像原格變寬了」,黃底的收款格就要黃底。 */
function backgroundOf(el: HTMLElement): string {
  let n: HTMLElement | null = el;
  while (n && n !== document.documentElement) {
    const c = getComputedStyle(n).backgroundColor;
    const a = c.match(/[\d.]+/g);
    if (a && (a[3] === undefined || Number(a[3]) > 0)) return c;
    n = n.parentElement;
  }
  return 'var(--card)';
}

export function TruncationReveal({ root = '.orders-grid' }: { root?: string }) {
  useEffect(() => {
    // 🔴 觸控裝置直接不掛。`typeof window.matchMedia !== 'function'` 不是贅字:jsdom 沒有它,
    //    而本元件掛在 `/orders` 頁上 ⇒ 少了它,每一支 render 整頁的既有測試都會 TypeError(實測 23 格)。
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(hover: hover)').matches) return;

    const layer = document.createElement('div');
    layer.setAttribute('data-truncation-reveal', '');
    // 🔴 掛 `<body>`,不是掛進那一格:`.orders-grid td` 有 `overflow:hidden` ⇒ 掛在格子裡會被切掉。
    // 🔴 `pointer-events:auto` + `user-select:text` 就是這一片的目的 —— 上一版 none 讓它看得到選不到。
    layer.style.cssText =
      'position:fixed;z-index:50;display:none;box-sizing:border-box;overflow:visible;' +
      'pointer-events:auto;user-select:text;-webkit-user-select:text;cursor:text;' +
      // 配色用【既有 token】當底,實際顯示時再抄原格算出來的顏色(Sean 逐字「像是原本的顏色配置就好」)。
      'background:var(--card);color:var(--foreground);border:0;border-radius:0';
    document.body.appendChild(layer);

    let src: HTMLElement | null = null;
    let clickTimer: ReturnType<typeof setTimeout> | null = null;

    const hide = () => {
      layer.style.display = 'none';
      src = null;
    };

    const show = (el: HTMLElement) => {
      // 🔴🔴 `innerText` 不是 `textContent`:日期格裡有兩顆 `<Link>`(桌機 / 手機)靠 CSS 顯隱,
      //    `textContent` 會把單號讀兩次(2026-09-13 量欄寬時踩過)。`innerText` 只回看得到的字。
      const full = el.innerText.replace(/\s+/g, ' ').trim();
      if (!full) return hide();
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 逐項抄來源的排版(料號格是 font-mono ⇒ 氣泡跟著等寬),看起來就是「那一格變寬了」。
      for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textAlign'] as const) {
        layer.style[k] = cs[k];
      }
      layer.style.color = cs.color;
      layer.style.background = backgroundOf(el);
      const clamp = cs.webkitLineClamp !== '' && cs.webkitLineClamp !== 'none';
      layer.style.whiteSpace = clamp ? 'normal' : 'nowrap';
      // 氣泡蓋在原格上、往左上各外擴一點,內距補回去 ⇒ 文字落在原位;`min-width` = 原格寬,不會比原格窄。
      layer.style.left = `${r.left - PAD_X}px`;
      layer.style.top = `${r.top - PAD_Y}px`;
      layer.style.minWidth = `${r.width + PAD_X}px`;
      layer.style.padding = `${parseFloat(cs.paddingTop) + PAD_Y}px ${parseFloat(cs.paddingRight) + PAD_R}px ${parseFloat(cs.paddingBottom) + PAD_Y}px ${parseFloat(cs.paddingLeft) + PAD_X}px`;
      layer.style.width = clamp ? `${r.width + PAD_X + PAD_R}px` : 'max-content';
      layer.textContent = full;
      layer.style.display = 'block';
      src = el;
    };

    // 🔴 走 `elementsFromPoint`,不走 `e.target`:整列被 stretched link(`after:absolute after:inset-0`)蓋住
    //    ⇒ 滑鼠事件的 target 是日期格那顆 `<a>`,永遠不是被截的那一格。`elementsFromPoint` 會把
    //    覆蓋層底下那一格一起列出來 ⇒ 從最上層往下找第一個真的被截的元素。
    const onMove = (e: MouseEvent) => {
      const t = e.target;
      // 滑進氣泡本身 ⇒ 不收(這是「移到氣泡上複製」成立的那一條)。
      if (t instanceof Node && layer.contains(t)) return;
      for (const hit of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (!(hit instanceof HTMLElement) || hit === layer) continue;
        if (!hit.closest(root)) break;
        if (overflowing(hit)) {
          if (hit !== src) show(hit);
          return;
        }
      }
      hide();
    };

    // 氣泡沒有選取時點一下 = 點原格(整列 stretched link ⇒ 展開 / 進明細)。
    // 先收氣泡再用 `elementFromPoint` 找滑鼠底下真正的東西 ⇒ 不用知道那一格點下去是什麼。
    const onClick = (e: MouseEvent) => {
      e.stopPropagation();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      if (e.detail !== 1) return;
      const { clientX, clientY } = e;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        if (String(window.getSelection()).length || !src) return;
        hide();
        const under = document.elementFromPoint(clientX, clientY);
        if (under instanceof HTMLElement) under.click();
      }, CLICK_THROUGH_DELAY_MS);
    };
    const onDblClick = (e: MouseEvent) => {
      e.stopPropagation();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
    };
    const stop = (e: Event) => e.stopPropagation();
    const onKey = (e: KeyboardEvent) => {
      // Esc 先收氣泡;氣泡沒開時不吃這顆鍵(讓彈窗 / 面板照舊處理)。
      if (e.key === 'Escape' && layer.style.display !== 'none') {
        e.stopPropagation();
        hide();
      }
    };

    layer.addEventListener('click', onClick);
    layer.addEventListener('dblclick', onDblClick);
    layer.addEventListener('mousedown', stop);
    layer.addEventListener('mouseup', stop);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('keydown', onKey, true);
    // 捲動 / 改變大小之後那個座標就過期了 ⇒ 直接收掉,不做追隨。
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      if (clickTimer) clearTimeout(clickTimer);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      layer.remove();
    };
  }, [root]);

  return null;
}
