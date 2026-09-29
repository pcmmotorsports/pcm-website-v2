// @vitest-environment jsdom
// 商品列表工具列的入口:價格變動與新上架清單並排(2026-09-29;側欄維持 Sean 09-13 的 6 項)。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('server-only', () => ({}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('./product-filter-chips', () => ({ ProductSortSelect: () => null }));
vi.mock('./product-keyword-search', () => ({ ProductKeywordSearch: () => null }));
vi.mock('./product-sku-filter', () => ({ ProductSkuFilter: () => null }));

import { ProductToolbar } from './product-toolbar';

afterEach(cleanup);

describe('商品工具列入口', () => {
  it('「查看價格變動」與「查看新上架」都在, 連到各自的清單', () => {
    render(<ProductToolbar filter={{} as never} size={50} total={0} loadFailed={false} />);
    expect(screen.getByRole('link', { name: '查看價格變動' }).getAttribute('href')).toBe('/products/price-changes');
    expect(screen.getByRole('link', { name: '查看新上架' }).getAttribute('href')).toBe('/products/new-listings');
  });
});
