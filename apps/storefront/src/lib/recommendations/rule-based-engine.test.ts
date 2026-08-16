// rule-based-engine.test.ts — 推薦引擎 R2b 單體測(對齊 plan §6:各分層 / fallback / 去重 /
//   排自身 / 決定性 / 經銷價 strip / hasMore 正確 / 空 vehicle / 空結果不 throw / not-implemented)。
//
// 🔴 repo 測試替身 = 本檔本地 FakeProductRepository(非 @pcm/adapters InMemory):
//   InMemoryProductRepository 未從 @pcm/adapters root barrel 匯出、且 package `exports` map
//   僅開 '.'/'./server' 擋 deep import → storefront 測試無法 import 之。本地 fake 鏡射 InMemory
//   對本引擎相關方法(listByFitment/listByBrand/listByCategory/listGeneral)的語意,且更貼合
//   「引擎 orchestration 單元測試」意圖:年份重疊/RLS 為 repository(R2a/R1b)合約、非引擎職責,
//   引擎只需 repo 回「符合車輛/品牌的候選」。plan「走 InMemory」的 means=repo 測試替身、此 fake 等效。
//
// mock 'server-only':rule-based-engine.ts 檔頭 import 'server-only'、且 import toUIProduct
//   (lib/products.ts 亦 server-only);node 測試環境無此需求、mock 避免 import throw
//   (同 products.test.ts 手法)。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { Product, FitmentSpec, ProductId, CategoryPath, CategorySummary, PaginationParams, Paginated } from '@pcm/domain';
import { toMoneyAmount, resolveEnd } from '@pcm/domain';
import type { IProductRepository } from '@pcm/ports';
import { RuleBasedRecommendationEngine } from './rule-based-engine';
import type { RecommendationContext } from './types';

/**
 * 本地 repo 測試替身(見檔頭 🔴)。只有引擎會呼叫的 4 個查詢方法做真過濾、其餘 throw
 * (引擎誤呼未預期方法 → 大聲失敗、不靜默)。過濾語意鏡射 InMemoryProductRepository。
 *
 * 🔴 **2026-08-17 codex 對抗審查抓到**:本替身原本的四個方法**簽名裡根本沒有 `poolLimit`**
 * (TS 結構型別容許實作參數比介面少)⇒ 它**永遠回全部**,而真 adapter 只回 `poolLimit` 筆
 * ⇒ 以本替身寫的引擎測試對「池上限」這件事**零判別力**,而且看起來全綠。
 * ⇒ 現在四支都吃 `poolLimit`,並鏡射真 adapter 的 `.order('handle').limit(n)`。
 */
class FakeProductRepository implements IProductRepository {
  constructor(private readonly seed: Product[] = []) {}

  /** 鏡射真 adapter:handle 升冪後取前 poolLimit 筆。 */
  private takePool(items: Product[], poolLimit: number): Product[] {
    return items
      .slice()
      .sort((a, b) => a.handle.localeCompare(b.handle, 'en'))
      .slice(0, poolLimit);
  }

  async listByCategory(
    category: CategoryPath,
    poolLimit: number,
  ): Promise<Product[]> {
    return this.takePool(
      this.seed.filter((p) => p.category.raw === category.raw),
      poolLimit,
    );
  }
  async listByBrand(
    brandId: string,
    poolLimit: number,
    categoryRaw?: string,
  ): Promise<Product[]> {
    // 🔴 替身也要吃 `categoryRaw`：不吃的話「分類 filter 有沒有真的下推」在測試裡零判別力。
    return this.takePool(
      this.seed.filter(
        (p) =>
          p.brand.id === brandId &&
          (categoryRaw === undefined || p.category.raw === categoryRaw),
      ),
      poolLimit,
    );
  }
  async listGeneral(poolLimit: number): Promise<Product[]> {
    return this.takePool(
      this.seed.filter((p) => p.fitments.length === 0),
      poolLimit,
    );
  }
  async listByFitment(
    spec: FitmentSpec,
    poolLimit: number,
  ): Promise<Product[]> {
    // 鏡射 InMemory matchFitment:motoBrand + modelCode 必相同、年份範圍重疊(任一邊無年份=通吃)。
    return this.takePool(
      this.seed.filter((p) =>
        p.fitments.some((f) => {
          if (f.motoBrand !== spec.motoBrand || f.modelCode !== spec.modelCode) return false;
          if (f.yearStart === undefined || spec.yearStart === undefined) return true;
          return f.yearStart <= resolveEnd(spec.yearStart, spec.yearEnd) &&
            spec.yearStart <= resolveEnd(f.yearStart, f.yearEnd);
        }),
      ),
      poolLimit,
    );
  }
  // 引擎不呼叫、契約完整性用:
  async findById(_id: ProductId): Promise<Product | null> { throw new Error('unused'); }
  async findByHandle(_h: string): Promise<Product | null> { throw new Error('unused'); }
  async listAllByCategory(c: CategoryPath): Promise<Product[]> {
    // 全量版:不轉呼叫取樣版(`listByCategory` 自 2026-08-17 起必填 poolLimit)。
    return this.seed.filter((p) => p.category.raw === c.raw);
  }
  async listAllProducts(_o?: { limit?: number }): Promise<Product[]> { throw new Error('unused'); }
  async listCategories(): Promise<CategorySummary[]> { throw new Error('unused'); }
  async searchByKeyword(_q: string, _p: PaginationParams): Promise<Paginated<Product>> { throw new Error('unused'); }
  async save(_p: Product): Promise<Product> { throw new Error('unused'); }
}

