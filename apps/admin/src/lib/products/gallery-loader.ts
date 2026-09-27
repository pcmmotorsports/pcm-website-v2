import 'server-only';
import { getSessionActor } from '../session/actor';
import { createGalleryApi, readGalleryApiConfig } from './gallery-api';
import { galleryErrorMessage, type GalleryPhoto } from './product-gallery';

// gallery-loader.ts — 商品頁打開時讀這件商品的共用圖庫(報價單 G2 API)。只在伺服器端。
// 三種結果分開:圖庫沒啟用(env 沒設)/ 讀不到 / 讀到了(可能是空的)。讀不到不能顯示成「還沒有照片」。

export type ProductGalleryState =
  | { state: 'disabled' }
  | { state: 'failed'; message: string }
  | { state: 'ok'; photos: GalleryPhoto[] };

const LOAD_FAILED = '照片載入失敗，請重新整理。若仍無法載入，請聯絡系統管理員。';

export async function loadProductGallery(product: {
  readonly supplier_slug: string;
  readonly external_id: string;
}): Promise<ProductGalleryState> {
  const config = readGalleryApiConfig();
  if (!config) return { state: 'disabled' };
  const actor = await getSessionActor();
  if (!actor) return { state: 'failed', message: '無法確認登入身分，請重新整理頁面。若仍無法載入，請重新登入。' };
  const r = await createGalleryApi(config).list(
    { supplierSlug: product.supplier_slug, mainSku: product.external_id },
    actor.id,
  );
  if (r.ok) return { state: 'ok', photos: r.photos };
  console.error('[admin/products/[id]] 圖庫讀取失敗', { status: r.status, code: r.code });
  return {
    state: 'failed',
    message: r.code === 'GALLERY_PRODUCT_NOT_FOUND' ? galleryErrorMessage('reorder', 404, r.code) : LOAD_FAILED,
  };
}
