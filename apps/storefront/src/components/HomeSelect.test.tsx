// @vitest-environment jsdom
//
// HomeSelect smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「正常 / empty / error 三條 UI 分支 render 不報錯」。
// useRouter 走 per-file vi.mock(router.push 只在點 ProductCard 時觸發)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { HomeSelect } from './HomeSelect';
import type { FeaturedResult } from '@/lib/products';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(cleanup);

describe('HomeSelect', () => {
  it('should render the featured products grid without crashing', () => {
    const featured: FeaturedResult = { products: MOCK_PRODUCTS.slice(0, 4), error: false };
    render(<HomeSelect featured={featured} />);
    expect(screen.getByText('The Selection · 編輯精選')).toBeDefined();
    expect(screen.getByText(MOCK_PRODUCTS[0]!.name)).toBeDefined();
  });

  it('should render the empty branch when there are no products', () => {
    const featured: FeaturedResult = { products: [], error: false };
    render(<HomeSelect featured={featured} />);
    expect(screen.getByText('目前沒有商品')).toBeDefined();
  });

  it('should render the error branch when the fetch failed', () => {
    const featured: FeaturedResult = { products: [], error: true };
    render(<HomeSelect featured={featured} />);
    expect(screen.getByText('載入失敗、請稍後再試')).toBeDefined();
  });
});
