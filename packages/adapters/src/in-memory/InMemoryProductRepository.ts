import type { IProductRepository } from '@pcm/ports';
import type {
  Product,
  ProductId,
  CategoryPath,
  FitmentSpec,
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
    this.products.set(product.id, product);
    return product;
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

  async searchByKeyword(query: string): Promise<Product[]> {
    const q = query.toLowerCase();
    return Array.from(this.products.values()).filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
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
