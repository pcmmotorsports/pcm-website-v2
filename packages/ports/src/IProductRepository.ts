import type {
  Product,
  ProductId,
  CategoryPath,
  FitmentSpec,
} from '@pcm/domain';

/**
 * IProductRepository: 商品查詢 port。
 *
 * 對齊 ADR-0003 §3.3 — 介面方法簽名只出現 domain 命名、不允許 Medusa wire 字串 leak。
 * 實作:M-1-02 InMemoryProductRepository(test) + M-1-03 MedusaProductAdapter(real)。
 */
export interface IProductRepository {
  findById(id: ProductId): Promise<Product | null>;
  listByCategory(category: CategoryPath): Promise<Product[]>;
  listByBrand(brandId: string): Promise<Product[]>;
  listByFitment(spec: FitmentSpec): Promise<Product[]>;
  /**
   * Search products by keyword (full-text search across title / metadata.fits).
   *
   * 兩階段實作(對齊 ADR-0004 Q3=A1 + medusa-schema-design.md §2.5):
   * - M-1-03 Medusa adapter 落地用 PG ILIKE 暫代(p99 1-3s @ 200 SKU)
   * - M-6 上線前切 PG tsvector + GIN + pg_jieba(p99 < 100ms @ 5w SKU、需 Supabase Pro)
   *
   * TODO M-1-03: 加 PaginationParams + Paginated<Product>(對應 backlog #20)
   */
  searchByKeyword(query: string): Promise<Product[]>;
}
