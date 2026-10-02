import { beforeEach, describe, expect, it, vi } from 'vitest';

// gallery-actions.test.ts — 商品頁「照片」的 server action(G5 接 G2)。報價單 API、登入、商品讀取全用假的。

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  config: vi.fn(),
  product: vi.fn(),
  list: vi.fn(),
  op: vi.fn(),
  upload: vi.fn(),
  setImages: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('../session/authorize', () => ({ authorizeAdminMutation: m.auth }));
vi.mock('./product-repository', () => ({ getProductForAdmin: m.product }));
vi.mock('./manual-product-repository', () => ({ setManualProductImages: m.setImages }));
vi.mock('../audit/context', () => ({ getRequestId: async () => 'req-1' }));
vi.mock('./gallery-api', () => ({
  readGalleryApiConfig: m.config,
  createGalleryApi: () => ({ list: m.list, op: m.op, upload: m.upload }),
}));

import {
  removeGalleryPhotoAction,
  reorderGalleryAction,
  setGalleryHiddenAction,
  uploadGalleryPhotoAction,
} from './gallery-actions';

const PID = '22222222-2222-4222-8222-222222222222';
const PHOTO_ID = '11111111-1111-4111-8111-111111111111';
const URL1 = 'https://img/a.webp';
const ROW = { id: PHOTO_ID, url: URL1, source: 'staff', position: 0, hidden: false };
const KEY = { supplierSlug: 'rpm', mainSku: 'BR-LV-0003' };

beforeEach(() => {
  vi.clearAllMocks();
  m.auth.mockResolvedValue({ sid: 's', actorId: 'staff_1' });
  m.config.mockReturnValue({ base: 'https://q', secret: 'x' });
  m.product.mockResolvedValue({ id: PID, supplier_slug: 'rpm', external_id: 'BR-LV-0003' });
  m.list.mockResolvedValue({ ok: true, curated: true, photos: [ROW] });
});

describe('共同的檢查', () => {
  it('沒登入或來源不對 ⇒ 不呼叫報價單', async () => {
    m.auth.mockResolvedValueOnce(null);
    expect(await reorderGalleryAction(PID, [URL1])).toEqual({
      ok: false,
      message: '沒有權限或登入已過期，請重新登入後再試。',
    });
    expect(m.op).not.toHaveBeenCalled();
  });

  it('圖庫沒啟用(env 沒設)⇒「圖庫尚未啟用」', async () => {
    m.config.mockReturnValueOnce(null);
    expect(await reorderGalleryAction(PID, [URL1])).toEqual({ ok: false, message: '圖庫尚未啟用。' });
  });

  it('🔴 報價單要的鍵由伺服器從商品讀(supplier_slug + external_id), 不信瀏覽器傳來的', async () => {
    m.op.mockResolvedValueOnce({ ok: true });
    await reorderGalleryAction(PID, [URL1]);
    expect(m.product).toHaveBeenCalledWith(PID);
    expect(m.op).toHaveBeenCalledWith(KEY, 'staff_1', { op: 'reorder', urls: [URL1] });
  });

  it('商品 id 或照片 id 不是 uuid ⇒ 不查', async () => {
    expect((await reorderGalleryAction('x', [URL1])).ok).toBe(false);
    expect((await removeGalleryPhotoAction(PID, 'x')).ok).toBe(false);
    expect(m.op).not.toHaveBeenCalled();
  });
});

describe('排序', () => {
  // 🔴 2026-09-28 Sean 實撞「儲存順序後照片變 0 張」:報價單操作後不回照片物件(排序回網址字串、隱藏回 photo、刪除回 removed),
  //    所以每一種操作成功後都重讀圖庫清單。
  it('🔴 每一種操作成功後都重讀圖庫清單, 畫面拿到的是完整照片(不會變 0 張)', async () => {
    const LISTED = [ROW, { ...ROW, id: '22222222-2222-4222-8222-222222222222', url: 'https://img.example.com/b.jpg', position: 1 }];
    m.list.mockResolvedValue({ ok: true, curated: true, photos: LISTED });
    // 舊的 op 對報價單真實回應(網址字串)解析出來的就是空清單;不能拿它當畫面上的照片。
    m.op.mockResolvedValue({ ok: true, photos: [] });
    expect(await reorderGalleryAction(PID, [URL1])).toEqual({ ok: true, curated: true, photos: LISTED });
    expect(await removeGalleryPhotoAction(PID, PHOTO_ID)).toEqual({ ok: true, curated: true, photos: LISTED });
    expect(await setGalleryHiddenAction(PID, URL1, true)).toEqual({ ok: true, curated: true, photos: LISTED });
    expect(m.list).toHaveBeenCalledTimes(3);
  });

  it('成功 ⇒ 回重讀後排好的照片', async () => {
    m.op.mockResolvedValueOnce({ ok: true });
    expect(await reorderGalleryAction(PID, [URL1])).toEqual({ ok: true, curated: true, photos: [ROW] });
  });

  it('🔴 409(供應商同步剛好加了或拿掉照片)⇒ 請員工重新整理再排', async () => {
    m.op.mockResolvedValueOnce({ ok: false, status: 409, code: 'GALLERY_SET_MISMATCH' });
    expect(await reorderGalleryAction(PID, [URL1])).toEqual({
      ok: false,
      message: '供應商剛更新了照片，請重新整理再排。',
    });
  });
});

