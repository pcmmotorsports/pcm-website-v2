import type { SupabaseClient } from '@supabase/supabase-js';
import type { IProductRepository } from '@pcm/ports';
import type {
  CategoryPath,
  CategorySummary,
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
import {
  queryGeneralProducts,
  queryInheritedFitments,
  queryProductsByFitment,
  queryProductsByVehicle,
} from './helpers/fitment-queries';
import {
  SEARCHABLE_COLUMNS,
  buildIlikeOrFilter,
  fetchAllPaginated,
  findSingle,
} from './helpers/product-query-support';
import {
  listCategories as listCategoriesQuery,
  resolveCategoryId,
} from './helpers/category-queries';

/**
 * Detail projection(M-1-05 刀 2 Sub-slice 2-3):products_public detail view 公開欄(含 A/#270 highlights 賣點欄 + #270 manuals/video_url 安裝資源欄)
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
  'id, external_id, title, subtitle, description, highlights, manuals, video_url, handle, fitments, images, availability, brand_id, category_id, price_general, created_at, updated_at, brands(id, name, slug, premium_extra_pct), categories(raw_path, segments)';

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
 * @TODO brand / category resolve cache:`resolveCategoryId` 已抽至
 *   `helpers/category-queries.ts`(鐵則 6 拆檔;listByCategory / listAllByCategory / save 共 3 處用);
 *   brand 為 value-object 已含 UUID(`Brand.id: string`)、不需 name→ID resolve;
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
    const row = await findSingle<SupabaseProductRow>(
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
    const row = await findSingle<SupabaseProductRow>(
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
    const categoryId = await resolveCategoryId(this.supabase, category.raw);
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
   * 分頁正確性:`.order('id')`(PK uuid 穩定)+ 連續非重疊 `.range` 視窗、末頁 <PAGE_SIZE 即停、
   * MAX_PAGES 防呆(細節見 `fetchAllPaginated`);fail-closed 同 listByCategory:找不到 categoryId → `[]`。
   */
  async listAllByCategory(category: CategoryPath): Promise<Product[]> {
    const categoryId = await resolveCategoryId(this.supabase, category.raw);
    if (categoryId === null) {
      return [];
    }

    const rows = (await fetchAllPaginated(
      (from, to) =>
        this.supabase
          .from('products_public')
          .select(PRODUCT_SELECT_DETAIL)
          .eq('category_id', categoryId)
          .order('id', { ascending: true })
          .range(from, to),
      `SupabaseProductAdapter.listAllByCategory(category=${category.raw})`,
    )) as SupabaseProductRow[];

    return rows.map(mapSupabaseProductToDomain);
  }

  /**
   * 列出**全目錄**非下架 product —— 全量、跨分類(接線 plan C4、#205)。對齊
   * IProductRepository.listAllProducts contract。
   *
   * 同 listAllByCategory 的分頁迴圈(繞 PostgREST 1000-row 上限、`fetchAllPaginated` 共用),
   * 但**不疊 category_id 過濾** → 撈整個公開目錄(RLS 已濾下架、回非下架商品全量)。
   * 解除 lib/products 舊「寫死單一分類『碳纖維部品』」;RPM 零回歸見 port contract。
   *
   * 🔴 **stopgap**:同 listAllByCategory,全量撈進 client;多品牌(#212)後改 server-side 分頁(#51)。
   *
   * `options.limit`(perf/P2):正整數且 ≤1000(PostgREST 單查詢 Max rows)→ 單次
   * `.order('id').limit(n)` 下推 DB、不走分頁迴圈(首頁精選 4 筆免撈全表);
   * >1000 → 分頁迴圈撈滿再裁切(避免 PostgREST 靜默截斷、no silent caps);
   * 非正整數 → throw(fail-closed、對齊 port contract)。
   */
  async listAllProducts(options?: {
    limit?: number;
    orderBy?: 'id_asc' | 'created_desc';
  }): Promise<Product[]> {
    const limit = options?.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new Error(`SupabaseProductAdapter.listAllProducts: limit 須為正整數、收到 ${limit}`);
    }

    // 排序(前菜 D):'id_asc'=既有全站預設(單次 .order('id' 升冪)、byte 等價舊行為);
    //   'created_desc'=最新商品(created_at 遞減 + id 遞減 tie-break 保定序、防 created_at 撞值漂移)。
    //   鏈式 .order 直接串接(型別自然推導、不套自參照泛型 helper — supabase select→order 回傳型別不同)。
    const orderDesc = options?.orderBy === 'created_desc';

    if (limit !== undefined && limit <= 1000) {
      const base = this.supabase.from('products_public').select(PRODUCT_SELECT_DETAIL);
      const ordered = orderDesc
        ? base.order('created_at', { ascending: false }).order('id', { ascending: false })
        : base.order('id', { ascending: true });
      const { data, error } = await ordered.limit(limit);
      if (error) {
        throw error;
      }
      return ((data ?? []) as SupabaseProductRow[]).map(mapSupabaseProductToDomain);
    }

    const rows = (await fetchAllPaginated(
      (from, to) => {
        const base = this.supabase.from('products_public').select(PRODUCT_SELECT_DETAIL);
        const ordered = orderDesc
          ? base.order('created_at', { ascending: false }).order('id', { ascending: false })
          : base.order('id', { ascending: true });
        return ordered.range(from, to);
      },
      'SupabaseProductAdapter.listAllProducts',
    )) as SupabaseProductRow[];

    const capped = limit !== undefined ? rows.slice(0, limit) : rows;
    return capped.map(mapSupabaseProductToDomain);
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
   * 依 fitment spec 列出 product(motoBrand + modelCode + 年份範圍重疊)。
   *
   * R2a:由舊 jsonb `.contains` @> + client cross-check 改走**正規化 product_fitments 索引表**
   * (推薦引擎「以車查商品」反查加速;正規化一列一相容、天生消掉舊版跨車型 false-positive)。
   * 兩步查詢與年份範圍重疊邏輯抽至 `helpers/fitment-queries.ts`(鐵則 6);prod 無 caller、
   * 行為以 contract + 兩實作測為準。
   */
  async listByFitment(spec: FitmentSpec): Promise<Product[]> {
    const rows = await queryProductsByFitment(
      this.supabase,
      spec,
      PRODUCT_SELECT_DETAIL,
    );
    return rows.map(mapSupabaseProductToDomain);
  }

  /**
   * 以車查商品(S1 變體補足、2026-07-12;/products 車款篩選下推 DB、取代 client 全量過濾)。
   *
   * 走 DB RPC `search_products_by_vehicle` = `product_fitments`(direct、即時)∪
   * `product_fitments_effective`(報價單母款家族樹展開、每日同步)去重 → 繼承件也命中
   * (MT-09 SP 2021 實測 74→124)。`.range()` 分頁繞 SETOF RPC 的 PostgREST Max Rows 1000
   * (品牌-only 可破千、靜默截斷;codex#2)。細節見 helpers/fitment-queries.queryProductsByVehicle。
   *
   * 註:未收進 IProductRepository port —— 家族樹展開語意綁 DB RPC、InMemory 實作無法等價復刻
   * (展開權威在報價單);單一 consumer(storefront /products server fetch)、port 收錄待
   * contract test 一併補(對齊 listByFitment @TODO 分頁簽名同批)。
   */
  async listByVehicle(
    motoBrand: string,
    modelCode?: string,
    year?: number,
  ): Promise<Product[]> {
    const rows = await queryProductsByVehicle(
      this.supabase,
      motoBrand,
      modelCode,
      year,
    );
    return rows.map(mapSupabaseProductToDomain);
  }

  /**
   * 查單一商品的「車系相容(推導)」fitment(S1、PDP 兩層顯示、Sean Q4=A)。
   *
   * 讀 `product_fitments_effective` inherited 列(anon SELECT + RLS 濾下架)、回
   * `FitmentSpec[]`(matchSource='inherited');direct 即 product.fitments 原始值、不經此查。
   * 未收進 port:理由同 listByVehicle(effective 表為 DB 專屬衍生物)。
   */
  async listInheritedFitments(productId: ProductId): Promise<FitmentSpec[]> {
    return queryInheritedFitments(this.supabase, productId);
  }

  /**
   * 列出通用款 product(fitments 空陣列、對齊 IProductRepository.listGeneral contract)。
   *
   * 查詢抽至 `helpers/fitment-queries.ts` queryGeneralProducts(products_public + RLS、
   * `fitments = '[]'` jsonb 等值);「非空全髒不算通用」= Sean 2026-07-08 逐筆判斷(見 helper 註解)。
   */
  async listGeneral(): Promise<Product[]> {
    const rows = await queryGeneralProducts(
      this.supabase,
      PRODUCT_SELECT_DETAIL,
    );
    return rows.map(mapSupabaseProductToDomain);
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
    const categoryId = await resolveCategoryId(this.supabase, product.category.raw);
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
    const saved = await findSingle<SupabaseProductRow>(
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
   * 列出全部分類 + 各分類上架商品數(接線 plan C1)。
   * 實作抽至 `helpers/category-queries.ts`(鐵則 6 拆檔);contract 見 IProductRepository.listCategories。
   */
  async listCategories(): Promise<CategorySummary[]> {
    return listCategoriesQuery(this.supabase);
  }
}
