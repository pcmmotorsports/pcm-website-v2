// product-gallery.ts — 共用圖庫 G5 的純邏輯(後台商品頁「照片」;Sean 2026-09-27 C3:前台與報價單共用、可拖曳排序)。
// 資料形狀照報價單 `supabase/migrations/20260927160000_product_gallery.sql`(414564e4,尚未貼正式庫):
//   · source = 'staff'(我們上傳,只能刪)/ 'supplier'(每天同步帶進來,不能刪、只能隱藏)
//   · 顯示順序 = position 由小到大;第 1 張是封面。
// 🔴 還沒接報價單 API(G2)。本檔與畫面元件只處理「畫面上的狀態」,存檔由呼叫端傳進來的函式負責。

export type GallerySource = 'staff' | 'supplier';

export interface GalleryPhoto {
  readonly id: string;
  readonly url: string;
  readonly source: GallerySource;
  readonly position: number;
  readonly hidden: boolean;
}

/** 檔案選擇框的 accept;與 `uploadRejection` 用同一組。 */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const GALLERY_ACCEPT = ACCEPTED_TYPES.join(',');

/** 顯示中(依 position,同值依 id)與已隱藏兩組。 */
export function splitGallery(photos: readonly GalleryPhoto[]): { shown: GalleryPhoto[]; hidden: GalleryPhoto[] } {
  const sorted = [...photos].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { shown: sorted.filter((p) => !p.hidden), hidden: sorted.filter((p) => p.hidden) };
}

/** 把第 from 張移到第 to 張的位置;原地或超出範圍 ⇒ 原樣回傳(新陣列)。 */
export function moveGalleryPhoto<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function galleryOrderChanged(original: readonly string[], current: readonly string[]): boolean {
  return original.length !== current.length || original.some((id, i) => id !== current[i]);
}

/** 不收的檔案 ⇒ 給員工看的一句話;收 ⇒ null。瀏覽器沒給格式也不收(不猜)。 */
export function uploadRejection(file: { readonly name: string; readonly type: string }): string | null {
  if ((ACCEPTED_TYPES as readonly string[]).includes(file.type)) return null;
  return `「${file.name}」沒有上傳：只接受 JPG、PNG、WebP。請在手機設定改成「最相容」格式，或先轉檔再上傳。`;
}

// ── 接報價單 API(G2)之後 ─────────────────────────────────────────────

/** 上傳前在瀏覽器縮到最長邊 1600(報價單圖片慣例;Vercel 請求上限 4.5MB)。 */
export const UPLOAD_MAX_EDGE = 1600;
/** 報價單上傳 API 收的上限(報價單 lib/gallery/service.ts MAX_UPLOAD_BYTES)。 */
export const UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** 等比縮到最長邊不超過 max;本來就小就不放大。 */
export function fitWithin(width: number, height: number, max: number = UPLOAD_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 呼叫端丟這個錯 ⇒ 畫面直接顯示它的訊息(已經是給員工看的話)。 */
export class GalleryUserError extends Error {}

export type GalleryAction = 'reorder' | 'remove' | 'hide' | 'unhide' | 'upload';

/**
 * 報價單 API 的錯誤 ⇒ 給員工看的一句話。
 * 🔴 刪除、上傳在「結果不明」(連不上、500)時不叫人直接重按:可能已經做了。排序、隱藏重做一次結果相同,可以重試。
 */
export function galleryErrorMessage(action: GalleryAction, status: number, code: string): string {
  if (action === 'reorder' && status === 409) return '供應商剛更新了照片，請重新整理再排。';
  if (action === 'remove' && code === 'GALLERY_WRONG_SOURCE') return '供應商照片不能刪除，可以隱藏。';
  if (status === 400) {
    // 報價單上傳 400 的原因是中文句子(報價單 lib/gallery/service.ts):「只收…」「檔案…」是照片本身的問題,
    // 其餘(supplier_slug、main_sku、actor、request_id 格式)是網站送的參數錯 ⇒ 員工改照片也沒用(Fable R1 建議 3)。
    // ponytail: 靠報價單訊息的開頭字判斷;報價單改用錯誤代碼後改成比對代碼。
    if (action === 'upload' && /^(只收|檔案)/.test(code)) return '照片沒有上傳：格式或大小不符（只收 JPG、PNG、WebP，4MB 以內）。';
    return '圖庫連線設定有誤，請聯絡系統管理員。';
  }
  if (code === 'GALLERY_PRODUCT_NOT_FOUND') return '報價單找不到這件商品，暫時無法整理照片。';
  if (code === 'GALLERY_NOT_IN_PRODUCT') return '這張照片已經不在這件商品的圖庫裡，請重新整理頁面。';
  if (status === 409) return '照片剛被別人改過，請重新整理頁面後再試。';
  if (action === 'upload' && status === 503) return '照片空間尚未設定，暫時無法上傳。';
  if (status === 401) return '圖庫連線設定有誤，請聯絡系統管理員。';
  if (action === 'remove') return '刪除的結果不確定，請重新整理頁面，確認這張照片是否還在。';
  if (action === 'upload') return '上傳的結果不確定，請重新整理頁面，確認照片是否已經上傳。';
  return '沒有完成，請再試一次。若仍失敗，請聯絡系統管理員。';
}
