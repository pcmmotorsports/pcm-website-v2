import 'server-only';
import type { GalleryPhoto } from './product-gallery';

// gallery-api.ts — 網站後台呼叫報價單圖庫 API(共用圖庫 G2)的 client。只在伺服器端用。
// 介面:報價單 repo feat/gallery-g2-api-58 的 app/api/gallery/route.ts(GET 讀、POST op)與 upload/route.ts(multipart)。
// 🔴 密鑰與報價單網址只從 env 讀(PCM_GALLERY_API_BASE / PCM_GALLERY_API_SECRET),任一沒設 ⇒ 整個圖庫不啟用。
// 🔴 request_id 每次呼叫一個新的 uuid(報價單那邊只收 uuid;網站自己的 req_… 格式不行)。

export interface GalleryApiConfig {
  readonly base: string;
  readonly secret: string;
}

export interface GalleryKey {
  readonly supplierSlug: string;
  readonly mainSku: string;
}

export type GalleryApiResult<T> = ({ ok: true } & T) | { ok: false; status: number; code: string };

export type GalleryOp =
  | { op: 'remove'; id: string }
  | { op: 'set_hidden'; id: string; hidden: boolean }
  | { op: 'reorder'; ids: string[] };

const TIMEOUT_MS = 20_000;
/** 打開商品頁時那一讀:報價單卡住也不能讓整頁跟著等(Fable R1 建議 2)。 */
const LIST_TIMEOUT_MS = 5_000;

export function readGalleryApiConfig(env: Record<string, string | undefined> = process.env): GalleryApiConfig | null {
  const base = env.PCM_GALLERY_API_BASE?.trim().replace(/\/+$/, '') ?? '';
  const secret = env.PCM_GALLERY_API_SECRET?.trim() ?? '';
  // 密鑰走 Authorization 標頭 ⇒ 不是 https 就不送
  if (!base.startsWith('https://') || secret === '') return null;
  return { base, secret };
}

function isPhoto(v: unknown): v is GalleryPhoto {
  if (v === null || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.url === 'string' &&
    (p.source === 'staff' || p.source === 'supplier') &&
    typeof p.position === 'number' &&
    typeof p.hidden === 'boolean'
  );
}

function toPhotos(v: unknown): GalleryPhoto[] {
  return Array.isArray(v)
    ? v.filter(isPhoto).map(({ id, url, source, position, hidden }) => ({ id, url, source, position, hidden }))
    : [];
}

export function createGalleryApi(config: GalleryApiConfig, fetchImpl: typeof fetch = fetch) {
  async function call(
    path: string,
    init: RequestInit,
    timeoutMs: number = TIMEOUT_MS,
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; status: number; code: string }> {
    let res: Response;
    try {
      res = await fetchImpl(`${config.base}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${config.secret}` },
        cache: 'no-store',
        // 不跟隨轉址:轉到別的網址時密鑰標頭會跟著送出去(Fable R1 建議 1)
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      console.error('[admin/gallery-api] 連不到報價單', path, error);
      return { ok: false, status: 0, code: 'network' };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, status: res.status, code: typeof body.error === 'string' ? body.error : 'unknown' };
    return { ok: true, body };
  }

  const common = (key: GalleryKey, actor: string) => ({
    supplier_slug: key.supplierSlug,
    main_sku: key.mainSku,
    actor,
    request_id: crypto.randomUUID(),
  });

  return {
    async list(key: GalleryKey, actor: string): Promise<GalleryApiResult<{ photos: GalleryPhoto[] }>> {
      const r = await call(`/api/gallery?${new URLSearchParams(common(key, actor))}`, { method: 'GET' }, LIST_TIMEOUT_MS);
      return r.ok ? { ok: true, photos: toPhotos(r.body.photos) } : r;
    },

    async op(key: GalleryKey, actor: string, op: GalleryOp): Promise<GalleryApiResult<{ photos?: GalleryPhoto[] }>> {
      const r = await call('/api/gallery', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...op, ...common(key, actor) }),
      });
      if (!r.ok) return r;
      return Array.isArray(r.body.photos) ? { ok: true, photos: toPhotos(r.body.photos) } : { ok: true };
    },

    async upload(key: GalleryKey, actor: string, file: File): Promise<GalleryApiResult<object>> {
      const form = new FormData();
      for (const [k, v] of Object.entries(common(key, actor))) form.set(k, v);
      form.set('file', file);
      const r = await call('/api/gallery/upload', { method: 'POST', body: form });
      return r.ok ? { ok: true } : r;
    },
  };
}
