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
});
