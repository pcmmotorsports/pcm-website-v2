import type {
  Product,
  ProductId,
  Brand,
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
  listByBrand(brand: Brand): Promise<Product[]>;
  listByFitment(spec: FitmentSpec): Promise<Product[]>;
  /** TODO M-1-03: 補分頁參數(limit / offset / cursor、storefront 商品列表用) */
  search(query: string): Promise<Product[]>;
}
