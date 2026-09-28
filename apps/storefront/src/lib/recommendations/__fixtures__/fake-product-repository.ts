// 推薦引擎測試共用的 repo 替身與商品工廠(從 rule-based-engine.test.ts 搬出來,給 parity 測試共用)。
// 註解照原樣搬過來;內容沒有改。
import type { Product, FitmentSpec, ProductId, CategoryPath, CategorySummary, PaginationParams, Paginated } from '@pcm/domain';
import { toMoneyAmount, resolveEnd } from '@pcm/domain';
import type { BrandPoolKey, IProductRepository } from '@pcm/ports';

/**
 * 本地 repo 測試替身(見檔頭 🔴)。只有引擎會呼叫的 4 個查詢方法做真過濾、其餘 throw
 * (引擎誤呼未預期方法 → 大聲失敗、不靜默)。過濾語意鏡射 InMemoryProductRepository。
 *
 * 🔴 **2026-08-17 codex 對抗審查抓到**:本替身原本的四個方法**簽名裡根本沒有 `poolLimit`**
 * (TS 結構型別容許實作參數比介面少)⇒ 它**永遠回全部**,而真 adapter 只回 `poolLimit` 筆
 * ⇒ 以本替身寫的引擎測試對「池上限」這件事**零判別力**,而且看起來全綠。
 * ⇒ 現在四支都吃 `poolLimit`,並鏡射真 adapter 的 `.order('handle').limit(n)`。
 */
export class FakeProductRepository implements IProductRepository {
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
  /** 鏡射真 adapter:與 listByBrand 同一組篩選與筆數,只回三個欄位。 */
  async listBrandPoolKeys(
    brandId: string,
    poolLimit: number,
    categoryRaw?: string,
  ): Promise<BrandPoolKey[]> {
    return (await this.listByBrand(brandId, poolLimit, categoryRaw)).map((p) => ({
      id: p.id,
      handle: p.handle,
      categoryRaw: p.category.raw,
    }));
  }
  /** 鏡射真 adapter:照傳入順序,查不到的不回。 */
  async listByIds(ids: readonly string[]): Promise<Product[]> {
    const byId = new Map(this.seed.map((p) => [p.id, p]));
    return ids.map((id) => byId.get(id)).filter((p): p is Product => p !== undefined);
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
  async listAllHandles(): Promise<string[]> { throw new Error('unused'); }
  async listCategories(): Promise<CategorySummary[]> { throw new Error('unused'); }
  async searchByKeyword(_q: string, _p: PaginationParams): Promise<Paginated<Product>> { throw new Error('unused'); }
  async save(_p: Product): Promise<Product> { throw new Error('unused'); }
}

/** 建 fake Product(對齊 InMemoryProductRepository.test.ts createFakeProduct 風格)。 */
export function makeProduct(overrides: Partial<Product> = {}): Product {
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
