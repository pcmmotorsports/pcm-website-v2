// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TruncationReveal } from './truncation-reveal';

// truncation-reveal.test.tsx — 滑到被截的字上原地顯示全文（Sean 2026-09-13 拍板）。
//
// 🛑🛑 **誠實邊界，先講：jsdom 沒有版面引擎** ⇒ `scrollWidth` / `clientWidth` 恆為 0。
//    ⇒ 「有沒有真的被截」「疊層對不對得齊」**這裡量不到**，本檔用 `defineProperty` 假造那兩個值。
//    ⇒ 📌 **本檔守的是【接線與那幾個承重決定】，不是畫面。** 畫面由真瀏覽器量 + Sean 肉眼驗。
//    （那正是今天學到的 §7.19：一個真的綠，要說得出它答的是哪一題。）

afterEach(cleanup);

const hoverable = (matches: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches, media: '', addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );

/** 造一格「被截的」——jsdom 量不到，所以直接把那兩個數字釘上去。 */
function makeClippedCell(text: string) {
  const grid = document.createElement('div');
  grid.className = 'orders-grid';
  const td = document.createElement('td');
  td.textContent = text;
  Object.defineProperty(td, 'scrollWidth', { value: 200, configurable: true });
  Object.defineProperty(td, 'clientWidth', { value: 100, configurable: true });
  grid.appendChild(td);
  document.body.appendChild(grid);
  return { grid, td };
}

const layerOf = () =>
  [...document.body.children].find(
    (c) => c.tagName === 'DIV' && (c as HTMLElement).style.position === 'fixed',
  ) as HTMLElement | undefined;

describe('TruncationReveal — 接線', () => {
  it('🔴 元件本身渲染 null（不佔版面），而疊層掛在 <body>', () => {
    // 🔴 **「掛 body」是承重的**：`.orders-grid td` 有 `overflow:hidden`
    //    ⇒ 掛在格子裡的疊層會被切掉，而那正是它要解決的問題。
    hoverable(true);
    const { container } = render(<TruncationReveal />);
    expect(container.innerHTML).toBe('');
    expect(layerOf(), '疊層不在 body 上 ⇒ 它會被 td 的 overflow:hidden 切掉').toBeDefined();
  });

  it('🔴🔴 疊層 `pointer-events:none` —— 少了它，滑過去之後那一列就點不進去', () => {
    // 🔴 整列是一個 stretched link（Sean 2026-08-09 實測要求「整列可點進詳情」）。
    //    疊層若吃得到滑鼠，員工滑過去之後那一列**點不進去，而畫面看起來完全正常**。
    hoverable(true);
    render(<TruncationReveal />);
    expect(layerOf()!.style.pointerEvents).toBe('none');
  });

  it('🔴 觸控裝置（沒有 hover）⇒ 整支不掛，連疊層都不建', () => {
    // 📌 Sean 拍過「員工幾乎不用手機」⇒ 這一片**不涵蓋手機**，而那是照實寫不是漏做。
    //    不掛的話，觸控上不會有一個永遠不會開的監聽。
    hoverable(false);
    render(<TruncationReveal />);
    expect(layerOf()).toBeUndefined();
  });

  it('🔴🔴 `matchMedia` 不存在（jsdom）⇒ 不掛，**而且不得炸掉**', () => {
    // 🔴 **這一格是一個真的當掉換來的。** 第一版沒有 `typeof window.matchMedia !== 'function'`
    //    ⇒ 本元件掛在 `/orders` 頁上，**每一支 render 整頁的既有測試當場 `TypeError`**
    //    （實測 23 格：`page.test.tsx` / `order-panel-wiring` / `order-keyword-search-wiring`）。
    //    📌 **問不到「這台機器有沒有 hover」時，選擇【不掛】** —— 掛一個問不出前提的監聽，
    //       在觸控上永遠不會開，而沒有人看得出來。
    vi.stubGlobal('matchMedia', undefined);
    expect(() => render(<TruncationReveal />)).not.toThrow();
    expect(layerOf()).toBeUndefined();
  });

  it('🔴 卸載後疊層要收走（不留孤兒節點）', () => {
    hoverable(true);
    const { unmount } = render(<TruncationReveal />);
    expect(layerOf()).toBeDefined();
    unmount();
    expect(layerOf()).toBeUndefined();
  });

  it('🔴 被截的格子 ⇒ 疊層開；沒被截的 ⇒ 收起（量具自檢在同一格裡）', () => {
    hoverable(true);
    render(<TruncationReveal />);
    const { grid, td } = makeClippedCell('側柱加大底座 — CNC RACING');

    td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(layerOf()!.style.display).toBe('block');

    // 量具自檢：同一個元素改成「沒被截」⇒ 必須收起來。
    //    🔴 少了這一半，一個「永遠都開」的實作也會讓上面那條綠。
    Object.defineProperty(td, 'scrollWidth', { value: 100, configurable: true });
    td.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(layerOf()!.style.display).toBe('none');

    grid.remove();
  });

  it('🔴 表格外的元素不管它（本片不是全站功能）', () => {
    hoverable(true);
    render(<TruncationReveal />);
    const outside = document.createElement('div');
    Object.defineProperty(outside, 'scrollWidth', { value: 200, configurable: true });
    Object.defineProperty(outside, 'clientWidth', { value: 100, configurable: true });
    document.body.appendChild(outside);

    outside.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(layerOf()!.style.display).toBe('none');

    outside.remove();
  });
});

