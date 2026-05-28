// @vitest-environment jsdom
//
// FavoritesTab smoke(g-3:空狀態)。
//
// 驗:
// - 標題「收藏清單」+ acc-section 殼(data-tab="favorites")
// - acc-empty「目前尚無收藏商品」+ sub「您的收藏會顯示在此」
// - 不洩 design mock 商品字面(LIGHTECH / RIZOMA / Akrapovič / NT$ 12,800 等;
//   防 g-3 反走樣搬 design data.products.slice(0, 6) mock)

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FavoritesTab } from './FavoritesTab';

afterEach(cleanup);

describe('FavoritesTab(g-3 空狀態)', () => {
  it('標題「收藏清單」+ acc-section 殼', () => {
    const { container } = render(<FavoritesTab />);
    expect(screen.getByText('收藏清單')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="favorites"]')).toBeTruthy();
    expect(container.querySelector('.acc-section-head h2')).toBeTruthy();
  });

  it('acc-empty 文案「目前尚無收藏商品」+ sub「您的收藏會顯示在此」', () => {
    const { container } = render(<FavoritesTab />);
    expect(container.querySelector('.acc-empty')).toBeTruthy();
    expect(screen.getByText('目前尚無收藏商品')).toBeTruthy();
    expect(screen.getByText('您的收藏會顯示在此')).toBeTruthy();
  });

  it('不洩 design mock 商品字面(防 g-3 反走樣)', () => {
    const { container } = render(<FavoritesTab />);
    expect(container.textContent).not.toContain('LIGHTECH');
    expect(container.textContent).not.toContain('RIZOMA');
    expect(container.textContent).not.toContain('Akrapovič');
    expect(container.textContent).not.toContain('AKRAPOVIČ');
    expect(container.textContent).not.toContain('NT$');
  });
});
