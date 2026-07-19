// @vitest-environment jsdom
//
// ProductCard smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯 + hover 切換不報錯」。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProductCard } from './ProductCard';
import { MOCK_PRODUCTS } from '../data/mock-products';

const product = MOCK_PRODUCTS[0]!;

afterEach(cleanup);

describe('ProductCard', () => {
  it('should render a product card without crashing', () => {
    render(<ProductCard p={product} />);
    expect(screen.getByText(product.brand)).toBeDefined();
    expect(screen.getByText(product.name)).toBeDefined();
  });

  it('should not crash on hover enter / leave', () => {
    render(<ProductCard p={product} />);
    const card = screen.getByText(product.name).closest('article')!;
    fireEvent.mouseEnter(card);
    fireEvent.mouseLeave(card);
    expect(card).toBeDefined();
  });

  it('should toggle the like button without crashing', () => {
    render(<ProductCard p={product} />);
    fireEvent.click(screen.getByLabelText('收藏'));
    expect(screen.getByLabelText('收藏')).toBeDefined();
  });

  it('should render an anchor with href when href prop is provided', () => {
    render(<ProductCard p={product} href={`/products/${product.slug}?from=catalog`} />);
    const anchor = screen.getByText(product.name).closest('a');
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute('href')).toBe(`/products/${product.slug}?from=catalog`);
  });

  it('should fall back to article + onClick when href is absent', () => {
    render(<ProductCard p={product} />);
    expect(screen.getByText(product.name).closest('a')).toBeNull();
    expect(screen.getByText(product.name).closest('article')).not.toBeNull();
  });

  // M-1-16c-1:真圖渲染 + 無圖 fallback
  it('should render the real product image when p.image is provided', () => {
    const realUrl = 'https://cdn.shopify.com/s/files/test-carbon.jpg';
    render(<ProductCard p={{ ...product, image: realUrl }} />);
    const imgs = screen.getAllByAltText(product.brand);
    expect(imgs.some((el) => el.getAttribute('src') === realUrl)).toBe(true);
    // 真圖分支只渲染單張、不走 unsplash placeholder
    expect(imgs.some((el) => el.getAttribute('src')?.includes('images.unsplash.com'))).toBe(false);
  });

  it('should fall back to placeholder gallery when p.image is absent', () => {
    render(<ProductCard p={product} />);
    const imgs = screen.getAllByAltText(product.brand);
    expect(imgs.some((el) => el.getAttribute('src')?.includes('images.unsplash.com'))).toBe(true);
  });

  // trim 線 S4b:去白邊模式 vs cover fallback
  it('should apply trim positioning and white background when p.imageTrim resolves', () => {
    const realUrl = 'https://cdn.shopify.com/s/files/test-trim.jpg';
    // l=t=0.1 w=h=0.5 方圖 → computeTrimStyle width 184% / left top -14.4%
    const trim = { l: 0.1, t: 0.1, w: 0.5, h: 0.5, nw: 1000, nh: 1000 };
    render(<ProductCard p={{ ...product, image: realUrl, imageTrim: trim }} />);
    const img = screen.getAllByAltText(product.brand).find((el) => el.getAttribute('src') === realUrl)!;
    expect(img.style.width).toBe('184%');
    expect(img.style.left).toBe('-14.4%');
    expect(img.style.top).toBe('-14.4%');
    expect(img.style.transformOrigin).toBe('35% 35%');
    expect(img.style.objectFit).toBe('');
    const gallery = img.closest('.pcard-gallery') as HTMLElement;
    expect(gallery.style.background).toContain('255, 255, 255');
  });

  it('should keep the cover path byte-identical when imageTrim is absent or too small', () => {
    const realUrl = 'https://cdn.shopify.com/s/files/test-cover.jpg';
    // 無 trim → cover
    render(<ProductCard p={{ ...product, image: realUrl }} />);
    // 內容過小(w=h=0.2 → 460% 超 300% 上限)→ 一樣 cover fallback
    render(<ProductCard p={{ ...product, image: realUrl, imageTrim: { l: 0.4, t: 0.4, w: 0.2, h: 0.2, nw: 1000, nh: 1000 } }} />);
    const covers = screen.getAllByAltText(product.brand).filter((el) => el.getAttribute('src') === realUrl);
    expect(covers.length).toBe(2);
    for (const img of covers) {
      expect(img.style.objectFit).toBe('cover');
      expect(img.style.width).toBe('100%');
      const gallery = img.closest('.pcard-gallery') as HTMLElement;
      expect(gallery.style.background).toContain('linear-gradient');
    }
  });
});