/** 建 fake Product(對齊 InMemoryProductRepository.test.ts createFakeProduct 風格)。 */
function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p-000',
    productCode: 'CODE-000',
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
    handle: 'handle-000',
    subtitle: '',
    variants: [],
    variantCount: 0, // 2026-08-08 必填:本 factory 不測變體 ⇒ 填 0(給不出真值就明填、不用 optional 逃避)
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const CAT_A = { raw: '引擎部品 · 排氣管', segments: ['引擎部品', '排氣管'] };
const CAT_B = { raw: '制動 · 卡鉗', segments: ['制動', '卡鉗'] };
const CAT_C = { raw: '外觀 · 碳纖維', segments: ['外觀', '碳纖維'] };

const engineFor = (seed: Product[]) =>
  new RuleBasedRecommendationEngine(new FakeProductRepository(seed));

describe('RuleBasedRecommendationEngine — placement / 前置守衛', () => {
  it('非 pdp-related 落點回空、不 throw(not-implemented)', async () => {
    const engine = engineFor([]);
    const res = await engine.recommend({
      placement: 'cart-addon',
      context: { product: makeProduct() },
      limit: 8,
    });
    expect(res).toEqual({ items: [], hasMore: false });
  });

  it('context 無 product → 回空、不 throw', async () => {
    const engine = engineFor([makeProduct()]);
    const res = await engine.recommend({ placement: 'pdp-related', context: {}, limit: 8 });
    expect(res).toEqual({ items: [], hasMore: false });
  });

  it('limit <= 0 → 回空', async () => {
    const engine = engineFor([makeProduct()]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: makeProduct() },
      limit: 0,
    });
    expect(res).toEqual({ items: [], hasMore: false });
  });
});

describe('RuleBasedRecommendationEngine — Case B(沒選車、同品牌)', () => {
  const current = makeProduct({ id: 'cur', handle: 'cur', brand: brand('b1'), category: CAT_A });
  const b1SameCat = makeProduct({ id: 'b1a', handle: 'b1a', brand: brand('b1'), category: CAT_A });
  const b1OtherCat = makeProduct({ id: 'b1b', handle: 'b1b', brand: brand('b1'), category: CAT_B });
  const b2SameCat = makeProduct({ id: 'b2a', handle: 'b2a', brand: brand('b2'), category: CAT_A });
  const generalP = makeProduct({ id: 'gen', handle: 'gen', brand: brand('b3'), category: CAT_C, fitments: [] });

  it('分層順序:同品牌×同分類 → 同品牌其他 → 同分類補位 → 通用款;排自身', async () => {
    const engine = engineFor([current, b1SameCat, b1OtherCat, b2SameCat, generalP]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 8,
    });
    const handles = res.items.map((i) => i.product.slug);
    expect(handles).toEqual(['b1a', 'b1b', 'b2a', 'gen']);
    expect(handles).not.toContain('cur'); // 排自身
    const byHandle = Object.fromEntries(res.items.map((i) => [i.product.slug, i.reason]));
    expect(byHandle.b1a).toBe('same-brand'); // 同品牌×同分類
    expect(byHandle.b1b).toBe('same-brand'); // 同品牌其他分類
    expect(byHandle.b2a).toBe('fallback-category'); // 不同品牌同分類補位
    expect(byHandle.gen).toBe('general'); // 通用款
    expect(res.hasMore).toBe(false);
  });

  it('去重:同商品既屬同品牌 tier 又屬同分類 fallback → 只出現一次、取較高 tier reason', async () => {
    // b1SameCat 同時命中 listByBrand(b1)（tier1）與 listByCategory(CAT_A)（fallback）
    const engine = engineFor([current, b1SameCat]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 8,
    });
    const b1aItems = res.items.filter((i) => i.product.slug === 'b1a');
    expect(b1aItems).toHaveLength(1);
    expect(b1aItems[0]?.reason).toBe('same-brand'); // 高 tier 勝
  });

  it('excludeHandles 額外排除', async () => {
    const engine = engineFor([current, b1SameCat, b1OtherCat]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current, excludeHandles: ['b1a'] },
      limit: 8,
    });
    expect(res.items.map((i) => i.product.slug)).not.toContain('b1a');
  });
});

