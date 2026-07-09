import {
  toMoneyAmount,
  type Brand,
  type CategoryPath,
  type Currency,
  type FitmentSpec,
  type Money,
  type Product,
  type ProductAvailability,
  type ProductManual,
  type ProductVariant,
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
  // A/#270 賣點條列。jsonb 來源 shape 不保證(可能非陣列/含非字串)→ 型別標 unknown[](對齊 SupabaseVariantRow.images/spec 慣例)、mapper runtime guard 收斂為 string[]。
  highlights: unknown[] | null;
  // #270 安裝資源。manuals jsonb 來源 shape 不保證(元素可能缺 label/url)→ unknown[]、mapper guard 收斂 ProductManual[];video_url 單支影片 URL(2026-07-10 起混格式 youtube/vimeo/mp4、UI 三分流)或 null。
  manuals: unknown[] | null;
  video_url: string | null;
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
  /**
   * 變體 embed(M-1-16c-2、backlog #203):detail 投射(findById / findByHandle)走
   * `product_variants_public(...)` embed、回 7 欄(view DDL 10 欄、adapter 只投射 domain 所需 7 欄);
   * list 路徑(listByCategory/Brand/Fitment/searchByKeyword)不帶變體(避 N+1 jsonb 膨脹)→ 此 key
   * 在 list 路徑 row 為 undefined。
   *
   * 🔴 經銷價防護:view 物理排除 price_store / metadata、透過 embed 亦無法 select(實測 PG 42703)、
   *   故此 wire 型別本就無敏感欄。
   */
  product_variants_public?: SupabaseVariantRow[];
};

/**
 * Supabase product_variants_public view embed row(M-1-16c-2、backlog #203)。
 *
 * 對齊 adapter detail 投射 7 欄(view DDL 10 欄、adapter 只 select domain 變體所需):
 *   id / sku / spec / price_general / availability / images / sort_order
 *   (view 另 3 欄 product_id / created_at / updated_at 變體 domain 不需、不投射)。
 *
 * 🔴 永遠無 price_store / metadata(view 物理排除、經銷敏感 + 內部欄)。
 *
 * wire 型別 spec / images 用寬鬆型(jsonb 來源 shape 不保證)、mapVariantRow runtime guard
 * 收斂為 domain Record<string,string> / string[](codex 關卡1 consider 3:防 import 錯 shape
 * 悄悄進 client)。
 */
