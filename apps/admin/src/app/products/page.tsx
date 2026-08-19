import Link from 'next/link';
// 相對 import(非 `@/`):根 `vitest.config.ts` 的 `@` alias 指向 **storefront** 的 src
// ⇒ admin 檔案用 `@/` 在測試裡 resolve 不到、這頁就測不起來(先例逐字見
// `app/settings/suppliers/page.tsx:14-19`、`app/customers/page.tsx:2-4`)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
import { ProductsTable } from '../../components/products/products-table';
import { ProductFilterChips } from '../../components/products/product-filter-chips';
import { ProductKeywordSearch } from '../../components/products/product-keyword-search';
import { ProductTaxonomyFilter } from '../../components/products/product-taxonomy-filter';
import { ListPagination } from '../../components/shared/list-pagination';
import {
  listProductFilterOptions,
  listProductsForAdmin,
  type AdminProductPage,
  type ProductFilterOptions,
} from '../../lib/products/product-repository';
import {
  buildCategoryOptions,
  buildBrandOptions,
  resolveCategoryIds,
} from '../../lib/products/product-taxonomy-options';
import {
  DEFAULT_PAGE_SIZE,
  KEYWORD_PARAM,
  PAGE_PARAM,
  PAGE_SIZE_OPTIONS,
  SET_BY_PARAM,
  SIZE_PARAM,
  BRAND_PARAM,
  CATEGORY_PARAM,
  buildProductListHref,
  buildProductListHrefResetPage,
  parseProductListParams,
} from '../../lib/products/product-list-view';
import { detectPageTruncation } from '../../lib/shared/list-params';

// M-4b #20 片1a:後台商品列表(唯讀)。plan = docs/specs/2026-08-14-products-admin-slice1a-plan.md。
// force-dynamic:讀 searchParams + DB 查、不靜態預渲染(同 customers/orders 兩頁)。
export const dynamic = 'force-dynamic';

// 🔴 **`PRODUCTS_PAGE_SIZE = 20` 已移除**(2026-08-19 分頁片)——
//    每頁筆數改由網址 `?size=` 決定,合法值與預設在 `lib/products/product-list-view.ts`
//    (`PAGE_SIZE_OPTIONS` / `DEFAULT_PAGE_SIZE`)。舊常數留著會變成第二個真相來源。
//    Sean 逐字規格:「單頁要能看到 200-500 以上,下方頁數選擇要可以自填頁數」。

type SearchParams = Record<string, string | string[] | undefined>;