describe('刪除、隱藏', () => {
  it('刪除成功 ⇒ 重新讀一次圖庫回傳', async () => {
    m.op.mockResolvedValueOnce({ ok: true });
    expect(await removeGalleryPhotoAction(PID, PHOTO_ID)).toEqual({ ok: true, curated: true, photos: [ROW] });
    expect(m.op).toHaveBeenCalledWith(KEY, 'staff_1', { op: 'remove', id: PHOTO_ID });
    expect(m.list).toHaveBeenCalledWith(KEY, 'staff_1');
  });

  it('🔴 刪除時連線失敗 ⇒ 結果不確定, 不叫員工直接重按', async () => {
    m.op.mockResolvedValueOnce({ ok: false, status: 0, code: 'network' });
    const r = await removeGalleryPhotoAction(PID, PHOTO_ID);
    expect(r).toEqual({ ok: false, message: '刪除的結果不確定，請重新整理頁面，確認這張照片是否還在。' });
  });

  it('隱藏 / 取消隱藏帶 hidden 旗標', async () => {
    m.op.mockResolvedValue({ ok: true });
    await setGalleryHiddenAction(PID, URL1, true);
    await setGalleryHiddenAction(PID, URL1, false);
    expect(m.op).toHaveBeenNthCalledWith(1, KEY, 'staff_1', { op: 'set_hidden', url: URL1, hidden: true });
    expect(m.op).toHaveBeenNthCalledWith(2, KEY, 'staff_1', { op: 'set_hidden', url: URL1, hidden: false });
  });

  it('成功了但重新讀圖庫失敗 ⇒ 講清楚已完成、請重新整理', async () => {
    m.op.mockResolvedValueOnce({ ok: true });
    m.list.mockResolvedValueOnce({ ok: false, status: 500, code: 'internal' });
    expect(await setGalleryHiddenAction(PID, URL1, true)).toEqual({
      ok: false,
      message: '已完成，但照片清單重新載入失敗，請重新整理頁面。',
    });
  });
});

describe('上傳', () => {
  const form = (file: File) => {
    const f = new FormData();
    f.set('product_id', PID);
    f.set('file', file);
    return f;
  };

  it('成功 ⇒ 上傳後重新讀圖庫', async () => {
    m.upload.mockResolvedValueOnce({ ok: true });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    expect(await uploadGalleryPhotoAction(form(file))).toEqual({ ok: true, curated: true, photos: [ROW] });
    expect(m.upload).toHaveBeenCalledWith(KEY, 'staff_1', expect.any(File));
  });

  it('格式不收或超過 4MB ⇒ 不送報價單', async () => {
    const heic = await uploadGalleryPhotoAction(form(new File(['x'], 'a.heic', { type: 'image/heic' })));
    expect(heic.ok).toBe(false);
    const big = await uploadGalleryPhotoAction(form(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'b.jpg', { type: 'image/jpeg' })));
    expect(big.ok).toBe(false);
    expect(m.upload).not.toHaveBeenCalled();
  });

  it('503(報價單照片空間還沒設)⇒ 暫時無法上傳', async () => {
    m.upload.mockResolvedValueOnce({ ok: false, status: 503, code: '照片空間尚未設定' });
    const r = await uploadGalleryPhotoAction(form(new File(['x'], 'a.jpg', { type: 'image/jpeg' })));
    expect(r).toEqual({ ok: false, message: '照片空間尚未設定，暫時無法上傳。' });
  });
});

describe('上傳檢查順序與空檔(Fable R1 建議 4)', () => {
  const form = (file: File) => {
    const f = new FormData();
    f.set('product_id', PID);
    f.set('file', file);
    return f;
  };
  it('沒登入 ⇒ 先說沒權限, 不先評論檔案', async () => {
    m.auth.mockResolvedValueOnce(null);
    const r = await uploadGalleryPhotoAction(form(new File(['x'], 'a.heic', { type: 'image/heic' })));
    expect(r).toEqual({ ok: false, message: '沒有權限或登入已過期，請重新登入後再試。' });
  });
  it('空檔 ⇒ 說檔案是空的', async () => {
    const r = await uploadGalleryPhotoAction(form(new File([], 'a.jpg', { type: 'image/jpeg' })));
    expect(r).toEqual({ ok: false, message: '「a.jpg」沒有上傳：檔案是空的，請換一張照片。' });
  });
});