export type SupabaseVariantRow = {
  id: string;
  sku: string;
  // 🔴 jsonb 來源可吐 null(#264:試點來源 spec=NULL 未經 rpm-transform `?? {}` 轉換、或歷史列);
  //   型別誠實標 nullable、mapVariantRow `?? {}`/`?? []` 防禦,否則 Object.entries(null)/null.map() 讓整頁 500。
  spec: Record<string, unknown> | null;
  price_general: number | null;
  availability: ProductAvailability;
  images: unknown[] | null;
  sort_order: number;
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
    // M-1-16c-4b:商品主碼 ← wire external_id(vendor 料號如 RPM-DCC01、UNIQUE NOT NULL);
    //   domain 業務語意命名 productCode、不 leak wire externalId 字面(ADR-0003 §3.1)。
    productCode: row.external_id,
    name: row.title,
    brand,
    category,
    fitments: row.fitments,
    priceByTier: { general, store, premiumStore },
    description: row.description ?? '',
    // A/#270 賣點條列:防禦性 guard(jsonb 來源 shape 不保證)→ 濾出 string、非陣列→[];恆 string[](never null、對齊 domain Product.highlights)。
    highlights: Array.isArray(row.highlights) ? row.highlights.filter((h): h is string => typeof h === 'string') : [],
    // #270 安裝資源:防禦性 guard(jsonb 元素 shape 不保證)→ 濾出有 label+url 字串的項、收斂 ProductManual[](sizeKB 僅在為 number 時保留);恆陣列 never null。
    manuals: Array.isArray(row.manuals)
      ? row.manuals.reduce<ProductManual[]>((acc, m) => {
          if (m && typeof m === 'object') {
            const { label, url, sizeKB } = m as Record<string, unknown>;
            if (typeof label === 'string' && typeof url === 'string') {
              acc.push(typeof sizeKB === 'number' ? { label, url, sizeKB } : { label, url });
            }
          }
          return acc;
        }, [])
      : [],
    // #270 安裝影片:單支影片 URL(2026-07-10 起混格式 youtube/vimeo/mp4);空字串/非字串→undefined(對齊 domain Product.videoUrl optional)。
    videoUrl: typeof row.video_url === 'string' && row.video_url.trim() !== '' ? row.video_url : undefined,
    images: row.images,
    availability: row.availability,
    handle: row.handle,
    subtitle: row.subtitle ?? '',
    // M-1-16c-2:detail 投射 embed product_variants_public → mapVariantRow(backlog #203);
    //   list 路徑無 embed key → undefined → []。依 sortOrder 排序(embed 無 ORDER BY、
    //   codex 關卡1 consider 2);sku tie-breaker 保確定性(sort_order DB DEFAULT 0 可並列、
    //   PostgREST embed 原始順序不保證、codex 關卡2 consider 1;sku 全表 UNIQUE)。
    variants: (row.product_variants_public ?? [])
      .map(mapVariantRow)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.sku.localeCompare(b.sku)),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * wire variant row → domain ProductVariant(M-1-16c-2、backlog #203)。
 *
 * 取價(鏡像 mapSupabaseProductToDomain、同源註解):
 *   - general:從 price_general(view 唯一公開取價欄、過 toMoneyAmount guard);null → throw
 *   - store:dummy { 0, TWD }(view 排除 price_store、經銷敏感)
 *   - premiumStore:placeholder { 0, TWD }(真經銷價待 M-2-08 server-side pricing endpoint)
 *
 * 🔴 變體無真經銷價可顯 → caller(16c-3 strip)變體 UI 價一律取 priceByTier.general、
 *   不可對 store / premiumStore 顯 dummy 0(防 NT$ 0、codex 關卡1 must-fix 2)。
 *
 * runtime guard(codex 關卡1 consider 3):spec 值全 string + images 元素全 string、否則 throw
 *   (fail loud、防未來 import 錯 shape 悄悄進 client;migration CHECK 只保證 spec=object / images=array、
 *   不保證值型別)。
 *
 * @throws price_general 為 null / spec 含非 string 值 / images 含非 string 元素
 */
export function mapVariantRow(row: SupabaseVariantRow): ProductVariant {
  if (row.price_general === null) {
    throw new Error(
      `Variant ${row.sku} missing price_general(16b 應已定價、缺欄表示 import 漏遷移)`,
    );
  }

  // spec guard:值全 string(domain ProductVariant.spec: Record<string, string>)
  // #264:jsonb spec 可為 null(來源 spec=NULL、或 rpm-transform `?? {}` 未觸及的歷史列)→ 視為空 spec
  //   不 throw(否則 Object.entries(null) 讓整個商品詳情頁 adapter 層 500、客人看到破頁)。
  const spec: Record<string, string> = {};
  for (const [k, v] of Object.entries(row.spec ?? {})) {
    if (typeof v !== 'string') {
      throw new Error(
        `Variant ${row.sku} spec.${k} 非 string(實際 ${typeof v});domain ProductVariant.spec 須 Record<string,string>`,
      );
    }
    spec[k] = v;
  }

  // images guard:元素全 string URL(domain ProductVariant.images: string[];空 [] 合法、16c fallback 商品圖)
  // #264:jsonb images 可為 null → 視為空陣列(靠 16c 商品代表圖 fallback)、不 throw。
  const images = (row.images ?? []).map((img, i) => {
    if (typeof img !== 'string') {
      throw new Error(
        `Variant ${row.sku} images[${i}] 非 string(實際 ${typeof img});domain ProductVariant.images 須 string[]`,
      );
    }
    return img;
  });

  const general: Money = toMoney({ amount: row.price_general, currency: 'TWD' });
  // store / premiumStore dummy(view 排除 price_store、鏡像 mapSupabaseProductToDomain L139/L143);
  // 真經銷價待 M-2-08、本片變體無真經銷價、caller 顯示前取 general。
  const store: Money = { amount: toMoneyAmount(0), currency: 'TWD' };
  const premiumStore: Money = { amount: toMoneyAmount(0), currency: 'TWD' };

  return {
    id: row.id,
    sku: row.sku,
    spec,
    priceByTier: { general, store, premiumStore },
    availability: row.availability,
    images,
    sortOrder: row.sort_order,
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
 * - `external_id` ← `domain.productCode`(M-1-16c-4b 起、vendor 主碼 round-trip;原 Phase 1
 *   placeholder「用 domain id 作同步」已退場 — domain 現有 productCode 真主碼欄)
 * - `metadata` Phase 1 寫 `{}`(Phase 2 vendor crawler / sync-engine 用)
 * - 不寫 `brands` / `categories` JOIN object(upsert 後 SELECT 重 JOIN 還原)
 */
export function mapDomainProductToSupabase(
  domain: Product,
  ids: { brandId: string; categoryId: string },
): Omit<SupabaseProductRow, 'brands' | 'categories'> {
  return {
    id: domain.id,
    // M-1-16c-4b:external_id ← domain.productCode(vendor 主碼 round-trip、取代原 domain.id placeholder)
    external_id: domain.productCode,
    title: domain.name,
    subtitle: emptyToNull(domain.subtitle),
    description: emptyToNull(domain.description),
    // A/#270:存檔路徑亦持久化賣點條列(domain.highlights 恆 string[]、對齊 products.highlights NOT NULL)。
    highlights: domain.highlights,
    // #270:持久化安裝資源(domain.manuals 恆 ProductManual[]、對齊 products.manuals NOT NULL DEFAULT '[]';videoUrl optional→null)。
    manuals: domain.manuals,
    video_url: domain.videoUrl ?? null,
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
