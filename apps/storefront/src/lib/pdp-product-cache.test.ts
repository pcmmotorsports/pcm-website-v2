/**
 * pdp-product-cache.test.ts —— PDP 商品本體 / 推薦的跨請求快取(2026-09-14 plan L1, 主視窗裁甲)。
 *
 * 守三件事(驗收 (1)(3)):
 *  ① 快取住的是【strip 成 general 之後】的 UI 物件:同 slug 一般會員先取、經銷會員後取, 經銷那份是 route 端【另外疊】的
 *     `dealerPrice`(這裡模擬 route 的 `{ ...product, dealerPrice }`), 而快取物件裡 grep 不到 dealerPrice / priceByTier / price_store。
 *  ② 同 slug 第二發 DB 零查詢(findByHandle / listInheritedFitments 計數不增)。
 *  ③ 鍵不含 tier:兩個 tier 拿到同一份快取(內容相等、參照不同 —— 每發 structuredClone 一份)。
 * 形狀照 `catalog-dealer-not-cached.test.ts`:`unstable_cache` 換成記憶體 Map, 真的會「命中」。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@pcm/domain';
import { toMoneyAmount } from '@pcm/domain';

vi.mock('server-only', () => ({}));

const cacheStore = new Map<string, unknown>();
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify(args);
      if (cacheStore.has(key)) return cacheStore.get(key);
      const out = await fn(...args);
      cacheStore.set(key, out);
      return out;
    },
}));

let findByHandleCalls = 0;
let inheritedCalls = 0;
function domainProduct(): Product {
  return {
    id: 'p-uuid-1',
    productCode: 'CODE-1',
    name: '測試商品',
    brand: { id: 'brand-1', name: 'Brand One', slug: 'brand-one', premium_extra_pct: 0 },
    category: { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] },
    fitments: [],
    priceByTier: {
      general: { amount: toMoneyAmount(45000), currency: 'TWD' },
      store: { amount: toMoneyAmount(38000), currency: 'TWD' },
      premiumStore: { amount: toMoneyAmount(36000), currency: 'TWD' },
    },
    description: '',
    highlights: [],
    manuals: [],
    soundClips: [],
    images: [],
    availability: 'in-stock',
    handle: 'handle-1',
    subtitle: '',
    variants: [],
    variantCount: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}
vi.mock('@pcm/adapters', async () => {
  const real = await vi.importActual<typeof import('@pcm/adapters')>('@pcm/adapters');
  class FakeAdapter {
    async findByHandle(h: string) {
      findByHandleCalls += 1;
      return h === 'handle-1' ? domainProduct() : null;
    }
    async listInheritedFitments() {
      inheritedCalls += 1;
      return [];
    }
  }
  return { ...real, SupabaseProductAdapter: FakeAdapter };
});
vi.mock('@/lib/catalog-anon-client', () => ({ createCatalogAnonClient: () => ({}) }));

const { fetchProductByHandle } = await import('./products');

beforeEach(() => {
  cacheStore.clear();
  findByHandleCalls = 0;
  inheritedCalls = 0;
});

describe('PDP 商品本體跨請求快取(L1)', () => {
  it('🔴 ① 快取物件是 general 版:沒有 dealerPrice / priceByTier / price_store;route 疊的 dealerPrice 不會回流進快取', async () => {
    const general = await fetchProductByHandle('handle-1');
    expect(general).not.toBeNull();
    const json = JSON.stringify(general);
    expect(json).not.toContain('dealerPrice');
    expect(json).not.toContain('priceByTier');
    expect(json).not.toContain('price_store');
    expect(json).not.toContain('38000');
    // 模擬 route 對經銷會員【真正】做的事:就地改(page.tsx:177 `product.dealerPrice = own`), 不是 spread(codex R1 nit ①)。
    // 本測試的 unstable_cache mock 回【同一個參照】(比真 Next 更嚴:真的走序列化)⇒ 靠的是 fetchProductByHandle 的 structuredClone。
    const dealerView = general as { dealerPrice?: number };
    dealerView.dealerPrice = 38000;
    expect(dealerView.dealerPrice).toBe(38000);
    // 疊完再以一般會員身分取同 slug ⇒ 拿到的仍是沒有 dealerPrice 的那份。
    const generalAgain = await fetchProductByHandle('handle-1');
    expect(JSON.stringify(generalAgain)).not.toContain('dealerPrice');
    expect(JSON.stringify(cacheStore.get('["handle-1"]'))).not.toContain('dealerPrice');
  });

  it('🔴 ② 同 slug 第二發 DB 零查詢;③ 鍵不含 tier ⇒ 兩次是同一份快取', async () => {
    const a = await fetchProductByHandle('handle-1');
    expect(findByHandleCalls).toBe(1);
    expect(inheritedCalls).toBe(1);
    const b = await fetchProductByHandle('handle-1');
    expect(findByHandleCalls).toBe(1);
    expect(inheritedCalls).toBe(1);
    expect(b).toEqual(a);
    expect(b).not.toBe(a); // 每一發是自己的副本(structuredClone), 同一份快取
    expect([...cacheStore.keys()]).toEqual(['["handle-1"]']);
  });

  it('🟢 負對照:不同 slug 各查一次(不是全部塌成同一份)', async () => {
    await fetchProductByHandle('handle-1');
    await fetchProductByHandle('handle-2');
    expect(findByHandleCalls).toBe(2);
    expect(cacheStore.size).toBe(2);
  });
});
