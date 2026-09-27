import Link from 'next/link';
import { ManualProductForm } from '../../../components/products/manual-product-form';
import { listCategoryChoices, listProductFilterOptions } from '../../../lib/products/product-repository';

// 商品頁乙 P6:新增手動商品(報價單沒有、網站自己賣的商品)。

export const dynamic = 'force-dynamic';

export default async function NewManualProductPage() {
  const [options, categories] = await Promise.all([
    listProductFilterOptions().catch((error: unknown) => {
      console.error('[admin/products/new] 品牌選項讀取失敗', error);
      return null;
    }),
    listCategoryChoices().catch((error: unknown) => {
      console.error('[admin/products/new] 分類選項讀取失敗', error);
      return null;
    }),
  ]);
  const brands = options ? [...options.brands].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')) : null;

  return (
    <div className='mx-auto max-w-4xl space-y-4'>
      <Link href='/products' className='text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm'>
        ← 返回商品列表
      </Link>
      <h1 className='text-lg font-semibold'>新增商品</h1>
      <p className='text-muted-foreground text-sm'>這裡新增的是報價單沒有、網站自己賣的商品。報價單有的商品每天會自動同步，不用在這裡新增。</p>
      {brands && categories ? (
        <ManualProductForm brands={brands} categories={categories} />
      ) : (
        <p className='text-destructive text-sm'>品牌或分類選項載入失敗，暫時無法新增商品，請重新整理頁面。</p>
      )}
    </div>
  );
}
