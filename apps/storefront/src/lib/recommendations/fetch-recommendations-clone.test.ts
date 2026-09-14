/**
 * fetch-recommendations-clone.test.ts —— PDP 推薦快取回的是【副本】(2026-09-14 主視窗 workflow 第 ③ 條)。
 *
 * 今天沒有人就地改 `related`,所以這不是在抓一個已發生的污染;
 * 它釘的是 `fetchProductByHandle` 那支早就有的同一條規矩:
 * **下一個人若在呼叫端疊經銷價(就地改),改的必須是這一發自己的副本,不能寫回跨使用者的快取。**
 * 形狀照 `lib/pdp-product-cache.test.ts`:`unstable_cache` 換成記憶體 Map、回【同一個參照】(比真 Next 更嚴)。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@pcm/adapters', () => ({
  SupabaseProductAdapter: class {
    async findByHandle() {
      findByHandleCalls += 1;
      return { id: 'p-1', handle: 'h-1' };
    }
  },
}));
vi.mock('@/lib/catalog-anon-client', () => ({ createCatalogAnonClient: () => ({}) }));
vi.mock('@/lib/products', () => ({ CATALOG_REVALIDATE_SECONDS: 60 }));
vi.mock('./rule-based-engine', () => ({
  RuleBasedRecommendationEngine: class {
    async recommend() {
      return {
        items: [{ product: { slug: 'rec-1', name: '推薦一', price: 1000 } }],
        hasMore: false,
      };
    }
  },
}));

const { fetchRecommendedProducts } = await import('./fetch-recommendations');

beforeEach(() => {
  cacheStore.clear();
  findByHandleCalls = 0;
});

describe('PDP 推薦快取回副本', () => {
  it('🔴 呼叫端就地疊 dealerPrice ⇒ 下一發(別的使用者)拿到的仍然沒有;快取本體也沒有', async () => {
    const first = await fetchRecommendedProducts('h-1', undefined);
    (first.items[0] as { dealerPrice?: number }).dealerPrice = 800;

    const second = await fetchRecommendedProducts('h-1', undefined);
    expect(findByHandleCalls, '第二發應命中快取').toBe(1);
    expect(JSON.stringify(second)).not.toContain('dealerPrice');
    for (const [, v] of cacheStore) expect(JSON.stringify(v)).not.toContain('dealerPrice');
  });

  it('🔵 負對照:兩發內容相等、參照不同', async () => {
    const a = await fetchRecommendedProducts('h-1', undefined);
    const b = await fetchRecommendedProducts('h-1', undefined);
    expect(b).toEqual(a);
    expect(b).not.toBe(a);
    expect(b.items[0]).not.toBe(a.items[0]);
  });
});
