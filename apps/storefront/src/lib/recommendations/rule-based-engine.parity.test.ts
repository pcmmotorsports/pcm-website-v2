// rule-based-engine.parity.test.ts — 同品牌推薦瘦身(2026-09-28)的「推薦結果不變」證明。
//
// 計畫:`~/pcm-mailbox/計畫-同品牌推薦瘦身-20260928.md` §4、§6.1。
// 做法:同一份商品資料,新引擎與舊引擎(`__fixtures__/legacy-rule-based-engine.ts`,origin/dev cc4ef16d7 原封副本)
// 各跑一次,逐件比對推薦出來的商品 id、網址、分數、理由,以及 hasMore。
// 資料用固定種子隨機產生:大小品牌都有(含超過 800 筆、會撈滿候選池的),有選車與沒選車都跑。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { Product } from '@pcm/domain';
import { FakeProductRepository, makeProduct } from './__fixtures__/fake-product-repository';
import { LegacyRuleBasedRecommendationEngine } from './__fixtures__/legacy-rule-based-engine';
import { RuleBasedRecommendationEngine } from './rule-based-engine';
import { BrandPoolCache } from './brand-pool-cache';
import type { RecommendationRequest, VehicleSelection } from './types';

const HOUR = 60 * 60 * 1000;

/** 固定種子的亂數(LCG),讓每次產生的資料都一樣。 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const CATS = [
  { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] },
  { raw: '制動 · 卡鉗', segments: ['制動', '卡鉗'] },
  { raw: '外觀 · 碳纖維', segments: ['外觀', '碳纖維'] },
  { raw: '操控 · 腳踏', segments: ['操控', '腳踏'] },
];
const VEHICLES: VehicleSelection[] = [
  { motoBrand: 'Yamaha', modelCode: 'MT-09' },
  { motoBrand: 'Honda', modelCode: 'CBR' },
];
/** 品牌大小:big 超過候選池上限 800,會走「另外查同分類」那條路。 */
const BRAND_SIZES: Record<string, number> = { tiny: 3, small: 40, mid: 300, big: 950 };

function makeCatalog(seed: number): Product[] {
  const r = rng(seed);
  const out: Product[] = [];
  for (const [brandId, size] of Object.entries(BRAND_SIZES)) {
    for (let i = 0; i < size; i++) {
      const id = `${brandId}-${i}`;
      // handle 打亂(不照 i 的順序),排序與洗牌才有意義
      const handle = `${brandId}-${Math.floor(r() * 1e9).toString(36)}-${i}`;
      const category = CATS[Math.floor(r() * r() * CATS.length)]!; // 偏向前面的分類
      const fitments = r() < 0.3 ? [] : [{ ...VEHICLES[Math.floor(r() * VEHICLES.length)]! }];
      out.push(
        makeProduct({
          id,
          handle,
          brand: { id: brandId, name: brandId.toUpperCase(), slug: brandId, premium_extra_pct: 0 },
          category,
          fitments,
        }),
      );
    }
  }
  return out;
}

type Outcome = {
  hasMore: boolean;
  items: { id: string | undefined; slug: string; score: number; reason: string; card: unknown }[];
};

async function run(
  engine: { recommend: (req: RecommendationRequest) => Promise<{ items: { product: { productId?: string; slug: string }; score: number; reason: string }[]; hasMore: boolean }> },
  product: Product,
  vehicle: VehicleSelection | undefined,
  limit: number,
  extraExcludes: string[] = [],
): Promise<Outcome> {
  const res = await engine.recommend({
    placement: 'pdp-related',
    context: { product, ...(vehicle ? { vehicle } : {}), excludeHandles: [product.handle, ...extraExcludes] },
    limit,
  });
  return {
    hasMore: res.hasMore,
    // card = 整張卡片的資料(toUIProduct 的輸出),新舊要逐欄相同
    items: res.items.map((i) => ({ id: i.product.productId, slug: i.product.slug, score: i.score, reason: i.reason, card: i.product })),
  };
}

