import type { Money, MemberTier } from '../shared/types';

export type ProductId = string;

/**
 * Brand: 商品所屬廠牌(value-object)。
 *
 * 對齊 ADR-0003 §4 #1:
 * - design 字面是 string('CNC RACING')
 * - Medusa wire 是 brand collection FK(brand_id)
 * - domain 用 value-object;adapter 邊界雙向 resolve FK ↔ name
 *
 * 範例:Brembo / CNC RACING / Öhlins / Akrapovič / RIZOMA / Kineo / Materya
 * (歐洲改裝零件廠商;非車輛廠牌、車輛廠牌見 FitmentSpec.motoBrand)
 */
export type Brand = {
  id: string;
  /** 對外顯示名稱、design 字面、例:'CNC RACING' */
  name: string;
  /** URL slug、例:'cnc-racing' */
  slug: string;
  /**
   * premium 店家 tier 在 store 價上的加碼折扣 %(0-30、預設 0 = 不加碼)。
   *
   * 對齊 supabase-schema-design.md §3.1 brands.premium_extra_pct +
   * M-1-03-post-supplement Pricing 公式。
   *
   * storefront 公式:
   *   `premiumStore` 顯示價 = round(priceByTier.store.amount × (1 - premium_extra_pct / 100))
   *
   * 字面慣例:snake_case `premium_extra_pct`(對齊 schema + design 字面、不用 camelCase)。
   */
  premium_extra_pct: number;
};

/**
 * CategoryPath: 商品分類路徑(value-object)。
 *
 * 對齊 ADR-0003 §4 #2:
 * - design 字面是 string('引擎部品 · 排氣管')
 * - Medusa wire 是 category 樹(parent_id 巢狀)
 * - domain 用 value-object;adapter 邊界 parse 字串 ↔ 樹節點
 *
 * `segments` 為 `raw` 解析結果(以「·」與全形空格分隔);
 * 解析 helper 在 M-1-02 補(本 slice 為 type-only stub)。
 *
 * @see M-1-02 補解析 helper
 */
export type CategoryPath = {
  /** 例:'引擎部品 · 排氣管' */
  raw: string;
  /** 例:['引擎部品', '排氣管'] */
  segments: string[];
};

/**
 * FitmentSpec: 商品適配車型(value-object array element)。
 *
 * 對齊 ADR-0003 §4 #3 + ADR-0004 wrs Q1=A1:
 * - design 字面是自由字串('CBR600RR'、`string.includes` 比對)
 * - Medusa wire 是 metadata.vehicle_ids[]
 * - domain 用結構化 value-object;adapter 邊界斷詞自由字串 → 結構化
 *
 * `motoBrand`(車輛廠牌口語名)為 string、與 catalog `Brand`(商品廠牌)語意分離;
 * M-1 storefront 寫 VehicleFinder / FilterSide 時若需結構化、可升級為 MotoBrand value-object。
 *
 * 年份範圍(對齊 ADR-0004 wrs Q1=A1、wrs.it IA 報告 §5):
 * - `yearStart` / `yearEnd` 雙欄位、對應 Sean 真實業務報價單格式("2018-2024" / "2025+")
 * - `yearEnd` 為 `null` 表示開放式範圍(例:"2025+" → yearStart=2025, yearEnd=null)
 * - `yearEnd` 為 undefined / 同 `yearStart` 表示單年(例:"2024" → yearStart=2024, yearEnd=2024)
 *
 * @see M-1 升級 MotoBrand value-object
 * @see docs/architecture/medusa-schema-design.md §2.4(adapter 邊界 fitmentToWireString / parseWireFitment 雙向 mapping)
 */
export type FitmentSpec = {
  /** 車輛廠牌口語名(例:'Yamaha' / 'Honda' / 'Ducati')、非商品廠牌 */
  motoBrand: string;
  /** 車型代號(例:'CBR600RR' / 'MT-09') */
  modelCode: string;
  /** 適用年份起(例:2018);若無年份限制可省略 */
  yearStart?: number;
  /** 適用年份迄;`null` = 開放式範圍("2025+");同 yearStart = 單年 */
  yearEnd?: number | null;
};

/**
 * ProductAvailability: 商品 availability 字面 union(M-1-02-audit L1 抽 type alias)。
 *
 * 對齊 ADR-0003 §3.2 enum 業務語意精神 + ADR-0004 Q4=A1 拍板訂貨型業務:
 * - `'in-stock'`:可訂(現貨 / 廠商 3-6 週訂貨範圍內)
 * - `'out-of-stock'`:訂不到(廠商停產 / 報價無 / 客服自行協調)
 *
 * 跨 layer 共用:catalog Product.availability(domain)、admin UI tier badge(M-4a)、
 * sync-engine 上架 pipeline 寫入(M-5-03)、storefront ProductCard / ProductPage 顯示
 * (M-1-06 / M-1-13)、Order 不直接引用(訂單下單時才 snapshot 價 + 庫存決定、
 * 不存 availability 字面)。
 *
 * 對齊 ADR-0003 §3.2 規範「entity 內 string literal union ≥ 2 個 consumer 必抽 type alias」
 * (M-1-02-audit Q3 規範類落地)。
 */
export type ProductAvailability = 'in-stock' | 'out-of-stock';

/**
 * PriceByTier: 三級會員多 tier 價格(keyed-map struct)。
 *
 * 對齊 ADR-0003 §4 #6:
 * - design 字面只一個 price 欄位
 * - Medusa wire 是 Price List(多 tier)
 * - domain 用 keyed-map 結構
 *
 * 註:ADR §4 #6 字面是 `Map<MemberTier, Money>`、本實作為 Record(JSON 序列化友善、
 * storefront server-side render 不需 hand-roll Map serializer);兩者語意等價。
 */
