import type { IProductRepository } from '@pcm/ports';
import type {
  Product,
  ProductId,
  CategoryPath,
  FitmentSpec,
  PaginationParams,
  Paginated,
} from '@pcm/domain';

/**
 * 真實作 in-memory ProductRepository。
 *
 * 用途:
 * - use-case test:不接 Medusa 也能跑 placeOrder / etc 的單元測試
 * - dev 期 spike:M-1-02 商品瀏覽流程不接 Medusa 也能 round-trip
 *
 * 對齊 ADR-0002 §4.1(in-memory 是真實作、非 mock)+ docs/architecture/testing-strategy.md §3.3
 *
 * @see packages/ports/src/IProductRepository.ts(合約字面)
 * @see docs/architecture/testing-strategy.md §3.3
 */
export class InMemoryProductRepository implements IProductRepository {
  private products: Map<ProductId, Product> = new Map();

  constructor(seed: Product[] = []) {
    for (const p of seed) {
      this.products.set(p.id, p);
    }
  }

  async findById(id: ProductId): Promise<Product | null> {
    return this.products.get(id) ?? null;
  }

  async save(product: Product): Promise<Product> {
    // M-1-02-audit C1 defensive copy:caller 後續 mutate 不影響 stored entity、
    // structuredClone 涵蓋 nested objects(brand / category / fitments[] / priceByTier / images[])
    // 對齊 ADR-0002 §4.1 in-memory 真實作精神(M-1-03 真實 adapter 走 wire round-trip 自然 immutable、
    // 此 helper 模擬 production isolation 行為)
    const cloned = structuredClone(product);
    this.products.set(cloned.id, cloned);
    return cloned;
  }

  async listByCategory(category: CategoryPath): Promise<Product[]> {
    return Array.from(this.products.values()).filter(
      (p) => p.category.raw === category.raw
    );
  }

  async listByBrand(brandId: string): Promise<Product[]> {
    return Array.from(this.products.values()).filter(
      (p) => p.brand.id === brandId
    );
  }

  async listByFitment(spec: FitmentSpec): Promise<Product[]> {
    // 字面對齊:單 spec 配對任一 product.fitments[i]
    // 多選 OR(specs[])M-1-03 / M-1-12 補(對齊 backlog #38)
    return Array.from(this.products.values()).filter((p) =>
      p.fitments.some((f) => this.matchFitment(f, spec))
    );
  }

  async searchByKeyword(
    query: string,
    params: PaginationParams
  ): Promise<Paginated<Product>> {
    // M-1-02-audit M2 empty query reject:trim 後空字串 → 返回空 Paginated 包
    // (對齊 RESTful 慣例「空查詢 = 無結果」、storefront 顯示「請輸入關鍵字」由 UI 層處理、
    //  不在 repository 層 throw error)
    const q = query.trim().toLowerCase();
    if (q === '') return { items: [], total: 0 };
    // 既有 toLowerCase().includes() filter(name + description)維持不動;
    // contract JSDoc 涵蓋 subtitle / fitments 為 main-b 真 adapter 拓寬範圍(對齊 backlog #86)。
    const matched = Array.from(this.products.values()).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
    const offset = params.offset ?? 0;
    const items = matched.slice(offset, offset + params.limit);
    return { items, total: matched.length };
  }

  /**
   * 單 spec 配對 helper。
   *
   * 本 slice 簡化版:只判 motoBrand + modelCode 必對。
   * 年份範圍(yearStart / yearEnd)實作 M-1-03 真實 MedusaProductAdapter 落地時補,
   * test 不深測年份範圍 case(對齊 backlog #38 / FitmentSpec yearEnd null 開放式語意)。
   */
  private matchFitment(actual: FitmentSpec, spec: FitmentSpec): boolean {
    if (actual.motoBrand !== spec.motoBrand) return false;
    if (actual.modelCode !== spec.modelCode) return false;
    return true;
  }
}