describe('新舊引擎推薦結果逐件相同(資料沒有變動時)', () => {
  it.each([1, 2, 3])('種子 %i:四種品牌大小 × 有無選車 × limit 1 / 8 / 30 / 900', async (seed) => {
    const catalog = makeCatalog(seed);
    const repo = new FakeProductRepository(catalog);
    const legacy = new LegacyRuleBasedRecommendationEngine(repo);
    // 新引擎整份資料共用一份快取:同品牌第二個商品起都走快取命中那條路
    const next = new RuleBasedRecommendationEngine(repo, new BrandPoolCache(HOUR));
    const r = rng(seed + 100);
    let compared = 0;
    for (const brandId of Object.keys(BRAND_SIZES)) {
      const inBrand = catalog.filter((p) => p.brand.id === brandId);
      for (let k = 0; k < 4; k++) {
        const product = inBrand[Math.floor(r() * inBrand.length)]!;
        for (const vehicle of [undefined, VEHICLES[0]]) {
          for (const limit of [1, 8, 30, 900]) {
            const a = await run(legacy, product, vehicle, limit);
            const b = await run(next, product, vehicle, limit);
            expect(b, `${brandId} ${product.handle} vehicle=${vehicle?.modelCode ?? '-'} limit=${limit}`).toEqual(a);
            compared++;
          }
        }
      }
    }
    expect(compared).toBe(4 * 4 * 2 * 4);
  });

  it('品牌剛好 800 件(候選池剛好撈滿)與 799 件', async () => {
    for (const size of [799, 800]) {
      const brand = { id: `edge-${size}`, name: 'E', slug: 'e', premium_extra_pct: 0 };
      const catalog = Array.from({ length: size }, (_, i) =>
        makeProduct({ id: `e${i}`, handle: `e-${String(i).padStart(4, '0')}`, brand, category: CATS[i % 3] }),
      );
      const repo = new FakeProductRepository(catalog);
      for (const limit of [8, 900]) {
        const a = await run(new LegacyRuleBasedRecommendationEngine(repo), catalog[5]!, undefined, limit);
        const b = await run(new RuleBasedRecommendationEngine(repo, new BrandPoolCache(HOUR)), catalog[5]!, undefined, limit);
        expect(b, `size=${size} limit=${limit}`).toEqual(a);
      }
    }
  });

  it('呼叫端額外排除幾個商品(excludeHandles)', async () => {
    const catalog = makeCatalog(4);
    const repo = new FakeProductRepository(catalog);
    const next = new RuleBasedRecommendationEngine(repo, new BrandPoolCache(HOUR));
    for (const brandId of ['small', 'big']) {
      const inBrand = catalog.filter((p) => p.brand.id === brandId);
      const product = inBrand[0]!;
      const extra = inBrand.slice(1, 6).map((p) => p.handle);
      const a = await run(new LegacyRuleBasedRecommendationEngine(repo), product, undefined, 8, extra);
      const b = await run(next, product, undefined, 8, extra);
      expect(b, brandId).toEqual(a);
    }
  });
});

