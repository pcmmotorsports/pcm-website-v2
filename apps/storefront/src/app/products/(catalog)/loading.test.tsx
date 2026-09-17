// @vitest-environment jsdom
// /products 路由 loading fallback 的 smoke test。
// 驗導航尚在等待 server 資料時，使用者立即看得到目錄語境與骨架，而非停在舊頁面。

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/Header', () => ({
  Header: ({ currentPage }: { currentPage?: string }) => (
    <header data-testid="catalog-loading-header" data-current-page={currentPage} />
  ),
}));

import ProductsLoading from './loading';

describe('ProductsLoading', () => {
  it('should immediately render the catalog shell and product-card placeholders', () => {
    const { container } = render(<ProductsLoading />);

    expect(screen.getByTestId('catalog-loading-header').getAttribute('data-current-page')).toBe('catalog');
    expect(screen.getByRole('heading', { name: '全部商品' })).toBeDefined();
    expect(screen.getByRole('status', { name: '正在載入商品目錄' })).toBeDefined();
    expect(container.querySelectorAll('[data-testid="catalog-loading-card"]')).toHaveLength(8);
  });
});
