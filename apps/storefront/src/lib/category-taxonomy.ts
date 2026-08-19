// apps/storefront/src/lib/category-taxonomy.ts
//
// CategorySummary[](adapter.listCategories 回)→ 側欄 MockCategory[] 樹
// (FilterSide / FilterTop / FilterDrawer 的「零件分類」樹用)。純函式(無 server 依賴、
// 可單元測);對齊 vehicle-taxonomy 的 server-fetch→衍生模式(C2 接線、取代 data/mock-categories)。
//
// 選項 A(Sean 2026-07-04 拍):只保留「有商品」的分類(自身 productCount>0 或有非空子類),
// 不顯示「點了 0 結果」的死分類(與品牌側 #220c 一致);多品牌寫入後空分類自動長出。
//
// ✅ 真分類**已經是兩層**:大類 29 / 子類 78 / 最深層數 2
//    (2026-08-19 Sean 本人於**正式庫** Supabase SQL Editor 實查並貼回;同批:分類表共 107 列、
//     商品 20341 件全部有 category_id、而商品實際用到的分類是 81 個 ⇒ 26 個分類目前沒有商品)
//    ⇒ 本函式的 parentId 分組邏輯**現在就在生效**,不是備而未用。
//
// 🔴 **上面那些數字會隨每日同步變動 —— 不要當常數。**要現值就跑這一發(唯讀):
//      select count(*) filter (where parent_category_id is not null) as 子類,
//             count(*) filter (where parent_category_id is null)     as 大類,
//             max(jsonb_array_length(segments))                      as 最深層數
//      from categories;
//    回「子類 = 0」⇒ 真的變回單層,本段要改回去;回數十 ⇒ 本段仍然成立。

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
    .map((top) => {
      const children = (subsByParent.get(top.id) ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .filter((s) => s.productCount > 0)
        .map((s) => ({ id: s.id, name: s.name, count: s.productCount }));
      // 大類顯示數 = 自身直掛商品(兩層下商品全掛子類、通常 0)+ 子類加總(rollup、
      // 對齊 matchesCategory「點大類涵蓋所有子類」);單層(無子類)時退化為自身數。
      const count = top.productCount + children.reduce((sum, c) => sum + c.count, 0);
      return { id: top.id, name: top.name, count, children };
    })
    .filter((top) => top.count > 0 || top.children.length > 0);
}