describe('RuleBasedRecommendationEngine — Case A(有選車、反查車輛相容池)', () => {
  const yamaha = { motoBrand: 'Yamaha', modelCode: 'MT-09' };
  // 當前商品自身 fitment = Honda(刻意與傳入 vehicle 不同,證明引擎用「選定車」非商品自身 fitment)
  const current = makeProduct({
    id: 'cur',
    handle: 'cur',
    category: CAT_A,
    fitments: [{ motoBrand: 'Honda', modelCode: 'CBR600RR', yearStart: 2020, yearEnd: 2020 }],
  });
  const vSameCat = makeProduct({
    id: 'va',
    handle: 'va',
    category: CAT_A,
    fitments: [{ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2018, yearEnd: 2024 }],
  });
  const vOtherCat = makeProduct({
    id: 'vb',
    handle: 'vb',
    category: CAT_B,
    fitments: [{ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2018, yearEnd: 2024 }],
  });
  // 只 fit 當前商品自身車輛(Honda)、且不同分類 → 若引擎誤用自身 fitment 才會出現
  const ownVehicleOnly = makeProduct({
    id: 'own',
    handle: 'own',
    category: CAT_C,
    fitments: [{ motoBrand: 'Honda', modelCode: 'CBR600RR', yearStart: 2020, yearEnd: 2020 }],
  });

  it('反查「選定車輛」相容池、非商品自身 fitment;同車×同分類 → 同車其他', async () => {
    const engine = engineFor([current, vSameCat, vOtherCat, ownVehicleOnly]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current, vehicle: yamaha },
      limit: 8,
    });
    const handles = res.items.map((i) => i.product.slug);
    expect(handles).toContain('va');
    expect(handles).toContain('vb');
    expect(handles).not.toContain('own'); // 🔴 用選定車(Yamaha)非商品自身(Honda)
    const byHandle = Object.fromEntries(res.items.map((i) => [i.product.slug, i.reason]));
    expect(byHandle.va).toBe('same-vehicle-same-category');
    expect(byHandle.vb).toBe('same-vehicle-other-brand');
  });

  it('年份四態:選定年份不重疊者不入池', async () => {
    // vOldYear 置於 CAT_C(fallback-category CAT_A 不撈、general 不撈〔有 fitments〕)→ 唯一入池路徑
    // 是車輛反查;年份不重疊被 listByFitment 閘掉 → 缺席,即證年份四態生效(非被其他 tier 遮蔽)。
    const vOldYear = makeProduct({
      id: 'vold',
      handle: 'vold',
      category: CAT_C,
      fitments: [{ motoBrand: 'Yamaha', modelCode: 'MT-09', yearStart: 2010, yearEnd: 2015 }],
    });
    const engine = engineFor([current, vSameCat, vOldYear]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current, vehicle: { ...yamaha, year: 2020 } },
      limit: 8,
    });
    const handles = res.items.map((i) => i.product.slug);
    expect(handles).toContain('va'); // 2018-2024 涵蓋 2020
    expect(handles).not.toContain('vold'); // 2010-2015 不涵蓋 2020、年份閘擋於車輛池外
  });

  it('車輛池不足 → 同分類補位 → 通用款', async () => {
    const catFiller = makeProduct({ id: 'cf', handle: 'cf', category: CAT_A });
    const generalP = makeProduct({ id: 'gen', handle: 'gen', category: CAT_C, fitments: [] });
    const engine = engineFor([current, vSameCat, catFiller, generalP]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current, vehicle: yamaha },
      limit: 8,
    });
    const byHandle = Object.fromEntries(res.items.map((i) => [i.product.slug, i.reason]));
    expect(byHandle.va).toBe('same-vehicle-same-category');
    expect(byHandle.cf).toBe('fallback-category'); // 同分類(不限車)補位
    expect(byHandle.gen).toBe('general');
  });
});

