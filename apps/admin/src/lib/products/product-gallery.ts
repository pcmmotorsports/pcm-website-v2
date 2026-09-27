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
