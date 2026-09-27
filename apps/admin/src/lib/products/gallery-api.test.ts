import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { createGalleryApi, readGalleryApiConfig } from './gallery-api';

// gallery-api.test.ts — 網站後台呼叫報價單圖庫 API(G2)的 client。用假的 fetch,不打真 API。
// 介面照報價單 feat/gallery-g2-api-58 的 app/api/gallery/route.ts 與 upload/route.ts。

const CONFIG = { base: 'https://quote.example', secret: 's3cret' };
const KEY = { supplierSlug: 'rpm', mainSku: 'BR-LV-0003' };
const ROW = { id: '11111111-1111-4111-8111-111111111111', url: 'https://img/a.webp', source: 'staff', position: 0, hidden: false };

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe('readGalleryApiConfig', () => {
  it('網址與密鑰都有才啟用;任一缺 ⇒ null(畫面寫「圖庫尚未啟用」)', () => {
    expect(readGalleryApiConfig({ PCM_GALLERY_API_BASE: 'https://q/', PCM_GALLERY_API_SECRET: 'x' })).toEqual({
      base: 'https://q',
      secret: 'x',
    });
    expect(readGalleryApiConfig({ PCM_GALLERY_API_BASE: 'https://q' })).toBeNull();
    expect(readGalleryApiConfig({ PCM_GALLERY_API_SECRET: 'x' })).toBeNull();
    expect(readGalleryApiConfig({ PCM_GALLERY_API_BASE: ' ', PCM_GALLERY_API_SECRET: 'x' })).toBeNull();
  });
  it('🔴 網址不是 https ⇒ 不啟用(密鑰不走明文)', () => {
    expect(readGalleryApiConfig({ PCM_GALLERY_API_BASE: 'http://q', PCM_GALLERY_API_SECRET: 'x' })).toBeNull();
  });
});