describe('RuleBasedRecommendationEngine — 決定性 / hasMore / 經銷價 strip', () => {
  it('決定性:同 context 兩次呼叫 items 完全一致(禁 Math.random)', async () => {
    const current = makeProduct({ id: 'cur', handle: 'cur', category: CAT_A });
    const pool = Array.from({ length: 6 }, (_, i) =>
      makeProduct({ id: `p${i}`, handle: `p${i}`, category: CAT_A }),
    );
    const engine = engineFor([current, ...pool]);
    const ctx: RecommendationContext = { product: current };
    const r1 = await engine.recommend({ placement: 'pdp-related', context: ctx, limit: 4 });
    const r2 = await engine.recommend({ placement: 'pdp-related', context: ctx, limit: 4 });
    expect(r1.items.map((i) => i.product.slug)).toEqual(r2.items.map((i) => i.product.slug));
  });

  it('hasMore:去重排自身後候選 > limit → true、items 恰 limit 筆', async () => {
    const current = makeProduct({ id: 'cur', handle: 'cur', brand: brand('b1'), category: CAT_A });
    const pool = Array.from({ length: 10 }, (_, i) =>
      makeProduct({ id: `p${i}`, handle: `p${i}`, brand: brand('b1'), category: CAT_A }),
    );
    const engine = engineFor([current, ...pool]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 8,
    });
    expect(res.items).toHaveLength(8);
    expect(res.hasMore).toBe(true);
  });

  it('hasMore 邊界:候選恰 limit+1 → true、items 恰 limit(固化 codex #5 契約)', async () => {
    const current = makeProduct({ id: 'cur', handle: 'cur', brand: brand('b1'), category: CAT_A });
    const limit = 3;
    // 候選恰 limit+1 = 4 筆(同品牌同分類、皆入 tier1)
    const pool = Array.from({ length: limit + 1 }, (_, i) =>
      makeProduct({ id: `p${i}`, handle: `p${i}`, brand: brand('b1'), category: CAT_A }),
    );
    const engine = engineFor([current, ...pool]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit,
    });
    expect(res.items).toHaveLength(limit);
    expect(res.hasMore).toBe(true);
  });

  it('repo 查詢 throw → 降級回空、不 throw(不讓推薦區 crash 整頁)', async () => {
    const current = makeProduct({ id: 'cur', handle: 'cur', brand: brand('b1'), category: CAT_A });
    const throwingRepo = new FakeProductRepository([current]);
    // listByBrand throw(模擬 DB 斷線/RLS 錯);Case B 第一個 repo 呼叫即炸
    throwingRepo.listByBrand = async () => {
      throw new Error('simulated DB failure');
    };
    const engine = new RuleBasedRecommendationEngine(throwingRepo);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 8,
    });
    expect(res).toEqual({ items: [], hasMore: false });
  });

  it('hasMore=false 當候選數 <= limit', async () => {
    const current = makeProduct({ id: 'cur', handle: 'cur', brand: brand('b1'), category: CAT_A });
    const p1 = makeProduct({ id: 'p1', handle: 'p1', brand: brand('b1'), category: CAT_A });
    const engine = engineFor([current, p1]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 8,
    });
    expect(res.hasMore).toBe(false);
  });

  // 🔴 codex R3 F1:hasMore = 主池(CTA 目標 filter)> limit,非全候選流。車輛池 ≤ limit 但 fallback
  //   灌滿 carousel 時 hasMore 仍 false(否則「查看全部相容」CTA 連到 /products?vehicle= 只有 ≤limit 品=誤導)。
  it('hasMore 主池語意:Case A 車輛池 ≤ limit 但 fallback 灌滿 carousel → hasMore=false', async () => {
    const current = makeProduct({
      id: 'cur',
      handle: 'cur',
      category: CAT_A,
      fitments: [{ motoBrand: 'Honda', modelCode: 'CBR', yearStart: 2020, yearEnd: 2020 }],
    });
    const va1 = makeProduct({ id: 'va1', handle: 'va1', category: CAT_A, fitments: [{ motoBrand: 'Yamaha', modelCode: 'MT-09' }] });
    const va2 = makeProduct({ id: 'va2', handle: 'va2', category: CAT_B, fitments: [{ motoBrand: 'Yamaha', modelCode: 'MT-09' }] });
    const fills = Array.from({ length: 5 }, (_, i) => makeProduct({ id: `f${i}`, handle: `f${i}`, category: CAT_A }));
    const engine = engineFor([current, va1, va2, ...fills]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current, vehicle: { motoBrand: 'Yamaha', modelCode: 'MT-09' } },
      limit: 3,
    });
    expect(res.items).toHaveLength(3); // carousel 被 fallback 灌滿
    expect(res.hasMore).toBe(false); // 但車輛池只有 2(≤3)→ CTA 不誤導
  });

  it('hasMore 主池語意:Case A 車輛池 > limit → hasMore=true', async () => {
    const current = makeProduct({ id: 'cur', handle: 'cur', category: CAT_A, fitments: [{ motoBrand: 'Honda', modelCode: 'CBR' }] });
    const pool = Array.from({ length: 5 }, (_, i) =>
      makeProduct({ id: `va${i}`, handle: `va${i}`, category: CAT_A, fitments: [{ motoBrand: 'Yamaha', modelCode: 'MT-09' }] }),
    );
    const engine = engineFor([current, ...pool]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current, vehicle: { motoBrand: 'Yamaha', modelCode: 'MT-09' } },
      limit: 3,
    });
    expect(res.items).toHaveLength(3);
    expect(res.hasMore).toBe(true); // 車輛池 5 > 3
  });

  it('經銷價 strip:輸出 UIProduct 不含 priceByTier / 經銷金額', async () => {
    const current = makeProduct({ id: 'cur', handle: 'cur', brand: brand('b1'), category: CAT_A });
    const p1 = makeProduct({ id: 'p1', handle: 'p1', brand: brand('b1'), category: CAT_A });
    const engine = engineFor([current, p1]);
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 8,
    });
    const item = res.items[0];
    expect(item).toBeDefined();
    expect(item?.product.price).toBe(45000); // general 價
    expect(Object.keys(item?.product ?? {})).not.toContain('priceByTier');
    const serialized = JSON.stringify(item?.product);
    expect(serialized).not.toContain('38000'); // store
    expect(serialized).not.toContain('36000'); // premiumStore
  });

  it('空結果:無任何候選 → { items: [], hasMore: false }、不 throw', async () => {
    const current = makeProduct({ id: 'cur', handle: 'cur', brand: brand('lonely'), category: CAT_A });
    const engine = engineFor([current]); // 池內只有自身
    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 8,
    });
    expect(res).toEqual({ items: [], hasMore: false });
  });
});