describe('候選名單快取', () => {
  function spyRepo(catalog: Product[]) {
    const repo = new FakeProductRepository(catalog);
    const calls: string[] = [];
    const orig = repo.listBrandPoolKeys.bind(repo);
    repo.listBrandPoolKeys = async (brandId, poolLimit, categoryRaw) => {
      calls.push(`${brandId}|${categoryRaw ?? '*'}`);
      return orig(brandId, poolLimit, categoryRaw);
    };
    return { repo, calls };
  }

  it('同品牌的第二個商品不再查候選名單;大品牌同分類那份也快取', async () => {
    const catalog = makeCatalog(7);
    const { repo, calls } = spyRepo(catalog);
    const engine = new RuleBasedRecommendationEngine(repo, new BrandPoolCache(HOUR));
    const small = catalog.filter((p) => p.brand.id === 'small');
    await run(engine, small[0]!, undefined, 8);
    await run(engine, small[1]!, undefined, 8);
    expect(calls, '小品牌:只查一次整個品牌,不另外查同分類').toEqual(['small|*']);

    const big = catalog.filter((p) => p.brand.id === 'big' && p.category.raw === CATS[0]!.raw);
    calls.length = 0;
    await run(engine, big[0]!, undefined, 8);
    await run(engine, big[1]!, undefined, 8);
    expect(calls, '大品牌:整個品牌一次、同分類一次,第二個商品都命中').toEqual(['big|*', `big|${CATS[0]!.raw}`]);
  });

  it('到期後重查', async () => {
    const catalog = makeCatalog(8);
    const { repo, calls } = spyRepo(catalog);
    let now = 0;
    const engine = new RuleBasedRecommendationEngine(repo, new BrandPoolCache(HOUR, 600, () => now));
    const small = catalog.filter((p) => p.brand.id === 'small');
    await run(engine, small[0]!, undefined, 8);
    now = HOUR - 1;
    await run(engine, small[1]!, undefined, 8);
    expect(calls).toHaveLength(1);
    now = HOUR;
    await run(engine, small[2]!, undefined, 8);
    expect(calls).toHaveLength(2);
  });

  it('查詢失敗不存:下一次會重查,且那次正常', async () => {
    const catalog = makeCatalog(9);
    const repo = new FakeProductRepository(catalog);
    const orig = repo.listBrandPoolKeys.bind(repo);
    let fail = true;
    let calls = 0;
    repo.listBrandPoolKeys = async (...args) => {
      calls++;
      if (fail) throw new Error('simulated DB failure');
      return orig(...args);
    };
    const engine = new RuleBasedRecommendationEngine(repo, new BrandPoolCache(HOUR));
    const small = catalog.filter((p) => p.brand.id === 'small');
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await run(engine, small[0]!, undefined, 8)).toEqual({ hasMore: false, items: [] });
    quiet.mockRestore();
    fail = false;
    const second = await run(engine, small[0]!, undefined, 8);
    expect(calls).toBe(2);
    expect(second.items.length).toBeGreaterThan(0);
  });

  it('同時兩個請求查同一個品牌,只查一次', async () => {
    const catalog = makeCatalog(10);
    const { repo, calls } = spyRepo(catalog);
    const engine = new RuleBasedRecommendationEngine(repo, new BrandPoolCache(HOUR));
    const small = catalog.filter((p) => p.brand.id === 'small');
    await Promise.all([run(engine, small[0]!, undefined, 8), run(engine, small[1]!, undefined, 8)]);
    expect(calls).toEqual(['small|*']);
  });

  it('筆數上限:超過就丟掉最久沒用的', async () => {
    const cache = new BrandPoolCache(HOUR, 2);
    let loads = 0;
    const load = async () => {
      loads++;
      return [];
    };
    await cache.get('a', load);
    await cache.get('b', load);
    await cache.get('a', load); // a 變成最近用過
    await cache.get('c', load); // 丟掉 b
    await cache.get('a', load);
    expect(loads).toBe(3);
    await cache.get('b', load);
    expect(loads).toBe(4);
  });
});

/** 同一品牌、同一分類 20 件 + 其他分類 10 件,目前商品在最前面。 */
function tierCatalog(): { catalog: Product[]; current: Product } {
  const brand = { id: 'tb', name: 'TB', slug: 'tb', premium_extra_pct: 0 };
  const same = Array.from({ length: 20 }, (_, i) =>
    makeProduct({ id: `s${i}`, handle: `s-${String(i).padStart(2, '0')}`, brand, category: CATS[0] }),
  );
  const other = Array.from({ length: 10 }, (_, i) =>
    makeProduct({ id: `o${i}`, handle: `o-${String(i).padStart(2, '0')}`, brand, category: CATS[1] }),
  );
  const current = makeProduct({ id: 'cur', handle: 'a-cur', brand, category: CATS[0] });
  return { catalog: [current, ...same, ...other], current };
}

