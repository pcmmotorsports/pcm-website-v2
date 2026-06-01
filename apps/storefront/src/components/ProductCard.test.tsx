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
});
