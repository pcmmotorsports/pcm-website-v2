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
 * JOIN 結果(走 `.select(PRODUCT_SELECT)` 在 SupabaseProductAdapter):
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
  price_by_tier: {
    general: { amount: number; currency: Currency };
    store: { amount: number; currency: Currency };
  };
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
 * - `price_by_tier` amount(integer)→ `MoneyAmount` brand type(過 `toMoneyAmount` guard)
 *
 * @throws 若 `brands` / `categories` JOIN 為 null(資料完整性違反、不 silent ignore)
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

  return {
    id: row.id,
    name: row.title,
    brand,
    category,
    fitments: row.fitments,
    // priceByTier(wire-only narrow、sub 8a 落地):
    //   - wire 層 price_by_tier 二 key(general / store)、對齊 schema doc §2.1 CHECK 二 key + 刀 3 migration 落地
    //   - premiumStore tier 由 domain layer computeEffectivePrice 動態算(store × (1 - brand.premium_extra_pct / 100))
    //   - domain Product.priceByTier 保留三 key Record<MemberTier, Money>(Q2-clarify=A1 拍板、不 narrow domain)
    //   - mapper 端 premiumStore key 構造 placeholder Money({amount: 0, currency: store.currency})、由 computeEffectivePrice 在 storefront 端 dispatch 時覆蓋
    priceByTier: {
      general: toMoney(row.price_by_tier.general),
      store: toMoney(row.price_by_tier.store),
      premiumStore: { amount: toMoneyAmount(0), currency: row.price_by_tier.store.currency },
    },
    description: row.description ?? '',
    images: row.images,
    availability: row.availability,
    handle: row.handle,
    subtitle: row.subtitle ?? '',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * domain Product → wire row(寫部分、對齊 docs/specs/M-1-03-main-b-PRD.md §4.2)。
 *
 * 對應規則:`name` → `title`、`subtitle` / `description` empty string → null、`Date` → ISO string。
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
