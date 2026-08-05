// @vitest-environment jsdom
//
// FeatureEditorial — 版位渲染(D5e-1 起改資料驅動)。
// 決策那一面(輪播是誰、fallback 怎麼退)在 `lib/brand-focus.test.ts`,本支不重複驗;
// 這裡只驗「給了一顆 focus,版位有沒有把每一欄真的畫出來」。
//
// 🔴 D5e-1 之前這支只有一條 smoke test,而版位的內容**全部硬編在 JSX 裡** ——
//    所以「把資料接錯欄位」這一族(標題吃到 body、facts 只畫第一則、照片吃到品牌名)
//    以前零覆蓋。改資料驅動之後這些才變成真的會發生的錯,故補齊。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FeatureEditorial } from './FeatureEditorial';
import type { ResolvedBrandFocus } from '@/lib/brand-focus';

afterEach(cleanup);

const focus: ResolvedBrandFocus = {
  slug: 'rizoma',
  name: 'RIZOMA',
  title: '工藝之鏡',
  body: '第一行。<br>第二行。',
  caption: '義大利',
  facts: [
    ['ORIGIN', 'Milano, Italy'],
    ['SINCE', '2000'],
    ['CRAFT', 'CNC · Anodized'],
  ],
  photo: 'https://example.test/rizoma.jpg',
};

describe('FeatureEditorial', () => {
  it('should render the monthly feature section without crashing', () => {
    render(<FeatureEditorial focus={focus} />);
    expect(screen.getByText('This month · 本月聚焦')).toBeDefined();
    expect(screen.getByText('工藝之鏡')).toBeDefined();
  });

  // 🔴 每一欄都要畫出來。這條擋的是「接線錯但長得很正常」那一族:
  //    少畫一則 fact、或標題吃到 body,畫面看起來仍然是完整的一個版位。
  it('🔴 三則事實的標籤與值全部畫出來(不是只畫第一則)', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    expect(container.querySelectorAll('.ed-feature-meta > div')).toHaveLength(3);
    for (const [label, value] of focus.facts) {
      expect(screen.getByText(label), `事實標籤「${label}」沒畫出來`).toBeDefined();
      expect(screen.getByText(value), `事實值「${value}」沒畫出來`).toBeDefined();
    }
  });

  // 🔴 `body` 帶白名單標記 ⇒ 必須過 `BrandRichText` 變成真的 `<br>`,
  //    而不是把 `<br>` 三個字原樣印在畫面上(那是「沒過 parser」的症狀)。
  it('🔴 敘述的 <br> 被解析成換行元素、不是印出字面', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    const body = container.querySelector('.ed-feature-body');
    expect(body?.querySelectorAll('br')).toHaveLength(1);
    expect(body?.textContent).toBe('第一行。第二行。');
    expect(body?.textContent).not.toContain('<br>');
  });

  it('🔴 標題 = 品牌名 + 鉤子兩段(鉤子不重複寫品牌名,名字由版位另外提供)', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    const h2 = container.querySelector('.ed-feature-title');
    expect(h2?.textContent).toBe('RIZOMA.工藝之鏡');
    expect(h2?.querySelector('em')?.textContent).toBe('工藝之鏡');
  });

  it('🔴 CTA 連到當期品牌、文字帶當期品牌名(硬編 rizoma 的話換一家就錯)', () => {
    const { container } = render(<FeatureEditorial focus={{ ...focus, slug: 'k-speed', name: 'K-SPEED' }} />);
    const link = container.querySelector('a[href*="brand="]');
    expect(link?.getAttribute('href')).toBe('/products?brand=k-speed');
    expect(link?.textContent).toContain('探索 K-SPEED');
  });

  it('圖說吃 caption(產地),圖的 alt 吃品牌名', () => {
    const { container } = render(<FeatureEditorial focus={focus} />);
    expect(container.querySelector('.ed-feature-caption')?.textContent).toContain('義大利');
    const img = container.querySelector('.ed-feature-media img');
    expect(img?.getAttribute('src')).toBe(focus.photo);
    expect(img?.getAttribute('alt')).toBe('RIZOMA');
  });

  // 🔴 `photo` 為 null 時整個媒體欄不建 —— 不是建一個 `<img src="">`(那會是破圖框)。
  //    D5e-2 搬 20 家時必然會遇到某幾家還沒有產品特寫照。
  it('🔴 沒有照片時不渲染媒體欄,而不是畫一個 src 空的 <img>', () => {
    const { container } = render(<FeatureEditorial focus={{ ...focus, photo: null }} />);
    expect(container.querySelector('.ed-feature-media')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    // 左欄仍在 ⇒ 版位不是整個消失
    expect(container.querySelector('.ed-feature-side')).not.toBeNull();
  });
});