describe('list', () => {
  it('GET 帶 supplier_slug / main_sku / actor / request_id(uuid)與 Bearer 密鑰, 不快取', async () => {
    const { fn, calls } = fakeFetch(200, { curated: true, photos: [ROW] });
    const r = await createGalleryApi(CONFIG, fn).list(KEY, 'staff_1');
    expect(r).toEqual({ ok: true, curated: true, photos: [ROW] });
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe('https://quote.example/api/gallery');
    expect(u.searchParams.get('supplier_slug')).toBe('rpm');
    expect(u.searchParams.get('main_sku')).toBe('BR-LV-0003');
    expect(u.searchParams.get('actor')).toBe('staff_1');
    expect(u.searchParams.get('request_id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe('Bearer s3cret');
    expect(calls[0]!.init.cache).toBe('no-store');
  });

  it('每次呼叫都是新的 request_id', async () => {
    const { fn, calls } = fakeFetch(200, { photos: [] });
    const api = createGalleryApi(CONFIG, fn);
    await api.list(KEY, 'a');
    await api.list(KEY, 'a');
    const ids = calls.map((c) => new URL(c.url).searchParams.get('request_id'));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('形狀不對的列丟掉, 不讓畫面壞', async () => {
    const { fn } = fakeFetch(200, { curated: true, photos: [ROW, { id: 1 }, null, { ...ROW, id: '2', source: 'x' }] });
    expect(await createGalleryApi(CONFIG, fn).list(KEY, 'a')).toEqual({ ok: true, curated: true, photos: [ROW] });
  });

  it('🔴 尚未整理 ⇒ curated false、照片沒有 id(報價單回目前的供應商照片)', async () => {
    const sup = { id: null, url: 'https://cdn.sup/a.jpg', source: 'supplier', position: 0, hidden: false };
    const { fn } = fakeFetch(200, { curated: false, photos: [sup] });
    expect(await createGalleryApi(CONFIG, fn).list(KEY, 'a')).toEqual({ ok: true, curated: false, photos: [sup] });
  });

  it('沒帶 curated 或不是布林 ⇒ 當作尚未整理(不猜成已整理)', async () => {
    const { fn } = fakeFetch(200, { photos: [] });
    expect(await createGalleryApi(CONFIG, fn).list(KEY, 'a')).toEqual({ ok: true, curated: false, photos: [] });
  });

  it('錯誤 ⇒ 帶狀態碼與錯誤代碼;連線失敗 ⇒ status 0', async () => {
    const { fn } = fakeFetch(404, { error: 'GALLERY_PRODUCT_NOT_FOUND' });
    expect(await createGalleryApi(CONFIG, fn).list(KEY, 'a')).toEqual({
      ok: false,
      status: 404,
      code: 'GALLERY_PRODUCT_NOT_FOUND',
    });
    const boom = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    expect(await createGalleryApi(CONFIG, boom).list(KEY, 'a')).toEqual({ ok: false, status: 0, code: 'network' });
  });
});

describe('op', () => {
  // 🔴 2026-09-28 Sean 正式後台實撞:按「儲存順序」後照片變 0 張, 重新整理才回來。
  //    報價單 /api/gallery 的排序回 { photos: [網址字串…] }(gallery_reorder 回 to_jsonb(text[]));
  //    隱藏回 { photo }、刪除回 { removed }。op 以前把 photos 當照片物件解析 ⇒ 字串全被濾掉 ⇒ 空清單。
  //    ⇒ op 不再解析 photos, 只回成功與否;呼叫端一律重讀清單(gallery-actions.ts)。
  it('🔴 報價單排序回的是網址字串陣列 ⇒ op 只回成功, 不把它當成照片清單(以前會變成 0 張)', async () => {
    const { fn } = fakeFetch(200, { photos: ['https://img.example.com/a.jpg', 'https://img.example.com/b.jpg'] });
    expect(await createGalleryApi(CONFIG, fn).op(KEY, 'staff_1', { op: 'reorder', urls: ['https://img.example.com/b.jpg'] })).toEqual({ ok: true });
  });

  it('POST JSON:op 與參數、四個共同欄位', async () => {
    const { fn, calls } = fakeFetch(200, { photos: [ROW] });
    await createGalleryApi(CONFIG, fn).op(KEY, 'staff_1', { op: 'reorder', urls: [ROW.url] });
    expect(calls[0]!.init.method).toBe('POST');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toMatchObject({ op: 'reorder', urls: [ROW.url], supplier_slug: 'rpm', main_sku: 'BR-LV-0003', actor: 'staff_1' });
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Headers(calls[0]!.init.headers).get('content-type')).toBe('application/json');
  });

  it('409 排序衝突 ⇒ 原樣回報代碼', async () => {
    const { fn } = fakeFetch(409, { error: 'GALLERY_SET_MISMATCH' });
    expect(await createGalleryApi(CONFIG, fn).op(KEY, 'a', { op: 'reorder', urls: [] })).toEqual({
      ok: false,
      status: 409,
      code: 'GALLERY_SET_MISMATCH',
    });
  });
});

describe('upload', () => {
  it('POST multipart 到 /api/gallery/upload, 帶檔案與四個共同欄位', async () => {
    const { fn, calls } = fakeFetch(200, { photo: ROW });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const r = await createGalleryApi(CONFIG, fn).upload(KEY, 'staff_1', file);
    expect(r.ok).toBe(true);
    expect(calls[0]!.url).toBe('https://quote.example/api/gallery/upload');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('file')).toBeInstanceOf(File);
    expect(form.get('supplier_slug')).toBe('rpm');
    expect(form.get('main_sku')).toBe('BR-LV-0003');
    expect(form.get('actor')).toBe('staff_1');
    expect(String(form.get('request_id'))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('503(報價單照片空間沒設)⇒ 原樣回報', async () => {
    const { fn } = fakeFetch(503, { error: '照片空間尚未設定' });
    const r = await createGalleryApi(CONFIG, fn).upload(KEY, 'a', new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
});

describe('Fable R1 建議', () => {
  it('🔴 不跟隨轉址(密鑰不會被帶去別的網址)', async () => {
    const { fn, calls } = fakeFetch(200, { photos: [] });
    const api = createGalleryApi(CONFIG, fn);
    await api.list(KEY, 'a');
    await api.op(KEY, 'a', { op: 'remove', id: 'x' });
    await api.upload(KEY, 'a', new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    expect(calls.map((c) => c.init.redirect)).toEqual(['error', 'error', 'error']);
  });

  it('打開商品頁那一讀(list)最多等 5 秒, 寫入最多 20 秒', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const { fn } = fakeFetch(200, { photos: [] });
    const api = createGalleryApi(CONFIG, fn);
    await api.list(KEY, 'a');
    await api.op(KEY, 'a', { op: 'remove', id: 'x' });
    expect(spy.mock.calls.map((c) => c[0])).toEqual([5000, 20000]);
    spy.mockRestore();
  });
});
