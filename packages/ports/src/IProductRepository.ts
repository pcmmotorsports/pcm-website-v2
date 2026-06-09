import type {
  Product,
  ProductId,
  CategoryPath,
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
