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
  assertPositiveIntegerPoolLimit,
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
/**
 * 🔴 2026-08-09 附件線片 3b-wire 加 `sound_clips`(排氣聲浪音檔)。
 * **加在 base-safe 的這一顆、不是下面兩顆 VIEW 常數** —— 與 `card_image_trim` 的處置刻意不同:
 *   · `card_image_trim` 是 **view 衍生欄**(base 表沒有 ⇒ save() 選它會 42703)⇒ 只能放 VIEW 常數;
 *   · `sound_clips` 是 **base `products` 表的真欄位**(migration 20260808000000
 *     `ALTER TABLE products ADD COLUMN sound_clips`),base 與 view 兩邊都在,同 `manuals` 一樣
 *     ⇒ 放這裡讓「讀路徑」與「save() 回讀」拿到同一個形狀,不會出現
 *       「存完之後回傳的 domain 物件音檔憑空變空」。
 * ⚠️ 部署順序硬依賴:PostgREST 對不存在的欄位是 **42703 整條 throw、不是缺鍵優雅降級**
 *    ⇒ 本常數上線的環境必須已 apply 該 migration
 *    (主視窗 2026-08-09 實查:已 apply、akrapovic 抽樣 107/200 群有值)。
 * ⚠️ **只讀不寫**:save() 的 upsert payload **不含** sound_clips —— 那一欄由 rpm 同步管線寫,
 *    網站端寫進去等於兩個來源搶同一欄。
 */
const PRODUCT_SELECT_DETAIL =
  'id, external_id, title, subtitle, description, highlights, manuals, video_url, sound_clips, handle, fitments, images, availability, brand_id, category_id, price_general, created_at, updated_at, brands(id, name, slug, premium_extra_pct), categories(raw_path, segments)';

/**
 * View-read projection(trim 線 S4a):PRODUCT_SELECT_DETAIL + `card_image_trim`
 * (products_public 末欄、migration 20260719150000;卡片首圖去白邊 bbox jsonb 或 null)。
 * 🔴 讀寫投影拆分的理由:save() 對 **base products 表** upsert 後 `.select()` 重用投影,
 * base 表無 card_image_trim → 直接加進 PRODUCT_SELECT_DETAIL 會讓 save 42703。
 * 故:所有 products_public **讀路徑**用本常數;save() 維持 PRODUCT_SELECT_DETAIL(base-safe)、
 * 其回讀 row 缺此欄 → mapper 收斂 cardImageTrim=undefined(合法、前端 fallback cover)。
 * 🔴 部署順序硬依賴(S4a code-reviewer Critical;同檔 WITH_VARIANTS 註的 42703 實測同理):
 * PostgREST 對 select 指名不存在欄回 42703 error、非「缺鍵優雅降級」→ 本常數上線的環境
 * **必須**已 apply migration 20260719150000,否則所有目錄讀路徑整條 throw。
 *
 * 🔴 2026-08-08(Q28 加購鈕線)加 embed `product_variants_public(id)` —— **只有 id 這一欄**:
 * 列表卡片的快速加購需要知道「這款有沒有變體」,但**不需要變體資料本身**(Sean 拍板:有規格就導
 * 商品頁選,不在卡片上直接加某個規格)。不帶這個訊息時,「真的沒變體」與「有變體但沒帶下來」
 * 在卡片端長得一模一樣 ⇒ 有變體商品會被加成幽靈品項(購物車 fail-closed 丟掉那行、客人卻看到
 * 加購成功)。只投 id 讓 :74 那個「避 N+1 jsonb 膨脹」的理由**仍然成立**(不拖 spec/images jsonb)。
 * mapper 端由 `isFullVariantRow` 分辨兩種形狀:精簡形狀只進 `variantCount`、不進 `variants`
 * ⇒ list 路徑的 `variants` 維持 `[]`、零行為回歸。
 * 部署面:embed 關係已由主視窗對**正式站 PostgREST** 實測(`select=id,product_variants_public(id)`
 * → HTTP 200、每列帶 `[{id},…]`),42703 那格不會發生。
 */