export type PriceByTier = Record<MemberTier, Money>;

/**
 * ProductVariant: 商品變體(entity sub-object、M-1-16a 落地 backlog #81 A 真變體)。
 *
 * 對齊:
 * - #81 真變體拍板(RPM 一商品 ~24 變體:紋路 weave × 表面 finish × special、
 *   各自料號 sku / 價 / 庫存 / 圖)。
 * - DB product_variants 表(supabase/migrations/20260531142533_init_product_variants.sql)。
 *
 * 取價(Q5=A、鏡像 Product):DB 只存 price_general + price_store 兩整數欄、不存 price_by_tier;
 *   adapter mapper(16c mapVariantRow、backlog #203)從兩欄重組 priceByTier(general 從
 *   price_general、store dummy、premiumStore placeholder、與 mapSupabaseProductToDomain 同法)。
 *   domain 層統一用 priceByTier(與 Product 一致)。
 *
 * spec:自由 key-value(可擴 N 層);RPM = {weave, finish, special}(審查證來源
 *   non_string spec values = 0、故 Record<string, string>)。
 *
 * @see packages/adapters/src/supabase/mappers/product.ts(16c mapVariantRow)
 * @see docs/phase-1-backlog.md #81(variants 落地)/ #203(adapter 接線待 16c)
 */
export type ProductVariant = {
  id: string;
  /** 變體料號(原始 sku、join key、全表 UNIQUE) */
  sku: string;
  /** 規格自由 key-value(例:{ weave: '3K', finish: 'Glossy', special: '12K' }) */
  spec: Record<string, string>;
  /** 三級會員多 tier 價(domain 統一 priceByTier;DB 兩整數欄 mapper 重組) */
  priceByTier: PriceByTier;
  /** 變體 availability(對齊 ProductAvailability、與 Product 同 union) */
  availability: ProductAvailability;
  /** 變體圖 URL 陣列;無圖時 16c fallback 商品群代表圖(Q3=C) */
  images: string[];
  /** 排序權重(DB sort_order、預設 0) */
  sortOrder: number;
};

/**
 * Product: 商品 entity(M-1-02 擴 7 欄位、對齊 ADR-0004 Q1=A2 拍板)。
 *
 * 對齊 ADR-0003 §3.1 命名規則(camelCase + 業務語意);
 * 對齊 ADR-0004 Q1=A2(本 slice 擴 description / images / availability / handle / subtitle / createdAt / updatedAt 7 欄位)、Q4=A1(availability 'in-stock' | 'out-of-stock'、不顯示數字、訂貨型業務)、Q2=A2(images URL string、上傳走 Supabase Storage 由 M-1-13 / M-1-16 落地)。
 *
 * 本 slice(M-1-16a)落地:
 * - variants:ProductVariant[](backlog #81 A 真變體);read 路徑接 product_variants_public 留 16c(#203)
 *
 * 推延欄位(本 slice 不補):
 * - inventoryQuantity:M-1-02 Q4=A1 拍板不做(訂貨型業務不需數字)、見 backlog #33 Supersede 註
 * - SEO metadata(M-1-09 補)
 *
 * @see docs/architecture/medusa-schema-design.md §2 Product
 * @see docs/decisions/0003-domain-entity-naming.md §4 #1 brand / #2 category / #3 fits / #6 priceByTier
 * @see docs/decisions/0004-m1-pre-launch-decisions.md(本 slice Q1 / Q2 / Q4 拍板擴欄位)
 * @see docs/phase-1-backlog.md #33(Supersede 註不抽 IInventoryRepository)、#81(variants spike)
 */
export type Product = {
  // 既有 6 欄位(M-0-04 / M-0-10b 落地、本 slice 不動)
  id: ProductId;
  name: string;
  brand: Brand;
  category: CategoryPath;
  fitments: FitmentSpec[];
  priceByTier: PriceByTier;

  // 本 slice Q1=A2 擴 7 欄位:
  /** 商品描述、純文字 / Markdown 後續決定 */
  description: string;
  /** 商品圖片 URL 陣列、來源含廠商 URL 與 Supabase Storage 上傳(對齊 ADR-0004 Q2=A2、上傳機制 M-1-13 / M-1-16 落地) */
  images: string[];
  /**
   * 商品 availability(對齊 ProductAvailability type alias、跨 layer 共用)
   *
   * 對齊 PCM 訂貨型業務(商品基本無庫存、需訂貨 3-6 週)、不顯示數字。
   * 不抽 IInventoryRepository(對齊 ADR-0004 Q4=A1 拍板 + backlog #33 Supersede)、availability 變動走 IProductRepository.save 改值。
   */
  availability: ProductAvailability;
  /** SEO URL slug、kebab-case、例:'akrapovic-titanium-full-exhaust'(M-1-09 SEO slice 用) */
  handle: string;
  /** 商品副標、例:'適用 Panigale V4 / 2018-2024 / 輕量化 35%'(M-1-13 ProductPage 顯示) */
  subtitle: string;
  /**
   * 商品變體(M-1-16a 落地 #81 A 真變體;無變體商品為空陣列 [])。
   *
   * read 路徑接 product_variants_public view 留 16c(adapter mapVariantRow、backlog #203);
   * 16a 各 Product 建構點(mapper / test factory)先填 [](型別接通、真讀變體 16c)。
   */
  variants: ProductVariant[];
  /** entity 建立時間(adapter 邊界從 wire mapper 填) */
  createdAt: Date;
  /** entity 最後更新時間(adapter 邊界從 wire mapper 填、對齊 IProductRepository.save 樂觀鎖 trigger M-1-03) */
  updatedAt: Date;
};
