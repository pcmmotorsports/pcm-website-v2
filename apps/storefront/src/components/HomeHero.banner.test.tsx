// @vitest-environment jsdom
//
// HomeHero × 新品大圖(email 新品 → 首頁大圖 片 3;2026-09-16)。
// 原本四張輪播的行為由 `HomeHero.test.tsx` 守(沒傳 banner ⇒ 四張,那支一個字沒改)。
// 這支守:有大圖 ⇒ 第 1 張、先播(Sean Q11 甲)、兩種圖的類型、按鈕連結、輪播張數 5。
// ⚠️ 擋不住:版面(展示台位置、字有沒有壓到台面)—— 那要真瀏覽器截圖。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { HomeHero } from './HomeHero';
import type { LiveHomeBanner } from '@/lib/home-banners';
import { HOME_BANNER_MOTION_MS } from '@pcm/domain';

const SCENE: LiveHomeBanner = {
  id: 'b1',
  eyebrow: 'AKRAPOVIC ‧ 新品到貨',
  titleLine1: 'Slip-On 鈦合金尾段，',
  titleLine2: '2026 年式新款到貨',
  subtitle: '適用 BMW S 1000 RR · 已上架 6 件',
  ctaLabel: '看 Akrapovic 新品',
  linkPath: '/products?pbrands=akrapovic',
  imageDesktopUrl: 'https://cdn.example.com/scene.jpg',
  imageMobileUrl: 'https://cdn.example.com/scene-m.jpg',
  kind: 'scene',
};
const PRODUCT: LiveHomeBanner = { ...SCENE, id: 'b2', kind: 'product', imageMobileUrl: null, imageDesktopUrl: 'https://cdn.example.com/white.jpg' };

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

const slides = () => [...document.querySelectorAll('.b-hero-slide')];
const onIndex = () => slides().findIndex((s) => s.classList.contains('is-on'));
const title = () => document.querySelector('.b-hero-title')?.textContent ?? '';

