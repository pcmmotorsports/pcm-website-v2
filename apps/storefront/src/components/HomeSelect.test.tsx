// @vitest-environment jsdom
//
// HomeSelect smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「正常 / empty / error 三條 UI 分支 render 不報錯」。
// #5b 後改 href(Next.js Link)導航、不再用 useRouter;下方斷言精選卡 href 用真 slug(非 hashed id)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { HomeSelect } from './HomeSelect';
import type { FeaturedResult } from '@/lib/products';
import { MOCK_PRODUCTS } from '../data/mock-products';

afterEach(cleanup);

describe('HomeSelect', () => {
  it('should render the featured products grid without crashing', () => {
    const featured: FeaturedResult = { products: MOCK_PRODUCTS.slice(0, 4), error: false };
    render(<HomeSelect featured={featured} />);
    expect(screen.getByText('New Arrivals · 最新商品')).toBeDefined();
    expect(screen.getByText(MOCK_PRODUCTS[0]!.name)).toBeDefined();
    // #5b regression guard:精選卡導向真 slug(/products/<slug>),非 hashIdToNumber 雜湊數字。
    const links = screen.getAllByRole('link');
    expect(
      links.some((a) => a.getAttribute('href') === `/products/${MOCK_PRODUCTS[0]!.slug}`),
    ).toBe(true);
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