// 🔴 `?page=` / `?set_by=` / `?q=` 的解析與**連結組裝**都搬去
//    `lib/products/product-list-view.ts`(`#661`)。搬的理由不是整理:
//    **本檔 :106 那行 `buildHref` 逐字只帶 `page`,把 `set_by` 丟掉了** ——
//    員工按「手動」再按「下一頁」就回到全部商品,而 chip 高亮跳回「全部」。
//    ⇒ 解析與組裝住在一起,才有辦法用往返測試釘住「進去什麼、出來什麼」。

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const { filter, view } = parseProductListParams(raw);
  const offset = (view.page - 1) * view.size;

  // 🔴🔴 **下拉選項先撈,而且它【失敗不算列表失敗】** —— 兩個 try 是刻意分開的:
  //    選項撈不到 ⇒ 少兩顆下拉,商品列表照樣看得到(降級,不是壞掉);
  //    列表撈不到 ⇒ 才是「這一頁壞了」。
  //    合成一個 try 的話,`brands` 那張小表出問題會讓**整頁商品消失**,
  //    而員工看到的是「商品列表載入失敗」—— 一個完全指錯方向的訊息。
  let options: ProductFilterOptions | null = null;
  try {
    options = await listProductFilterOptions();
  } catch (error) {
    console.error('[admin/products] 篩選選項載入失敗(列表不受影響)', error);
  }

  const categoryOptions =
    options === null
      ? []
      : buildCategoryOptions(options.categories, options.categoryIdsWithProducts);
  const brandOptions = options === null ? [] : buildBrandOptions(options.brands);

  // 🔴 選了大類 ⇒ 要含它自己 + 它的子類;認不得的 `raw_path` ⇒ `null` ⇒ **不套用分類條件**
  //    (看到全部,不是看到空的 —— 理由逐字在 `resolveCategoryIds` 檔頭)。
  //    ⚠️ 選項撈失敗時 `categoryOptions` 是空陣列 ⇒ 這裡一律回 `null` ⇒ 分類條件不套用。
  //       **那是對的**:此時畫面上根本沒有分類下拉,再拿一個解不出來的路徑去砍列表
  //       只會讓員工看到一個他無法解釋、也無法清除的空清單。
  const categoryIds = resolveCategoryIds(categoryOptions, filter.categoryPath) ?? undefined;

  // 🔴🔴 **R1 審查 important-4:網址上有分類篩選,而查詢沒套上它 —— 這件事畫面上看不出來。**
  //    兩條可達路徑,而兩條的畫面都是「一份看起來正常的清單」:
  //      ① 選項撈失敗 ⇒ `categoryOptions` 空 ⇒ `?category=` 被丟掉,
  //         **而 `?brand=` 照樣生效** ⇒ 員工看到一份「品牌篩過、分類沒篩」的清單,
  //         且此時兩顆下拉整塊不畫 ⇒ **他沒有任何控制項可以解釋或清掉它**。
  //      ② 選項撈成功,但那個分類今天同步後變成 0 件 ⇒ 被 `buildCategoryOptions` 濾掉
  //         ⇒ 舊書籤 `?category=X` 從「0 件」變成 **整本兩萬多件**。
  //    ⇒ 講出來 + 給一條清得掉的路。**不自動改寫網址** —— 那會讓「我明明選了」變成無聲的消失。
  const categoryFilterDropped = filter.categoryPath !== undefined && categoryIds === undefined;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識、DB error 不外洩到畫面(同 customers/page.tsx:37-48)。
  let result: AdminProductPage | null = null;
  let loadFailed = false;
  try {
    result = await listProductsForAdmin(view.size, offset, {
      setBy: filter.setBy,
      keyword: filter.keyword,
      brandId: filter.brandId,
      categoryIds,
    });
  } catch (error) {
    console.error('[admin/products] 商品列表載入失敗', error);
    loadFailed = true;
  }

  const items = result?.items ?? [];
  const total = result?.total ?? 0;

  // 🔴🔴 **這一頁是不是被砍過** —— 見 `detectPageTruncation` 的檔頭。
  //    它取代了「頁大小要小於 db-max-rows」那個**靠設定值的假設**:
  //    那個上限在 Supabase Dashboard 上點一下就能改小,而改小的那天**不會有任何東西紅**。
  //    ⚠️ 讀取失敗時不判(那時 total/items 都是保底的 0,判了會誤報)。
  const truncation = loadFailed ? null : detectPageTruncation(total, view.page, view.size, items.length);

  // 兩個 GET 表單(換筆數 / 跳頁)要原封帶過去的篩選軸。
  // 🔴 **不含 `page` 與 `size`** —— 那兩軸各自由表單自己的欄位提供,見 `ListPaginationJump`。
  //    🔴 新增的兩軸也要在這裡 —— 少了它們,員工篩了品牌再「跳到第 5 頁」,
  //       品牌篩選會消失而畫面上的下拉仍顯示著那個品牌(本頁檔頭記的那個病的第三個觸發點)。
  //    📌 分類只帶 `CATEGORY_PARAM`(不帶 `subcategory`):`filter.categoryPath` 已經是
  //       解析後的**單一真相**,而 `buildProductListHref` 也只寫這個 param ⇒ 兩邊一致。
  const filterFields = {
    [SET_BY_PARAM]: filter.setBy,
    [KEYWORD_PARAM]: filter.keyword,
    [BRAND_PARAM]: filter.brandId,
    [CATEGORY_PARAM]: filter.categoryPath,
  };

  return (
    <div className='mx-auto space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>商品</h1>
        {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 件</p>}
      </div>

      {/* 🔴 不寫「編輯功能即將推出」那種對未來的承諾
          (同 settings/suppliers/page.tsx:74-76 的教訓:不得宣稱尚未生效的功能)。
          🔴🔴 **2026-08-19 更正方向(G2 通報)**:原句是「目前只能查看,不能修改」——
          而 `4f54a851` 已經在**商品明細頁**放了上下架表單 ⇒ 那句話開始**否認一個已經存在的功能**。
          症狀不是「文案不精確」:員工讀到「不能修改」就不會點進明細 ⇒ **那顆鈕等於不存在**,
          而 Sean 2026-08-15 拍了那個板、等了四天才有介面。
          ⇒ 教訓的方向是【不得宣稱不存在的功能】,而它的反面**同樣要守**:
            **不得否認已經存在的功能**。兩個方向都由 :199 那組測試釘著。 */}
      <p className='text-muted-foreground text-sm'>
        這裡列出所有商品,含已下架的。上架/下架請點進商品明細頁,其餘欄位目前不能修改。
      </p>

      {/* 🔴 上線初期「手動」會是 0 筆 —— 因為把商品設成手動的入口還沒做(plan §5 Q3=乙)。
          這句話存在的理由:不寫的話,Sean 打開來看到 0 筆會以為篩選壞了。 */}
      {/* 🔴 搜尋框在標題列與篩選列【之間】,位置抄 customers 那一面
          (`app/customers/page.tsx:80`)⇒ 員工的視線順序是
          「這一頁是什麼 → 我要找什麼 → 再細分」。
          ⚠️ 它畫在 `loadFailed` 判斷【外面】:讀取失敗時搜尋框仍要在 ——
          否則員工唯一能做的動作(換個詞再試)會跟著錯誤訊息一起消失。 */}
      <ProductKeywordSearch filter={filter} size={view.size} />

      {!loadFailed && (
        <>
          <ProductFilterChips filter={filter} size={view.size} />
          {categoryFilterDropped && (
            <p className='border-input text-muted-foreground rounded-md border border-dashed p-3 text-sm'>
              網址帶著分類「{filter.categoryPath}」,但目前套用不上(選項載入失敗,或這個分類已經沒有商品)
              —— <strong>下面的清單沒有依分類篩選</strong>。
              <Link
                href={buildProductListHrefResetPage({ ...filter, categoryPath: undefined }, view.size)}
                className='text-primary ml-2 underline'
              >
                清除分類條件
              </Link>
            </p>
          )}
          {/* 🔴 選項撈失敗 ⇒ 整塊不畫(不是畫一組空下拉)。
              空下拉點得下去、送得出去、然後什麼都不會變 —— 那是一個會騙人的控制項。 */}
          {(brandOptions.length > 0 || categoryOptions.length > 0) && (
            <ProductTaxonomyFilter
              filter={filter}
              size={view.size}
              brands={brandOptions}
              categories={categoryOptions}
            />
          )}
          {filter.setBy === 'staff' && filter.keyword === undefined && total === 0 && (
            <p className='text-muted-foreground text-sm'>
              目前沒有手動設定過的商品。設定上下架的功能還沒做好,所以現在每一筆都是「自動」。
            </p>
          )}
        </>
      )}

      {loadFailed ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          商品列表載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          {/* 🔴 `#661`:有搜尋詞而零命中 ⇒ 換一句話。
              「目前沒有商品」與「找不到符合的商品」在畫面上是同一個空框,
              而前者讀起來像系統壞了或還沒進貨、後者讀起來像「再打一次」。 */}
          <ProductsTable
            rows={items}
            emptyText={
              filter.keyword === undefined
                ? '目前沒有商品。'
                : `找不到符合「${filter.keyword}」的商品。換個料號或商品名再試一次。`
            }
          />
          <ListPagination
            page={view.page}
            total={total}
            pageSize={view.size}
            shownCount={items.length}
            buildHref={(p) => buildProductListHref(filter, { page: p, size: view.size })}
            unit='件'
            truncation={truncation}
            jump={{
              action: '/products',
              filterFields,
              pageParam: PAGE_PARAM,
              sizeParam: SIZE_PARAM,
              sizeOptions: PAGE_SIZE_OPTIONS,
              currentSize: view.size,
              defaultSize: DEFAULT_PAGE_SIZE,
            }}
          />
        </>
      )}
    </div>
  );
}