describe('HomeHero · 新品大圖', () => {
  it('🔴 有大圖 ⇒ 5 張 / 5 顆切換條,第 1 張是大圖而且一開始就亮', () => {
    render(<HomeHero banner={SCENE} />);
    expect(slides()).toHaveLength(5);
    expect(document.querySelectorAll('.b-hero-tick')).toHaveLength(5);
    expect(onIndex()).toBe(0);
    expect(slides()[0]?.getAttribute('data-banner-kind')).toBe('scene');
    expect(title()).toContain('Slip-On 鈦合金尾段');
    expect(document.querySelector('.b-hero-sub')?.textContent).toBe(SCENE.subtitle);
  });

  it('🔴 按鈕連到大圖的站內路徑,字是按鈕字', () => {
    render(<HomeHero banner={SCENE} />);
    const cta = document.querySelector<HTMLAnchorElement>('a.b-hero-cta');
    expect(cta?.getAttribute('href')).toBe('/products?pbrands=akrapovic');
    expect(cta?.textContent).toContain('看 Akrapovic 新品');
  });

  it('🔴 大圖是 LCP:第 1 張 fetchPriority=high、帶手機圖 source;實拍在 load 前不發請求', () => {
    Object.defineProperty(document, 'readyState', { value: 'loading', configurable: true });
    render(<HomeHero banner={SCENE} />);
    const imgs = [...document.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['https://cdn.example.com/scene.jpg']);
    expect(imgs[0]?.getAttribute('fetchpriority')).toBe('high');
    expect(document.querySelector('source')?.getAttribute('srcset')).toBe('https://cdn.example.com/scene-m.jpg');
    Object.defineProperty(document, 'readyState', { value: 'complete', configurable: true });
  });

  it('🔴 白底商品照 ⇒ 展示台 + section 掛 b-hero--stage;換到實拍那張就拿掉', () => {
    render(<HomeHero banner={PRODUCT} />);
    const section = document.querySelector('section.b-hero')!;
    expect(section.classList.contains('b-hero--stage')).toBe(true);
    expect(document.querySelector('.b-hero-stage img')?.getAttribute('src')).toBe('https://cdn.example.com/white.jpg');
    fireEvent.click(document.querySelectorAll('.b-hero-tick')[1]!);
    expect(section.classList.contains('b-hero--stage'), '切到實拍還掛著展示台樣式 ⇒ 字會被限寬').toBe(false);
    expect(title()).toContain('改裝不只是升級配件');
  });

  it('🔴 自動輪播跑完 5 張回到大圖(不是跳過它、也不是只在 4 張裡轉)', () => {
    render(<HomeHero banner={SCENE} />);
    for (let i = 1; i <= 5; i++) act(() => { vi.advanceTimersByTime(6500); });
    expect(onIndex()).toBe(0);
    expect(title()).toContain('Slip-On');
  });

  it('沒有副標 / 眉標 ⇒ 不畫空殼', () => {
    render(<HomeHero banner={{ ...SCENE, subtitle: null, eyebrow: null, titleLine2: null }} />);
    expect(document.querySelector('.b-hero-sub')).toBeNull();
    expect(document.querySelector('.b-hero-eyebrow')).toBeNull();
    expect(document.querySelector('.b-hero-title br')).toBeNull();
  });

  it('🔴 負對照:banner=null ⇒ 回到今天的 4 張,沒有按鈕與展示台', () => {
    render(<HomeHero banner={null} />);
    expect(slides()).toHaveLength(4);
    expect(document.querySelector('.b-hero-cta')).toBeNull();
    expect(document.querySelector('.b-hero-stage')).toBeNull();
  });

  it('🔴 m1 標題分層:第一行英文車款 ⇒ 小字層、第二行大標、中間不插 <br>', () => {
    render(<HomeHero banner={{ ...PRODUCT, titleLine1: 'KTM 1390 Super Adventure', titleLine2: '專用風鏡到貨' }} />);
    expect(document.querySelector('.b-hero-title .hb-t-model')?.textContent).toBe('KTM 1390 Super Adventure');
    expect(document.querySelector('.b-hero-title br')).toBeNull();
    expect(title()).toContain('專用風鏡到貨');
  });

  it('第一行有中文 ⇒ 沒有小字層、照舊兩行(負對照)', () => {
    render(<HomeHero banner={SCENE} />);
    expect(document.querySelector('.hb-t-model')).toBeNull();
    expect(document.querySelector('.b-hero-title br')).not.toBeNull();
  });

  it('🔴 動畫時間來自 @pcm/domain(掛在 section 的 CSS 變數上,CSS 檔不寫數字)', () => {
    render(<HomeHero banner={PRODUCT} />);
    const style = document.querySelector<HTMLElement>('section.b-hero')!.style;
    expect(style.getPropertyValue('--hb-kenburns')).toBe(`${HOME_BANNER_MOTION_MS.kenBurns}ms`);
    expect(style.getPropertyValue('--hb-stagger')).toBe(`${HOME_BANNER_MOTION_MS.textStagger}ms`);
  });

  it('🔴 展示台:圖在慢推層裡、光掃只掛在亮著的那張;手機台面小牌是眉標', () => {
    render(<HomeHero banner={PRODUCT} />);
    expect(document.querySelector('.b-hero-stage .hb-kb img')?.getAttribute('src')).toBe('https://cdn.example.com/white.jpg');
    expect(document.querySelector('.b-hero-stage .hb-sweep')).not.toBeNull();
    expect(document.querySelector('.b-hero-stage-inline .hb-tag')?.textContent).toBe(PRODUCT.eyebrow);
    fireEvent.click(document.querySelectorAll('.b-hero-tick')[1]!);
    expect(document.querySelector('.b-hero-stage .hb-sweep'), '切走還掛著 ⇒ 輪回來不會重掃').toBeNull();
  });
});
