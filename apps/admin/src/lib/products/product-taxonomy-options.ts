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
// 📌 附記:storefront `category-taxonomy.ts` 的檔頭一度寫著「真分類為單層、無子類」
//    (2026-07 的字面)—— **已於 2026-08-19 同日改掉並附上可跑的檢查**。
//    若你讀到的版本還是舊的,代表你在一個較早的 checkout 上。

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

/**
 * 品牌下拉選項:依名稱排(`brands` 表沒有 `sort_order`),**只留有商品的**。
 *
 * 🔴 **濾掉零商品品牌的理由與 `buildCategoryOptions` 同一條**(主視窗 2026-08-19 裁定):
 * 篩選器的每個選項都是一個承諾,一個點下去必然 0 筆的選項比沒有那個選項更糟。
 * 來由 = Sean 肉眼驗收逐字「多了很多沒有的品牌,有說要先不顯示」(`MAIN-063` D)。
 *
 * ⚠️ **而「他說有拍過板」那條拍板【查無】**(W2 2026-08-19 掃過 4,905 個 .md + `git log --all --grep`
 * 三種變體 + 11 種語意變體)。最接近的兩條(07-31 `Q2=A` / 08-04)講的是**客人站的品牌牆**、
 * 而且說的是**保留顯示、泛白、不可點**,與這裡的做法**相反** —— 兩條都已落實在客人站。
 * ⇒ 🔴 **本函式的做法不是「照 Sean 拍板」,是後台篩選器的通則**(換一個後台也會這樣做)。
 * 誰要把它改成泛白,先讀這段:那是刻意的分岔,不是漏抄。
 *
 * 🔴 **`selectedId` 那格不是便利功能,是在堵一個「畫面說 A、查詢做 B」**:
 * 沒有它,網址上帶著一個零商品品牌時 —— 下拉找不到對應的 `<option>` ⇒ 瀏覽器顯示第一個
 * 「全部品牌」,而查詢**照樣**在篩那個品牌 ⇒ 員工看到「全部品牌 + 0 筆」,
 * **既解釋不了、也清不掉**(他已經在「全部」那一格了,沒有東西可以改回去)。
 * ⇒ 選中的那個一律留在清單裡,不論它有沒有商品。它是那個狀態的唯一出口。
 * 📌 這與分類那邊 `resolveCategoryIds` 回 `null` 是**同一個病的兩種解**,而**兩種都要**:
 *    · 品牌**在表裡、只是零商品** ⇒ 把選項留著(本函式這一格)
 *    · 品牌**根本不在表裡**(被刪掉 + 舊書籤)⇒ **不套用品牌條件**(在 `app/products/page.tsx`,
 *      `brandKnown` 那一段;形狀照分類那條)
 * 🔴 ~~「品牌沒有路徑解析、id 認不認得無從判斷」~~ **作廢**(W6 `W6-051` F1):
 *    同一個請求裡就有整張 `brands` 表,`brands.some(b => b.id === filter.brandId)` 一行就判得出來,
 *    根本不需要路徑解析。**我寫的那個理由是錯的,而錯的理由會關掉下一個人的動作** ——
 *    它比「少做這個修法」更貴,因為讀到的人會以為做不到。
 *
 * 🔴 `idsWithProducts` **必須從資料算,不得寫死**(同 `buildCategoryOptions`)——
 * 那個集合每日同步跑完就會變。
 */
export function buildBrandOptions(
  rows: readonly BrandOptionRow[],
  idsWithProducts: ReadonlySet<string>,
  selectedId?: string,
): BrandOptionRow[] {
  return rows
    .filter((row) => idsWithProducts.has(row.id) || row.id === selectedId)
    .sort((a, b) => a.name.localeCompare(b.name));
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
