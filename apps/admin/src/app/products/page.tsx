// 相對 import(非 `@/`):根 `vitest.config.ts` 的 `@` alias 指向 **storefront** 的 src
// ⇒ admin 檔案用 `@/` 在測試裡 resolve 不到、這頁就測不起來(先例逐字見
// `app/settings/suppliers/page.tsx:14-19`、`app/customers/page.tsx:2-4`)。
import { ProductsTable } from '../../components/products/products-table';
import { ProductFilterChips } from '../../components/products/product-filter-chips';
import { ListPagination } from '../../components/shared/list-pagination';
import {
  listProductsForAdmin,
  type AdminProductPage,
  type ProductSetByFilter,
} from '../../lib/products/product-repository';

// M-4b #20 片1a:後台商品列表(唯讀)。plan = docs/specs/2026-08-14-products-admin-slice1a-plan.md。
// force-dynamic:讀 searchParams + DB 查、不靜態預渲染(同 customers/orders 兩頁)。
export const dynamic = 'force-dynamic';

/** 沿用既有列表慣例的每頁筆數;plan §5-4 已標「未依商品實際筆數調校」。 */
export const PRODUCTS_PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * `?page=` 解析。🔴 只收正整數;`?page=a&page=b` 會被 Next 解析成陣列 ⇒ 當作沒給。
 * 本片刻意不建 `product-list-view.ts` —— 沒有篩選就沒有 `buildHref` 要組(plan §1)。
 */
function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== 'string') return 1;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * `?set_by=` 解析(`#20` 片2c)。**白名單,不是直接轉型** ——
 * 🔴 這個值會被送進 `.eq('listing_set_by', …)`;不過白名單等於讓網址決定查詢條件。
 * 認不得的值(含 `?set_by=a&set_by=b` 的陣列)→ `undefined` = 不篩,**不是報錯** ——
 * 網址是使用者可以手改的,亂改的後果應該是「看到全部」而不是一頁錯誤。
 */
function parseSetBy(value: string | string[] | undefined): ProductSetByFilter | undefined {
  if (value === 'staff' || value === 'sync') return value;
  return undefined;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const page = parsePage(raw.page);
  const setBy = parseSetBy(raw.set_by);
  const offset = (page - 1) * PRODUCTS_PAGE_SIZE;

  // 🔴 防禦:讀取失敗(env 未設 / DB 錯)→ 顯錯誤態、頁面仍 200(不 500);
  //    server log 留鑑識、DB error 不外洩到畫面(同 customers/page.tsx:37-48)。
  let result: AdminProductPage | null = null;
  let loadFailed = false;
  try {
    result = await listProductsForAdmin(PRODUCTS_PAGE_SIZE, offset, setBy);
  } catch (error) {
    console.error('[admin/products] 商品列表載入失敗', error);
    loadFailed = true;
  }

  const items = result?.items ?? [];
  const total = result?.total ?? 0;

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
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
      {!loadFailed && (
        <>
          <ProductFilterChips current={setBy} />
          {setBy === 'staff' && total === 0 && (
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
          <ProductsTable rows={items} />
          <ListPagination
            page={page}
            total={total}
            pageSize={PRODUCTS_PAGE_SIZE}
            shownCount={items.length}
            buildHref={(p) => (p <= 1 ? '/products' : `/products?page=${p}`)}
            unit='件'
          />
        </>
      )}
    </div>
  );
}
