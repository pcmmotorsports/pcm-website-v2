import {
  BRAND_PARAM,
  CATEGORY_PARAM,
  DEFAULT_PAGE_SIZE,
  KEYWORD_PARAM,
  SET_BY_PARAM,
  SIZE_PARAM,
  SKU_PARAM,
  SUBCATEGORY_PARAM,
  type AdminProductFilter,
} from '../../lib/products/product-list-view';
import type {
  BrandOptionRow,
  CategoryOption,
} from '../../lib/products/product-taxonomy-options';
import { AutoApplySubmit } from '../shared/auto-apply-submit';

// product-taxonomy-filter.tsx — 後台商品列表的「品牌 / 分類 / 子分類」篩選。
//
// Sean 2026-08-19 逐字:「有看到商品的搜尋功能了,接下來就是篩選,要有品牌、分類、子分類等等」。
//
// 🔴 **零 JS 的 `<form method="get">`,不是 client component** —— 抄同一頁既有的
//    `product-keyword-search.tsx`(該檔頭寫了為什麼)。`<select>` 的 onChange 需要 JS,
//    所以配一顆「套用」鈕:**不用 JS 也能操作**(plan §3 ⑤ 驗收條件逐字)。
//    🔴 **2026-08-19 更新**:那顆鈕改由 `shared/auto-apply-submit.tsx` 畫 —— 有 JS 時「選了就生效」、
//       沒 JS 時就是原本那顆鈕。表單的結構、欄位名、hidden 欄位一個字沒改。
//       來由:Sean 肉眼驗收逐字「點選後下方列表沒自動跳」(`MAIN-063` D;客戶頁 C 是同一句話)。
//
// 🔴 **選中態靠網址不靠 state** —— `product-filter-chips.tsx:11-19` 檔頭那三件紀律的第三件。
//    ⇒ 重新整理後選中態還在、可加書籤、上一頁能用。
//
// 🔴 **`page` 不給欄位 ⇒ 送出後回第 1 頁。** 與 `product-keyword-search.tsx` 完全同一條理由:
//    換篩選卻停在第 3 頁,常常直接看到空白頁 —— 而那看起來像「查無結果」,不像「你還在第 3 頁」。
//    ⚠️ 而 `size` **要**給 hidden 欄位(理由與 `page` **相反**):沒有它,員工選的「每頁 500」
//    會在按下「套用」的瞬間消失,而畫面上沒有任何提示。
//
// 🔴 **子分類下拉只在選了大類之後出現** —— 不是為了少畫一個框:
//    107 個分類全部攤平進一顆下拉,員工要滾過 78 個子類才找得到東西。
//    (層數 = 2 已量到,見 `product-taxonomy-options.ts` 檔頭 ⇒ 不做遞迴。)

/** 「全部」那一格的 value。空字串 ⇒ `URLSearchParams` 不會帶上這個 param(見下方 `<option>`)。 */
const ALL = '';

