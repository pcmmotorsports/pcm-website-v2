// @vitest-environment jsdom
//
// use-bottom-bar-height.test.ts — 守「底部固定列長高時,頁尾保留區要跟著長」。
//
// (jsdom docblock 必要:root `vitest.config.ts:70` 預設 `environment: 'node'`,
//  而本檔要一顆 `document` 才問得出「變數有沒有被寫上去」。)
//
// 🔴 **這一格守的是一條【跨兩個檔】的契約**,所以兩邊都要問:
//    ① CSS 這一側(`mobile-tabbar.css`):`body { padding-bottom }` 必須**吃變數**,
//       不可以再退回任何寫死的高度 —— 2026-09-12 的洞就是那個 70px。
//    ② JS 這一側(本檔同名 hook):量到的高度要**真的寫進那個變數**,而且列長高時要跟著變。
//    📌 少了任一側,另一側單獨看起來都是對的 —— 而客人看到的還是被蓋住的頁尾。
//
// ⚠️ **本檔證不到什麼**:jsdom 沒有排版,`getBoundingClientRect` 是我們自己餵的。
//    ⇒ 它證的是「**拿到的數字有沒有被正確送到那個變數**」,不是「畫面上真的不再被蓋住」。
//    那一半是真瀏覽器的事,讀數寫在 commit body(375 / 414 各量一次)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRef } from 'react';
import { BOTTOM_BAR_H_VAR, useBottomBarHeight } from './use-bottom-bar-height';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(HERE, '../styles/mobile-tabbar.css'), 'utf8');

/** 取出所有 `body { … padding-bottom: X }` 的那個 X(手機 @media 與 data-mobile 兜底各一)。 */
function bodyPaddingBottomDecls(): string[] {
  return [...CSS.matchAll(/body\s*\{[^}]*?padding-bottom:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim());
}

/** 造一顆「高度由我說了算」的假元素,替代 jsdom 沒有的排版。 */
function barWithHeight(h: number) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ height: h }) as DOMRect;
  return el;
}

/** 立刻回呼的 ResizeObserver 替身;`fire()` 模擬「列長高了」。 */
function stubResizeObserver() {
  const cbs: ResizeObserverCallback[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        cbs.push(cb);
      }
      observe() {}
      disconnect = disconnect;
      unobserve() {}
    },
  );
  return { fire: () => cbs.forEach((cb) => cb([], {} as ResizeObserver)), disconnect };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty(BOTTOM_BAR_H_VAR);
});

