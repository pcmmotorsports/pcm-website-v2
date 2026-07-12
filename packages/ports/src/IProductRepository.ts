import type {
  Product,
  ProductId,
  CategoryPath,
  CategorySummary,
  FitmentSpec,
  PaginationParams,
  Paginated,
} from '@pcm/domain';

/**
 * IProductRepository: 商品查詢 port。
 *
 * 對齊 ADR-0003 §3.3 — 介面方法簽名只出現 domain 命名、不允許 Medusa wire 字串 leak。
 * 實作:M-1-02 InMemoryProductRepository(test) + M-1-03 SupabaseProductAdapter(real)。
 */
export interface IProductRepository {
  findById(id: ProductId): Promise<Product | null>;
  /**
   * 依 handle(SEO URL slug)查單筆 product entity。
   *
   * Contract:
   * - handle UNIQUE、回對應 entity;不存在 → null(同 findById)
   * - detail 查詢:回完整 Product 含 variants(adapter embed product_variants_public、
   *   list 路徑不帶變體避 N+1;對齊 backlog #203 讀路徑接線)
   *
   * 用途:storefront 詳情頁路由 /products/[slug](slug = handle)、M-1-16c 接真資料。
   *
   * @see backlog #203(product_variants_public adapter 接線)
   */
  findByHandle(handle: string): Promise<Product | null>;
  /**
   * 依 category 列出 product。
   *
   * @TODO M-1-09/10 真實撞 5w SKU scale 時補 PaginationParams 簽名(對齊 backlog #20 + #51)
   */
  listByCategory(category: CategoryPath): Promise<Product[]>;
  /**
   * 依 category 列出 product —— 全量版(#220、/products 列表頁)。
   *
   * 與 listByCategory 差異:adapter 實作以 .order + .range 分頁迴圈繞過 PostgREST/Supabase
   * 「Max rows = 1000」硬上限、撈完整品類(非下架商品全量);listByCategory 留單次查
   * (featured 等只取前 N、不退化效能)。
   *
   * 🔴 stopgap:全量撈進 client(client filter/分頁)。多品牌(#212)目錄長大後須改
   * server-side 分頁/篩選(#51)、非長久解。
   */
  listAllByCategory(category: CategoryPath): Promise<Product[]>;
  /**
   * 列出**全目錄**非下架 product —— 全量、跨分類(接線 plan C4、#205)。
   *
   * 與 listAllByCategory 差異:不綁分類、撈整個公開目錄;adapter 實作以 .order('id') + .range
   * 分頁迴圈繞過 PostgREST/Supabase「Max rows = 1000」硬上限。/products 列表頁 + 首頁精選 +
   * sitemap 由此撈全站(解除舊「寫死單一分類『碳纖維部品』」、多品牌上架後客人可跨分類瀏覽)。
   *
   * RPM 零回歸:現況全站公開商品恰在單一分類「碳纖維部品」,故 listAllProducts()
   * 與 listAllByCategory({碳纖維部品}) 回傳等價;多品牌寫入後才多出其他分類商品。
   *
   * 🔴 stopgap:全量撈進 client(client filter/分頁)。多品牌(#212)目錄長大後須改
   * server-side 分頁/篩選(#51)、非長久解。
   *
   * `options.limit`(perf/P2、2026-07-08 效能修復 plan):選用、正整數。給定時回
   * **依 orderBy 排序後前 limit 筆**(兩實作同語意;Supabase 端下推 DB `.limit()` 免撈全表——
   * 首頁最新只要 4 筆、舊 stopgap 撈 3602 件 slice(0,4) 是首頁 TTFB 秒級主因之一);
   * 省略時行為不變(全量)。非正整數 → throw(fail-closed、程式錯誤即早爆)。
   *
   * `options.orderBy`(M-4a 前菜 D):選用、預設 `'id_asc'`=既有全站語意(穩定主鍵升冪);
   * `'created_desc'`=最新商品(created_at 遞減、id 遞減 tie-break 保定序),供首頁「最新商品」區用。
   * 省略時 byte 等價舊行為(既有 /products 目錄、sitemap 路徑不受影響)。
   *
   * @see docs/specs/2026-07-04-catalog-category-brand-frontend-wiring-plan.md C4
   * @see docs/specs/2026-07-08-storefront-perf-fix-plan.md P2
   * @see docs/specs/2026-07-12-m4a-admin-phase1-prd.md 前菜 D(首頁推薦改最新商品)
   */
  listAllProducts(options?: {
    limit?: number;
    orderBy?: 'id_asc' | 'created_desc';
  }): Promise<Product[]>;
  /**
   * 列出全部分類 + 各分類上架商品數(接線 plan C1)。
   *
   * Contract:
   * - 回分類註冊表**全部**分類(含 productCount = 0 的空分類);消費端(CategoryGrid /
   *   篩選側欄)自行決定是否過濾 count > 0(對齊品牌側 #220c「只渲染有真商品」由消費端做)
   * - `productCount` = 該分類下上架(delisted_at IS NULL)商品數;真 adapter 走
   *   products_public + RLS 天然只計上架品、絕不觸經銷價欄
   * - 排序:依 sortOrder 遞增(SupabaseProductAdapter);InMemory 為 use-case test 用途、
   *   由庫存 product 推導、DB-only 欄位為 degenerate 值(見 CategorySummary JSDoc)
   *
   * 用途:首頁真分類格 + /products 分類樹篩選(取代 data/mock-categories.ts);
   *   多品牌上架後客人可跨分類瀏覽(#147 / #205 / #220c)。
   *
   * @TODO 目錄長大後(#212 多品牌)per-category count 應改 server-side 聚合(view/RPC),
   *   非逐分類 count 查詢(對齊 backlog #51 / #247)。
   *
   * @see docs/specs/2026-07-04-catalog-category-brand-frontend-wiring-plan.md C1
   */
  listCategories(): Promise<CategorySummary[]>;
  /**
   * 依 brand 列出 product。
   *
   * @TODO M-1-09/10 真實撞 5w SKU scale 時補 PaginationParams 簽名(對齊 backlog #20 + #51)
   */
  listByBrand(brandId: string): Promise<Product[]>;
  /**
   * 依 fitment spec 列出 product(motoBrand + modelCode 配對)。
   *
   * @TODO M-1-09/10 真實撞 5w SKU scale 時補 PaginationParams 簽名(對齊 backlog #20 + #51)
   */
  listByFitment(spec: FitmentSpec): Promise<Product[]>;
  /**
   * 列出「通用款」product —— fitments 為空(設計上不綁任何車型、適用任何車)。
   *
   * 用途:推薦引擎最後補位 fallback(Case A/B 湊不滿上限時補通用零件、對齊
   * docs/specs/2026-07-08-recommendation-engine-related-products-plan.md §4)。
   *
   * Contract:
   * - 回 `fitments` 為空陣列(`[]`)的 product(真「通用」= 設計上不綁車型);
   *   fitments 非空但元素全髒(無法正規化)者**不算**通用(其意圖為特定車、僅資料髒)。
   * - 排自身 / 上限由呼叫端(推薦引擎)處理、非本方法;真 adapter 走 products_public
   *   + RLS(只回上架、經銷價物理排除)。
   *
   * @see docs/specs/2026-07-08-recommendation-engine-related-products-plan.md §4
   */
  listGeneral(): Promise<Product[]>;
  /**
   * 依關鍵字模糊搜尋 product entity、回分頁包。
   *
   * Contract:
   * - 字面 substring 比對(case-insensitive)、跨 name / subtitle / description / fitments[].motoBrand / fitments[].modelCode
   * - empty query(trim 後空字串)→ 回空 items + total = 0
   * - 結果依 params.limit + params.offset 分頁
   *
   * 性能(adapter 兩階段、對齊 ADR-0004 Q3=A1 + supabase-schema-design.md §2.5):
   * - M-1-03 main-b SupabaseProductAdapter 用 PG ILIKE 暫代(p99 1-3s @ 200 SKU、dev 期可接受)
   * - M-6 上線前切 PG tsvector + GIN + pg_jieba(p99 < 100ms @ 5w SKU、需 Supabase Pro)
   *
   * @see backlog #20(分頁簽名)
   * @see backlog #86(contract test、main-b/prep 補)
   */
  searchByKeyword(query: string, params: PaginationParams): Promise<Paginated<Product>>;
  /**
   * 儲存 product entity(create / update 統一入口)
   *
   * @param product 完整 Product entity(對齊 catalog/types.ts 7 欄位)
   * @returns 儲存後的 Product
   *
   * 對齊 ADR-0003 §3.3 ports 介面字面只出現 domain 命名 +
   * ADR-0004 Q4=A1 拍板 availability 走 save 改值(不抽 IInventoryRepository、對齊 backlog #33 Supersede)。
   *
   * 註:adapter 實作關注(樂觀鎖 / idempotency / audit trail)寫進對應 adapter class JSDoc、
   * 不在 port contract 字面(對齊 ADR-0003 §3.3「ports JSDoc contract vs adapter implementation TODO」規則、M-1-02-audit Q6 落地)。
   */
  save(product: Product): Promise<Product>;
}
