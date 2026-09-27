import { describe, expect, it } from 'vitest';
import {
  fitWithin,
  galleryErrorMessage,
  GALLERY_ACCEPT,
  galleryOrderChanged,
  moveGalleryPhoto,
  splitGallery,
  uploadRejection,
  type GalleryPhoto,
} from './product-gallery';

// product-gallery.test.ts — 共用圖庫 G5 的純邏輯(畫面元件用;還沒接報價單 API)。
// 表結構照報價單 20260927160000_product_gallery.sql:我們上傳的(staff)只能刪、供應商的(supplier)只能隱藏。

const P = (id: string, over: Partial<GalleryPhoto> = {}): GalleryPhoto => ({
  id,
  url: `https://img.example/${id}.webp`,
  source: 'staff',
  position: 0,
  hidden: false,
  ...over,
});

describe('splitGallery', () => {
  it('顯示中的照 position 排;已隱藏的另外一組', () => {
    const { shown, hidden } = splitGallery([
      P('c', { position: 2 }),
      P('a', { position: 0 }),
      P('h', { position: 1, source: 'supplier', hidden: true }),
      P('b', { position: 1 }),
    ]);
    expect(shown.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(hidden.map((p) => p.id)).toEqual(['h']);
  });

  it('position 相同時用網址排, 每次結果一樣(尚未整理的照片沒有 id)', () => {
    const { shown } = splitGallery([P('b', { position: 0, id: null }), P('a', { position: 0, id: null })]);
    expect(shown.map((p) => p.url)).toEqual(['https://img.example/a.webp', 'https://img.example/b.webp']);
  });
});

describe('moveGalleryPhoto', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('往後拖', () => expect(moveGalleryPhoto(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']));
  it('往前拖(設為封面 = 拖到 0)', () => expect(moveGalleryPhoto(ids, 3, 0)).toEqual(['d', 'a', 'b', 'c']));
  it('原地或超出範圍 ⇒ 不變, 不產生 undefined', () => {
    expect(moveGalleryPhoto(ids, 1, 1)).toEqual(ids);
    expect(moveGalleryPhoto(ids, -1, 2)).toEqual(ids);
    expect(moveGalleryPhoto(ids, 1, 9)).toEqual(ids);
  });
  it('不改原陣列', () => {
    const copy = [...ids];
    moveGalleryPhoto(copy, 0, 3);
    expect(copy).toEqual(ids);
  });
});

describe('galleryOrderChanged', () => {
  it('順序一樣 ⇒ false;換過 ⇒ true;換回來 ⇒ false', () => {
    expect(galleryOrderChanged(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(galleryOrderChanged(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(galleryOrderChanged(['a', 'b'], moveGalleryPhoto(['b', 'a'], 1, 0))).toBe(false);
  });
});

describe('uploadRejection:只收 JPG、PNG、WebP', () => {
  it('接受的格式 ⇒ null', () => {
    expect(uploadRejection({ name: 'a.jpg', type: 'image/jpeg' })).toBeNull();
    expect(uploadRejection({ name: 'a.png', type: 'image/png' })).toBeNull();
    expect(uploadRejection({ name: 'a.webp', type: 'image/webp' })).toBeNull();
  });
  it('iPhone 的 HEIC ⇒ 說清楚怎麼改', () => {
    expect(uploadRejection({ name: '側面-原檔.heic', type: 'image/heic' })).toBe(
      '「側面-原檔.heic」沒有上傳：只接受 JPG、PNG、WebP。請在手機設定改成「最相容」格式，或先轉檔再上傳。',
    );
  });
  it('瀏覽器沒給格式(空字串)也擋, 不當成可以', () => {
    expect(uploadRejection({ name: 'x', type: '' })).not.toBeNull();
  });
  it('檔案選擇框的 accept 與上面同一組', () => {
    expect(GALLERY_ACCEPT).toBe('image/jpeg,image/png,image/webp');
  });
});

describe('fitWithin:上傳前縮到最長邊 1600', () => {
  it('橫的、直的都縮到最長邊 1600, 比例不變', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: 1600 });
  });
  it('本來就小 ⇒ 不放大', () => expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 }));
});

describe('galleryErrorMessage', () => {
  it('🔴 排序 409 ⇒ 供應商剛更新', () => {
    expect(galleryErrorMessage('reorder', 409, 'GALLERY_SET_MISMATCH')).toBe('供應商剛更新了照片，請重新整理再排。');
  });
  it('🔴 刪除 / 上傳結果不明 ⇒ 請重新整理確認, 不叫人重按', () => {
    expect(galleryErrorMessage('remove', 0, 'network')).toContain('結果不確定');
    expect(galleryErrorMessage('upload', 500, 'internal')).toContain('結果不確定');
  });
  it('排序、隱藏失敗 ⇒ 可以再試(做兩次結果一樣)', () => {
    expect(galleryErrorMessage('hide', 500, 'internal')).toContain('請再試一次');
    expect(galleryErrorMessage('reorder', 0, 'network')).toContain('請再試一次');
  });
  it('上傳 503 ⇒ 照片空間尚未設定', () => {
    expect(galleryErrorMessage('upload', 503, 'x')).toBe('照片空間尚未設定，暫時無法上傳。');
  });
});

describe('galleryErrorMessage(Fable R1 建議 3、4)', () => {
  it('上傳 400:照片本身的問題 ⇒ 說照片不符;參數錯 ⇒ 說連線設定有誤', () => {
    expect(galleryErrorMessage('upload', 400, '只收 jpeg、png、webp')).toContain('格式或大小不符');
    expect(galleryErrorMessage('upload', 400, '檔案大小要在 4194304 bytes 以內')).toContain('格式或大小不符');
    expect(galleryErrorMessage('upload', 400, '檔案讀不出圖片')).toContain('格式或大小不符');
    expect(galleryErrorMessage('upload', 400, 'supplier_slug 格式不對')).toBe('圖庫連線設定有誤，請聯絡系統管理員。');
    expect(galleryErrorMessage('upload', 400, 'request_id 要是 uuid')).toBe('圖庫連線設定有誤，請聯絡系統管理員。');
  });
  it('其他動作 400 ⇒ 連線設定有誤', () => {
    expect(galleryErrorMessage('reorder', 400, 'actor 要是員工帳號(小寫英數與底線)')).toBe('圖庫連線設定有誤，請聯絡系統管理員。');
  });
  it('刪除供應商照片(409 WRONG_SOURCE)⇒ 說不能刪、可以隱藏', () => {
    expect(galleryErrorMessage('remove', 409, 'GALLERY_WRONG_SOURCE')).toBe('供應商照片不能刪除，可以隱藏。');
  });
});
