// @vitest-environment jsdom
//
// BrandIndex smoke test — WO-3 工作流優化、前台 regression 安全網。
// 驗「render 不報錯」(純展示 server component、無互動)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BrandIndex } from './BrandIndex';
import { MOCK_BRANDS } from '../data/mock-brands';

afterEach(cleanup);

describe('BrandIndex', () => {
  it('should render the authorized brands wall without crashing', () => {
    render(<BrandIndex />);
    expect(screen.getByText('Authorized brands · 授權代理')).toBeDefined();
    expect(screen.getByText(MOCK_BRANDS[0]!.name)).toBeDefined();
  });

  it('Q4-S5:品牌連結導 /products?brand=<slug>(修 /brands 404;= parseBrandFilterFromUrl 比對鍵)', () => {
    render(<BrandIndex />);
    const first = MOCK_BRANDS[0]!;
    const link = screen.getByText(first.name).closest('a');
    expect(link?.getAttribute('href')).toBe(`/products?brand=${first.id}`);
    // 「品牌專區」表頭連結不再指向不存在的 /brands
    expect(screen.getByText('品牌專區').closest('a')?.getAttribute('href')).toBe('/products');
  });
});
