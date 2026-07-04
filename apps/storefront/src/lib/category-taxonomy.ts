// apps/storefront/src/lib/category-taxonomy.ts
//
// CategorySummary[](adapter.listCategories 回)→ 側欄 MockCategory[] 樹
// (FilterSide / FilterTop / FilterDrawer 的「零件分類」樹用)。純函式(無 server 依賴、
// 可單元測);對齊 vehicle-taxonomy 的 server-fetch→衍生模式(C2 接線、取代 data/mock-categories)。
//
// 選項 A(Sean 2026-07-04 拍):只保留「有商品」的分類(自身 productCount>0 或有非空子類),
// 不顯示「點了 0 結果」的死分類(與品牌側 #220c 一致);多品牌寫入後空分類自動長出。
//
// 🔴 目前真分類為單層(16 大類 + 碳纖維部品、parentId 全 null、無子類);本函式已備 parentId
//    分組邏輯,子類上架(#212)後自動組進 children。

import type { CategorySummary } from '@pcm/domain';
import type { MockCategory } from '@/data/mock-categories';

/**
 * 扁平 CategorySummary[](含 parentId / sortOrder / productCount)→ 兩層 MockCategory[] 樹。
 * - 頂層 = parentId === null,依 sortOrder 遞增。
 * - 子類 = parentId 指向頂層 id,依 sortOrder 遞增,只留 productCount > 0(選項 A)。
 * - 頂層只保留「自身 productCount > 0 或有非空子類」者(選項 A、無死分類)。
 * - count ← productCount。
 */
export function buildCategoryTree(summaries: CategorySummary[]): MockCategory[] {
  const subsByParent = new Map<string, CategorySummary[]>();
  for (const c of summaries) {
    if (c.parentId !== null) {
      const arr = subsByParent.get(c.parentId) ?? [];
      arr.push(c);
      subsByParent.set(c.parentId, arr);
    }
  }

  return summaries
    .filter((c) => c.parentId === null)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((top) => ({
      id: top.id,
      name: top.name,
      count: top.productCount,
      children: (subsByParent.get(top.id) ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((s) => s.productCount > 0)
        .map((s) => ({ id: s.id, name: s.name, count: s.productCount })),
    }))
    .filter((top) => top.count > 0 || top.children.length > 0);
}
