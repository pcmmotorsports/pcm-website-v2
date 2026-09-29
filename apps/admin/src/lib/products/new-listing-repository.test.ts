// 後台「最近 7 天新上架」清單的純函式(地圖 M-5-03;提案 ~/pcm-mailbox/提案-新商品審核-20260929.md 甲)。
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@pcm/adapters/server', () => ({ createSupabaseServiceClient: vi.fn() }));

import { LOW_PRICE_THRESHOLD, newListingFlags, sortNewListings, type NewListingFlag } from './new-listing-repository';

const ok = { priceGeneral: 12000, imageMissing: false, titleLacksCjk: false, categoryRawPath: '外觀與後視鏡' };

describe('需要注意的項目', () => {
  it('都正常 ⇒ 沒有標記', () => {
    expect(newListingFlags(ok)).toEqual([]);
  });

  it(`價格:沒有價格、或低於 NT$${LOW_PRICE_THRESHOLD}(含 0 元)都標出來`, () => {
    expect(newListingFlags({ ...ok, priceGeneral: null })).toEqual(['no_price']);
    expect(newListingFlags({ ...ok, priceGeneral: 100 })).toEqual(['low_price']);
    expect(newListingFlags({ ...ok, priceGeneral: 0 })).toEqual(['low_price']);
    expect(newListingFlags({ ...ok, priceGeneral: LOW_PRICE_THRESHOLD })).toEqual([]);
  });

  it('沒有代表圖、標題沒有中文、分類是「未分類」或沒有分類', () => {
    expect(newListingFlags({ ...ok, imageMissing: true })).toEqual(['image_missing']);
    expect(newListingFlags({ ...ok, titleLacksCjk: true })).toEqual(['title_no_cjk']);
    expect(newListingFlags({ ...ok, categoryRawPath: '未分類' })).toEqual(['uncategorized']);
    expect(newListingFlags({ ...ok, categoryRawPath: null })).toEqual(['uncategorized']);
  });

  it('多項同時成立 ⇒ 全部列出', () => {
    expect(newListingFlags({ priceGeneral: 50, imageMissing: true, titleLacksCjk: true, categoryRawPath: '未分類' })).toEqual([
      'low_price',
      'image_missing',
      'title_no_cjk',
      'uncategorized',
    ]);
  });
});

describe('排序', () => {
  it('需要注意的項目多的在前;一樣多就新到舊', () => {
    const rows: { id: string; createdAt: string; flags: NewListingFlag[] }[] = [
      { id: 'a', createdAt: '2026-09-29T01:00:00Z', flags: [] },
      { id: 'b', createdAt: '2026-09-28T01:00:00Z', flags: ['low_price'] },
      { id: 'c', createdAt: '2026-09-29T02:00:00Z', flags: ['low_price'] },
      { id: 'd', createdAt: '2026-09-27T01:00:00Z', flags: ['low_price', 'image_missing'] },
      { id: 'e', createdAt: '2026-09-29T03:00:00Z', flags: [] },
    ];
    expect(sortNewListings(rows).map((r) => r.id)).toEqual(['d', 'c', 'b', 'e', 'a']);
  });
});
