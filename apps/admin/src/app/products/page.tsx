// 相對 import(非 `@/`):根 `vitest.config.ts` 的 `@` alias 指向 **storefront** 的 src
// ⇒ admin 檔案用 `@/` 在測試裡 resolve 不到、這頁就測不起來(先例逐字見
// `app/settings/suppliers/page.tsx:14-19`、`app/customers/page.tsx:2-4`)。
// ⚠️ #612 更新(2026-08-17):上述 alias 限制已由 #606 修除(vitest projects、admin 自帶 @ alias)⇒ 新 code 可用 @/;既有相對 import 保留、不回改。
import { ProductsTable } from '../../components/products/products-table';
import { ProductFilterChips } from '../../components/products/product-filter-chips';
import { ProductKeywordSearch } from '../../components/products/product-keyword-search';
import { ListPagination } from '../../components/shared/list-pagination';
import { listProductsForAdmin, type AdminProductPage } from '../../lib/products/product-repository';
import {
  buildProductListHref,
  parseProductListParams,
} from '../../lib/products/product-list-view';

// M-4b #20 片1a:後台商品列表(唯讀)。plan = docs/specs/2026-08-14-products-admin-slice1a-plan.md。
// force-dynamic:讀 searchParams + DB 查、不靜態預渲染(同 customers/orders 兩頁)。
export const dynamic = 'force-dynamic';

/** 沿用既有列表慣例的每頁筆數;plan §5-4 已標「未依商品實際筆數調校」。 */
export const PRODUCTS_PAGE_SIZE = 20;

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
  const { filter, page } = parseProductListParams(raw);
  const offset = (page - 1) * PRODUCTS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識、DB error 不外洩到畫面(同 customers/page.tsx:37-48)。
  let result: AdminProductPage | null = null;
  let loadFailed = false;
  try {
    result = await listProductsForAdmin(PRODUCTS_PAGE_SIZE, offset, filter.setBy, filter.keyword);
  } catch (error) {
    console.error('[admin/products] 商品列表載入失敗', error);
    loadFailed = true;
  }

  const items = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <div className='mx-auto space-y-4'>
      <div className='flex items-center justify-between'>
        <h1 className='text-2xl font-semibold'>商品</h1>
        {!loadFailed && <p className='text-muted-foreground text-sm'>共 {total} 件</p>}
      </div>

      {/* 🔴 本頁只能看、不能改 —— 不寫成「編輯功能即將推出」那種對未來的承諾
          (同 settings/suppliers/page.tsx:74-76 的教訓:不得宣稱尚未生效的功能)。 */}
      <p className='text-muted-foreground text-sm'>
        這裡列出所有商品,含已下架的。目前只能查看,不能修改。
      </p>

      {/* 🔴 上線初期「手動」會是 0 筆 —— 因為把商品設成手動的入口還沒做(plan §5 Q3=乙)。
          這句話存在的理由:不寫的話,Sean 打開來看到 0 筆會以為篩選壞了。 */}
      {/* 🔴 搜尋框在標題列與篩選列【之間】,位置抄 customers 那一面
          (`app/customers/page.tsx:80`)⇒ 員工的視線順序是
          「這一頁是什麼 → 我要找什麼 → 再細分」。
          ⚠️ 它畫在 `loadFailed` 判斷【外面】:讀取失敗時搜尋框仍要在 ——
          否則員工唯一能做的動作(換個詞再試)會跟著錯誤訊息一起消失。 */}
      <ProductKeywordSearch filter={filter} />

      {!loadFailed && (
        <>
          <ProductFilterChips filter={filter} />
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
            page={page}
            total={total}
            pageSize={PRODUCTS_PAGE_SIZE}
            shownCount={items.length}
            buildHref={(p) => buildProductListHref(filter, p)}
            unit='件'
          />
        </>
      )}
    </div>
  );
}
