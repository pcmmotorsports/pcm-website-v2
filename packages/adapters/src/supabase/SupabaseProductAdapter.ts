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
import type { Database } from './database.types';
import {
  mapDomainProductToSupabase,
  mapSupabaseProductToDomain,
  type SupabaseProductRow,
} from './mappers/product';
import { matchFitmentYear } from './helpers/fitment';

/**
 * Detail projection(M-1-05 刀 2 Sub-slice 2-3):products_public detail view 14 欄
 * + brands / categories embedded JOIN、單一 source of truth。
 *
 * 5 read method(findById / searchByKeyword / listByFitment / listByCategory /
 * listByBrand)全走 products_public view 取此投射;save 走 base products 表、
 * upsert 後 `.select()` 重用此投射(products_public 為 products 欄位子集、欄名相容)。
 *
 * view 排除 price_store / price_by_tier / metadata(經銷敏感 + 內部欄位、對齊
 * backlog #118 + #119);price_general 對齊 M-1-05 刀 2 Sub-slice 2-1 新欄。
 *
 * 注:list-projection(products_list_public 9 欄)本 sub-slice 暫不接線 —— Sean
 * 拍板 list method 改讀 detail view(9 欄 list view 缺 description / images /
 * timestamps、還原不出完整 domain Product);list/detail projection 拆分留後續 slice。
 *
 * 對齊 docs/architecture/supabase-schema-design.md §3.3 + §4.3 JOIN strategy。
 */
const PRODUCT_SELECT_DETAIL =
  'id, external_id, title, subtitle, description, handle, fitments, images, availability, brand_id, category_id, price_general, created_at, updated_at, brands(id, name, slug, premium_extra_pct), categories(raw_path, segments)';

/**
 * Detail-with-variants projection(M-1-16c-2、backlog #203):PRODUCT_SELECT_DETAIL +
 * embed `product_variants_public(...)` 7 欄(view DDL 10 欄、adapter 只投射 domain 變體所需 7 欄:
 * id / sku / spec / price_general / availability / images / sort_order)。
 *
 * 只給單筆 detail 查詢(findById / findByHandle)用;list 路徑(listByCategory / listByBrand /
 * listByFitment / searchByKeyword)維持 PRODUCT_SELECT_DETAIL（不帶變體、避 N+1 jsonb 膨脹）。
 *
 * 🔴 經銷價防護:embed 走 product_variants_public view、view 物理排除 price_store / metadata、
 *   透過 embed 亦無法 select(實測 PostgreSQL 42703「column does not exist」)→ 經銷價在 DB 層硬擋、
 *   不僅靠 application 投射選擇。PostgREST view↔view 關係已實測偵測成功(不需 product_id fallback)。
 */
