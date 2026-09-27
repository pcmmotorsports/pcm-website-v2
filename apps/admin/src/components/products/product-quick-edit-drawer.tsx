import Link from 'next/link';
import { ProductGalleryPanel } from './product-gallery-panel';
import { ProductOverridesEditor } from './product-overrides-editor';
import type { ProductGalleryState } from '../../lib/products/gallery-loader';
import { readProductOverrides } from '../../lib/products/product-overrides-view';
import { toProductMedia } from '../../lib/products/product-media';
import type { AdminProductDetailRow } from '../../lib/products/product-repository';

// product-quick-edit-drawer.tsx —— 商品列表的「快速編輯」側邊欄(Sean 2026-09-28:「側邊欄位我只是想說快速調整圖片位置會更方便」)。
// 網址 ?edit=<商品 id> 就打開;關掉 = 同一個列表網址只拿掉 edit ⇒ 篩選、頁碼、捲動位置都不變。原本點名稱進整頁照舊。
// 🔴 不另寫一套:照片直接用商品頁的 ProductGalleryPanel(排序、設封面、上傳、刪除、隱藏), 文字用 ProductOverridesEditor(一次儲存)。
//    兩者的寫入、權限、稽核都跟商品頁同一條路。

export function ProductQuickEditDrawer({
  product,
  loadFailed,
  gallery,
  closeHref,
  detailHref,
}: {
  product: AdminProductDetailRow | null;
  loadFailed: boolean;
  gallery: ProductGalleryState | null;
  /** 同一個列表網址, 只拿掉 ?edit=。 */
  closeHref: string;
  /** 這件商品的整頁(帶回列表的網址)。 */
  detailHref: string;
}) {
  const overrides = readProductOverrides(product?.staff_overrides);
  return (
    <div data-quick-edit className='fixed inset-0 z-50 flex justify-end'>
      {/* 點側邊欄外面也可以關(同「關閉」那一顆, 只拿掉 ?edit=)。 */}
      <Link href={closeHref} scroll={false} aria-label='關閉快速編輯' className='bg-foreground/20 flex-1' tabIndex={-1} />
      <aside
        role='dialog'
        aria-modal='true'
        aria-label='快速編輯'
        className='bg-background flex h-full w-full max-w-[640px] flex-col border-l shadow-xl'
      >
        <header className='flex items-start gap-3 border-b p-4'>
          <div className='min-w-0 flex-1'>
            <p className='text-muted-foreground text-xs'>快速編輯</p>
            <h2 className='truncate text-base font-semibold'>
              {product ? (overrides.title ?? product.title) : '商品'}
            </h2>
            {product && <p className='text-muted-foreground font-mono text-xs'>{product.external_id}</p>}
          </div>
          <Link href={detailHref} className='text-primary shrink-0 text-sm hover:underline'>
            開整頁
          </Link>
          <Link
            href={closeHref}
            scroll={false}
            data-quick-edit-close
            className='border-input hover:bg-accent shrink-0 rounded-md border px-3 py-1 text-sm'
          >
            關閉
          </Link>
        </header>
        <div className='flex-1 space-y-4 overflow-y-auto p-4'>
          {product === null ? (
            <p className={loadFailed ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
              {loadFailed ? '這件商品載入失敗，請關閉後再試一次。' : '找不到這件商品，可能已被刪除。'}
            </p>
          ) : (
            <>
              {gallery?.state === 'ok' ? (
                <ProductGalleryPanel productId={product.id} initialPhotos={gallery.photos} initialCurated={gallery.curated} />
              ) : (
                <section className='rounded-lg border p-4'>
                  <h3 className='mb-2 text-sm font-medium'>照片</h3>
                  <p className={gallery?.state === 'failed' ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}>
                    {gallery?.state === 'failed' ? gallery.message : '圖庫尚未啟用。'}
                  </p>
                </section>
              )}
              <ProductOverridesEditor
                productId={product.id}
                supplier={{ title: product.title, subtitle: product.subtitle, highlights: toProductMedia(product).highlights }}
                overrides={overrides}
              />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
