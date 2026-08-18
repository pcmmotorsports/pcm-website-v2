// @vitest-environment jsdom
//
// FavoritesTab smoke(M-4b #191:空狀態 + 真清單)。
//
// 驗:
// - 標題「收藏清單」+ acc-section 殼(data-tab="favorites")
// - favorites=[] → acc-empty「目前尚無收藏商品」+ sub「您的收藏會顯示在此」
// - favorites 有料 → .acc-fav-grid 逐項 = 連到 /products/<handle> 的 <a> + 品牌 / 品名 / 價格
// - 🔴 **不洩 design mock 商品字面**(LIGHTECH / RIZOMA / Akrapovič / NT$ 12,800 等)
//   ⚠️ 這一格守的是「不要拿假資料裝成有收藏」,**不是**「不准出現商品」——
//   所以它只跑在 `favorites=[]` 那個 case 上;下面真清單的 case 用自己的假資料字面。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FavoriteListItem } from '@pcm/domain';
import { FavoritesTab } from './FavoritesTab';

afterEach(cleanup);

const item = (over: Partial<FavoriteListItem['product']> = {}): FavoriteListItem => ({
  favorite: {
    customerUserId: '00000000-0000-4000-8000-000000000001',
    productId: over.id ?? '00000000-0000-4000-8000-0000000000aa',
    createdAt: '2026-08-18T09:00:00.000Z',
  },
  product: {
    id: '00000000-0000-4000-8000-0000000000aa',
    handle: 'probe-part-1',
    title: '測試零件一號',
    brandName: 'PROBE',
    priceGeneral: 3300,
    imageUrl: 'https://example.test/probe-1.jpg',
    ...over,
  },
});

describe('FavoritesTab(M-4b #191)', () => {
  it('標題「收藏清單」+ acc-section 殼', () => {
    const { container } = render(<FavoritesTab favorites={[]} />);
    expect(screen.getByText('收藏清單')).toBeTruthy();
    expect(container.querySelector('.acc-section[data-tab="favorites"]')).toBeTruthy();
    expect(container.querySelector('.acc-section-head h2')).toBeTruthy();
  });

  it('沒有收藏 → acc-empty 文案「目前尚無收藏商品」+ sub「您的收藏會顯示在此」', () => {
    const { container } = render(<FavoritesTab favorites={[]} />);
    expect(container.querySelector('.acc-empty')).toBeTruthy();
    expect(container.querySelector('.acc-fav-grid')).toBeNull();
    expect(screen.getByText('目前尚無收藏商品')).toBeTruthy();
    expect(screen.getByText('您的收藏會顯示在此')).toBeTruthy();
  });

  it('沒有收藏時不洩 design mock 商品字面(防 g-3 反走樣)', () => {
    const { container } = render(<FavoritesTab favorites={[]} />);
    expect(container.textContent).not.toContain('LIGHTECH');
    expect(container.textContent).not.toContain('RIZOMA');
    expect(container.textContent).not.toContain('Akrapovič');
    expect(container.textContent).not.toContain('AKRAPOVIČ');
    expect(container.textContent).not.toContain('NT$');
  });

  it('🔴 有收藏 → 空狀態消失、改渲 .acc-fav-grid,每項連到 /products/<handle>', () => {
    const { container } = render(<FavoritesTab favorites={[item()]} />);
    expect(container.querySelector('.acc-empty')).toBeNull();
    const cards = container.querySelectorAll('a.acc-fav');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.getAttribute('href')).toBe('/products/probe-part-1');
    expect(screen.getByText('PROBE')).toBeTruthy();
    expect(screen.getByText('測試零件一號')).toBeTruthy();
    expect(screen.getByText('NT$ 3,300')).toBeTruthy();
    expect(container.querySelector('.acc-fav img')?.getAttribute('src')).toBe(
      'https://example.test/probe-1.jpg',
    );
  });

  it('🔴 沒有圖就不渲 <img>(空 src 會變成一塊看起來壞掉的灰底)', () => {
    const { container } = render(<FavoritesTab favorites={[item({ imageUrl: null })]} />);
    expect(container.querySelector('a.acc-fav')).toBeTruthy();
    expect(container.querySelector('.acc-fav img')).toBeNull();
  });

  it('🔴 沒有價格就不渲價格列(不印「NT$ null」也不印「NT$ 0」)', () => {
    const { container } = render(<FavoritesTab favorites={[item({ priceGeneral: null })]} />);
    expect(container.querySelector('.acc-fav-price')).toBeNull();
    expect(container.textContent).not.toContain('NT$');
  });
});
