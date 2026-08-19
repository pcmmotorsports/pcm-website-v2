import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '../../../lib/orders/note-action-state';
import { ProductDetail } from '../../../components/products/product-detail';
import { ProductListingForm } from '../../../components/products/product-listing-form';
import { ResultBanner } from '../../../components/orders/result-banner';
import { resolveListingState } from '../../../lib/products/product-repository';
import {
  getProductForAdmin,
  getProductTaxonomyNames,
  type AdminProductDetailRow,
  type ProductTaxonomyNames,
} from '../../../lib/products/product-repository';

// M-4b #20 片1b-1:後台商品詳情頁(唯讀)。plan = docs/specs/2026-08-15-products-admin-slice1b-plan.md。
// 相對 import(非 `@/`)理由見 app/products/page.tsx:1-3。
export const dynamic = 'force-dynamic';

// 🔴 **UUID 守門直接 import 既有的 `isUuid`,不再手抄第四份字面**(code-reviewer R1 N-d)。
//    第一版自己寫了一條 `UUID_RE` + 註解「兩處要一致才不會一邊嚴一邊鬆」——
//    **註解不是機制**,沒有任何東西會在兩份漂開時叫。
//    而 `note-action-state.ts:62-64` 的 docstring 逐字記著同一個教訓:
//    「關卡2 抓到我在 `note-form.ts` 另養了一份字面相同的,那是純粹的漂移面」。
//    該檔零 `server-only`、零 `@/`、零 IO(檔頭 `:3-4` 逐字保證)⇒ 這裡 import 是安全的。

export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  // PRG 結果碼(上下架 action 導回時帶 `?r=`;鏡像 customers/[id])。
  const rawSearch = await searchParams;
  const resultCode = typeof rawSearch.r === 'string' ? rawSearch.r : undefined;

  // 🔴 形狀不對 → 直接 404,**不打 DB**(路由參數不透傳進查詢;鏡像 app/customers/[id]/page.tsx:22-25)。
  if (!isUuid(id)) {
    notFound();
  }

  // 🔴 三條路要分得開,不能混成一條:
  //    查無 → 404 / 讀取失敗 → 錯誤態 200(不 500、DB error 不外洩)/ 讀到 → 正常顯示。
  let product: AdminProductDetailRow | null = null;
  let loadFailed = false;
  try {
    product = await getProductForAdmin(id);
  } catch (error) {
    console.error('[admin/products/[id]] 商品讀取失敗', error);
    loadFailed = true;
  }

  if (!loadFailed && product === null) {
    notFound();
  }

  // 🔴 品牌/分類是**獨立區塊**:它壞掉只讓那一區塊顯錯,其餘欄位照看
  //    (同 customers/[id] 的分區容錯;整頁一起炸會讓員工連料號都查不到)。
  let taxonomy: ProductTaxonomyNames = { brandName: null, categoryName: null };
  let taxonomyFailed = false;
  if (product !== null) {
    try {
      taxonomy = await getProductTaxonomyNames(product.brand_id, product.category_id);
    } catch (error) {
      console.error('[admin/products/[id]] 品牌與分類讀取失敗', error);
      taxonomyFailed = true;
    }
  }

  // 🔴 `max-w-6xl` **刻意留著**:本頁是商品**詳情表單**、沒有表格。
  //    規則:沒有表格 ⇒ 留 `max-w-`(長文字行過寬更難讀);有表格的列表頁一律吃滿寬
  //    (`#640` 守門在 `app/design-tokens.test.ts`)。
  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <Link
        href='/products'
        className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
      >
        ← 返回商品列表
      </Link>

      <ResultBanner code={resultCode} />

      {product === null ? (
        <div className='border-destructive/30 bg-destructive/5 text-destructive rounded-lg border p-6 text-sm'>
          商品資料載入失敗,請稍後再試或聯絡系統維護。
        </div>
      ) : (
        <>
          <ProductDetail
            product={product}
            brandName={taxonomy.brandName}
            categoryName={taxonomy.categoryName}
            taxonomyFailed={taxonomyFailed}
          />
          {/* 🔴 M-4b `#20`:上下架是這一頁**唯一**的寫入動作。
              位置=詳情頁(plan §3 裁定);理由與「不放列表」的取捨寫在
              `components/products/product-listing-form.tsx` 檔頭。 */}
          <section className='rounded-lg border p-4'>
            <h2 className='mb-3 text-sm font-medium'>上架 / 下架</h2>
            <ProductListingForm
              productId={product.id}
              listed={resolveListingState(product) === 'listed'}
            />
          </section>
          {/* 🔴 這一句原本是「這一頁只能查看,不能修改」—— **本片之後那是假的**。
              (同 `app/products/page.tsx:60-64` 的教訓:不要留一句已經不成立的自述。) */}
          <p className='text-muted-foreground text-sm'>
            這一頁目前只能改上架狀態,其餘欄位仍不能修改。
          </p>
        </>
      )}
    </div>
  );
}
