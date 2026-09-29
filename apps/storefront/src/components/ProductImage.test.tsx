// @vitest-environment jsdom
// ProductImage 的 priority(2026-09-29 手機速度:目錄 LCP 是第一張卡的照片, 卻是 loading="lazy")。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ProductImage } from './ProductImage';

afterEach(cleanup);

const REAL = 'https://cdn.shopify.com/s/files/perf-test.jpg';
const TRIM = { l: 0.1, t: 0.1, w: 0.5, h: 0.5, nw: 1000, nh: 1000 };
const imgOf = (c: HTMLElement) => c.querySelector('img')!;

describe('ProductImage priority', () => {
  const cases: [string, Parameters<typeof ProductImage>[0]][] = [
    ['真圖 contain', { image: REAL }],
    ['真圖 trim', { image: REAL, trim: TRIM }],
    ['沒照片 ⇒ 品牌 logo', { image: null, brandSlug: 'akrapovic' }],
    ['沒照片也沒 logo ⇒ 站內佔位圖', { image: null, brandSlug: null }],
  ];

  for (const [name, props] of cases) {
    it(`${name}:priority ⇒ 立刻載入、高優先`, () => {
      const { container } = render(<ProductImage {...props} priority />);
      expect(imgOf(container).getAttribute('loading')).toBe('eager');
      expect(imgOf(container).getAttribute('fetchpriority')).toBe('high');
    });

    it(`🔵 ${name}:沒給 priority ⇒ 照舊延遲載入`, () => {
      const { container } = render(<ProductImage {...props} />);
      expect(imgOf(container).getAttribute('loading')).toBe('lazy');
      expect(imgOf(container).getAttribute('fetchpriority')).toBeNull();
    });
  }
});
