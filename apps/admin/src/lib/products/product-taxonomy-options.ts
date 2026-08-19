// apps/admin/src/lib/products/product-taxonomy-options.ts
//
// 商品列表「品牌 / 分類」篩選的**純函式層**(plan:`docs/specs/2026-08-19-admin-product-brand-category-filter-plan.md`)。
//
// 🔴 **為什麼獨立一支檔而不是併進 `product-repository.ts`**:G3 同時在動那一支
//    (商品頁分頁片,`.range()` 那一段)⇒ 兩片動同一支檔會撞。本檔零交集,
//    接線那一步等 G3 commit 後再做(plan §3 前置欄)。
//
// 🔴 **做法照顧客站,不重用它的元件**:
//    `apps/storefront/src/lib/category-taxonomy.ts:24-49` 的 `buildCategoryTree` 已經解過同一題
//    (扁平 `parentId` 列 → 兩層樹、依 `sortOrder`)。本檔沿用**那個做法**,
//    不 import 它 —— 它吃的是 storefront 的 `CategorySummary` / `MockCategory`(綁死該側型別),
//    而後台要的是「下拉選項」不是「側欄樹」。同 `product-filter-chips.tsx:11-19` 的紀律:
//    **不是重用元件,是照抄做法**。
//
// ✅ **層數已量到:2**(Sean 2026-08-19 於正式庫跑 `max(jsonb_array_length(segments))`;
//    同批量到 分類總數 107 / 大類 29 / 子類 78 / 商品用到 81 / 品牌 16 / 商品 20341 且零 NULL)
//    ⇒ 大類 → 子類連動成立,**不做遞迴**。而本檔的資料形狀對單層也退化得下去
//    (`children` 空陣列 ⇒ 呼叫端只畫一顆下拉)。
//
// ⚠️ 而 storefront `category-taxonomy.ts:10-11` 的註解逐字寫著「目前真分類為**單層**
//    (16 大類…parentId 全 null、無子類)」—— **那是 2026-07 的字面,現在 78 個子類**。
//    引用那支檔時不要連它的現況描述一起引。

/** `categories` 表撈下來的一列(欄位名逐字對齊 DB,見 `20260505130758_init_brands_categories.sql:38-47`)。 */
export interface CategoryOptionRow {
  readonly id: string;
  readonly name: string;
  /** 根→葉的完整路徑,例 `'引擎部品 · 排氣管'`;DB 上是 UNIQUE。 */
  readonly raw_path: string;
  readonly parent_category_id: string | null;
  readonly sort_order: number;
}

/** `brands` 表撈下來的一列。 */
export interface BrandOptionRow {
  readonly id: string;
  readonly name: string;
}

/** 下拉用的一個分類選項;`children` 空 = 這個大類沒有子類。 */
export interface CategoryOption {
  readonly id: string;
  readonly name: string;
  readonly rawPath: string;
  readonly children: readonly CategoryOption[];
}

/**
 * 扁平 `categories` 列 → 兩層下拉選項,**只留有商品的**。
 *
 * 🔴 **為什麼濾掉空分類**(主視窗 2026-08-19 裁定):正式庫量到 **分類表 107 個、
 * 而商品實際用到的只有 81 個** ⇒ **26 個分類一件商品都沒有**。
 * **一個點下去是空的篩選選項,比沒有那個選項更糟** —— 員工會以為「這個分類的商品不見了」,
 * 那是一次假警報。大類同理:底下子類全空且自身也沒商品 ⇒ 大類本身也不出現。
 *
 * ⚠️ **而我原本寫的是相反的**(理由:員工看到「這分類是空的」本身是資訊)。
 * 那個理由在**列表/管理頁**成立,在**篩選下拉**不成立 —— 篩選器的每個選項都是一個承諾。
 * 留這段是為了讓下一個人知道這裡權衡過,不要再翻一次。
 *
 * 🔴 `idsWithProducts` **必須從資料算,不得寫死** —— 那個集合會隨每日同步變動
 * (今天 81,明天可能 83)。
 *
 * 做法其餘部分對齊 storefront `category-taxonomy.ts:24-49` 的 `buildCategoryTree`;
 * 不帶 `count`(每個分類旁顯示件數 = facet counts,**不在本片範圍**)。
 *
 * 排序:兩層都依 `sort_order` 遞增,同值時依 `name` 穩定排(DB 的 `sort_order` 預設全 0,
 * 只靠它會讓下拉順序隨查詢回傳順序漂移)。
 */
export function buildCategoryOptions(
  rows: readonly CategoryOptionRow[],
  idsWithProducts: ReadonlySet<string>,
): CategoryOption[] {
  const byParent = new Map<string, CategoryOptionRow[]>();
  for (const row of rows) {
    if (row.parent_category_id === null) continue;
    const siblings = byParent.get(row.parent_category_id) ?? [];
    siblings.push(row);
    byParent.set(row.parent_category_id, siblings);
  }

  const toOption = (row: CategoryOptionRow, children: readonly CategoryOption[]): CategoryOption => ({
    id: row.id,
    name: row.name,
    rawPath: row.raw_path,
    children,
  });

  return rows
    .filter((row) => row.parent_category_id === null)
    .slice()
    .sort(compareRows)
    .map((top) =>
      toOption(
        top,
        (byParent.get(top.id) ?? [])
          .slice()
          .sort(compareRows)
          .filter((child) => idsWithProducts.has(child.id))
          .map((child) => toOption(child, [])),
      ),
    )
    .filter((top) => idsWithProducts.has(top.id) || top.children.length > 0);
}

function compareRows(a: CategoryOptionRow, b: CategoryOptionRow): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

/** 品牌下拉選項:依名稱排(`brands` 表沒有 `sort_order`)。 */
export function buildBrandOptions(rows: readonly BrandOptionRow[]): BrandOptionRow[] {
  return rows.slice().sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * 選中的分類(以 `raw_path` 表示)→ 要丟給 `.in('category_id', …)` 的 id 清單。
 *
 * 🔴 **選了大類要涵蓋它的子類** —— 對齊顧客站 `products-filter-logic.ts:63-74` 的
 * `matchesCategory`(子類=全等、大類=前綴)。差別在**後台比對的是 id 不是字串**:
 * 商品掛的是 `category_id`,而字串前綴比對在 DB 端要 `LIKE`,那會吃不到索引。
 * 這裡在**已經撈下來的分類清單上**解出 id 集合 ⇒ 零額外查詢、且走 `idx_products_category_id`。
 *
 * 回 `null` = 這個 `raw_path` 不認得 ⇒ 呼叫端應**不套用分類條件**(而不是套一個空集合
 * 讓畫面變成 0 件:網址被亂改時,「看到全部」比「看到空的」更不會誤導員工)。
 */
export function resolveCategoryIds(
  options: readonly CategoryOption[],
  rawPath: string | undefined,
): string[] | null {
  if (rawPath === undefined) return null;
  for (const top of options) {
    if (top.rawPath === rawPath) {
      return [top.id, ...top.children.map((child) => child.id)];
    }
    const child = top.children.find((candidate) => candidate.rawPath === rawPath);
    if (child !== undefined) return [child.id];
  }
  return null;
}