describe('CSS 這一側:頁尾保留區必須吃變數', () => {
  // 🔴 這一格的重點是 `toHaveLength(3)` **本身**:第一版只改了前兩條,而檔案後面
  //    還有一條 600–1079px 的 `body`(同樣命中、而且在後面 ⇒ 會蓋掉前兩條)。
  //    ⇒ 有人日後再加第四條而忘了接變數時,要在這裡先叫,不是等客人捲到頁尾才發現。
  it('每一條 body padding-bottom 都用 --shell-bottom-bar-h(目前三條)', () => {
    const decls = bodyPaddingBottomDecls();
    expect(decls, 'mobile-tabbar.css 的 body padding-bottom 條數變了 ⇒ 回來看新那條有沒有接變數').toHaveLength(3);
    for (const d of decls) expect(d).toContain(BOTTOM_BAR_H_VAR);
  });

  it('🔴 不可以再出現寫死的列高 —— 2026-09-12 的洞就是那個 70px', () => {
    for (const d of bodyPaddingBottomDecls()) {
      // fallback 的 64px 是**分頁列自己**的高度(同檔 `.mobile-tabbar { height: 64px }`),
      // 那是有出處的;被禁的是「把某一條列當下的實測高度抄成字面」。
      expect(d, `padding-bottom 又出現寫死的列高:${d}`).not.toMatch(/\b(70|134|137)px\b/);
    }
  });

  // 沒有人量的時候要與改動前逐字等值:窄機 64+6=70、600–1079 那條 68+6=74。
  // 🔴 fallback 必須等於**同斷點分頁列自己的高度**,不是抄別條 —— 抄錯的話那個斷點會少留。
  it('沒有人量的時候,值與這次改動前等價(各斷點 = 該斷點分頁列高 + 6px 呼吸)', () => {
    const decls = bodyPaddingBottomDecls();
    const fallbacks = decls.map((d) => /var\(--shell-bottom-bar-h,\s*calc\((\d+)px/.exec(d)?.[1]);
    expect(fallbacks, 'fallback 不是「數字 px + env」的形狀 ⇒ 前提失效').toEqual(['64', '64', '68']);
    for (const d of decls) {
      expect(d).toContain('env(safe-area-inset-bottom)');
      expect(d).toContain('+ 6px');
    }
  });

  // 🔴🔴 2026-09-12 平板回歸時補的一格 —— 它釘的正是我**原本漏掉**的那件事。
  //   三條 `body` 的 specificity 相同(`body` 與 `html[data-mobile="true"] body` 差一級,
  //   而平板那條兩個選擇器都寫了)⇒ **誰在後面誰贏**。
  //   ⇒ 平板那條(600–1079,fallback 68)必須是**最後一條**;有人把它搬到前面,
  //     600–1079 會吃到窄機的 64 而少留 4px,**而 375 / 414 量起來會全綠**。
  //   📌 上面那格的 `toEqual(['64','64','68'])` 其實也順帶釘住了順序,
  //     而它讀起來像在問「值對不對」⇒ 這一格把「為什麼是這個順序」問成一句獨立的話。
  it('🔴 600–1079 那條必須排在最後(同 specificity ⇒ 後者贏;搬前面會讓平板少留 4px)', () => {
    const idx = (needle: string) => CSS.indexOf(needle);
    const tabletBlock = idx('@media (min-width: 600px) and (max-width: 1079px)');
    expect(tabletBlock, '找不到平板段 ⇒ 本格前提失效').toBeGreaterThan(-1);
    const lastDeclAt = CSS.lastIndexOf('padding-bottom: calc(var(--shell-bottom-bar-h');
    expect(
      lastDeclAt,
      '最後一條 body padding-bottom 不在平板段裡 ⇒ 平板會被前面那條的 64px 蓋掉',
    ).toBeGreaterThan(tabletBlock);
  });
});

describe('JS 這一側:量到多高就寫多高', () => {
  it('掛上去就把高度寫進變數', () => {
    stubResizeObserver();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLElement }).current = barWithHeight(67);
    renderHook(() => useBottomBarHeight(ref));
    expect(document.documentElement.style.getPropertyValue(BOTTOM_BAR_H_VAR)).toBe('67px');
  });

  it('🔴 列長高(數量列滑出 67 → 134)⇒ 變數要跟著長', () => {
    const ro = stubResizeObserver();
    const el = barWithHeight(67);
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLElement }).current = el;
    renderHook(() => useBottomBarHeight(ref));
    expect(document.documentElement.style.getPropertyValue(BOTTOM_BAR_H_VAR)).toBe('67px');

    el.getBoundingClientRect = () => ({ height: 134 }) as DOMRect;
    ro.fire();
    expect(document.documentElement.style.getPropertyValue(BOTTOM_BAR_H_VAR)).toBe('134px');
  });

  it('小數高度往上取整(無條件進位),不可以少留 1px', () => {
    stubResizeObserver();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLElement }).current = barWithHeight(66.4);
    renderHook(() => useBottomBarHeight(ref));
    expect(document.documentElement.style.getPropertyValue(BOTTOM_BAR_H_VAR)).toBe('67px');
  });

  it('🔴 高度 0(列被 display:none)⇒ 移除變數讓 CSS fallback 接手,不可以寫 0px', () => {
    const ro = stubResizeObserver();
    const el = barWithHeight(134);
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLElement }).current = el;
    renderHook(() => useBottomBarHeight(ref));

    el.getBoundingClientRect = () => ({ height: 0 }) as DOMRect;
    ro.fire();
    expect(document.documentElement.style.getPropertyValue(BOTTOM_BAR_H_VAR)).toBe('');
  });

  it('🔴 卸載要把變數收乾淨,否則離開商品頁後一般頁面照商品頁的高度留白', () => {
    const ro = stubResizeObserver();
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLElement }).current = barWithHeight(134);
    const { unmount } = renderHook(() => useBottomBarHeight(ref));
    expect(document.documentElement.style.getPropertyValue(BOTTOM_BAR_H_VAR)).toBe('134px');

    unmount();
    expect(document.documentElement.style.getPropertyValue(BOTTOM_BAR_H_VAR)).toBe('');
    expect(ro.disconnect).toHaveBeenCalled();
  });

  it('沒有 ResizeObserver 的環境:至少留下首次量到的值,不整個放棄', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLElement }).current = barWithHeight(67);
    renderHook(() => useBottomBarHeight(ref));
    expect(document.documentElement.style.getPropertyValue(BOTTOM_BAR_H_VAR)).toBe('67px');
  });
});
