'use server';

import { isUuid } from '../orders/note-action-state';
import { authorizeAdminMutation } from '../session/authorize';
import { createGalleryApi, readGalleryApiConfig, type GalleryKey, type GalleryOp } from './gallery-api';
import { getProductForAdmin } from './product-repository';
import {
  UPLOAD_MAX_BYTES,
  galleryErrorMessage,
  uploadRejection,
  type GalleryAction,
  type GalleryPhoto,
} from './product-gallery';

// gallery-actions.ts — 商品頁「照片」的 server action(共用圖庫 G5 接 G2)。
// 🔴 每一支都先 authorizeAdminMutation(登入 + 來源檢查),actor = 登入員工 id(Sean C4 甲:全員可改、留紀錄)。
// 🔴 報價單要的鍵(supplier_slug + main_sku)由伺服器從商品讀,不收瀏覽器傳來的:
//    main_sku = 網站 products.external_id(同步時就是用報價單的 COALESCE(NULLIF(group_code,''), upper(sku)) 產的)。

/** curated false = 尚未整理(畫面上的是報價單目前給網站的供應商照片)。 */
export type GalleryActionResult = { ok: true; curated: boolean; photos: GalleryPhoto[] } | { ok: false; message: string };

/** 報價單要的照片網址形狀(G2:https、最多 2048 字)。 */
function isPhotoUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2048;
}

const DENIED = '沒有權限或登入已過期，請重新登入後再試。';
const DISABLED = '圖庫尚未啟用。';
const INVALID = '資料不完整，請重新整理頁面後再試。';
const RELOAD_FAILED = '已完成，但照片清單重新載入失敗，請重新整理頁面。';

type Ready = { ok: true; api: ReturnType<typeof createGalleryApi>; key: GalleryKey; actor: string } | { ok: false; message: string };

async function prepare(productId: string): Promise<Ready> {
  const auth = await authorizeAdminMutation();
  if (!auth) return { ok: false, message: DENIED };
  const config = readGalleryApiConfig();
  if (!config) return { ok: false, message: DISABLED };
  if (!isUuid(productId)) return { ok: false, message: INVALID };
  const product = await getProductForAdmin(productId).catch((error: unknown) => {
    console.error('[admin/products/gallery] 商品讀取失敗', error);
    return null;
  });
  if (!product) return { ok: false, message: '商品資料載入失敗，請重新整理頁面。' };
  return {
    ok: true,
    api: createGalleryApi(config),
    key: { supplierSlug: product.supplier_slug, mainSku: product.external_id },
    actor: auth.actorId,
  };
}

async function reload(r: Extract<Ready, { ok: true }>): Promise<GalleryActionResult> {
  const list = await r.api.list(r.key, r.actor);
  return list.ok ? { ok: true, curated: list.curated, photos: list.photos } : { ok: false, message: RELOAD_FAILED };
}

async function runOp(productId: string, action: GalleryAction, op: GalleryOp): Promise<GalleryActionResult> {
  const r = await prepare(productId);
  if (!r.ok) return r;
  const res = await r.api.op(r.key, r.actor, op);
  if (!res.ok) return { ok: false, message: galleryErrorMessage(action, res.status, res.code, r.key.supplierSlug) };
  // 成功後一律重讀清單:報價單的操作回應裡沒有照片清單(見 gallery-api.ts op 的註解;2026-09-28 照片變 0 張的根因)。
  return reload(r);
}

/** urls = 這件商品全部照片(含已隱藏)的新順序。 */
export async function reorderGalleryAction(productId: string, urls: string[]): Promise<GalleryActionResult> {
  if (!Array.isArray(urls) || urls.length === 0 || !urls.every(isPhotoUrl) || new Set(urls).size !== urls.length) {
    return { ok: false, message: INVALID };
  }
  return runOp(productId, 'reorder', { op: 'reorder', urls });
}

export async function removeGalleryPhotoAction(productId: string, id: string): Promise<GalleryActionResult> {
  if (!isUuid(id)) return { ok: false, message: INVALID };
  return runOp(productId, 'remove', { op: 'remove', id });
}

export async function setGalleryHiddenAction(productId: string, url: string, hidden: boolean): Promise<GalleryActionResult> {
  if (!isPhotoUrl(url) || typeof hidden !== 'boolean') return { ok: false, message: INVALID };
  return runOp(productId, hidden ? 'hide' : 'unhide', { op: 'set_hidden', url, hidden });
}

/** FormData:product_id、file(瀏覽器已縮到最長邊 1600)。一次一張。 */
export async function uploadGalleryPhotoAction(form: FormData): Promise<GalleryActionResult> {
  // 先驗登入與商品,再看檔案:沒權限的人不該先聽到檔案哪裡不對(Fable R1 建議 4)
  const r = await prepare(String(form.get('product_id') ?? ''));
  if (!r.ok) return r;
  const file = form.get('file');
  if (!(file instanceof File)) return { ok: false, message: INVALID };
  const rejected = uploadRejection(file);
  if (rejected) return { ok: false, message: rejected };
  if (file.size === 0) return { ok: false, message: `「${file.name}」沒有上傳：檔案是空的，請換一張照片。` };
  if (file.size > UPLOAD_MAX_BYTES) {
    return { ok: false, message: `「${file.name}」沒有上傳：縮小後仍超過 4MB，請換一張較小的照片。` };
  }
  const res = await r.api.upload(r.key, r.actor, file);
  if (!res.ok) return { ok: false, message: galleryErrorMessage('upload', res.status, res.code, r.key.supplierSlug) };
  return reload(r);
}