export function ProductTaxonomyFilter({
  filter,
  size,
  brands,
  categories,
}: {
  filter: AdminProductFilter;
  /** 目前的每頁筆數 —— 🔴 **必須帶著走**,理由同 `ProductFilterChips`。 */
  size: number;
  brands: readonly BrandOptionRow[];
  /** 已經濾掉「一件商品都沒有」的分類(見 `buildCategoryOptions`)。 */
  categories: readonly CategoryOption[];
}) {
  // 目前選中的大類:先看選中的 `raw_path` 是不是某個大類本身,再看它是不是某個大類的子類。
  // 🔴 認不得的 `raw_path` ⇒ `undefined` ⇒ 子分類下拉不出現、大類下拉停在「全部」
  //    —— 與 `resolveCategoryIds` 回 `null`(不套用分類條件)是**同一個決定的兩面**:
  //    網址被亂改時,畫面與查詢都退回「全部」,兩邊不會互相矛盾。
  const selectedTop = categories.find(
    (top) =>
      top.rawPath === filter.categoryPath ||
      top.children.some((child) => child.rawPath === filter.categoryPath),
  );
  const selectedIsChild = selectedTop !== undefined && selectedTop.rawPath !== filter.categoryPath;

  return (
    <form method='get' action='/products' className='flex flex-wrap items-end gap-2'>
      {/* 🔴 `size` 帶著走、`page` 不帶(兩者理由相反,見檔頭)。
          預設筆數不送 ⇒ 與 `buildProductListHref` 的省略規則對齊,網址才會長一樣。 */}
      {size !== DEFAULT_PAGE_SIZE && <input type='hidden' name={SIZE_PARAM} value={String(size)} />}

      {/* 🔴🔴 **把另外兩軸帶著走。** 沒有這兩格,員工搜尋「brembo」之後再選品牌,
          搜尋詞就被洗掉了 —— 而畫面看起來完全正常(清單真的變了、搜尋框變空)。
          那正是 `lib/products/product-list-view.ts` 檔頭記的那個病,只是換了個觸發點。 */}
      {filter.setBy !== undefined && (
        <input type='hidden' name={SET_BY_PARAM} value={filter.setBy} />
      )}
      {filter.keyword !== undefined && (
        <input type='hidden' name={KEYWORD_PARAM} value={filter.keyword} />
      )}
      {/* 🔴 料號那一軸也要帶著走。少這一格,員工貼完料號再換品牌,料號就被洗掉了 ——
          而畫面看起來完全正常(清單真的變了、貼料號的框變空)。 */}
      {filter.skus !== undefined && (
        <input type='hidden' name={SKU_PARAM} value={filter.skus.join(',')} />
      )}

      <div className='flex flex-col gap-1'>
        <label htmlFor='product-brand-filter' className='text-muted-foreground text-xs font-medium'>
          品牌
        </label>
        {/* 🔴🔴 **2026-08-20 廠牌可複選** —— UI 是【最小改動】:`<select>` 加 `multiple`。
            版面(chips / 樹狀)是四版稿真正打架的地方 ⇒ **押著等 Sean**,這一片不碰。
            ⚠️ **`multiple` 之後沒有「全部品牌」那一格** —— 多選清單的「全部」就是**一個都不選**,
               留著一個 value 為空的 option 會變成「可以選『全部』又同時選 Brembo」那種矛盾狀態。
            🔴 而送出的形狀**不是逗號** —— 瀏覽器把多選序列化成**同名多鍵**
               (`?brand=u1&brand=u2`;2026-08-20 chromium 實測)。
               `parseProductBrandIds` 兩種都收,理由見它的檔頭。 */}
        <select
          id='product-brand-filter'
          name={BRAND_PARAM}
          multiple
          size={4}
          defaultValue={filter.brandIds === undefined ? [] : [...filter.brandIds]}
          className='border-input bg-background rounded-md border px-2 py-1 text-sm w-48'
        >
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </div>

      <div className='flex flex-col gap-1'>
        <label
          htmlFor='product-category-filter'
          className='text-muted-foreground text-xs font-medium'
        >
          分類
        </label>
        {/* 🔴 值是 `raw_path` 不是 id —— `raw_path` 本身(`'引擎部品 · 排氣管'`)已經含著大類,
            ⇒ 查詢層只需要**一軸**(`AdminProductFilter.categoryPath`),不必再記大類是誰。
            ⚠️ 而**表單層是兩個欄位名**(這顆 `category`、子分類那顆 `subcategory`),
               理由見下方子分類那一段 —— 那是零 JS 的硬約束,不是這裡的設計選擇。 */}
        <select
          id='product-category-filter'
          name={CATEGORY_PARAM}
          defaultValue={selectedTop?.rawPath ?? ALL}
          className='border-input bg-background h-9 w-48 rounded-md border px-2 text-sm'
        >
          <option value={ALL}>全部分類</option>
          {categories.map((top) => (
            <option key={top.id} value={top.rawPath}>
              {top.name}
            </option>
          ))}
        </select>
      </div>

      {/* 🔴 只有「選了大類、而且那個大類真的有子類」時才畫子分類下拉。
          ⚠️ 兩個條件都要:有些大類的子類全是空的(已被 `buildCategoryOptions` 濾掉)
          ⇒ `children` 是空陣列 ⇒ 畫出來會是一顆只有「全部」的下拉,那是一個假的選擇。 */}
      {selectedTop !== undefined && selectedTop.children.length > 0 && (
        <div className='flex flex-col gap-1'>
          <label
            htmlFor='product-subcategory-filter'
            className='text-muted-foreground text-xs font-medium'
          >
            子分類
          </label>
          {/* 🔴🔴 這顆用 `?subcategory=`,**不與上面那顆同名** —— 而那不是命名偏好,
              是零 JS 下唯一走得通的做法:同名欄位 HTML 會**兩個都送**
              ⇒ `?category=大類&category=子類` ⇒ Next 解析成陣列
              ⇒ `parseProductCategoryPath` 回 `undefined` ⇒ **篩選失效而畫面完全正常**。
              ⇒ 兩個名字 + `parseProductListParams` 讀「子的優先」(見 `SUBCATEGORY_PARAM` 檔頭)。
              📌 而**網址仍然只有一種正規寫法**:`buildProductListHref` 永遠只寫 `?category=`,
                 因為 `raw_path` 本身已經含著大類。 */}
          <select
            id='product-subcategory-filter'
            name={SUBCATEGORY_PARAM}
            defaultValue={selectedIsChild ? (filter.categoryPath ?? ALL) : ALL}
            className='border-input bg-background h-9 w-48 rounded-md border px-2 text-sm'
          >
            <option value={ALL}>全部子分類</option>
            {selectedTop.children.map((child) => (
              <option key={child.id} value={child.rawPath}>
                {child.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 🔴 文案是「套用篩選」不是「套用」—— 而這是**在真瀏覽器上撞出來的**,不是想出來的:
          分頁片(G3)的「每頁筆數」表單也有一顆叫「套用」的鈕,兩顆同時在這一頁上。
          playwright 用無障礙名稱點它時直接 strict-mode 撞名 ——
          🔴 **而讀螢幕閱讀器的員工聽到的就是那兩個一模一樣的名字。**
          ⇒ 這顆講清楚自己套用的是什麼。(另一顆屬 G3 的檔,不在本片範圍,已列進回報。) */}
      <AutoApplySubmit
        label='套用篩選'
        className='bg-primary text-primary-foreground h-9 rounded-md px-3 text-sm'
      />
    </form>
  );
}
