import { describe, expect, it } from 'vitest';
import {
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

  it('position 相同時用 id 排, 每次結果一樣', () => {
    const { shown } = splitGallery([P('b', { position: 0 }), P('a', { position: 0 })]);
    expect(shown.map((p) => p.id)).toEqual(['a', 'b']);
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