describe('TruncationReveal — 兩條寫死的規矩（原始碼層）', () => {
  const SRC = readFileSync(join(__dirname, 'truncation-reveal.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('前提：剝註解真的有作用，而且讀到了那支檔', () => {
    expect(SRC).toContain('export function TruncationReveal');
    expect('const a = 1; // textContent'.replace(/\/\/.*$/gm, '')).not.toContain('textContent');
  });

  it('🔴🔴 取字用 `innerText`、**不得**用 `textContent`', () => {
    // 🔴 **這是 2026-09-13 量欄寬時踩過的那個坑的解藥。**
    //    日期格裡有**兩顆** `<Link>`（桌機面板 / 手機整頁），兩顆都在 DOM 裡、靠 CSS 顯隱
    //    ⇒ `textContent` 會把單號讀**兩次**（真瀏覽器實測：`PCM-2026-1005PCM-2026-1005`）。
    //    📌 而那個錯**畫面上看起來完全正常** —— 它只是印出一個兩倍長的單號。
    //    `innerText` 只回**算出來看得到**的文字 ⇒ 它就是這件事的內建解法。
    // ⚠️ **禁的是【讀】來源元素的 `textContent`,不是【寫】疊層的** ——
    //    `layer.textContent = …` 是合法的(那是在設定疊層自己的字)。
    //    📌 我第一版寫成整支禁 `textContent`,它擋下的是**我自己那一行合法的寫入** ——
    //       一道範圍抓太寬的守門,紅的時候說的是假話。
    expect(SRC, '從來源元素讀 textContent ⇒ 雙份連結的欄位會把字印兩次').not.toMatch(/\bel\.textContent\b/);
    expect(SRC, '沒有走 innerText ⇒ 那個坑沒有被解掉').toMatch(/\bel\.innerText\b/);
  });

  it('🔴 不用 `title=`（那條是既有拍板，不是偏好）', () => {
    // `orders-table.tsx:268` 逐字「G2 那版把說明放 `title=` 裡…**刻意不接回來**」。
    expect(SRC).not.toContain('title=');
    expect(SRC).not.toContain("setAttribute('title'");
  });

  it('🔴 配色從既有 token 取，不新造顏色（Sean 逐字「像是原本的顏色配置就好」）', () => {
    // 🛑 他推翻了自己第一版的「氣泡」形狀：**不做深色 tooltip、不做上下浮出的氣泡。**
    //    ⇒ 出現任何 `#rrggbb` / `rgb(` / `oklch(` 字面就是在新造顏色。
    for (const token of ['var(--card)', 'var(--foreground)', 'var(--border)']) {
      expect(SRC, `配色沒走既有 token：${token}`).toContain(token);
    }
    expect(SRC, '出現寫死的顏色字面 ⇒ 新造了顏色').not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(/);
  });
});
