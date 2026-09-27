import { GalleryUserError, UPLOAD_MAX_EDGE, fitWithin } from './product-gallery';

// gallery-shrink.ts — 上傳前在瀏覽器把照片縮到最長邊 1600(共用圖庫 G5)。
// 為什麼在瀏覽器縮:Vercel 請求上限 4.5MB,手機原圖常常 5–12MB,直接送會被擋;報價單收到後還會再轉成 WebP。
// 一律輸出 JPEG(各家瀏覽器都能編碼);透明背景先填白,不然 PNG 的透明處會變黑。
// 🔴 只能在瀏覽器跑(canvas / createImageBitmap);單測裡由呼叫端的測試換成假的。

export async function shrinkForUpload(file: File): Promise<File> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new GalleryUserError(`「${file.name}」讀不出圖片，請換一張照片。`);
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height, UPLOAD_MAX_EDGE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new GalleryUserError('這個瀏覽器無法處理照片，請換一個瀏覽器再試。');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!blob) throw new GalleryUserError(`「${file.name}」縮小失敗，請換一張照片。`);
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' });
}
