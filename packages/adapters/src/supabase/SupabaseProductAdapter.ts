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
  mapDomainProductToSupabase,
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

/** searchByKeyword ILIKE 三欄(對齊 PRD §3.5 + supabase-schema-design.md §2.5 dev 階段)。 */
const SEARCHABLE_COLUMNS = ['title', 'subtitle', 'description'] as const;

/**
 * 為 PostgREST `.or()` 跨欄 ILIKE filter 組裝 sanitized pattern + filter string。
 *
 * 兩階段 sanitize:
 * 1. 剝除 PostgREST `.or()` filter 語法保留字元(`,` `(` `)` `.` `"`)、避免 user
 *    輸入破壞 filter 解析(例 `Yamaha,price.gte.999` 會被當兩個 filter clause)。
 *    Phase 1 trade-off:這些字元在 ILIKE substring 失準、M-6 切 tsvector + textSearch
 *    時可用真 escape(對齊 backlog #110)。
 * 2. 轉義 ILIKE wildcards(`\` `%` `_`)、`\` 先(否則 `\%` 會被當已轉義)。
 *
 * regex / strip 字元集合為 Code 設計選擇、不歸 PRD 字面源(對齊 lessons §12-3 維度 A)。
 */
function buildIlikeOrFilter(columns: readonly string[], q: string): string {
  const sanitized = q
    .replace(/[,()."]/g, ' ')
    .replace(/[\\%_]/g, (c) => '\\' + c);
  const pattern = `%${sanitized}%`;
  return columns.map((col) => `${col}.ilike.${pattern}`).join(',');
}

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
 * @TODO 樂觀鎖(updated_at 比對):save 衝突偵測待 M-1-13 落地;sub-slice 4
 *   依賴 upsert onConflict='id' 替代、未實作 updated_at 比對(對齊 backlog #86 contract test)
 * @TODO idempotency:save 重複呼叫同 entity 應冪等;sub-slice 4 用 upsert
 *   onConflict='id' 對齊 PG 行為(對齊 backlog #86 contract test、M-1-13 完整化)
 * @TODO audit trail:寫操作記錄 customer_id + timestamp 進 audit log(M-3-04 落地、
 *   對齊 security-timeline §C7;sub-slice 4 未實作)
 * @TODO brand / category resolve cache:`resolveCategoryId` 私有 method 已抽
 *   (sub-slice 2 / sub-slice 4、第 2 處用:listByCategory + save);brand 為
 *   value-object 已含 UUID(`Brand.id: string`)、不需 name→ID resolve;
 *   LRU cache 抽出待第 3 處撞才抽 trigger(對齊 lessons #84/#85 Defer 模式)、
 *   Phase 1 dev 200 SKU 規模 round-trip 開銷可接受
 */
export class SupabaseProductAdapter implements IProductRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * 依 id 查單筆 product。對齊 PRD §3.1 + supabase-schema-design.md §2.3。
   *
   * 找不到 → null(`findSingle` 統一處理 PGRST_NOT_FOUND);其他 error → throw。
   */
  async findById(id: ProductId): Promise<Product | null> {
    const row = await this.findSingle<SupabaseProductRow>(
      this.supabase
        .from('products')
        .select(PRODUCT_SELECT)
        .eq('id', id)
        .single(),
    );
    return row ? mapSupabaseProductToDomain(row) : null;
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
   * 依關鍵字模糊搜尋 product。對齊 PRD §3.5 + supabase-schema-design.md §2.5 dev 階段
   * + IProductRepository.searchByKeyword contract。
   *
   * Phase 1 dev 階段:ILIKE on title / subtitle / description(對齊 ADR-0004 Q3=A1
   * 兩階段、p99 1-3s @ 200 SKU、dev 期可接受);M-6 上線前切 tsvector + GIN + pg_jieba。
   *
   * Empty query:`query.trim() === ''` → return `{ items: [], total: 0 }`(對齊 contract)。
   *
   * 注:ILIKE 特殊字符(`%` / `_`)經 `escapeLikePattern` 轉義、避免使用者輸入觸發
   * unintended wildcard 行為。
   */
  async searchByKeyword(
    query: string,
    params: PaginationParams,
  ): Promise<Paginated<Product>> {
    const q = query.trim();
    if (q === '') {
      return { items: [], total: 0 };
    }

    const offset = params.offset ?? 0;
    const filter = buildIlikeOrFilter(SEARCHABLE_COLUMNS, q);

    const { data, error, count } = await this.supabase
      .from('products')
      .select(PRODUCT_SELECT, { count: 'exact' })
      .or(filter)
      .range(offset, offset + params.limit - 1);

    if (error) {
      throw error;
    }

    const items = (data as unknown as SupabaseProductRow[]).map(
      mapSupabaseProductToDomain,
    );
    return { items, total: count ?? 0 };
  }

  /**
   * 儲存 product entity(create / update 統一入口、upsert)。對齊 PRD §3.6 +
   * supabase-schema-design.md §2.3 第 8 行 + ADR-0003 §3.4 wire 紀律。
   *
   * Resolve 流程:
   * - `categoryId`:`product.category.raw` → `resolveCategoryId` UNIQUE query
   *   (重用 sub-slice 2 internal helper、第 2 處用);找不到 → throw
   *   (save 不 auto-create category;由 seed slice / sync-engine 負責、對齊
   *   supabase-schema-design.md §3.3 末段「M-1-16 種子資料 import 時觸發」)。
   * - `brandId`:`product.brand.id` 已是 UUID(`Brand.id: string`)、直接使用、
   *   不需 name → ID resolve(本 sub-slice commit body 揭示:此處與 PRD §3.6
   *   字面「brand / category 名稱→ID 快取」偏離;`Brand` value-object 已含 id、
   *   `CategoryPath` 無 id 須 resolve、cache 抽出 trigger 留 audit / 第 3 處撞才抽)。
   *
   * 樂觀鎖 / idempotency / audit trail:見 class JSDoc @TODO、本 sub-slice 不實作。
   */
  async save(product: Product): Promise<Product> {
    const categoryId = await this.resolveCategoryId(product.category.raw);
    if (categoryId === null) {
      throw new Error(
        `Category '${product.category.raw}' not found. Ensure category exists before saving.`,
      );
    }

    const row = mapDomainProductToSupabase(product, {
      brandId: product.brand.id,
      categoryId,
    });

    const saved = await this.findSingle<SupabaseProductRow>(
      this.supabase
        .from('products')
        .upsert(row, { onConflict: 'id' })
        .select(PRODUCT_SELECT)
        .single(),
    );

    if (!saved) {
      throw new Error(`Upsert of product '${product.id}' returned no row`);
    }

    return mapSupabaseProductToDomain(saved);
  }

  /**
   * 內部 helper:`categories.raw_path` UNIQUE query 取 leaf node id。
   * 對齊 PRD §3.2 + supabase-schema-design.md §4.3。
   *
   * 注:只取 leaf node id;parent_id_chain 解析屬 save 路徑(對齊 PRD §5.1 末段)、
   * 不在本 helper 範圍。
   */
  private async resolveCategoryId(rawPath: string): Promise<string | null> {
    const row = await this.findSingle<{ id: string }>(
      this.supabase
        .from('categories')
        .select('id')
        .eq('raw_path', rawPath)
        .single(),
    );
    return row?.id ?? null;
  }

  /**
   * 內部 helper:`.single()` 結果統一處理(PGRST_NOT_FOUND → null、其他 error → throw、
   * data null fallthrough → null)。對齊 sub-slice 4 audit 第 3 處撞 Defer trigger
   * (findById + resolveCategoryId + save、雙 audit R1/R2/Q6 共識)。
   *
   * 雙 cast escape hatch 集中於本 helper、未來 backlog #106 typed Database schema
   * 落地時改 generic 即可消除 cast。
   */
  private async findSingle<T>(
    promise: PromiseLike<{
      data: unknown;
      error: { code: string; message: string } | null;
    }>,
  ): Promise<T | null> {
    const { data, error } = await promise;
    if (error) {
      if (error.code === PGRST_NOT_FOUND) {
        return null;
      }
      throw error;
    }
    return (data ?? null) as T | null;
  }
}
