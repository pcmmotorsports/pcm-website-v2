import type { IProductRepository } from '@pcm/ports';
import {
  resolveEnd,
  type Product,
  type ProductId,
  type CategoryPath,
  type FitmentSpec,
  type PaginationParams,
  type Paginated,
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
   * 單 spec 配對 helper(M-1-03-prep 件 #4 補完整年份邏輯、M-1-03 main-b sub-slice 3
   * 重構引 resolveEnd helper、對齊 backlog #83 + #92 + #94 +
   * docs/architecture/supabase-schema-design.md §2.4)
   *
   * 規則:
   * 1. motoBrand 必相同
   * 2. modelCode 必相同
   * 3. 年份範圍重疊判定:
   *    - 任一邊無年份(yearStart undefined)→ match(無年份限制 = 不限年份)
   *    - 否則 actual / spec 兩端對稱處理 yearEnd null/undefined(對齊 #94):
   *      - yearEnd null = 開放式範圍("2025+"、無上限)、轉 Infinity 比對
   *      - yearEnd undefined = 單年、轉 yearStart 比對
   *      - yearEnd 為 number = 範圍上限直接用
   *      - 由 resolveEnd helper 統一解析(對齊 #92、跨 adapter 共用)
   *    - 範圍重疊判定:actual.start ≤ spec.end 且 spec.start ≤ actual.end
   *    - 無交集 → 不 match(false-positive 防線、修正 M-1-02 簡化版 silent bug)
   *
   * @see resolveEnd(packages/domain/src/catalog/year-range.ts)
   */
  private matchFitment(actual: FitmentSpec, spec: FitmentSpec): boolean {
    // 規則 1 + 2
    if (actual.motoBrand !== spec.motoBrand) return false;
    if (actual.modelCode !== spec.modelCode) return false;

    // 規則 3:年份範圍重疊
    // 任一邊無年份 → match(narrowing 後 yearStart 為 number、不需 ! assertion)
    if (actual.yearStart === undefined || spec.yearStart === undefined) return true;

    // actualEnd / specEnd 由 resolveEnd 統一解析(對齊 #92 + #94 兩端對稱處理)
    const actualEnd = resolveEnd(actual.yearStart, actual.yearEnd);
    const specEnd = resolveEnd(spec.yearStart, spec.yearEnd);

    return actual.yearStart <= specEnd && spec.yearStart <= actualEnd;
  }
}