describe('快取期間有商品下架(補資料時查不到)', () => {
  async function afterDelist(delistIds: string[], limit = 8) {
    const { catalog, current } = tierCatalog();
    const cache = new BrandPoolCache(HOUR);
    // 先用完整資料暖快取
    await run(new RuleBasedRecommendationEngine(new FakeProductRepository(catalog), cache), current, undefined, limit);
    const reduced = catalog.filter((p) => !delistIds.includes(p.id));
    const repo = new FakeProductRepository(reduced);
    const b = await run(new RuleBasedRecommendationEngine(repo, cache), current, undefined, limit);
    const a = await run(new LegacyRuleBasedRecommendationEngine(repo), current, undefined, limit);
    return { a, b };
  }

  it('0 件、1 件、4 件下架:與舊引擎在下架後的資料上逐件相同', async () => {
    for (const k of [0, 1, 4]) {
      const { a, b } = await afterDelist(Array.from({ length: k }, (_, i) => `s${i}`));
      expect(b.items, `下架 ${k} 件`).toEqual(a.items);
    }
  });

  it('同一層下架 6 件(超過多取的 4 件):不會出現已下架或重複的商品,卡片數不超過 limit', async () => {
    const delist = Array.from({ length: 6 }, (_, i) => `s${i}`);
    const { b } = await afterDelist(delist);
    const ids = b.items.map((i) => i.id);
    expect(ids.filter((id) => delist.includes(id ?? ''))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(b.items.length).toBeLessThanOrEqual(8);
  });
});

describe('快取期間改網址、改品牌(身分用 id)', () => {
  it('目前商品改過網址:不會推薦到自己;品牌裡剛好還有 limit 件其他商品時 hasMore 是 false', async () => {
    const brand = { id: 'rb', name: 'RB', slug: 'rb', premium_extra_pct: 0 };
    const others = Array.from({ length: 8 }, (_, i) =>
      makeProduct({ id: `r${i}`, handle: `r-${i}`, brand, category: CATS[0] }),
    );
    const oldSelf = makeProduct({ id: 'self', handle: 'self-old', brand, category: CATS[0] });
    const cache = new BrandPoolCache(HOUR);
    // 用別的商品暖快取:名單裡存的是 self-old
    await run(new RuleBasedRecommendationEngine(new FakeProductRepository([oldSelf, ...others]), cache), others[0]!, undefined, 8);
    const newSelf = { ...oldSelf, handle: 'self-new' };
    const res = await run(
      new RuleBasedRecommendationEngine(new FakeProductRepository([newSelf, ...others]), cache),
      newSelf,
      undefined,
      8,
    );
    expect(res.items.map((i) => i.id)).not.toContain('self');
    expect(res.items).toHaveLength(8);
    expect(res.hasMore).toBe(false);
  });

  it('別的商品改過網址:卡片用新網址,而且只出現一次', async () => {
    const { catalog, current } = tierCatalog();
    const cache = new BrandPoolCache(HOUR);
    await run(new RuleBasedRecommendationEngine(new FakeProductRepository(catalog), cache), current, undefined, 8);
    const renamed = catalog.map((p) => (p.id === 's0' ? { ...p, handle: 's-00-new' } : p));
    const res = await run(new RuleBasedRecommendationEngine(new FakeProductRepository(renamed), cache), current, undefined, 30);
    const slugs = res.items.map((i) => i.slug);
    expect(slugs).toContain('s-00-new');
    expect(slugs).not.toContain('s-00');
    expect(res.items.filter((i) => i.id === 's0')).toHaveLength(1);
  });

  it('別的商品改了品牌:不會以同品牌的理由出現', async () => {
    const { catalog, current } = tierCatalog();
    const cache = new BrandPoolCache(HOUR);
    await run(new RuleBasedRecommendationEngine(new FakeProductRepository(catalog), cache), current, undefined, 8);
    const moved = catalog.map((p) =>
      p.id === 's0' ? { ...p, brand: { id: 'other', name: 'OTHER', slug: 'other', premium_extra_pct: 0 } } : p,
    );
    const res = await run(new RuleBasedRecommendationEngine(new FakeProductRepository(moved), cache), current, undefined, 8);
    expect(res.items.filter((i) => i.id === 's0' && i.reason === 'same-brand')).toEqual([]);
  });
});
