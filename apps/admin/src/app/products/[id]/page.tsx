import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ProductDetail } from '../../../components/products/product-detail';
import {
  getProductForAdmin,
  getProductTaxonomyNames,
  type AdminProductDetailRow,
  type ProductTaxonomyNames,
} from '../../../lib/products/product-repository';

// M-4b #20 片1b-1:後台商品詳情頁(唯讀)。plan = docs/specs/2026-08-15-products-admin-slice1b-plan.md。
// 相對 import(非 `@/`)理由見 app/products/page.tsx:1-3。
export const dynamic = 'force-dynamic';

/** UUID 形狀守門。字面沿用 lib/customers/customer-detail-view.ts:8 —— 兩處要一致才不會一邊嚴一邊鬆。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 🔴 形狀不對 → 直接 404,**不打 DB**(路由參數不透傳進查詢;鏡像 app/customers/[id]/page.tsx:22-25)。
  if (!UUID_RE.test(id)) {
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

  return (
    <div className='mx-auto max-w-6xl space-y-4'>
      <Link
        href='/products'
        className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'
      >
        ← 返回商品列表
      </Link>

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
          {/* 本頁唯讀。不寫「即將可編輯」——同 app/products/page.tsx:60-64 的教訓。 */}
          <p className='text-muted-foreground text-sm'>這一頁只能查看,不能修改。</p>
        </>
      )}
    </div>
  );
}
