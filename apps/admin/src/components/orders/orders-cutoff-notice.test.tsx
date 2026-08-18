// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersCutoffNotice } from './orders-cutoff-notice';

/**
 * 🔴🔴 **這一組能守什麼、不能守什麼,先講清楚(codex R1 逼出來的)。**
 *
 * jsdom **沒有版面引擎** ⇒ 真的 `getBoundingClientRect()` 全是 0
 * ⇒ 不動手腳的話這個元件在 jsdom 裡永遠不出現,而「沒溢出就不出現」那條斷言會**恆真**
 *   (整支元件刪掉照樣綠)。
 * ⇒ 本組**把 `getBoundingClientRect` 換成假的**,測的是【判準 / 文案 / 重量時機 / 收尾】。
 *
 * ```
 * 能守   哪些欄算「沒有完整顯示」、報數、文案字面、沒溢出時不畫、
 *        ResizeObserver observe 了誰、RO 回呼會重量、scroll 會重量、
 *        unmount 把同一支 handler 移掉、兩張表各量各的
 * 不能守 sticky 有沒有真的黏住、真實欄寬、真的 overflow、print:hidden 有沒有生效
 * ```
 * 🔴🔴 **而那三件【沒有任何守門】,不是「守在別的地方」**(codex R3 must-fix,他是對的):
 *    commit body 裡那 12 個真瀏覽器觀測點是**一次性的觀察**,不是回歸守門 ——
 *    哪天有人把 `sticky` 拿掉、或改壞 `.orders-grid` 的 CSS,**這 8 格照樣全綠**。
 *    ⇒ 要真守門得補 playwright e2e,那不在這一片的範圍;
 *      **在那之前,不得把「我量過」講成「有守門」。**
 */
type Rect = { left: number; right: number };
const col = (name: string, left: number, right: number) => ({ name, rect: { left, right } });

/** 造一個假的 `.orders-grid`:容器右緣 `boxRight`,表頭欄位的 rect 由呼叫端指定。 */
function makeGrid({ boxRight, ths }: { boxRight: number; ths: { name: string; rect: Rect }[] }) {
  const grid = document.createElement('div');
  grid.className = 'orders-grid';
  grid.getBoundingClientRect = () => ({ left: 0, right: boxRight }) as DOMRect;

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  for (const { name, rect } of ths) {
    const th = document.createElement('th');
    th.textContent = name;
    th.getBoundingClientRect = () => rect as DOMRect;
    tr.appendChild(th);
  }
  thead.appendChild(tr);
  table.appendChild(thead);
  grid.appendChild(table);

  const host = document.createElement('div');
  grid.insertBefore(host, table);
  document.body.appendChild(grid);
  // 元件靠 `closest('.orders-grid')` 認容器 ⇒ 中間包幾層都認得到,
  // 這裡就故意包一層 `host`,順便釘住「不依賴直接子節點」這件事。
  return { grid, table, host };
}

const noticeIn = (grid: HTMLElement) => grid.querySelector('[data-cutoff-notice]');

/** 攔下 ResizeObserver 的回呼與被觀察的節點,才驗得到「觀察了誰」與「叫了會怎樣」。 */
let roCallbacks: (() => void)[] = [];
let roObserved: Element[] = [];
let roDisconnects = 0;

