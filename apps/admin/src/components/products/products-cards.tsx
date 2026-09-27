import Link from 'next/link';
import { ProductSelectAllOnPage } from './product-batch-bar';
import { ProductStatusCaps } from './product-status-caps';
import { productDetailHref } from '../../lib/products/product-list-view';
import { displayTitle, resolvePrice, saleLabel, type AdminProductListRow } from '../../lib/products/product-repository';

// products-cards.tsx —— 商品列表的卡片檢視(商品頁乙 E1–E2;計畫 ~/pcm-mailbox/計畫-後台商品頁乙-20260928.md 第五節 E)。
// 大縮圖、客人看到的標題、料號、售價、狀態;看照片找商品時比表格快。
// E2:每張卡的勾選框與表格同一個形狀(data-product-select、value、data-title),
//     批次按鈕列(ProductBatchBar)直接讀畫面上的勾選框, 所以卡片與表格共用同一組批次按鈕。
// 🔴 同表格的規矩:售價經 resolvePrice、狀態經 ProductStatusCaps, 不直接讀 price_general / delisted_at 等欄。

export function ProductsCards({
  rows,
  listHref,
  emptyText,
  editHref,
}: {
  rows: readonly AdminProductListRow[];
  /** 目前列表的網址(帶篩選);點進明細頁時帶著, 返回時回到同一個列表。 */
  listHref: string;
  emptyText: string;
  /** Sean 2026-09-28:「快速編輯」的網址(保留篩選與頁碼, 多帶 ?edit=)。 */
  editHref?: (id: string) => string;
}) {
  if (rows.length === 0) {
    return <p className='text-muted-foreground rounded-lg border p-6 text-center text-sm'>{emptyText}</p>;
  }
  return (
    <div data-products-cards className='space-y-2'>
      <label className='text-muted-foreground inline-flex items-center gap-2 text-sm'>
        <ProductSelectAllOnPage />
        本頁全選
      </label>
      <ul className='grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'>
        {rows.map((row) => {
          const title = displayTitle(row);
          const price = resolvePrice(row);
          const href = productDetailHref(row.id, listHref);
          return (
            <li key={row.id} className='bg-card relative flex flex-col overflow-hidden rounded-lg border'>
              <input
                type='checkbox'
                data-product-select
                value={row.id}
                data-title={title}
                aria-label={`選取 ${title}`}
                className='absolute top-2 left-2 z-10 h-4 w-4'
              />
              <Link href={href} className='bg-muted flex aspect-square items-center justify-center'>
                {row.image_missing !== false || !row.thumb ? (
                  <span className='text-muted-foreground text-xs'>代表圖待補</span>
                ) : (
                  <img src={row.thumb} alt='' loading='lazy' className='h-full w-full object-contain' />
                )}
              </Link>
              <div className='flex flex-1 flex-col gap-1 p-2'>
                <Link href={href} className='text-foreground line-clamp-2 text-sm font-bold hover:underline'>
                  {title}
                </Link>
                <span className='text-muted-foreground font-mono text-xs'>{row.external_id}</span>
                <span className='text-sm'>{price === null ? '—' : `NT$ ${price.toLocaleString('zh-TW')}`}</span>
                {saleLabel(row) !== null && <span className='text-destructive text-xs'>{saleLabel(row)}</span>}
                <div className='mt-auto flex flex-wrap items-center justify-between gap-1 pt-1 text-xs'>
                  <ProductStatusCaps row={row} />
                  {editHref && (
                    <Link href={editHref(row.id)} scroll={false} className='text-primary whitespace-nowrap hover:underline'>
                      快速編輯
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
