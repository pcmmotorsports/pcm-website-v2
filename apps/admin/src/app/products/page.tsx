import Link from 'next/link';
// 相對 import(非 `@/`):根 `vitest.config.ts` 的 `@` alias 指向 **storefront** 的 src
// ⇒ admin 檔案用 `@/` 在測試裡 resolve 不到、這頁就測不起來(先例逐字見
// `app/settings/suppliers/page.tsx:14-19`、`app/customers/page.tsx:2-4`)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
import { ProductsTable } from '../../components/products/products-table';
import { ProductToolbar } from '../../components/products/product-toolbar';
import { ProductAttentionChips } from '../../components/products/product-filter-chips';
import { OrdersStickyOffset } from '../../components/orders/orders-sticky-offset';
import { ListPagination } from '../../components/shared/list-pagination';
import {
  countProductAttention,
  listProductFilterOptions,
  listProductsForAdmin,
  type AdminProductPage,
  type ProductFilterOptions,
} from '../../lib/products/product-repository';
import { resolveProductListQuery } from '../../lib/products/product-taxonomy-options';
import {
  DEFAULT_PAGE_SIZE,
  filterHiddenFields,
  KEYWORD_PARAM,
  PAGE_PARAM,
  PAGE_SIZE_OPTIONS,
  PRODUCT_ATTENTION_LABEL,
  SET_BY_PARAM,
  SIZE_PARAM,
  BRAND_PARAM,
  CATEGORY_PARAM,
  buildProductListHref,
  buildProductListHrefResetPage,
  parseProductListParams,
} from '../../lib/products/product-list-view';
import { detectPageTruncation } from '../../lib/shared/list-params';
import { TruncationReveal } from '../../components/orders/truncation-reveal';

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

  // 🔴 篩選解析(品牌逐個認、分類認不得就不套用、兩種「沒套上」的提示)搬到
  //    `resolveProductListQuery`(`lib/products/product-taxonomy-options.ts`),原本的註解跟著搬過去。
  //    2026-09-27 搬的理由:`/products/export` 要跟這一頁用【同一支】,匯出的才會是員工眼前這批。
  const { query, brandOptions, categoryOptions, brandFilterDropped, categoryFilterDropped } =
    resolveProductListQuery(filter, options);

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識、DB error 不外洩到畫面(同 customers/page.tsx:37-48)。
  let result: AdminProductPage | null = null;
  let loadFailed = false;
  // 商品頁乙 A2:「要處理」件數與列表平行查;件數失敗只讓數字不顯示,列表照常。
  const countsPromise = countProductAttention(query).catch((error: unknown) => {
    console.error('[admin/products] 要處理件數載入失敗(列表不受影響)', error);
    return null;
  });
  try {
    result = await listProductsForAdmin(view.size, offset, query);
  } catch (error) {
    console.error('[admin/products] 商品列表載入失敗', error);
    loadFailed = true;
  }
  const attentionCounts = await countsPromise;

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
  //    🔴🔴 **2026-08-19(貼料號片,W6 must-fix):這個 map 現在有【編譯期窮舉守門】。**
  //       在它之前,這裡是一個手寫的物件字面 —— 而同一頁的 `buildProductListHref`
  //       **早就有窮舉守門**(`product-list-view.ts` 的 `Record<keyof AdminProductFilter, …>`)
  //       ⇒ **同一頁上兩套保留機制,而只有一套被守著**;chips 與翻頁連結走 builder(有守門),
  //         換筆數與跳頁那兩張 form 走這個 map(沒守門)。
  //       ⇒ 我加 `skus` 那一軸時,builder 那邊 `tsc` 當場紅、而這裡**靜靜地通過** ——
  //         症狀正是上面那句寫的:貼了料號再跳頁,料號整個消失。**那會是第四個觸發點。**
  //       ⇒ 型別改成 `Record<keyof AdminProductFilter, string | undefined>`:
  //         **`AdminProductFilter` 加一軸而這裡沒列,`tsc` 直接紅。**
  //       ⚠️ 同 builder 那道的限定:它只保證「每個軸都被做過決定」,
  //          保證不了那個決定是對的(對到錯的 param 名一樣過)—— 那半靠往返測試。
  const filterFields = filterHiddenFields(filter);

  return (
    <div className='pcm-plist pcm-sticky mx-auto space-y-3'>
      {/* 🆕 2026-09-14(Sean 逐字「重新幫我設計一個比較好用的版本,目前很不直覺並且上方篩選欄位太佔空間」):
          舊的 h1 + 說明句 + 一整塊篩選卡(搜尋 / chips / 4 行高品牌多選 / 分類 / 料號批次摺疊,佔首屏三分之一)⇒ 一列工具列,
          與訂單頁同一套凍結(工具列 + 表頭 sticky;`OrdersStickyOffset` 量工具列高寫 `--orders-sticky-top`,thead 吃它)。
          🔴 零改資料層:篩選參數 / RPC / 四支篩選元件原封,只換排法與字級。說明句搬到表格下(那句被 page.test 釘著兩個方向)。 */}
      <div data-orders-sticky-head='' className='bg-background sticky top-0 z-30 -mx-6 -mt-6 px-6 pt-6 pb-2'>
        <OrdersStickyOffset />
        <ProductToolbar
          filter={filter}
          size={view.size}
          brands={brandOptions}
          categories={categoryOptions}
          total={total}
          loadFailed={loadFailed}
        />
        {!loadFailed && <ProductAttentionChips filter={filter} size={view.size} counts={attentionCounts} />}
      </div>
      {!loadFailed && brandFilterDropped && (
        <p className='border-input text-muted-foreground rounded-md border border-dashed p-3 text-sm'>
          網址帶著一個找不到的品牌(選項載入失敗,或這個品牌已經被刪掉)——{' '}
          <strong>下面的清單沒有依品牌篩選</strong>。
          <Link
            href={buildProductListHrefResetPage({ ...filter, brandIds: undefined }, view.size)}
            className='text-primary ml-2 underline'
          >
            清除品牌條件
          </Link>
        </p>
      )}
      {!loadFailed && categoryFilterDropped && (
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
      {!loadFailed && (
        <>
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
              filter.keyword !== undefined
                ? `找不到符合「${filter.keyword}」的商品。換個料號或商品名再試一次。`
                : filter.attention !== undefined
                  ? `目前沒有「${filter.attention.map((k) => PRODUCT_ATTENTION_LABEL[k]).join('」或「')}」的商品。`
                  : '目前沒有商品。'
            }
          />
          <p className='pcm-note2'>這裡列出所有商品,含已下架的。上架/下架請點進商品明細頁,其餘欄位目前不能修改。</p>
          {/* 被截斷的字滑到看全文、可框選複製(同訂單列表那一支;只在真的被截時出現)。 */}
          <TruncationReveal root='table' />
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