const PRODUCT_SELECT_DETAIL_VIEW = `${PRODUCT_SELECT_DETAIL}, card_image_trim, product_variants_public(id)`;

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
// 🔴 2026-08-08 R2 must-fix:**不得**由 `PRODUCT_SELECT_DETAIL_VIEW` 組 —— 那個常數自本日起已含
//   `product_variants_public(id)`,再接一份 7 欄 embed 會讓**同一關係在同一 select 出現兩次**
//   (展開後 `…, product_variants_public(id), product_variants_public(id, sku, …)`)。
//   PostgREST 對未取別名的重複 embed 行為不確定:報錯 ⇒ findById/findByHandle 整條 throw = PDP 全掛;
//   或解析取到只有 id 的那份 ⇒ PDP `variants=[]`、`cart/actions.ts:168` 的 fail-closed 判斷失效、
//   變體商品以群代表價結帳。故本常數自己接 `card_image_trim`、繞開那個 embed。
const PRODUCT_SELECT_DETAIL_WITH_VARIANTS = `${PRODUCT_SELECT_DETAIL}, card_image_trim, product_variants_public(id, sku, spec, price_general, availability, images, sort_order)`;

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
  async listByCategory(
    category: CategoryPath,
    poolLimit: number,
  ): Promise<Product[]> {
    assertPositiveIntegerPoolLimit('listByCategory', poolLimit);

    const categoryId = await resolveCategoryId(this.supabase, category.raw);
    if (categoryId === null) {
      return [];
    }

    // 🔴 下一個方法(`listAllByCategory`)的註解**早就診斷完這個病**:逐字「listByCategory 走單次
    //    `.select()`、會撞 PostgREST/Supabase 的 `db-max-rows` 硬上限(品類超過該上限時靜默截斷)」。
    //    🔴 該上限 ~~原寫 1000~~ ⇒ **2026-08-18 實測 2000**(V 窗量、本檔改動者未自驗);
    //    **而這段論證與那個數字是多少無關** —— 它講的是「單次 select 會被伺服器靜默夾短」。
    //    ⇒ 兩個方法的**分工是對的**(取樣版 vs 全量版),缺的只是取樣版**沒有把上限講出來** ——
    //    於是它看起來像「全部」。實測 3 個分類破千(1,642 / 1,627 / 1,295,2026-08-17 anon 側 production)。
    const { data, error } = await this.supabase
      .from('products_public')
      .select(PRODUCT_SELECT_DETAIL_VIEW)
      .eq('category_id', categoryId)
      .order('handle', { ascending: true })
      .limit(poolLimit);

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
   * listByCategory 走單次 `.select()`、會撞 PostgREST/Supabase `db-max-rows` 硬上限(~~原寫「Max rows = 1000」~~ ⇒ **2026-08-18 實測 2000**,V 窗量、本檔改動者未自驗)
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
          .select(PRODUCT_SELECT_DETAIL_VIEW)
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
   * 同 listAllByCategory 的分頁迴圈(繞 PostgREST `db-max-rows` 上限;~~原寫「1000-row」~~ ⇒ 2026-08-18 實測 **2000**、`fetchAllPaginated` 共用),
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
      const base = this.supabase.from('products_public').select(PRODUCT_SELECT_DETAIL_VIEW);
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
        const base = this.supabase.from('products_public').select(PRODUCT_SELECT_DETAIL_VIEW);
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
   * 依 brand 列出 product,最多 `poolLimit` 筆。對齊 PRD §3.3 + supabase-schema-design.md §3.3。
   *
   * `brandId` 已是 UUID、不需 resolve(對齊 IProductRepository.listByBrand 簽名)。
   *
   * 🔴 **`.order('id')` 不是排版偏好,是讓「取哪 N 筆」變成決定性的** ——
   * 沒有 `order` 時 PostgREST 回哪幾列由 planner 決定,同一個查詢兩次可以不同
   * ⇒ 推薦內容會無故漂移,而那種漂移查不出原因。
   *
   * ⚠️ **為什麼不用同檔 `listAllProducts` 那個 `fetchAllPaginated`(撈完)**:
   * 撈完在這裡**做得到**(品牌最大 4,566 筆、5 頁),而**推薦引擎只吐個位數**
   * ⇒ 撈 4,566 筆完整列(帶 `images`/`description` jsonb)只為了挑 8 筆是淨浪費。
   * ⇒ 這裡要的是**明示的取樣**,不是撈完。**明示取樣與靜默截斷的差別是:前者寫在這一行、看得到。**
   */
  async listByBrand(
    brandId: string,
    poolLimit: number,
    categoryRaw?: string,
  ): Promise<Product[]> {
    assertPositiveIntegerPoolLimit('listByBrand', poolLimit);

    // 🔴 分類 filter【下推 DB】而不是拉回來再篩(2026-08-17 codex):
    //    找不到該分類 ⇒ 回 [](與 `listByCategory` 同慣例,不 throw)。
    let categoryId: string | null = null;
    if (categoryRaw !== undefined) {
      categoryId = await resolveCategoryId(this.supabase, categoryRaw);
      if (categoryId === null) {
        return [];
      }
    }

    const base = this.supabase
      .from('products_public')
      .select(PRODUCT_SELECT_DETAIL_VIEW)
      .eq('brand_id', brandId);
    const { data, error } = await (categoryId === null
      ? base
      : base.eq('category_id', categoryId))
      .order('handle', { ascending: true })
      .limit(poolLimit);

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
  async listByFitment(
    spec: FitmentSpec,
    poolLimit: number,
  ): Promise<Product[]> {
    assertPositiveIntegerPoolLimit('listByFitment', poolLimit);

    const rows = await queryProductsByFitment(
      this.supabase,
      spec,
      PRODUCT_SELECT_DETAIL_VIEW,
      poolLimit,
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
  async listGeneral(poolLimit: number): Promise<Product[]> {
    assertPositiveIntegerPoolLimit('listGeneral', poolLimit);

    const rows = await queryGeneralProducts(
      this.supabase,
      PRODUCT_SELECT_DETAIL_VIEW,
      poolLimit,
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

    // 🔴 `.order('id')` 不是排版,是**分頁正確性的前提**(2026-08-17 V 窗掃出、A 窗修)。
    //    SQL **沒有 ORDER BY 就不保證列的順序** —— 而本方法是分頁(`.range(offset, …)`),
    //    兩頁是**兩次獨立查詢**:planner 只要在兩次之間換了計畫(資料量變化、統計更新、
    //    parallel scan 與否),同一列就可能出現在兩頁、或一頁都沒出現。
    //    ⇒ 客人翻到第 2 頁看到第 1 頁看過的商品,或某個商品**任何一頁都翻不到**,
    //      而 `count` 照樣回報正確總數 ⇒ **畫面上完全正常**。
    //
    //    ⚠️ **我試過構造這個漂移,構造不出來**:對 production 用本方法的 filter
    //    (`title/subtitle/description` ILIKE)命中 13,945 筆、每頁 1,000 逐頁翻完 14 頁
    //    ⇒ **重複 0 筆、漏 0 筆**;同一頁連跑 4 次指紋相同。
    //    ⇒ **所以這一條是【結構性的】不是【觀察到的】** —— 今天的資料量與計畫下它剛好穩定,
    //      而「穩定」不是「保證」。**修它是預防,不是止血。**
    //
    //    選 `id`(PK uuid)而不是 `handle`:現況無排序 ⇒ 客人看到的順序本來就無語意,
    //    用 `id` 是**行為改變最小**的穩定序;改用 `handle` 會讓搜尋結果變成字母序 = 行為改變。
    const { data, error, count } = await this.supabase
      .from('products_public')
      .select(PRODUCT_SELECT_DETAIL_VIEW, { count: 'exact' })
      .or(filter)
      .order('id', { ascending: true })
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
        // 🔴 回讀走 base 表投影(無 embed)⇒ mapper 算出的 `variantCount` **恆為 0、不可信**,
        //   與 `domain/catalog/types.ts` 對該欄「必填且為真值」的契約不符。
        //   今天沒有正式呼叫點(grep 只有 in-memory 測試)所以是死路,不是現行 bug;
        //   **接線前先讓這條投影也帶 embed**,否則存檔回來的 Product 會謊稱「這款沒有變體」。
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