describe('11=丙 — 右邊沒完整顯示的欄,在【看不到的人的螢幕上】講出來', () => {
  beforeEach(() => {
    roCallbacks = [];
    roObserved = [];
    roDisconnects = 0;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          roCallbacks.push(cb);
        }
        observe(el: Element) {
          roObserved.push(el);
        }
        disconnect() {
          roDisconnects += 1;
        }
      },
    );
  });
  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('🔴 有欄的右緣超出容器 ⇒ 逐欄點名 + 報數(含只被切一半的那一欄)', () => {
    const { grid, host } = makeGrid({
      boxRight: 1000,
      ths: [col('單號', 0, 200), col('狀態', 900, 1100), col('發票', 1100, 1250), col('操作', 1250, 1400)],
    });
    render(<OrdersCutoffNotice />, { container: host });
    const n = noticeIn(grid)!;
    expect(n.textContent).toContain('右邊還有 3 欄沒有完整顯示');
    expect(n.textContent).toContain('狀態、發票、操作');
    // 完全在容器內的那一欄不得被點名(否則報數是虛的)
    expect(n.textContent).not.toContain('單號');
  });

  it('🔴 負向對照:所有欄都在容器內 ⇒ 不畫任何提示(Sean 的 1728 螢幕就是這一態)', () => {
    const { grid, host } = makeGrid({
      boxRight: 1000,
      ths: [col('單號', 0, 200), col('狀態', 200, 400), col('操作', 400, 600)],
    });
    render(<OrdersCutoffNotice />, { container: host });
    expect(noticeIn(grid)).toBeNull();
  });

  it('文案用「沒有完整顯示」,不用「看不到」(半切的欄用後者是說過頭)', () => {
    const { grid, host } = makeGrid({ boxRight: 1000, ths: [col('操作', 950, 1100)] });
    render(<OrdersCutoffNotice />, { container: host });
    const t = noticeIn(grid)!.textContent ?? '';
    expect(t).toContain('沒有完整顯示');
    expect(t).not.toContain('欄看不到');
  });

  it('🔴 ResizeObserver 觀察的是【容器與表格兩個】—— 只觀察容器的話,內容變寬時不會重量', () => {
    const { grid, table, host } = makeGrid({ boxRight: 1000, ths: [col('操作', 950, 1100)] });
    render(<OrdersCutoffNotice />, { container: host });
    expect(roObserved).toContain(grid);
    expect(roObserved).toContain(table);
  });

  it('🔴 ResizeObserver 回呼被叫到 ⇒ 用【新的】欄位位置重算(不是停在第一次那組答案)', () => {
    let right = 1100;
    const grid = document.createElement('div');
    grid.className = 'orders-grid';
    grid.getBoundingClientRect = () => ({ left: 0, right: 1000 }) as DOMRect;
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = '操作';
    th.getBoundingClientRect = () => ({ left: right - 150, right }) as DOMRect;
    tr.appendChild(th);
    thead.appendChild(tr);
    table.appendChild(thead);
    grid.appendChild(table);
    const host = document.createElement('div');
    grid.insertBefore(host, table);
    document.body.appendChild(grid);

    render(<OrdersCutoffNotice />, { container: host });
    expect(noticeIn(grid)).not.toBeNull(); // 溢出中

    right = 900; // 表格縮回容器內(例:側邊欄收起來)
    act(() => roCallbacks.forEach((cb) => cb()));
    expect(noticeIn(grid)).toBeNull(); // ⇒ 提示要自己退場
  });

  it('🔴 捲動也會重量 —— 捲到右邊之後那幾欄看得到了,提示不得停在舊答案上', () => {
    let right = 1100;
    const grid = document.createElement('div');
    grid.className = 'orders-grid';
    grid.getBoundingClientRect = () => ({ left: 0, right: 1000 }) as DOMRect;
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = '操作';
    th.getBoundingClientRect = () => ({ left: right - 150, right }) as DOMRect;
    tr.appendChild(th);
    thead.appendChild(tr);
    table.appendChild(thead);
    grid.appendChild(table);
    const host = document.createElement('div');
    grid.insertBefore(host, table);
    document.body.appendChild(grid);

    render(<OrdersCutoffNotice />, { container: host });
    expect(noticeIn(grid)).not.toBeNull();

    right = 950; // 使用者往右捲,那一欄進來了
    act(() => grid.dispatchEvent(new Event('scroll')));
    expect(noticeIn(grid)).toBeNull();
  });

  it('🔴 unmount 之後 scroll listener 有被【移掉】+ ResizeObserver 有 disconnect(不留殭屍)', () => {
    const { grid, host } = makeGrid({ boxRight: 1000, ths: [col('操作', 950, 1100)] });
    // 🔴 **原本這格寫 `expect(() => dispatchEvent).not.toThrow()`,codex R2 判 must-fix:
    //    listener 沒被移掉時它【也會通過】** ⇒ 那是假守門。
    //    改成直接盯住同一支 handler 有沒有被 add 又被 remove(同一個 reference 才算)。
    const added: EventListenerOrEventListenerObject[] = [];
    const removed: EventListenerOrEventListenerObject[] = [];
    const origAdd = grid.addEventListener.bind(grid);
    const origRemove = grid.removeEventListener.bind(grid);
    grid.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === 'scroll') added.push(fn);
      return origAdd(type, fn, opts as AddEventListenerOptions);
    }) as typeof grid.addEventListener;
    grid.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, opts?: unknown) => {
      if (type === 'scroll') removed.push(fn);
      return origRemove(type, fn, opts as EventListenerOptions);
    }) as typeof grid.removeEventListener;

    const { unmount } = render(<OrdersCutoffNotice />, { container: host });
    expect(added).toHaveLength(1);

    unmount();
    expect(roDisconnects).toBe(1);
    // 同一支 handler,不是「有 remove 過就算」
    expect(removed).toContain(added[0]);
  });

  it('🔴 一頁兩張表:各量各的(原本用 document.querySelector 時,第二張會拿第一張的答案)', () => {
    const a = makeGrid({ boxRight: 1000, ths: [col('單號', 0, 200)] }); // 沒有溢出
    const b = makeGrid({ boxRight: 1000, ths: [col('操作', 950, 1100)] }); // 有溢出
    render(<OrdersCutoffNotice />, { container: a.host });
    render(<OrdersCutoffNotice />, { container: b.host });
    expect(noticeIn(a.grid)).toBeNull();
    expect(noticeIn(b.grid)).not.toBeNull();
  });
});
