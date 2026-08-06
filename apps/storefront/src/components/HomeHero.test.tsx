// @vitest-environment jsdom
//
// HomeHero(首頁 N°01 四張輪播 + 入口板)—— D6 / 首頁對齊批 H5 重寫,2026-08-06。
// (前一版是「render 不報錯」的 smoke test,那時本檔是無互動的 server component。)
//
// 這支守的是 OD :1282-1288 逐字寫下的「輪播三件事」,那三件全部是**行為**、不是版面 ——
// 文字層守門(`styles/home.test.ts`)與截圖都看不到它們:
//   1. 圖與文案一起換(換圖沒換字 = 客人看到 02 的照片配 01 的標題)
//   2. `prefers-reduced-motion` 開著就**完全不自動**(只留手動)
//   3. 滑鼠移入 / 鍵盤 focus 進來 / 分頁切到背景都暫停
// 外加一條資源行為:第 2-4 張要等 `load` 之後才發請求(不然首屏同時吞四張 2.5K 大圖)。
//
// ⚠️ **它擋不住什麼**:jsdom 沒有真的 layout 與圖片載入 ⇒ 淡入淡出的視覺、`object-fit`、
//    漸層壓暗的可讀性都要真瀏覽器看;`matchMedia` 是本檔自己 stub 的,不是真的系統設定。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HomeHero } from './HomeHero';

const DWELL_MS = 6500;

/** 由本檔控制的 `prefers-reduced-motion` 假值(jsdom 沒有 matchMedia)。 */
let reduceMotion = false;
const mqListeners = new Set<() => void>();

