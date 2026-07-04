// category-taxonomy 單元測試 — buildCategoryTree(CategorySummary[] → 側欄 MockCategory[])。
//
// C2 接線:選項 A(只留有商品分類、#220c 一致)+ parentId 分組 + sortOrder 排序。

import { describe, expect, it } from 'vitest';
import type { CategorySummary } from '@pcm/domain';
import { buildCategoryTree } from './category-taxonomy';

function cs(over: Partial<CategorySummary> & { id: string; name: string }): CategorySummary {
  return {
    path: { raw: over.name, segments: [over.name] },
    parentId: null,
    sortOrder: 0,
    productCount: 0,
    ...over,
  };
}

describe('buildCategoryTree', () => {
  it('選項 A:過濾掉 productCount=0 的頂層、保留有商品者', () => {
    const tree = buildCategoryTree([
      cs({ id: 'carbon', name: '碳纖維部品', productCount: 1117, sortOrder: 0 }),
      cs({ id: 'ctrl', name: '操控部品', productCount: 0, sortOrder: 1 }),
      cs({ id: 'exhaust', name: '排氣系統', productCount: 5, sortOrder: 2 }),
    ]);
    expect(tree.map((c) => c.name)).toEqual(['碳纖維部品', '排氣系統']);
    expect(tree.map((c) => c.count)).toEqual([1117, 5]);
  });

  it('頂層依 sortOrder 遞增(不靠輸入順序)', () => {
    const tree = buildCategoryTree([
      cs({ id: 'b', name: 'B', productCount: 2, sortOrder: 2 }),
      cs({ id: 'a', name: 'A', productCount: 1, sortOrder: 0 }),
    ]);
    expect(tree.map((c) => c.name)).toEqual(['A', 'B']);
  });

  it('子類(parentId)組進 children、只留有商品子類;自身空但有非空子類的頂層保留', () => {
    const tree = buildCategoryTree([
      cs({ id: 'main', name: '大類', productCount: 0, sortOrder: 0 }),
      cs({ id: 'sub1', name: '子1', parentId: 'main', productCount: 3, sortOrder: 1 }),
      cs({ id: 'sub2', name: '子2', parentId: 'main', productCount: 0, sortOrder: 2 }),
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe('大類');
    expect(tree[0]?.children.map((s) => s.name)).toEqual(['子1']);
  });

  it('全空 → 回空陣列(側欄分類區不顯死分類)', () => {
    expect(buildCategoryTree([cs({ id: 'x', name: 'X', productCount: 0 })])).toEqual([]);
  });

  it('RPM 現況(碳纖維部品 1117、16 大類全 0)→ 只留碳纖維部品一項', () => {
    const summaries = [
      cs({ id: 'carbon', name: '碳纖維部品', productCount: 1117, sortOrder: 0 }),
      ...Array.from({ length: 16 }, (_, i) => cs({ id: `m${i}`, name: `大類${i}`, productCount: 0, sortOrder: i + 1 })),
    ];
    const tree = buildCategoryTree(summaries);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toEqual({ id: 'carbon', name: '碳纖維部品', count: 1117, children: [] });
  });
});