/** brand helper:同 id/slug/name 一致(listByBrand 以 brand.id 反查)。 */
function brand(id: string) {
  return { id, name: id.toUpperCase(), slug: id, premium_extra_pct: 0 };
}

describe('hasMore 與池上限的互動(2026-08-17 codex 對抗審查抓到的洞)', () => {
  // 🔴 病的形狀:`primaryPoolCount` 最多只會是 `RECOMMENDATION_POOL_SIZE`(800),
  //    呼叫端若傳 `limit = 900`,`800 > 900` 為 false ⇒ 錯回 `hasMore = false`,
  //    而「查看全部」CTA 點進去其實有幾千件。
  //    ⇒ 修法是「池被填滿 ⇒ 母體至少有那麼多 ⇒ 一定還有更多」。
  const brandId = 'brand-saturate';

  it('池被填滿 + limit 大於池上限 → hasMore 仍為 true(不可以說「沒有更多」)', async () => {
    // 801 筆同品牌 ⇒ 池(800)一定被填滿
    const seed = Array.from({ length: 801 }, (_, i) =>
      makeProduct({
        id: `p-${String(i).padStart(4, '0')}`,
        handle: `h-${String(i).padStart(4, '0')}`,
        brand: { id: brandId, name: 'B', slug: 'b', premium_extra_pct: 0 },
      }),
    );
    const engine = new RuleBasedRecommendationEngine(
      new FakeProductRepository(seed),
    );

    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: seed[0]! },
      limit: 900,
    });

    expect(res.hasMore).toBe(true);
  });

  it('負向對照:池【沒有】被填滿時,hasMore 照母體判斷(10 筆 < limit 900 ⇒ false)', async () => {
    const seed = Array.from({ length: 10 }, (_, i) =>
      makeProduct({
        id: `q-${i}`,
        handle: `q-${i}`,
        brand: { id: brandId, name: 'B', slug: 'b', premium_extra_pct: 0 },
      }),
    );
    const engine = new RuleBasedRecommendationEngine(
      new FakeProductRepository(seed),
    );

    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: seed[0]! },
      limit: 900,
    });

    // 🔴 這一格是上一格的判別力來源:若把修法寫成「無條件 true」,這格會紅。
    expect(res.hasMore).toBe(false);
  });
});

