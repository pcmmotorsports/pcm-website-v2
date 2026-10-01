// GET /api/catalog/quick-add:只有「剛好一個規格而且有價格」回規格編號, 其他一律「去商品頁」。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchProductByHandle = vi.fn();
vi.mock('@/lib/products', () => ({ fetchProductByHandle: (h: string) => fetchProductByHandle(h) }));

import { GET } from './route';

const V1 = { id: 'v-1', price: 1200 };
const V2 = { id: 'v-2', price: 1500 };
const ask = async (slug: string | null) => {
  const url = slug === null ? 'http://x/api/catalog/quick-add' : `http://x/api/catalog/quick-add?slug=${encodeURIComponent(slug)}`;
  const res = await GET(new Request(url));
  return { status: res.status, body: await res.json() };
};

// 🔴 要大括號:`() => fn.mockReset()` 會回傳那個 mock, 而 vitest 把 beforeEach 回傳的函式當「測完要跑的清理」
//    ⇒ 測完又呼叫一次 mock ⇒ 「查詢失敗」那格的 mock 在清理時丟錯, 整格紅在一個看不出原因的地方。
beforeEach(() => {
  fetchProductByHandle.mockReset();
});

describe('GET /api/catalog/quick-add', () => {
  it('🔴 剛好一個規格、有價格 ⇒ 回那個規格的編號', async () => {
    fetchProductByHandle.mockResolvedValue({ variants: [V1] });
    expect(await ask('rizoma-az203')).toEqual({ status: 200, body: { kind: 'add', variantId: 'v-1' } });
    expect(fetchProductByHandle).toHaveBeenCalledWith('rizoma-az203');
  });

  it.each([
    ['多個規格', { variants: [V1, V2] }],
    ['零規格(Sean 2026-08-31 不賣)', { variants: [] }],
    ['唯一規格沒有價格', { variants: [{ id: 'v-1', price: null }] }],
    ['查不到商品(已下架或打錯)', null],
  ])('%s ⇒ 去商品頁, 不回規格編號', async (_label, product) => {
    fetchProductByHandle.mockResolvedValue(product);
    expect(await ask('x')).toEqual({ status: 200, body: { kind: 'page' } });
  });

  it('查詢失敗 ⇒ 去商品頁(503), 不讓卡片自己猜', async () => {
    fetchProductByHandle.mockImplementation(async () => {
      throw new Error('db down');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await ask('x')).toEqual({ status: 503, body: { kind: 'page' } });
  });

  it('沒帶 slug 或太長 ⇒ 400 去商品頁, 不查資料庫', async () => {
    expect(await ask(null)).toEqual({ status: 400, body: { kind: 'page' } });
    expect((await ask('a'.repeat(257))).status).toBe(400);
    expect(fetchProductByHandle).not.toHaveBeenCalled();
  });
});
