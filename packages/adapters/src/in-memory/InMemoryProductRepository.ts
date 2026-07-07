import type { IProductRepository } from '@pcm/ports';
import {
  resolveEnd,
  type Product,
  type ProductId,
  type CategoryPath,
  type CategorySummary,
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

  /**
   * 依 handle 查單筆 product(M-1-16c-2、對齊 IProductRepository.findByHandle contract)。
   *
   * in-memory 存整 Product 物件、variants 天生帶(save 時 structuredClone 含 variants[]);
   * 找不到 → null(同 findById)。
   */
  async findByHandle(handle: string): Promise<Product | null> {
    return (
      Array.from(this.products.values()).find((p) => p.handle === handle) ?? null
    );
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

  /**
   * 依 category 列出全部 product（#220、全量版、對齊 IProductRepository.listAllByCategory contract）。
   *
   * in-memory 無 PostgREST「Max rows = 1000」上限 → 行為等同 listByCategory（全量回傳）；
   * 真 adapter(SupabaseProductAdapter)才需 .range 分頁迴圈繞過上限。
   */
  async listAllByCategory(category: CategoryPath): Promise<Product[]> {
    return this.listByCategory(category);
  }

  /**
   * 列出全目錄非下架 product —— 全量、跨分類(接線 plan C4、對齊 IProductRepository.listAllProducts contract)。
   *
   * in-memory 無 PostgREST「Max rows = 1000」上限、無下架概念(DB/RLS 概念)→ 回全部庫存 product;
   * 真 adapter(SupabaseProductAdapter)才需 .range 分頁迴圈繞上限 + RLS 濾下架。
   *
   * `options.limit`(perf/P2):給定時**先依 id 升冪排序再取前 limit 筆**——Map 迭代序是
   * 插入序、與 Supabase `.order('id')` 語意分歧,不排序會讓 contract 在兩實作間漂移
   * (K1 round2 抓點);非正整數 → throw(fail-closed、對齊 port contract)。
   * 省略時維持既有行為(插入序全量、既有測試不動)。
   */
  async listAllProducts(options?: { limit?: number }): Promise<Product[]> {
    const all = Array.from(this.products.values());
    const limit = options?.limit;
    if (limit === undefined) {
      return all;
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`InMemoryProductRepository.listAllProducts: limit 須為正整數、收到 ${limit}`);
    }
    return all
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit);
  }

  /**
   * 列出分類 + 各分類商品數(對齊 IProductRepository.listCategories contract)。
   *
   * in-memory 不承載分類註冊表 → 由庫存 product 的 category 推導 distinct 分類 + 商品數;
   * DB-only 欄位為 degenerate(id = path.raw、parentId = null、sortOrder = 0)。此 double 僅供
   * use-case test 滿足 port(use-case 不呼叫 listCategories);真分類清單(含空分類、真 uuid /
   * 巢狀樹 / 排序、上架 delisted_at IS NULL 過濾)由 SupabaseProductAdapter 提供。
   *
   * 註:count 為庫存全部 product(test 自控 seed);「上架過濾」是 DB/RLS 概念、不在 in-memory 範圍。
   */
  async listCategories(): Promise<CategorySummary[]> {
    const byRaw = new Map<string, CategorySummary>();
    for (const p of this.products.values()) {
      const raw = p.category.raw;
      const existing = byRaw.get(raw);
      if (existing) {
        existing.productCount += 1;
      } else {
        byRaw.set(raw, {
          id: raw,
          name: p.category.segments[p.category.segments.length - 1] ?? raw,
          path: { raw, segments: [...p.category.segments] },
          parentId: null,
          sortOrder: 0,
          productCount: 1,
        });
      }
    }
    return Array.from(byRaw.values());
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
