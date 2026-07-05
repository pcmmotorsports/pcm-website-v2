// @vitest-environment jsdom
//
// CategoryGrid smoke test — 前台 regression 安全網。
// Q4-S5(2026-07-05):改吃真 categories prop、link ?category=<真分類名>(修死連結)。
// 驗:真分類名渲染 + link 帶正確 category 參數 + 空 categories 不渲染整段。

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CategoryGrid } from './CategoryGrid';
import type { MockCategory } from '../data/mock-categories';

afterEach(cleanup);

const CATS: MockCategory[] = [
  { id: 'c1', name: '操控部品', count: 84, children: [] },
  { id: 'c2', name: '碳纖維部品', count: 52, children: [] },
];

describe('CategoryGrid', () => {
  it('renders real categories with working ?category= deep links', () => {
    render(<CategoryGrid categories={CATS} />);
    expect(screen.getByText('Categories · 部品分類')).toBeDefined();
    const link = screen.getByText('操控部品').closest('a');
    // link 帶真分類名(encodeURIComponent 後、= parseCategoryFromUrl / matchesCategory 比對鍵)
    expect(link?.getAttribute('href')).toBe(`/products?category=${encodeURIComponent('操控部品')}`);
  });

  it('sorts by count desc and caps at 8 cards (保留 design 8 卡格版面)', () => {
    const many: MockCategory[] = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, name: `類${i}`, count: i, children: [],
    }));
    render(<CategoryGrid categories={many} />);
    // count 最大者(類11)在、被 cap 掉的最小者(類0)不在
    expect(screen.getByText('類11')).toBeDefined();
    expect(screen.queryByText('類0')).toBeNull();
  });

  it('renders nothing when categories empty (不顯假卡/空格)', () => {
    const { container } = render(<CategoryGrid categories={[]} />);
    expect(container.querySelector('.ed-cats')).toBeNull();
  });
});