const PRODUCT_SELECT_DETAIL_WITH_VARIANTS = `${PRODUCT_SELECT_DETAIL}, product_variants_public(id, sku, spec, price_general, availability, images, sort_order)`;

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
  constructor(private readonly supabase: SupabaseClient<Database>) {}

  /**
   * 依 id 查單筆 product。對齊 PRD §3.1 + supabase-schema-design.md §2.3。
   *
   * 找不到 → null(`findSingle` 統一處理 PGRST_NOT_FOUND);其他 error → throw。
   */
  async findById(id: ProductId): Promise<Product | null> {
    const row = await this.findSingle<SupabaseProductRow>(
      this.supabase
        .from('products_public')
        .select(PRODUCT_SELECT_DETAIL_WITH_VARIANTS)
        .eq('id', id)
        .single(),
    );
    return row ? mapSupabaseProductToDomain(row) : null;
  }

  /**
   * 依 handle(SEO URL slug)查單筆 product。對齊 IProductRepository.findByHandle contract +
   * backlog #203。仿 findById、走 products_public view、embed product_variants_public 帶變體。
   *
   * 找不到 → null(findSingle 統一處理 PGRST_NOT_FOUND);其他 error → throw。
   *
   * 用途:storefront 詳情頁 /products/[slug](slug = handle)、M-1-16c-3 接真資料。
   */
  async findByHandle(handle: string): Promise<Product | null> {
    const row = await this.findSingle<SupabaseProductRow>(
      this.supabase
        .from('products_public')
        .select(PRODUCT_SELECT_DETAIL_WITH_VARIANTS)
        .eq('handle', handle)
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
      .from('products_public')
      .select(PRODUCT_SELECT_DETAIL)
      .eq('category_id', categoryId);

    if (error) {
      throw error;
    }

    return (data as unknown as SupabaseProductRow[]).map(
      mapSupabaseProductToDomain,
    );
  }

  /**
   * 依 category 列出 product —— 全量分頁版(#220、/products 列表頁用)。
   *
   * listByCategory 走單次 `.select()`、會撞 PostgREST/Supabase「Max rows = 1000」硬上限
   * (品類 >1000 件時靜默截斷、列表頁漏商品);本方法以 `.order('id')` + `.range()` 分頁迴圈
   * 撈到底,確保 /products 顯示完整公開目錄(RLS 已濾下架、回非下架商品全量)。
   *
   * 🔴 **stopgap**:全量撈進 client(client filter/分頁)。多品牌(#212)目錄長大後須改
   *   server-side 分頁/篩選(#51)、非長久解。
   *
   * 分頁正確性(審查點):
   * - `.order('id')`(PK uuid 唯一、穩定排序)+ 連續非重疊 `.range` 視窗 → 無重複 / 無漏行。
   * - 末頁 `batch.length < PAGE_SIZE` 即停(含「恰為 PAGE_SIZE 整數倍」時多撈一次空頁正常停)。
   * - `MAX_PAGES` 防呆上限:命中則 `console.warn`(不靜默截斷)、回已撈部分。
   * - fail-closed 同 listByCategory:找不到 categoryId → `[]`。
   */
  async listAllByCategory(category: CategoryPath): Promise<Product[]> {
    const categoryId = await this.resolveCategoryId(category.raw);
    if (categoryId === null) {
      return [];
    }

    const PAGE_SIZE = 1000;
    const MAX_PAGES = 50; // 防呆:50 × 1000 = 5 萬件上限(遠超現況、防迴圈失控)
    const rows: SupabaseProductRow[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const { data, error } = await this.supabase
        .from('products_public')
        .select(PRODUCT_SELECT_DETAIL)
        .eq('category_id', categoryId)
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      const batch = (data ?? []) as unknown as SupabaseProductRow[];
      rows.push(...batch);

      if (batch.length < PAGE_SIZE) {
        return rows.map(mapSupabaseProductToDomain); // 末頁、撈完
      }
    }

    // 命中 MAX_PAGES 仍未撈完(異常 scale)→ 不靜默截斷:警示後回已撈部分(no silent caps)。
    console.warn(
      `[SupabaseProductAdapter.listAllByCategory] category=${category.raw} 達 MAX_PAGES=${MAX_PAGES}(${MAX_PAGES * PAGE_SIZE} 件)上限、結果可能截斷;需改 server-side 分頁(#51)`,
    );
    return rows.map(mapSupabaseProductToDomain);
  }

  /**
   * 依 brand 列出 product。對齊 PRD §3.3 + supabase-schema-design.md §3.3。
   *
   * `brandId` 已是 UUID、不需 resolve(對齊 IProductRepository.listByBrand 簽名)。
   */
  async listByBrand(brandId: string): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from('products_public')
      .select(PRODUCT_SELECT_DETAIL)
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
   * - Server-side: `.contains('fitments', JSON.stringify([{motoBrand, modelCode}]))`(jsonb @> operator、規則 1+2)
   * - Client-side: 三條 cross-check `f.motoBrand === spec.motoBrand && f.modelCode === spec.modelCode
   *   && matchFitmentYear(f, spec)`(規則 1+2+3、對齊 InMemoryProductRepository.matchFitment 行為等價)
   *
   * 注:client-side 必須 cross-check brand+model,server-side prefilter 是 product 級別
   * (product 含**至少一條** fitment 含 spec.motoBrand+modelCode 即通過)、product.fitments 可
   * 含其他車型 fitment。若 client 只跑 matchFitmentYear(year-only)、會撞跨車型 false positive:
   * fitments=[{Yamaha,R1,2018-2024},{Honda,CBR,2010-2012}] 對 spec=(Honda,CBR,2020) → server
   * @> 通過 + client matchFitmentYear vs Yamaha R1 fitment year=2020 ∈ [2018,2024] some=true
   * 但實際 Honda CBR 2010-2012 不 cover 2020 → false positive。
   * (M-1-03 main-c sub-slice 2.5 修、Sean 業務拍板「跨車型常態、Phase 1 必修」)
   *
   * 注:第二參數須走 `JSON.stringify([...])` 字面;直傳 array of objects 會被 supabase-js
   * 序列化成 PostgREST array literal `cs.{...}`(curly outer)、PG JSON parser 22P02 reject
   * (M-1-03 main-c spike 揭示)。JSON 字串強制走 `cs.[...]` 格式對齊真實 SQL
   * `fitments @> '[{...}]'::jsonb`(對齊 supabase-schema-design.md §10.2 字面 + PG MCP 真權威驗 hits=1)。
   *
   * Phase 1 階段 1 不建 GIN index(對齊 supabase-schema-design.md §10.2 backlog #30 階段 2 trigger)。
   */
  async listByFitment(spec: FitmentSpec): Promise<Product[]> {
    const { data, error } = await this.supabase
      .from('products_public')
      .select(PRODUCT_SELECT_DETAIL)
      .contains(
        'fitments',
        JSON.stringify([
          { motoBrand: spec.motoBrand, modelCode: spec.modelCode },
        ]),
      );

    if (error) {
      throw error;
    }

    const products = (data as unknown as SupabaseProductRow[]).map(
      mapSupabaseProductToDomain,
    );

    return products.filter((p) =>
      p.fitments.some(
        (f) =>
          f.motoBrand === spec.motoBrand &&
          f.modelCode === spec.modelCode &&
          matchFitmentYear(f, spec),
      ),
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
      .from('products_public')
      .select(PRODUCT_SELECT_DETAIL, { count: 'exact' })
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

    // #106:upsert 寫 base products 表、payload 型須對齊生成 products Insert。row 由 domain 建構
    // (brand_id=product.brand.id / category_id=resolved、runtime 保證非空),但 wire SupabaseProductRow
    // 將 brand_id/category_id 型為 nullable(沿用 products_public view-read 的寬鬆 shape)→ 對 base 表
    // 寫入須 1 個 documented cast 收斂為 Insert 型(typed client 已驗欄名;此 cast 僅補 read↔write 表/view
    // nullable 落差、非 type-safety 漏洞)。
    const saved = await this.findSingle<SupabaseProductRow>(
      this.supabase
        .from('products')
        .upsert(row as Database['public']['Tables']['products']['Insert'], { onConflict: 'id' })
        .select(PRODUCT_SELECT_DETAIL)
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
   * #106:client 已 `SupabaseClient<Database>` generic(.from/.select/.eq 欄名查詢 compile 期檢)。
   * 本 helper 的 `as T` + read 路徑 `as unknown as SupabaseProductRow[]` **保留**:products_public view
   * + embeds 投射的 wire shape 把 jsonb 欄(fitments→FitmentSpec[] / images→string[] / segments→string[])
   * narrow 成 domain 形,生成型別僅給 `Json`、無法 derive → 此 cast 為 rich-Json 投射的正當邊界
   * (非 type-safety 漏洞;對比簡單 adapter〔customer/address/vehicle/wallet〕已全消 cast)。
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
