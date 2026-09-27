'use client';

import { useState } from 'react';
import { ProductGalleryEditor } from './product-gallery-editor';
import {
  removeGalleryPhotoAction,
  reorderGalleryAction,
  setGalleryHiddenAction,
  uploadGalleryPhotoAction,
  type GalleryActionResult,
} from '../../lib/products/gallery-actions';
import { shrinkForUpload } from '../../lib/products/gallery-shrink';
import { GalleryUserError, splitGallery, type GalleryPhoto } from '../../lib/products/product-gallery';

// product-gallery-panel.tsx — 商品頁「照片」:把 G5 畫面(ProductGalleryEditor)接到 server action(→ 報價單 G2 API)。
// 每個動作成功 ⇒ 換成 action 回傳的整份照片清單(報價單排好的);失敗 ⇒ 丟 GalleryUserError,畫面顯示那句話。
// 上傳:每張先在瀏覽器縮到最長邊 1600,再一張一張送;中途有一張失敗就停,前面已上傳的照片會留著並顯示。

/** 尚未整理時的說明(G2 6f44e9ff:報價單回目前網站顯示的供應商照片;第一次動手時報價單會先照原順序寫進圖庫)。 */
export const UNCURATED_NOTICE = '尚未整理，這是目前網站顯示的供應商照片。調整順序、隱藏或上傳之後，網站和報價單會改用這裡整理好的版本。';

/** 商品頁乙 P7:網站新增的手動商品(pcm)沒有供應商照片,只有我們上傳的。 */
export const MANUAL_EMPTY_NOTICE = '還沒有照片。上傳之後可以在這裡刪除和調整順序。';
export const MANUAL_FOOTNOTE = '這件是網站新增的商品，沒有供應商照片。照片可以上傳、刪除和調整順序，每次變更都會記進變更紀錄。';

export function ProductGalleryPanel({
  productId,
  initialPhotos,
  initialCurated,
  manual = false,
}: {
  productId: string;
  initialPhotos: readonly GalleryPhoto[];
  initialCurated: boolean;
  manual?: boolean;
}) {
  const [photos, setPhotos] = useState<readonly GalleryPhoto[]>(initialPhotos);
  const [curated, setCurated] = useState(initialCurated);

  function apply(r: GalleryActionResult) {
    if (!r.ok) throw new GalleryUserError(r.message);
    setPhotos(r.photos);
    setCurated(r.curated);
  }

  return (
    <ProductGalleryEditor
      photos={photos}
      notice={curated ? undefined : manual ? MANUAL_EMPTY_NOTICE : UNCURATED_NOTICE}
      footnote={manual ? MANUAL_FOOTNOTE : undefined}
      // 報價單的排序要「全部照片(含已隱藏)」的新順序 ⇒ 已隱藏的照原本順序接在後面
      onSaveOrder={async (urls) =>
        apply(await reorderGalleryAction(productId, [...urls, ...splitGallery(photos).hidden.map((p) => p.url)]))
      }
      onDelete={async (id) => apply(await removeGalleryPhotoAction(productId, id))}
      onHide={async (url) => apply(await setGalleryHiddenAction(productId, url, true))}
      onUnhide={async (url) => apply(await setGalleryHiddenAction(productId, url, false))}
      onUpload={async (files) => {
        for (const file of files) {
          const form = new FormData();
          form.set('product_id', productId);
          form.set('file', await shrinkForUpload(file));
          apply(await uploadGalleryPhotoAction(form));
        }
      }}
    />
  );
}
