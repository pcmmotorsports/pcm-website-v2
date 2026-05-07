import type { SupabaseClient } from '@supabase/supabase-js';
import type { IProductRepository } from '@pcm/ports';
import type {
  CategoryPath,
  FitmentSpec,
  Paginated,
  PaginationParams,
  Product,
  ProductId,
} from '@pcm/domain';
import {
  mapSupabaseProductToDomain,
  type SupabaseProductRow,
} from './mappers/product';
import { matchFitmentYear } from './helpers/fitment';

/**
 * SELECT projection 對齊 mapper consumed columns(避免讀 metadata / external_id 等 deferred 欄位)。
 * 跨 sub-slice 2-4 共用、單一 source of truth。
 *
 * 對齊 docs/architecture/supabase-schema-design.md §3.3 + §4.3 JOIN strategy。
 */
const PRODUCT_SELECT =
  'id, title, subtitle, description, handle, price_by_tier, fitments, images, availability, created_at, updated_at, brands(id, name, slug), categories(raw_path, segments)';

/** PostgREST not-found error code(`.single()` 找不到 row)。 */
const PGRST_NOT_FOUND = 'PGRST116';

/**
 * SupabaseProductAdapter:Supabase 真實 ProductRepository 實作。
 *
 * 對齊:
 * - `packages/ports/src/IProductRepository.ts`(IProductRepository contract)
 * - `docs/specs/M-1-03-main-b-PRD.md` §3 + §4 + §8
 * - `docs/architecture/supabase-schema-design.md` §2.3 mapping rules + §6 priceByTier 不洩漏 + §9 RLS
 * - `docs/decisions/0003-domain-entity-naming.md` §3.3 ports JSDoc contract vs adapter implementation TODO
 * - `docs/decisions/0005-custom-supabase-direct.md` §8.1
 *
 * @TODO 樂觀鎖(updated_at 比對):save 時驗 wire updated_at(M-1-03 main-b sub-slice 4 後、
 *   M-1-13 落地完整;對齊 backlog #86 contract test)
 * @TODO idempotency:save 重複呼叫同 entity 應冪等(對齊 backlog #86、M-1-13 落地)
 * @TODO audit trail:寫操作記錄 customer_id + timestamp 進 audit log(M-3-04 落地、
 *   對齊 security-timeline §C7)
 * @TODO brand / category resolve cache:LRU cache 名稱→ID(本 main-b sub-slice 4 落地、
 *   避免 save 時對同一 brand / category 重複 round-trip)
 */
export class SupabaseProductAdapter implements IProductRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * 依 id 查單筆 product。對齊 PRD §3.1 + supabase-schema-design.md §2.3。
   *
   * Error: PGRST116(`.single()` 找不到 row)→ return null;其他 throw。
   */
  async findById(id: ProductId): Promise<Product | null> {
    const { data, error } = await this.supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === PGRST_NOT_FOUND) {
        return null;
      }
      throw error;
    }

    if (!data) {
      return null;
    }

    return mapSupabaseProductToDomain(data as unknown as SupabaseProductRow);
  }

  /**
   * 依 category 列出 product。對齊 PRD §3.2 + supabase-schema-design.md §4.3。
   *
   * Resolve 流程:`categories.raw_path` UNIQUE query → categoryId(內部 resolveCategoryId);
   * 找不到 categoryId → return [](不 throw、對齊 PRD §3.2)。
   */
  async listByCategory(category: CategoryPath): Promise<Product[]> {
    const categoryId = await this.resolveCategoryId(category.raw);
    if (categoryId === null) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('category_id', categoryId);

    if (error) {
      throw error;
    }

    return (data as unknown as SupabaseProductRow[]).map(
      mapSupabaseProductToDomain,
    );
  }

  /**
   * 依 brand 列出 product。對齊 PRD §3.3 + supabase-schema-design.md §3.3。
   *
   * `brandId` 已是 UUID、不需 resolve(對齊 IProductRepository.listByBrand 簽名)。
   */
  async listByBrand(brandId: string): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .eq('brand_id', brandId);

    if (error) {
      throw error;
    }

    return (data as unknown as SupabaseProductRow[]).map(
      mapSupabaseProductToDomain,
    );
  }

  /**
   * 依 fitment spec 列出 product。對齊 PRD §3.4 + supabase-schema-design.md §2.3 第 6 行 + §2.4。
   *
   * 兩階段過濾:
   * - Server-side: `.contains('fitments', [{motoBrand, modelCode}])`(jsonb @> operator、規則 1+2)
   * - Client-side: `matchFitmentYear` filter(年份範圍重疊、規則 3、對齊 backlog #92 共用 resolveEnd)
   *
   * Phase 1 階段 1 不建 GIN index(對齊 supabase-schema-design.md §10.2 backlog #30 階段 2 trigger)。
   */
  async listByFitment(spec: FitmentSpec): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from('products')
      .select(PRODUCT_SELECT)
      .contains('fitments', [
        { motoBrand: spec.motoBrand, modelCode: spec.modelCode },
      ]);

    if (error) {
      throw error;
    }

    const products = (data as unknown as SupabaseProductRow[]).map(
      mapSupabaseProductToDomain,
    );

    return products.filter((p) =>
      p.fitments.some((f) => matchFitmentYear(f, spec)),
    );
  }

  /**
   * @TODO M-1-03 main-b sub-slice 4 落地(對齊 PRD §3.5 + §9、Phase 1 ILIKE / M-6 tsvector 切換)
   */
  async searchByKeyword(
    _query: string,
    _params: PaginationParams,
  ): Promise<Paginated<Product>> {
    throw new Error('Not implemented');
  }

  /**
   * @TODO M-1-03 main-b sub-slice 4 落地(對齊 PRD §3.6 + §9、含 brand/category resolve cache)
   */
  async save(_product: Product): Promise<Product> {
    throw new Error('Not implemented');
  }

  /**
   * 內部 helper:`categories.raw_path` UNIQUE query 取 leaf node id。
   * 對齊 PRD §3.2 + supabase-schema-design.md §4.3。
   *
   * Error: PGRST116(`.single()` 找不到 row)→ return null;其他 throw。
   *
   * 注:只取 leaf node id;parent_id_chain 解析屬 save 路徑(對齊 PRD §5.1 末段)、
   * 不在本 helper 範圍。
   */
  private async resolveCategoryId(rawPath: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('categories')
      .select('id')
      .eq('raw_path', rawPath)
      .single();

    if (error) {
      if (error.code === PGRST_NOT_FOUND) {
        return null;
      }
      throw error;
    }

    if (!data) {
      return null;
    }

    return (data as unknown as { id: string }).id;
  }
}
