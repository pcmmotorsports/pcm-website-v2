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
  splitSearchTerms,
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
/**
 * RPC 那條路一次最多認幾個 id。
 *
 * 🔴 **它不是效能參數,是【偵測截斷】用的門檻**:PostgREST 有 `db-max-rows`(本 repo 實測 **2000**),
 *    而超過時它**靜默截斷**、回 HTTP 200 ⇒ 📌 **「剛好 2000 筆」與「被砍成 2000 筆」印同一個東西。**
 * ⇒ ✅ 所以要 `RPC_ID_CAP + 1` 筆:**拿回來超過 cap ⇒ 就知道被截了** ⇒ 退回舊路(它的 count 是 exact)。
 * ⚠️ 取 1000(嚴格小於 2000)⇒ 而**餘裕是【設定】給的不是這支碼保證的**:
 *    `db-max-rows` 若被改到 1000 以下,這道偵測就再次零判別力
 *    (同族警告見 `helpers/product-query-support.ts` 的 `PAGE_SIZE`)。
 */
const RPC_ID_CAP = 1000;

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
    /**
     * 排除「大類第一段 = 這個字」的商品(新品區排除維修零件;Sean 2026-08-27 拍【甲】)。
     *
     * 🔴 **顯式選項, 預設不排除** —— 本方法是共用的:`id_asc` 全量列表也走它。
     *   把排除塞進預設行為 = 改一個共用方法去修一個畫面, 而測試只會測那個畫面。
     * 🔴 **排除下推到 DB, 不在拿到列之後才濾** —— 濾完會少於 limit 筆,
     *   而畫面上「少了幾格」與「就是只有這麼多新品」長得一樣。
     */
    excludeCategoryFirstSegment?: string;
  }): Promise<Product[]> {
    const limit = options?.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
      throw new Error(`SupabaseProductAdapter.listAllProducts: limit 須為正整數、收到 ${limit}`);
    }

    // ── 排除大類:對【已經 embed 的 categories】過濾, 不另外查一輪 ──────────────
    // 🔴 `PRODUCT_SELECT_DETAIL` 的尾巴本來就有 `categories(raw_path, segments)`(:69)
    //   ⇒ `raw_path` 這一手上本來就有 ⇒ 不需要先查一輪 category_id 集合再 `not.in`。
    //   📌 我第一版就是那樣寫的, 而它【會動、會對】—— 只是多做了一件已經有人做過的事。
    //      那種多餘最不會被抓到:過三綠、過審查、過驗收, 只是多一次查詢。(cf 2026-08-27 指出)
    // 🔴 **`!inner` 少不得**:PostgREST 對 embed 欄過濾, 不加 `!inner` 只會把不符的 embed 變成 null,
    //   而【那一列照樣回來】⇒ 排除完全失效, 而畫面上與「沒有那麼多新品」長得一樣。
    // 🔴 **兩條條件, 不是一條**:大類本身(單段 `維修零件`)與它的子類(`維修零件 · X`)。
    //   只寫 `not.like '維修零件%'` 會多殺一個假想的「維修零件座」根類(現值 87 個分類裡沒有 —— cf 量的,
    //   而「今天沒有」不是「不會有」)。這與 RPC `:143` 自己那兩個分支同形。
    // ⚠️ **代價**:`!inner` 會讓 `category_id IS NULL` 的商品【整列消失】, 不是「不排除」。
    //   🔴 codex nit 訂正:上一版把它寫成【現存風險】—— 而 `products.category_id` 是 `NOT NULL`
    //     (`20260507222633:6`, 全 migrations 掃不到 `DROP NOT NULL`)⇒ **那個世界今天進不了門。**
    //     ⇒ 它要成為風險, 得先有人另做一支 schema migration 把 NOT NULL 拿掉。
    // 🔴 而【真正現存】的那個代價是另一個:`!inner` 的 embed 讀 `categories` 要過 RLS。
    //   政策若被收窄 ⇒ 整排新品【安靜消失】, 而那與「它們被排除了」在畫面上是同一句話。
    //   ⇒ migration 的斷言⑥ 盯這件事(而它只在 apply 當下燒一次 —— 天花板寫在那裡)。
    const excludeSeg = options?.excludeCategoryFirstSegment;
    // 🔴 用 replace 生出 `!inner` 版, **不複製那串 20 欄的投影** —— 複製一份就會漂。
    const selectCols = excludeSeg
      ? PRODUCT_SELECT_DETAIL_VIEW.replace('categories(', 'categories!inner(')
      : PRODUCT_SELECT_DETAIL_VIEW;
    const applyExclude = <T extends { not: (c: string, o: string, v: string) => T }>(q: T): T =>
      excludeSeg
        ? q.not('categories.raw_path', 'eq', excludeSeg).not('categories.raw_path', 'like', `${excludeSeg} · %`)
        : q;

    // 排序(前菜 D):'id_asc'=既有全站預設(單次 .order('id' 升冪)、byte 等價舊行為);
    //   'created_desc'=最新商品(created_at 遞減 + id 遞減 tie-break 保定序、防 created_at 撞值漂移)。
    //   鏈式 .order 直接串接(型別自然推導、不套自參照泛型 helper — supabase select→order 回傳型別不同)。
    const orderDesc = options?.orderBy === 'created_desc';

    if (limit !== undefined && limit <= 1000) {
      const base = this.supabase.from('products_public').select(selectCols);
      const filtered = applyExclude(base);
      const ordered = orderDesc
        ? filtered.order('created_at', { ascending: false }).order('id', { ascending: false })
        : filtered.order('id', { ascending: true });
      const { data, error } = await ordered.limit(limit);
      if (error) {
        throw error;
      }
      // 🔴 `as unknown as`:`selectCols` 是【動態組出來的字串】(為了那個 `!inner`)⇒
      //   supabase-js 只對【字面量】做欄位型別推導, 拿到 string 就退化成 GenericStringError[]。
      //   這一步不是「型別亂關」—— 執行期形狀與原本逐字相同, 差的只有 embed 的 `!inner`。
      return ((data ?? []) as unknown as SupabaseProductRow[]).map(mapSupabaseProductToDomain);
    }

    const rows = (await fetchAllPaginated(
      (from, to) => {
        const base = this.supabase.from('products_public').select(selectCols);
        const filtered = applyExclude(base);
        const ordered = orderDesc
          ? filtered.order('created_at', { ascending: false }).order('id', { ascending: false })
          : filtered.order('id', { ascending: true });
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
   * 兩步查詢與年份範圍重疊邏輯抽至 `helpers/fitment-queries.ts`(鐵則 6)。
   *
   * 🔴🔴 **[2026-09-01 訂正 · 線【帳號】`-7a`;主視窗 `-0a` 裁]**
   * ⛔ ~~prod 無 caller、行為以 contract + 兩實作測為準。~~ —— **那一句的【兩個宣稱都是假的】**:
   *
   * 🔴 **假一「prod 無 caller」** ——
   *   `apps/storefront/src/lib/recommendations/rule-based-engine.ts:131` 逐字
   *   `await this.repo.listByFitment(` ⇒ **推薦引擎在用它。這是一條【活的】路。**
   *   (🟢 正對照:同一把尺打 `listByBrand` ⇒ 7 個真呼叫, 而我濾掉了註解行。)
   *
   * 🔴 **假二「行為以 contract 為準」** ——
   *   那個 contract 是 `packages/ports/src/IProductRepository.contract.ts`, 而
   *   **`runProductRepositoryContract()` 全 repo 零真呼叫端** ⇒ 裡面 15 個 `it.todo`
   *   **從來沒有被 vitest 收集過, 連「skipped」都不會出現在報告裡**(見該檔檔頭)。
   *
   * 🛑 **而真正要記的是那兩句【互相支撐】**:
   *   「沒有人用它」讓「測試不嚴謹沒關係」聽起來合理;
   *   而「有 contract 守著」讓「沒有人用它」聽起來不重要。
   *   ⇒ ⇒ **兩句單獨看都像小事, 而合起來它們讓一條【活的推薦引擎查詢】變成沒有人會去看的地方。**
   *   ⇒ 所以它們**必須一起訂正** —— 拆掉任何一句, 另一句就撐不住。
   *
   * ✅ **今天真正在守它的是**:`InMemoryProductRepository.test.ts`(InMemory 那一層)
   *   與 `rule-based-engine.test.ts`(而那支測的是**引擎**, 它自己 stub 了一個 repo)。
   * ⚠️ **⇒ 所以【這支 Supabase 實作本身】今天沒有測試。**已開列, 而本片刻意不順手補它
   *   (那是範圍擴張;本片只補了 `listByBrand`, 見 `SupabaseProductAdapter.test.ts` 檔尾那一節)。
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
   * 注:ILIKE 特殊字符(`%` / `_`)經 `buildIlikeOrFilter` 轉義、避免使用者輸入觸發
   * unintended wildcard 行為。
   */
  async searchByKeyword(
    query: string,
    params: PaginationParams,
    opts?: { countTotal?: boolean },
  ): Promise<Paginated<Product>> {
    const q = query.trim();
    if (q === '') {
      return { items: [], total: 0 };
    }

    const offset = params.offset ?? 0;

    // ─────────────────────────────────────────────────────────────────────
    // ⟦搜尋-品牌⟧ 2026-09-03:**先問那支 RPC;它不在就走下面的舊路。**
    //
    // 🔴 **為什麼要有這條分岔**:客人打「rpm rsv4」今天回 **0 筆** —— 而那不是碼壞了:
    //    `rpm` 是**品牌名**、`rsv4` 是**車款名**,而**兩者都不在被搜的四欄裡**
    //    (正式庫實測:含 `rsv4` 346 / 含 `rpm` 149 / **交集 0** / 全站 22,804)。
    //    ⇒ 走 `brands` join 之後那個交集是 **41**。
    //
    // 🛑 **而那支函式今天【還沒被貼進正式庫】**(`20260903050000`,在等 Sean)
    //    ⇒ **本段的硬條件:函式不在的今天,客人看到的東西必須【逐字不變】。**
    //    ⇒ ✅ 判別句:**SQL 還沒貼的那一天,結果會【變差】,而不是【消失】。**
    //
    // 🔴 **偵測方式選【乙:每次查詢時判】,而不是【甲:開機探測一次】** ——
    //    · **甲的代價**:Sean 貼完 SQL **要等我們重新部署**才會生效
    //      ⇒ 而他半夜貼完看不到效果,會以為貼失敗(今晚已經有一次「照著驗會得到相反結論」)。
    //    · **乙的代價**:函式還沒貼的期間,**每一次搜尋多一發失敗請求**
    //      ⇒ 而那一發是 **404,很快**;且今天站上**零客人在搜尋**(2026-09-03 Vercel log 實測)
    //      ⇒ **今天這個代價的實際值是零。**
    //    ⇒ 🎯 **選乙 ⇒ 他貼下去的那一刻(schema cache 重載後)就會生效,不必等任何人。**
    //
    // 🔴🔴 **而「不在」只認【兩個具名的碼】,不是 try/catch 吞掉一切** ——
    //    吞掉一切會把**真的壞掉**也讀成「還沒貼」,然後**安靜地**給客人比較差的結果。
    //    兩個碼是**實測**的,不是查文件推的(2026-09-03 拋棄式 PostgREST):
    //    ```
    //    函式從來沒有過 / schema cache 重載後 ⇒ `PGRST202`(HTTP 404)  ← **正式站今天就是這個**
    //    函式被 DROP 而 cache 還沒重載        ⇒ `42883`
    //    ```
    //    ⚠️ 而 Sean 貼完到 PostgREST 重載 cache 之間**還會是 `PGRST202`** ⇒ 那段時間照樣走舊路,
    //      **重載之後自動生效** —— 這正是選乙換到的東西。
    const brandIds = await this.trySearchIdsWithBrand(q);
    if (brandIds !== null) {
      const wantCountRpc = opts?.countTotal !== false;
      // 🔴 `.in('id', …)` **不保證順序** ⇒ 自己排,才與舊路的 `.order('id')` 同序。
      const ordered = [...brandIds].sort();
      const pageIds = ordered.slice(offset, offset + params.limit);
      if (pageIds.length === 0) {
        return wantCountRpc ? { items: [], total: ordered.length } : { items: [] };
      }
      const { data: rows, error: rowsErr } = await this.supabase
        .from('products_public')                 // 🛑 投影與 mapper 一個字不動
        .select(PRODUCT_SELECT_DETAIL_VIEW)
        .in('id', pageIds)
        .order('id', { ascending: true });
      if (rowsErr) {
        throw rowsErr;
      }
      // 🔴 `rows` 可能是 `null`(PostgREST 允許)⇒ 收斂成空陣列,而**不是**讓它變成 TypeError。
      //    ⚠️ 而這裡收斂成空是安全的:上面已經確定 `pageIds` 非空 ⇒ 回空只代表那幾個 id 撈不到列,
      //      那是**資料不一致**而不是「沒有這條路」⇒ 它不該退回舊路, 也不該炸掉整個搜尋。
      const rpcItems = ((rows ?? []) as unknown as SupabaseProductRow[]).map(
        mapSupabaseProductToDomain,
      );
      return wantCountRpc ? { items: rpcItems, total: ordered.length } : { items: rpcItems };
    }

    // ⟦搜尋-多詞與料號⟧ 2026-09-03:**每個詞各組一組 `.or()`,詞與詞之間是 AND。**
    //
    // 🔴 **為什麼不是把整串包成一個 pattern**(那是修之前的行為):
    //    `%rpm rsv4%` 要求那八個字**照這個順序連在一起**出現在**同一欄**裡
    //    ⇒ 線上實測 `rpm rsv4` / `rsv4 油箱貼` / `gilles rsv4` **一律 0 件**,而單詞全中。
    //    Sean 2026-09-03 線上親自撞到這一發。
    //
    // 🔴 **「兩道 `.or()` 疊起來 = AND、括號各自保住」不是推論,是本 repo 實測過的**:
    //    `SupabaseOrderAdapter.ts` 錨「兩道 `.or()` 疊起來」(該檔兩處都記著),
    //    來源片0 = `docs/specs/2026-08-15-1-p0-postgrest-or-semantics.md`(commit `b4865c29`,
    //    **跑真 PostgREST 量的、不是讀文件推的**);同檔第二次對 PostgREST 14.16 複量亦同。
    //    ⇒ 語意:`(詞1 中在任一欄) AND (詞2 中在任一欄) AND …`
    //    ⇒ 📌 **一個詞可以中在標題、另一個中在料號** —— 每一組都含全部欄位就是為了這件事。
    //
    // ⚠️ **這裡【不做】相關性排序** —— 下方 `.order('id')` 是**穩定序**(分頁正確性),不是相關序。
    //    ⇒ 本次改動修的是「找不到」,**不是「排得好」**。排序整段在片 B(要新 RPC + migration)。
    const terms = splitSearchTerms(q);
    // 🔴🔴 **零詞 ⇒ 當成空查詢 fail-closed,絕不往下送**(codex 2026-09-03 對抗審查 MF1)。
    //
    // **為什麼上面那道 `q === ''` 短路擋不住它**:`trim()` 走 Unicode White_Space,
    // 而 **`U+200B`(零寬空格)不在那個集合裡** —— 實測 `'\u200B'.trim()` 仍是 `'\u200B'`
    // ⇒ 它通過空字串檢查、然後被 `TERM_SEPARATORS` 切成**零個詞**。
    // 同族:只打 `.` 或 `,` 或 `()` —— sanitize 把它們換成空白 ⇒ 一樣是零詞。
    //
    // 🛑 **少了這一格會發生什麼**:`terms.reduce(...)` 沒有東西可疊 ⇒ 回傳的是**沒有加任何
    // `.or()` 的 base query** ⇒ 送出去的是一句**完全沒有條件**的查詢
    // ⇒ **整張 `products_public` 的第一頁被當成「搜尋結果」回給客人**,
    //   而 `count: 'exact'` 會讓它順便去數**全表**。
    // ⇒ 📌 **失敗形狀是【成功】** —— HTTP 200、有結果、畫面看起來正常。
    if (terms.length === 0) {
      return { items: [], total: 0 };
    }

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
    // 🔵 `countTotal`(預設 true = 既有行為)。`count: 'exact'` 會讓 PG **數完整個命中集合**
    //    —— 而疊層那條路只顯示 8 筆、畫面上沒有印總數的地方 ⇒ 那一發是白付的。
    //    🛑 而 `/search` 要它(`app/search/page.tsx:85` 共 N 件)⇒ **分路,不是刪掉。**
    const wantCount = opts?.countTotal !== false;
    // 🛑 **`.from('products_public')` 不准換** —— 那張 view **物理上**就沒有
    //    `price_store` / 經銷價那些欄(PCM Server 端鐵則)。換成別的投影 =
    //    把一道實體隔離換成一個條件式 ⇒ 另案 + 對抗審查,不在本次射程。
    const base = this.supabase
      .from('products_public')
      .select(
        PRODUCT_SELECT_DETAIL_VIEW,
        wantCount ? { count: 'exact' } : undefined,
      );
    // 🔴 每個詞疊一道 `.or()` ⇒ 交集(AND);`terms` 為空在上面就已經 return 了。
    const filtered = terms.reduce(
      (qb, term) => qb.or(buildIlikeOrFilter(SEARCHABLE_COLUMNS, term)),
      base,
    );
    const { data, error, count } = await filtered
      .order('id', { ascending: true })
      .range(offset, offset + params.limit - 1);

    if (error) {
      throw error;
    }

    const items = (data as unknown as SupabaseProductRow[]).map(
      mapSupabaseProductToDomain,
    );
    // 🔴 沒要數的時候**回 `undefined` 而不是 0** —— 「不知道總數」與「共 0 件」是兩件事,
    //    而 `?? 0` 會讓畫面出現「拿到 8 筆卻說共 0 件」(`search.ts` 那段註解同一條)。
    return wantCount ? { items, total: count ?? 0 } : { items };
  }


  /**
   * 問那支「把品牌名也算進去」的 RPC。**它不在就回 `null`,由呼叫端走舊路。**
   *
   * 🔴 **【回傳的 error 物件】只有兩個具名的碼算「不在」** —— 其餘一律往上拋。
   *    吞掉一切會把**真的壞掉**讀成「還沒貼」,然後**安靜地**給客人比較差的結果,
   *    而那個安靜正是這一片最該避免的東西。
   * 🛑 **而【throw 出來的】一律吞成走舊路,不分是哪一種** —— 這一句 2026-09-03 才補,
   *    ⛔ ~~原文只寫「其餘一律往上拋」~~,而那句話當時**對 throw 那一半是假的**:
   *    退路只接得住回傳的 error 物件,而正式站掛掉那次丟的是 `TypeError`
   *    ⇒ 它穿過整條退路、`/api/search` 回 503(11 次)。
   *    ⚠️ **代價照實記**:權限錯 / 網路斷 / 逾時若是 throw 來的, 現在會**靜靜降級走舊路**,
   *    只留一行 `console.warn`。⇒ **這是刻意的取捨** —— 客人搜得到(結果差一點)
   *    優先於「讓錯誤大聲」。要改回大聲, 就得先有一條不會讓整站搜尋 503 的路。
   * 🔵 兩個碼是**實測**的(2026-09-03 拋棄式 PostgREST,兩個世界各打一發):
   *    `PGRST202`(HTTP 404,函式從來沒有過 / schema cache 剛重載)· `42883`(被 DROP 而 cache 還沒重載)。
   * ⚠️ **回傳 `null` = 「今天沒有這條路」;回傳 `[]` = 「這條路走過了,而它一筆都沒找到」** ——
   *    兩者**不可**收斂成同一個東西:前者要走舊路,後者要直接回空。
   */
  private async trySearchIdsWithBrand(q: string): Promise<string[] | null> {
    const terms = splitSearchTerms(q);
    if (terms.length === 0) {
      return null; // 零詞 ⇒ 交回舊路,由它那道 fail-closed 處理
    }
    // 🔴🔴 **這個 cast 是【刻意】的,而它本身就是一個訊號** ——
    //    `database.types.ts` 是**從已部署的 schema 生成的**,而這支函式**還沒被貼**
    //    ⇒ 生成型別裡沒有它 ⇒ 具名 `.rpc()` 編譯不過。
    //    📌 **⇒ 編譯器在說一件真話:「你要叫的東西,今天不在那個資料庫上。」**
    //    ✅ **移除條件寫在這裡,免得它變成永久的縫**:
    //       Sean 貼完 `20260903050000` 之後**重新生成 `database.types.ts`**,
    //       這個 cast 就要拿掉、改回具名 `.rpc()`(形狀抄 `payment-repository.ts` 檔頭那段
    //       「型別縫已拆」——那支就是這樣把 cast 收掉的)。
    //    🛑 而 cast 只擋住編譯器,**擋不住執行期**:所以下面那兩個具名錯誤碼與形狀檢查
    //       **一格都不能省** —— 它們才是真正的把關。
    // 🔴 **`rpc` 本身不在也算「今天沒有這條路」** —— 而這一格是既有測試逼出來的:
    //    我加完之後 5 格既有測試當場紅, 成因是它們的 mock client **沒有 `rpc`**。
    //    ⇒ 而我沒有去改那 5 個 mock, 因為**那會把一個真的問題改掉**:
    //      若哪天 client 真的沒有 `rpc`(換 SDK / 注入了別的東西), 這裡應該**退回舊路**,
    //      而不是讓整個搜尋 500。⇒ 📌 **同一條原則:結果會變差, 不是消失。**
    if (typeof (this.supabase as { rpc?: unknown }).rpc !== 'function') {
      return null;
    }
    // 🔴🔴 **2026-09-03 正式站故障修復 —— 這裡原本把方法【從物件上拆下來】**:
    //    ⛔ ~~`const rpc = this.supabase.rpc as unknown as (…)` 然後 `rpc(fn, args, {from, to})`~~
    //    🛑 `SupabaseClient.rpc()` 內部是 `return this.rest.rpc(…)` ⇒ 拆下來之後 `this` 是
    //       `undefined` ⇒ 執行期丟 `TypeError: Cannot read properties of undefined (reading 'rest')`。
    //    🔬 實錘(Vercel runtime errors,`dpl_6TSmVSKzeo25kXnyUHMR1JXfWrnD`,首次 2026-09-03T02:12:34Z,
    //       11 次,routes `/search` `/api/search`):正式站搜尋 **HTTP 503 `search_failed`**;
    //       🟢 正對照 首頁同時 200 ⇒ 不是整站掛。
    //    ⇒ ✅ **改回在物件上呼叫**(cast 的是**整個 client**,不是那個方法)——
    //       呼叫點在結構上就是 method call ⇒ `this` **不可能**再掉一次,
    //       而且不需要有人記得補 `.bind()`。(code-reviewer important 5)
    //
    // 🔴 **而這裡原本【還有第二個錯】,它被第一個蓋住了**:
    //    ⛔ ~~第三個參數傳 `{ from, to }`~~ —— **`rpc()` 的第三參是 `{head, get, count}`**
    //    (實查 `@supabase/supabase-js@2.105.3` 的 `dist/index.d.mts:536`,不是憑記憶)。
    //    ⇒ 那個物件會被**當成 options 靜靜忽略** ⇒ **`.range()` 從來沒有生效過**
    //    ⇒ 📌 而 `:711` 的註解自己寫著「要帶 `.range()`」—— **碼與註解不一致, 而註解是對的。**
    //    ✅ `rpc()` 回的是 `PostgrestFilterBuilder`(同上 `:536` 的回傳型別)⇒ `.range()` 掛在它身上。
    const sb = this.supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => {
        range: (from: number, to: number) => PromiseLike<{
          data: unknown;
          error: { code?: unknown } | null;
        }>;
      };
    };
    // 🔴🔴 **要帶 `.range()`,否則吃 PostgREST 的 `db-max-rows`(本 repo 實測 2000)**
    //    ⇒ 寬查詢會被**靜默截成 2000 筆** ⇒ `共 N 件` 印 2000、第 81 頁之後翻不到,
    //      而**失敗形狀是 HTTP 200、畫面完全正常**(code-reviewer must-fix;同檔另一支 SETOF RPC 記過同一格)。
    //    ✅ 取 `RPC_ID_CAP + 1`:**多要一筆就是那把尺** —— 拿回來的筆數超過 cap ⇒ 我知道被截了。
    // 🔴🔴 **`try` 是這一片的第二個修法, 而它與 `this` 那個【一樣重要】**:
    //    下面 `if (error)` 那整段退路**只接得住【回傳的 error 物件】**。
    //    🛑 而上面那個 `TypeError` 是 **`throw` 出來的** ⇒ **穿過整條退路** ⇒ 整個搜尋 503。
    //    📌 **⇒ 我在 `:693-698` 寫過「結果會變差, 不是消失」—— 那句話在這一格上【沒有成立】,
    //       而當時測試全綠。** 一道只接住其中一種失敗形狀的退路, 在另一種形狀上等於不存在。
    //    ✅ 任何從 RPC 那條路丟出來的東西 ⇒ 記一行 ⇒ **退回舊路**, 不讓它上升成 500/503。
    let data: unknown;
    let error: { code?: unknown } | null;
    try {
      ({ data, error } = await sb
        .rpc('storefront_search_product_ids', { p_terms: terms })
        .range(0, RPC_ID_CAP));
    } catch (thrown) {
      console.warn(
        '[searchByKeyword] storefront_search_product_ids 那條路 throw 了 ⇒ 退回舊路:',
        thrown,
      );
      return null;
    }
    if (error) {
      const code = typeof error.code === 'string' ? error.code : '';
      if (code === 'PGRST202' || code === '42883') {
        // 🔴🔴 **要留一行訊號** —— `PGRST202` 同時代表兩件事(code-reviewer must-fix):
        //    ①函式**還沒貼**(預期中,今天就是這個)②**貼了,而函式名或參數名打錯**
        //    ⇒ 兩個世界**印同一個碼、同一個安靜** ⇒ Sean 貼完會看不出到底接上了沒。
        //    ⇒ ✅ 一行 `warn` 讓第二種在 log 裡有形狀;而它**不影響客人**(照樣走舊路)。
        console.warn(
          `[searchByKeyword] storefront_search_product_ids 叫不到(${code})⇒ 退回舊路;` +
            '若 SQL 已經貼了, 請檢查函式名與參數名 p_terms',
        );
        return null;
      }
      throw error; // 🔴 其餘是真的錯 ⇒ 不吞
    }
    if (!Array.isArray(data)) {
      return null;
    }
    // 🔴 逐列驗形狀,不信 cast:函式的契約是 `TABLE(id uuid)`,而**收到別的形狀代表契約變了**。
    const rows = data as unknown[];
    const ids = rows
      .map((row) =>
        typeof row === 'object' && row !== null && 'id' in row
          ? (row as { id: unknown }).id
          : null,
      )
      .filter((id): id is string => typeof id === 'string' && id !== '');

    // 🔴🔴 **契約變了(`id` 改名或換型別)⇒ 上面會把【每一列】都過濾掉 ⇒ `ids` 是空的**
    //    ⇒ 而空陣列在呼叫端被讀成「**走過了而一筆都沒找到**」⇒ **客人恆得 0 筆,且不退回舊路。**
    //    📌 那正好違反本檔宣稱的那個區分(`null` = 沒有這條路 · `[]` = 走過了沒找到)
    //    ⇒ ✅ 判別句:**回了列、卻一列都認不得 ⇒ 那不是「沒找到」,那是「我看不懂它回什麼」**
    //      ⇒ 當成「沒有這條路」退回舊路(code-reviewer must-fix)。
    if (rows.length > 0 && ids.length === 0) {
      console.warn(
        '[searchByKeyword] storefront_search_product_ids 回了列而一列都認不得(契約可能變了)⇒ 退回舊路',
      );
      return null;
    }
    if (ids.length > RPC_ID_CAP) {
      // 🛑 被 `db-max-rows` 截斷 ⇒ **不要拿一份殘缺的清單當全部** ⇒ 退回舊路(它的 count 是 exact)
      console.warn(
        `[searchByKeyword] storefront_search_product_ids 回超過 ${RPC_ID_CAP} 筆 ⇒ 可能被截斷 ⇒ 退回舊路`,
      );
      return null;
    }
    return ids;
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