beforeEach(() => {
  reduceMotion = false;
  mqListeners.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduceMotion : false,
    media: query,
    addEventListener: (_: string, fn: () => void) => mqListeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => mqListeners.delete(fn),
  }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const eyebrowText = () => document.querySelector('.b-hero-eyebrow span:last-child')?.textContent ?? '';
const titleText = () => document.querySelector('.b-hero-title')?.textContent ?? '';
const onIndex = () =>
  [...document.querySelectorAll('.b-hero-slide')].findIndex((s) => s.classList.contains('is-on'));

describe('HomeHero · 輪播(H5)', () => {
  it('🔴 前提:四張 slide、四顆切換條,第 1 張一開始就是亮的', () => {
    render(<HomeHero />);
    expect(document.querySelectorAll('.b-hero-slide')).toHaveLength(4);
    expect(document.querySelectorAll('.b-hero-tick')).toHaveLength(4);
    expect(onIndex(), '一開始亮的不是第 1 張').toBe(0);
    // 前提斷言:文案真的渲染出來了,否則下面比對文案的斷言會在比兩個空字串
    expect(eyebrowText()).toContain('PCM MOTOR PARTS');
    expect(titleText()).toContain('改裝不只是升級配件');
  });

  it('🔴 圖與文案**一起**換(換圖沒換字 = 02 的照片配 01 的標題)', () => {
    render(<HomeHero />);
    advance(DWELL_MS);
    expect(onIndex(), '過了停留時間卻沒換圖').toBe(1);
    expect(eyebrowText(), '圖換了、眉標沒換').toContain('FITMENT');
    expect(titleText(), '圖換了、標題沒換').toContain('只看裝得上的東西');
    advance(DWELL_MS * 3);
    expect(onIndex(), '第 4 張之後沒有繞回第 1 張').toBe(0);
    expect(eyebrowText()).toContain('PCM MOTOR PARTS');
  });

  it('🔴 `prefers-reduced-motion` 開著 ⇒ **完全不自動輪播**(不是換得慢一點)', () => {
    reduceMotion = true;
    render(<HomeHero />);
    advance(DWELL_MS * 5);
    expect(onIndex(), '開了減少動效卻還在自動換 ⇒ 對前庭障礙使用者是實際的生理不適').toBe(0);
    // 反面:手動仍然可以切(「只留手動」的那一半)
    fireEvent.click(screen.getByLabelText('第 3 張主視覺'));
    expect(onIndex()).toBe(2);
    // 手動切完也不得偷偷恢復自動
    advance(DWELL_MS * 2);
    expect(onIndex(), '手動切換後自動輪播又活過來了').toBe(2);
  });

  it('🔴 滑鼠移入暫停、移出恢復', () => {
    const { container } = render(<HomeHero />);
    const hero = container.querySelector('.b-hero')!;
    fireEvent.pointerEnter(hero);
    advance(DWELL_MS * 2);
    expect(onIndex(), '滑鼠停在上面卻把客人正在讀的字抽掉').toBe(0);
    fireEvent.pointerLeave(hero);
    advance(DWELL_MS);
    expect(onIndex(), '滑鼠移開後沒有恢復自動').toBe(1);
  });

  it('🔴 鍵盤 focus 進來暫停(不只滑鼠;鍵盤使用者讀得更慢)', () => {
    render(<HomeHero />);
    fireEvent.focus(screen.getByLabelText('第 2 張主視覺'));
    advance(DWELL_MS * 2);
    expect(onIndex()).toBe(0);
    fireEvent.blur(screen.getByLabelText('第 2 張主視覺'));
    advance(DWELL_MS);
    expect(onIndex()).toBe(1);
  });

  it('🔴 分頁切到背景就停(回來才繼續;不是回來一次補跳好幾張)', () => {
    render(<HomeHero />);
    const hiddenSpy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    advance(DWELL_MS * 3);
    expect(onIndex(), '分頁在背景還在燒計時器').toBe(0);
    hiddenSpy.mockReturnValue(false);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    advance(DWELL_MS);
    expect(onIndex(), '回到前景沒有恢復').toBe(1);
    advance(1); // 確認不是一次補跳
    expect(onIndex()).toBe(1);
    hiddenSpy.mockRestore();
  });

  it('🔴 點切換條:換到那一張 + **重新計時**(不是接著原本剩下的時間跳走)', () => {
    render(<HomeHero />);
    advance(DWELL_MS - 500); // 距離自動換只剩 500ms
    fireEvent.click(screen.getByLabelText('第 4 張主視覺'));
    expect(onIndex()).toBe(3);
    advance(600); // 若沒重新計時,這裡就會被原本那顆計時器帶走
    expect(onIndex(), '點完切換條之後 0.6 秒就被跳走 ⇒ 沒有重新計時').toBe(3);
    advance(DWELL_MS);
    expect(onIndex(), '重新計時之後該繼續自動輪播').toBe(0);
  });

  it('🔴 切換條的 aria 狀態跟著走(報讀器要知道現在是第幾張)', () => {
    render(<HomeHero />);
    const ticks = [...document.querySelectorAll('.b-hero-tick')];
    expect(ticks[0]!.getAttribute('aria-current')).toBe('true');
    expect(ticks.filter((t) => t.getAttribute('aria-current') === 'true'), '同時有兩顆標成 current').toHaveLength(1);
    fireEvent.click(screen.getByLabelText('第 3 張主視覺'));
    expect(ticks[2]!.getAttribute('aria-current')).toBe('true');
    expect(ticks[0]!.getAttribute('aria-current'), '舊的那顆沒有清掉').toBeNull();
  });
});

describe('HomeHero · 資源行為(H5)', () => {
  it('🔴 第 1 張立刻載入且 fetchPriority=high;第 2-4 張在 load 之前**不發請求**', () => {
    // readyState 在 jsdom 預設是 'complete' ⇒ 要先壓成 loading 才測得到「延後」那一半
    const spy = vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading');
    render(<HomeHero />);
    const imgs = [...document.querySelectorAll('.b-hero-media img')];
    expect(imgs, '第 2-4 張在 load 之前就掛上 <img> ⇒ 首屏會同時吞四張 2.5K 大圖').toHaveLength(1);
    expect(imgs[0]!.getAttribute('src')).toBe('/hero/hero-01.jpg');
    expect(imgs[0]!.getAttribute('fetchpriority'), '第 1 張是 LCP,沒有 high 會排在其他資源後面').toBe('high');
    // 手機版藝術指導:窄螢幕吃的是另一張直式構圖,不是把寬版裁一裁
    const source = document.querySelector('.b-hero-slide source');
    expect(source?.getAttribute('srcset')).toBe('/hero/hero-01-m.jpg');
    expect(source?.getAttribute('media')).toBe('(max-width: 900px)');

    act(() => { window.dispatchEvent(new Event('load')); });
    const after = [...document.querySelectorAll('.b-hero-media img')];
    expect(after, 'load 之後第 2-4 張仍然沒掛上來 ⇒ 輪播會切到空的').toHaveLength(4);
    expect(after.map((i) => i.getAttribute('src'))).toEqual([
      '/hero/hero-01.jpg', '/hero/hero-02.jpg', '/hero/hero-03.jpg', '/hero/hero-04.jpg',
    ]);
    // 只有第 1 張是 high
    expect(after.filter((i) => i.getAttribute('fetchpriority') === 'high')).toHaveLength(1);
    spy.mockRestore();
  });

  it('🔴 四張圖都帶 width/height(缺了會在圖載入時把整頁往下推 = CLS)', () => {
    render(<HomeHero />); // jsdom 預設 readyState=complete ⇒ 四張都在
    const imgs = [...document.querySelectorAll('.b-hero-media img')];
    expect(imgs).toHaveLength(4);
    for (const img of imgs) {
      expect(img.getAttribute('width')).toBe('2560');
      expect(img.getAttribute('height')).toBe('1200');
      // 底圖是裝飾:alt 要空字串,不是沒有 alt(沒有 alt 報讀器會唸檔名)
      expect(img.getAttribute('alt')).toBe('');
    }
  });
});

describe('HomeHero · 入口板(H5)', () => {
  it('🔴 children(選車器)渲染在 `.b-hero-inner` 裡面,而 hero section 帶 #vehicle-finder', () => {
    const { container } = render(<HomeHero><div className="b-dock">選車器</div></HomeHero>);
    const hero = container.querySelector('section.b-hero')!;
    expect(hero.getAttribute('id'), 'Header 首頁那顆「依車輛搜尋」導的 /#vehicle-finder 會落空').toBe('vehicle-finder');
    expect(container.querySelector('.b-hero-inner > .b-dock'), 'dock 沒有落在 hero-inner 內').not.toBeNull();
  });

  it('沒有 children 時不會炸(hero 仍然完整渲染)', () => {
    const { container } = render(<HomeHero />);
    expect(container.querySelector('.b-hero-inner')).not.toBeNull();
    expect(container.querySelector('.b-dock')).toBeNull();
  });
});
