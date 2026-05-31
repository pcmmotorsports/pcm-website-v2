import {
  toMoneyAmount,
  type Brand,
  type CategoryPath,
  type Currency,
  type FitmentSpec,
  type Money,
  type Product,
  type ProductAvailability,
} from '@pcm/domain';

/**
 * Supabase products row schema(對齊 docs/architecture/supabase-schema-design.md §2.1)。
 *
 * JOIN 結果(走 `.select(PRODUCT_SELECT_DETAIL)` 在 SupabaseProductAdapter):
 * - `brands`: 對應 brands 表 row 或 null
 * - `categories`: 對應 categories 表 row 或 null
 *
 * 對齊 ADR-0003 §3.4 wire 字串紀律:本 type 是 wire 字面、只在 mapper 邊界出現、
 * 不 leak 至 domain / ports / use-case。
 */

export type SupabaseBrandRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  /** premium 店家加碼 %(0-30、預設 0、NOT NULL、對齊 schema doc §3.1)。 */
  premium_extra_pct: number;
  created_at: string;
  updated_at: string;
};

export type SupabaseCategoryRow = {
  id: string;
  parent_category_id: string | null;
  name: string;
  raw_path: string;
  segments: string[];
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type SupabaseProductRow = {
  id: string;
  external_id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  handle: string;
  /**
   * price_by_tier jsonb(雙寫過渡期 source of truth)。
   *
   * optional:M-1-05 刀 2 Sub-slice 2-3 起、5 read method 走 products_public view、
   * view 排除 price_by_tier;僅 save 路徑 mapDomainProductToSupabase 寫此欄。
   */
  price_by_tier?: {
    general: { amount: number; currency: Currency };
    store: { amount: number; currency: Currency };
  };
  /**
   * 公開售價(TWD 元位整數)。products_public view + base products 表皆投射、
   * read 路徑唯一取價來源(M-1-05 刀 2 Sub-slice 2-1 新欄、nullable:NOT NULL
   * 推遲至雙寫穩定後另開 migration、對齊 migration 註解)。
   */
  price_general: number | null;
  /**
   * 經銷敏感價(TWD 元位整數)。view 永遠排除、僅 save 路徑寫入;
   * read 投射(PRODUCT_SELECT_DETAIL)不含此欄 → optional。
   */
  price_store?: number | null;
  fitments: FitmentSpec[];
  images: string[];
  availability: ProductAvailability;
  brand_id: string | null;
  category_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  brands: SupabaseBrandRow | null;
  categories: SupabaseCategoryRow | null;
};

/**
 * wire row → domain Product(對齊 docs/specs/M-1-03-main-b-PRD.md §4.1 +
 * docs/architecture/supabase-schema-design.md §2.2)。
 *
 * 還原規則:
 * - `title` → `name`(wire title、domain name)
 * - `brands` JOIN → `Brand` value-object(id + name + slug)
 * - `categories` JOIN → `CategoryPath` value-object(raw_path → raw、segments 直送)
 * - `price_general`(integer)→ `priceByTier.general`(過 `toMoneyAmount` guard);
 *   `priceByTier.store` 走 dummy、`priceByTier.premiumStore` 走 placeholder
 *   (M-1-05 刀 2 Sub-slice 2-3、見函式內取價註解)
 *
 * @throws 若 `brands` / `categories` JOIN 為 null(資料完整性違反、不 silent ignore)
 * @throws 若 `price_general` 為 null(雙寫過渡期缺欄、不 silent 補 0)
 */
export function mapSupabaseProductToDomain(row: SupabaseProductRow): Product {
  if (!row.brands) {
    throw new Error(`Product ${row.id} missing brand JOIN`);
  }
  if (!row.categories) {
    throw new Error(`Product ${row.id} missing category JOIN`);
  }

  // premium_extra_pct: 保留 ?? 0 防 row 為舊資料(SELECT 擴後 + 刀 3 migration 補丁後保證有值、但歷史 query 結果可能未含、保 fallback)
  const brand: Brand = {
    id: row.brands.id,
    name: row.brands.name,
    slug: row.brands.slug,
    premium_extra_pct: row.brands.premium_extra_pct ?? 0,
  };

  const category: CategoryPath = {
    raw: row.categories.raw_path,
    segments: row.categories.segments,
  };

  // 取價(M-1-05 刀 2 Sub-slice 2-3、對齊 Sean 兩題拍板):
  //   - general:從 products_public view + base products 表共有的 price_general 欄讀
  //     (view 排除 price_by_tier jsonb、price_general 為 read 路徑唯一公開取價來源)
  //   - store:5 read method + save 的 select 投射皆排除 price_store(經銷敏感)→ 走 dummy
  //   - premiumStore:placeholder(domain Product.priceByTier 三 key 必填、Q2-clarify=A1
  //     拍板不 narrow domain);真實 premiumStore 顯示價由 storefront computeEffectivePrice
  //     依 brand.premium_extra_pct 動態算
  if (row.price_general === null) {
    throw new Error(
      `Product ${row.id} missing price_general (M-1-05 雙寫過渡期、save 路徑應已雙寫、缺欄表示 seed 或既有 row 漏遷移)`,
    );
  }
  const general: Money = toMoney({ amount: row.price_general, currency: 'TWD' });

  // store dummy(amount 0 / TWD)。
  // TODO M-2-08:IPricingService 落地後、tier-aware 取價改走 server-side pricing
  //   endpoint(讀 base 表 price_store / price_by_tier)、本 dummy 退場。
  const store: Money = { amount: toMoneyAmount(0), currency: 'TWD' };

  // premiumStore placeholder(對齊 Q2-clarify=A1:mapper 端構造 placeholder、
  //   真值由 computeEffectivePrice 在 storefront dispatch 時覆蓋)。
  const premiumStore: Money = { amount: toMoneyAmount(0), currency: 'TWD' };

  return {
    id: row.id,
    name: row.title,
    brand,
    category,
    fitments: row.fitments,
    priceByTier: { general, store, premiumStore },
    description: row.description ?? '',
    images: row.images,
    availability: row.availability,
    handle: row.handle,
    subtitle: row.subtitle ?? '',
    // M-1-16a:variants 必填、read 路徑暫填空陣列;真讀變體 16c 接 product_variants_public
    //   (mapVariantRow embed、backlog #203)。products_public detail 投射本片不含 variants。
    variants: [],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * domain Product → wire row(寫部分、對齊 docs/specs/M-1-03-main-b-PRD.md §4.2)。
 *
 * 對應規則:`name` → `title`、`subtitle` / `description` empty string → null、`Date` → ISO string。
 *
 * 雙寫(M-1-05 刀 2 Sub-slice 2-3):同時寫 `price_by_tier` jsonb + `price_general`
 * + `price_store` 兩 integer 欄;jsonb 為雙寫過渡期 source of truth、整 row 單次
 * upsert(Postgres atomic)、無「寫一邊漏一邊」中間態。
 *
 * 注(本 mapper 偏離 spec、本 sub-slice commit body 揭示):
 * - `external_id` Phase 1 用 domain `id` 作同步(Phase 2 vendor crawler 落地時改寫)
 * - `metadata` Phase 1 寫 `{}`(Phase 2 vendor crawler / sync-engine 用)
 * - 不寫 `brands` / `categories` JOIN object(upsert 後 SELECT 重 JOIN 還原)
 */
export function mapDomainProductToSupabase(
  domain: Product,
  ids: { brandId: string; categoryId: string },
): Omit<SupabaseProductRow, 'brands' | 'categories'> {
  return {
    id: domain.id,
    external_id: domain.id,
    title: domain.name,
    subtitle: emptyToNull(domain.subtitle),
    description: emptyToNull(domain.description),
    handle: domain.handle,
    price_by_tier: {
      general: {
        amount: domain.priceByTier.general.amount,
        currency: domain.priceByTier.general.currency,
      },
      store: {
        amount: domain.priceByTier.store.amount,
        currency: domain.priceByTier.store.currency,
      },
    },
    // 雙寫:price_general / price_store 兩 integer 欄(從 priceByTier 拆 amount);
    // 與上方 price_by_tier jsonb 同一 row、單次 upsert atomic 落地。
    price_general: domain.priceByTier.general.amount,
    price_store: domain.priceByTier.store.amount,
    fitments: domain.fitments,
    images: domain.images,
    availability: domain.availability,
    brand_id: ids.brandId,
    category_id: ids.categoryId,
    metadata: {},
    created_at: domain.createdAt.toISOString(),
    updated_at: domain.updatedAt.toISOString(),
  };
}

function toMoney(wire: { amount: number; currency: Currency }): Money {
  return {
    amount: toMoneyAmount(wire.amount),
    currency: wire.currency,
  };
}

function emptyToNull(s: string): string | null {
  return s === '' ? null : s;
}