describe('同分類那一層改成【下推查詢】(2026-08-17 codex 對抗審查)', () => {
  // 🔴 病的形狀:品牌池取前 N 筆，若那 N 筆剛好都是【別的分類】，
  //    `score 100`（同品牌×同分類）整層會消失，推薦掉到 `score 80`，而畫面看不出異常。
  //    修法是把分類 filter 下推到查詢 ⇒ 那一層不再受「池裡剛好有沒有」影響。
  const BRAND = { id: 'brand-x', name: 'X', slug: 'x', premium_extra_pct: 0 };
  const TARGET_CAT = '碳纖維部品';
  const OTHER_CAT = '排氣系統';

  /** 造一個「同分類商品全部排在 handle 序很後面」的池 —— 正是那個構造。 */
  function seedWithSameCatAtTail(poolSize: number) {
    const others = Array.from({ length: poolSize }, (_, i) =>
      makeProduct({
        id: `o-${String(i).padStart(4, '0')}`,
        handle: `a-${String(i).padStart(4, '0')}`, // handle 排前面
        brand: BRAND,
        category: { raw: OTHER_CAT, segments: [OTHER_CAT] },
      }),
    );
    const sameCat = makeProduct({
      id: 'same-1',
      handle: 'z-9999', // handle 排最後 ⇒ 一定被池的前 N 筆擠掉
      brand: BRAND,
      category: { raw: TARGET_CAT, segments: [TARGET_CAT] },
    });
    return { seed: [...others, sameCat], sameCat };
  }

  it('🔴 同分類商品在 handle 序尾端時，仍然進得了推薦(下推查詢，不受池的前 N 筆影響)', async () => {
    // 池上限 800 ⇒ 造 800 筆別的分類把池塞滿
    const { seed, sameCat } = seedWithSameCatAtTail(800);
    const current = makeProduct({
      id: 'cur',
      handle: 'cur',
      brand: BRAND,
      category: { raw: TARGET_CAT, segments: [TARGET_CAT] },
    });
    const engine = new RuleBasedRecommendationEngine(
      new FakeProductRepository([...seed, current]),
    );

    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 4,
    });

    // 舊寫法:sameCat 從「handle 前 800 筆」篩 ⇒ 那 800 筆全是 OTHER_CAT ⇒ 同分類層為空
    const handles = res.items.map((i) => i.product.slug);
    expect(handles, '同分類商品被池的前 N 筆擠掉了 ⇒ score 100 那層消失').toContain(
      sameCat.handle,
    );
  });

  it('負向對照:同分類商品在 handle 序前端時也在(證明上一格不是恆真)', async () => {
    const sameCatFirst = makeProduct({
      id: 'same-2',
      handle: 'a-0000',
      brand: BRAND,
      category: { raw: TARGET_CAT, segments: [TARGET_CAT] },
    });
    const current = makeProduct({
      id: 'cur2',
      handle: 'cur2',
      brand: BRAND,
      category: { raw: TARGET_CAT, segments: [TARGET_CAT] },
    });
    const engine = new RuleBasedRecommendationEngine(
      new FakeProductRepository([sameCatFirst, current]),
    );

    const res = await engine.recommend({
      placement: 'pdp-related',
      context: { product: current },
      limit: 4,
    });

    expect(res.items.map((i) => i.product.slug)).toContain(sameCatFirst.handle);
  });
});
