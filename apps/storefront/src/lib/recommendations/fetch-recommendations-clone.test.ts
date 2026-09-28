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
let cacheReadFails = false;
vi.mock('next/cache', () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    async (...args: unknown[]) => {
      if (cacheReadFails) throw new Error('cache read failed');
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
    async listByFitment() {
      return [{ handle: 'h-1' }, { handle: 'h-2' }, { handle: 'h-2' }, { handle: 'h-3' }];
    }
  },
}));
vi.mock('@/lib/catalog-anon-client', () => ({ createCatalogAnonClient: () => ({}) }));
vi.mock('@/lib/products', () => ({ CATALOG_REVALIDATE_SECONDS: 60 }));
vi.mock('./rule-based-engine', () => ({
  RuleBasedRecommendationEngine: class {
    constructor(private readonly repo: { listByFitment: (s: unknown, n: number) => Promise<unknown> }) {}
    async recommend(req: { context: { vehicle?: unknown } }) {
      if (req.context.vehicle) await this.repo.listByFitment({}, 800);
      return {
        items: [{ product: { slug: 'rec-1', name: '推薦一', price: 1000 } }],
        hasMore: false,
      };
    }
  },
}));

const { fetchRecommendedProducts, testOnlyRecoDelay } = await import('./fetch-recommendations');

beforeEach(() => {
  cacheStore.clear();
  cacheReadFails = false;
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

describe('[reco] computed 紀錄(計畫 §7-5)', () => {
  it('primaryPool 跟引擎一樣去重、排除這件商品自己(Codex R1 建議 4)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    await fetchRecommendedProducts('h-1', { motoBrand: 'BMW', modelCode: 'S 1000 RR', year: 2021 });
    const line = info.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[reco] computed'));
    info.mockRestore();
    expect(line).toMatch(/^\[reco\] computed handle=h-1 vehicle=BMW:S 1000 RR:2021 poolMs=\d+ primaryPool=2 items=1$/);
  });
});

describe('推薦快取本身讀取失敗(Codex R1 必修 1)', () => {
  it('🔴 回空推薦,不丟出去(推薦在 Suspense 裡, 丟出去會蓋掉已送出的整頁)', async () => {
    cacheReadFails = true;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(fetchRecommendedProducts('h-1', undefined)).resolves.toEqual({ items: [], hasMore: false });
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('量串流用的人工延遲只在本機生效(計畫 §6-3)', () => {
  const settled = async (env: Parameters<typeof testOnlyRecoDelay>[0]): Promise<boolean> => {
    vi.useFakeTimers();
    try {
      let done = false;
      void testOnlyRecoDelay(env).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(4999);
      return done;
    } finally {
      vi.useRealTimers();
    }
  };

  it('🔴 Vercel 上(VERCEL=1)設了延遲也不等', async () => {
    expect(await settled({ VERCEL: '1', PCM_TEST_RECO_DELAY_MS: '5000' })).toBe(true);
  });

  it('本機(沒有 VERCEL)設了延遲就等滿', async () => {
    expect(await settled({ PCM_TEST_RECO_DELAY_MS: '5000' })).toBe(false);
  });

  it('沒設延遲就不等', async () => {
    expect(await settled({})).toBe(true);
  });
});
