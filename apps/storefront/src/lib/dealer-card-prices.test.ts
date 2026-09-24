// lib/dealer-card-prices.ts —— 經銷站列表卡片換成經銷價(B2B 計畫第四版 C 節片 5)。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogCardProduct } from './catalog-page';

const h = vi.hoisted(() => ({
  ids: vi.fn(async (handles: readonly string[]) => new Map(handles.map((s) => [s, `uuid-${s}`]))),
  prices: vi.fn(async (a: { productIds: readonly string[] }) => new Map(a.productIds.filter((id) => id !== 'uuid-nodeal').map((id) => [`product:${id}`, 700]))),
}));
vi.mock('@/lib/products', () => ({ fetchProductIdsByHandles: h.ids }));
const rpc = vi.hoisted(() => ({ fn: vi.fn(), boom: false }));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => {
    if (rpc.boom) throw new Error('network'); // 整段丟例外(連線、建 client 失敗)
    return { rpc: rpc.fn };
  },
}));
vi.mock('@/lib/tier-prices', () => ({
  fetchEffectivePrices: h.prices,
  priceKey: (kind: string, id: string) => `${kind}:${id}`,
}));

import { dealerPricesFor, withDealerCardPrices, withDealerCardPricesViaRpc } from './dealer-card-prices';

const card = (slug: string, extra: Partial<CatalogCardProduct> = {}) =>
  ({ slug, price: 1000, origPrice: 1200, originalPrice: 1200, isSale: true, tierLabel: null, ...extra }) as CatalogCardProduct;

beforeEach(() => {
  h.ids.mockClear();
  h.prices.mockClear();
});

describe('withDealerCardPrices', () => {
  it('不是 store ⇒ 原樣(新陣列),不查任何東西', async () => {
    const items = [card('a')];
    const out = await withDealerCardPrices(items, 'general');
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
    expect(h.prices).not.toHaveBeenCalled();
  });

  it('store ⇒ 換成經銷價、不劃原價不標特價;有 productId 的不再查 uuid;不動原物件', async () => {
    const withId = card('a', { productId: 'uuid-a' });
    const noId = card('b');
    const out = await withDealerCardPrices([withId, noId], 'store');
    expect(out.map((p) => p.price)).toEqual([700, 700]);
    expect(out[0]).toMatchObject({ origPrice: null, originalPrice: null, isSale: false });
    expect(h.ids).toHaveBeenCalledWith(['b']);
    expect(withId.price).toBe(1000); // 快取裡的物件不可以被改
  });

  // 🔴 結帳收經銷價 ⇒ 取不到時不可以印一般價。
  it('store 取不到經銷價 ⇒ price null,不退回一般價;整段失敗也一樣', async () => {
    const out = await withDealerCardPrices([card('nodeal'), card('a')], 'store');
    expect(out.map((p) => p.price)).toEqual([null, 700]);
    // B2B 5d:缺價的那張卡帶旗標(卡片印「價格暫時無法取得」);有價的不帶
    expect(out.map((p) => p.dealerPriceMissing)).toEqual([true, undefined]);
    h.prices.mockRejectedValueOnce(new Error('rpc down'));
    const failed = await withDealerCardPrices([card('a')], 'store');
    expect(failed[0]?.price).toBeNull();
  });

  it('超過 200 個 id ⇒ 分批送', async () => {
    const many = Array.from({ length: 450 }, (_, i) => card(`p${i}`, { productId: `uuid-p${i}` }));
    const out = await withDealerCardPrices(many, 'store');
    expect(h.prices).toHaveBeenCalledTimes(3);
    expect(out.every((p) => p.price === 700)).toBe(true);
  });

  it('dealerPricesFor:只回取得到的,去重、略過空 id', async () => {
    const got = await dealerPricesFor(['uuid-a', 'uuid-a', '', 'uuid-nodeal']);
    expect([...got]).toEqual([['uuid-a', 700]]);
    expect(h.prices).toHaveBeenCalledTimes(1);
  });

  // 清冊:四個列表都要換價(Codex R3 必修 4、R5 必修 1 列的地方;收藏清單與搜尋疊層在片 5b)。
  it('/search、首頁、會員中心、商品頁相關商品都走 withDealerCardPrices', () => {
    for (const rel of ['../app/search/page.tsx', '../app/page.tsx', '../app/account/page.tsx', '../app/products/[slug]/page.tsx']) {
      const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(src, rel).toContain('withDealerCardPrices(');
      // 第二個參數不可以寫死(Codex 5a R1 建議 1:寫死 'general' 時經銷商會看回一般價,而只查呼叫存在的清冊照樣綠)
      expect(src, rel).not.toMatch(/withDealerCardPrices\([^)]*,\s*['"`]/);
    }
  });

  // 片 5b:搜尋疊層與收藏清單。
  it('搜尋疊層走 withDealerCardPrices;會員中心把收藏經銷價傳給收藏清單', () => {
    const strip = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(strip('../app/api/search/route.ts')).toMatch(/withDealerCardPricesViaRpc\(items\)/);
    const account = strip('../app/account/page.tsx');
    expect(account).toContain('dealerPricesFor(');
    expect(account).toContain('favoriteDealerPrices={favoriteDealerPrices}');
    expect(strip('../components/account/AccountView.tsx')).toContain('dealerPrices={favoriteDealerPrices ?? null}');
  });
});

// 🔴 B2B 片 5b:搜尋疊層直接呼叫一次 get_effective_prices,由資料庫驗身分(不先查等級)。
describe('withDealerCardPricesViaRpc', () => {
  const hit = (id: string) => card(id, { productId: `uuid-${id}` });
  beforeEach(() => {
    rpc.fn.mockReset();
    rpc.boom = false;
  });

  it('資料庫說是 store ⇒ 換經銷價,取不到的那件不印金額;只呼叫一次', async () => {
    rpc.fn.mockResolvedValue({ data: [{ kind: 'product', id: 'uuid-a', amount: 700, currency: 'TWD', tier: 'store' }], error: null });
    const out = await withDealerCardPricesViaRpc([hit('a'), hit('b')]);
    expect(out.map((p) => p.price)).toEqual([700, null]);
    expect(out[0]).toMatchObject({ origPrice: null, isSale: false });
    expect(rpc.fn).toHaveBeenCalledTimes(1);
    expect(rpc.fn).toHaveBeenCalledWith('get_effective_prices', { p_product_ids: ['uuid-a', 'uuid-b'], p_variant_ids: null });
  });
  it('資料庫說不是 store ⇒ 原樣(一般價)', async () => {
    rpc.fn.mockResolvedValue({ data: [{ kind: 'product', id: 'uuid-a', amount: 1000, currency: 'TWD', tier: 'general' }], error: null });
    const out = await withDealerCardPricesViaRpc([hit('a')]);
    expect(out[0]?.price).toBe(1000);
  });
  it('呼叫失敗 ⇒ 全部不印金額(分不出是不是經銷商,不退回一般價)', async () => {
    rpc.fn.mockResolvedValue({ data: null, error: { code: '500' } });
    expect((await withDealerCardPricesViaRpc([hit('a')])).map((p) => p.price)).toEqual([null]);
    rpc.boom = true;
    expect((await withDealerCardPricesViaRpc([hit('a')])).map((p) => p.price)).toEqual([null]);
  });
  it('沒有商品編號 ⇒ 不呼叫', async () => {
    await withDealerCardPricesViaRpc([card('a')]);
    expect(rpc.fn).not.toHaveBeenCalled();
  });
});