describe('G2 新介面:網址與尚未整理', () => {
  it('排序網址要是不重複的 https;隱藏網址要是 https ⇒ 否則不送', async () => {
    expect((await reorderGalleryAction(PID, ['http://x/a.jpg'])).ok).toBe(false);
    expect((await reorderGalleryAction(PID, [URL1, URL1])).ok).toBe(false);
    expect((await reorderGalleryAction(PID, [])).ok).toBe(false);
    expect((await setGalleryHiddenAction(PID, 'not-a-url', true)).ok).toBe(false);
    expect(m.op).not.toHaveBeenCalled();
  });

  it('排序成功 ⇒ 圖庫已整理(報價單第一次寫入時已把供應商照片寫進去)', async () => {
    m.op.mockResolvedValueOnce({ ok: true });
    expect(await reorderGalleryAction(PID, [URL1])).toEqual({ ok: true, curated: true, photos: [ROW] });
  });

  it('重新讀圖庫帶回 curated', async () => {
    m.op.mockResolvedValueOnce({ ok: true });
    m.list.mockResolvedValueOnce({ ok: true, curated: false, photos: [] });
    expect(await setGalleryHiddenAction(PID, URL1, false)).toEqual({ ok: true, curated: false, photos: [] });
  });
});

// 2026-10-02 計畫-手動商品照片寫回網站(Sean Q1 甲):手動商品(pcm)不在每日同步裡, 照片要由後台寫回網站 products.images。
describe('手動商品:照片操作成功後寫回網站', () => {
  const MANUAL = { id: PID, supplier_slug: 'pcm', external_id: 'TEST-01' };
  const A = { id: PHOTO_ID, url: 'https://img.example.com/a.jpg', source: 'staff', position: 1, hidden: false };
  const B = { id: '33333333-3333-4333-8333-333333333333', url: 'https://img.example.com/b.jpg', source: 'staff', position: 0, hidden: false };
  const H = { id: '44444444-4444-4444-8444-444444444444', url: 'https://img.example.com/h.jpg', source: 'staff', position: 2, hidden: true };

  beforeEach(() => {
    m.product.mockResolvedValue(MANUAL);
    m.list.mockResolvedValue({ ok: true, curated: true, photos: [A, B, H] });
    m.op.mockResolvedValue({ ok: true });
    m.upload.mockResolvedValue({ ok: true });
    m.setImages.mockResolvedValue('UPDATED');
  });

  it('排序、刪除、隱藏、上傳成功 ⇒ 都寫回網站:只帶沒隱藏的照片, 照順序', async () => {
    const expected = { productId: PID, images: [B.url, A.url], actor: 'staff_1', requestId: 'req-1' };
    await reorderGalleryAction(PID, [B.url, A.url, H.url]);
    await removeGalleryPhotoAction(PID, PHOTO_ID);
    await setGalleryHiddenAction(PID, H.url, true);
    const form = new FormData();
    form.set('product_id', PID);
    form.set('file', new File([new Uint8Array([1])], 'a.jpg', { type: 'image/jpeg' }));
    await uploadGalleryPhotoAction(form);
    expect(m.setImages).toHaveBeenCalledTimes(4);
    for (const call of m.setImages.mock.calls) expect(call[0]).toEqual(expected);
  });

  it('寫回成功 ⇒ 結果和以前一樣, 沒有多出提示', async () => {
    expect(await reorderGalleryAction(PID, [B.url, A.url, H.url])).toEqual({ ok: true, curated: true, photos: [A, B, H] });
  });

  it('🔴 寫回失敗 ⇒ 照片區照常顯示報價單的結果, 另外說清楚網站沒跟著更新(不說失敗)', async () => {
    m.setImages.mockRejectedValueOnce(new Error('boom'));
    expect(await reorderGalleryAction(PID, [B.url, A.url, H.url])).toEqual({
      ok: true,
      curated: true,
      photos: [A, B, H],
      notice: '照片已更新，但網站上的商品照片沒有跟著更新。請再操作一次照片（例如重新排序），或聯絡系統管理員。',
    });
  });

  it('寫回時商品不見了(NOT_FOUND)⇒ 也當成沒跟著更新', async () => {
    m.setImages.mockResolvedValueOnce('NOT_FOUND');
    const r = await reorderGalleryAction(PID, [B.url, A.url, H.url]);
    expect(r.ok && r.notice).toBe('照片已更新，但網站上的商品照片沒有跟著更新。請再操作一次照片（例如重新排序），或聯絡系統管理員。');
  });

  it('報價單操作失敗或重讀清單失敗 ⇒ 不寫回(不知道現在的照片是哪些)', async () => {
    m.op.mockResolvedValueOnce({ ok: false, status: 500, code: 'X' });
    await reorderGalleryAction(PID, [B.url, A.url, H.url]);
    m.list.mockResolvedValueOnce({ ok: false, status: 500, code: 'X' });
    await reorderGalleryAction(PID, [B.url, A.url, H.url]);
    expect(m.setImages).not.toHaveBeenCalled();
  });

  it('同步商品(不是 pcm)⇒ 不寫回(照片由每日同步帶回網站)', async () => {
    m.product.mockResolvedValue({ id: PID, supplier_slug: 'rpm', external_id: 'BR-LV-0003' });
    await reorderGalleryAction(PID, [B.url, A.url, H.url]);
    expect(m.setImages).not.toHaveBeenCalled();
  });
});
