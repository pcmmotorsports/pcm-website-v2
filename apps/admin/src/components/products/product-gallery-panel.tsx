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
import { GalleryUserError, type GalleryPhoto } from '../../lib/products/product-gallery';

// product-gallery-panel.tsx — 商品頁「照片」:把 G5 畫面(ProductGalleryEditor)接到 server action(→ 報價單 G2 API)。
// 每個動作成功 ⇒ 換成 action 回傳的整份照片清單(報價單排好的);失敗 ⇒ 丟 GalleryUserError,畫面顯示那句話。
// 上傳:每張先在瀏覽器縮到最長邊 1600,再一張一張送;中途有一張失敗就停,前面已上傳的照片會留著並顯示。

export function ProductGalleryPanel({
  productId,
  initialPhotos,
}: {
  productId: string;
  initialPhotos: readonly GalleryPhoto[];
}) {
  const [photos, setPhotos] = useState<readonly GalleryPhoto[]>(initialPhotos);

  function apply(r: GalleryActionResult) {
    if (!r.ok) throw new GalleryUserError(r.message);
    setPhotos(r.photos);
  }

  return (
    <ProductGalleryEditor
      photos={photos}
      onSaveOrder={async (ids) => apply(await reorderGalleryAction(productId, ids))}
      onDelete={async (id) => apply(await removeGalleryPhotoAction(productId, id))}
      onHide={async (id) => apply(await setGalleryHiddenAction(productId, id, true))}
      onUnhide={async (id) => apply(await setGalleryHiddenAction(productId, id, false))}
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
