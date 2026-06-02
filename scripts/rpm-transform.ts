/**
 * rpm-transform — RPM Carbon 匯入:純轉換段(S2 從 rpm-import.ts 拆出、純 refactor、邏輯逐字搬移行為不變)
 *
 * 來源 wire(SourceProductRow)→ 目標 DB row(ProductRow / VariantRow)。無 IO、純函式。
 *
 * 🔴 紅線(對齊 16b plan):
 *   - price_general 一律取 products.price_listing(對外零售);絕不碰 MV 的 store/source 價
 *   - price_store 只進敏感欄(price_store / price_by_tier.store);shopee/cost/source 只進 metadata;
 *     三者 public view 全排除、絕不對外
 *   - 金額一律 Math.round 整數(禁浮點)
 *   - external_id=UPPER('rpm-'+main_sku)、handle='rpm-'+lower、變體 sku 原樣不 UPPER
 *
 * S2(2026-06-02):rpm-import.ts 原 415 行破鐵則 6、拆 fetch / transform / load 三段;本檔=transform 段
 *   (helpers + 目標 row types + transformGroup / transformVariant / variantSortKey)。
 *   ProductRow / VariantRow / computeMainSku / variantSortKey export 給 rpm-import orchestration 用。
 */

import type { FitmentSpec } from '@pcm/domain';
import type { SourceProductRow } from './rpm-fetch';

// ── constants ──
const PLACEHOLDER_IMAGE = '/placeholder-product.png';
const TWD = 'TWD' as const;

// ── helpers ──
/** main_sku = upper(regexp_replace(sku,'-(g|m)-.*$','','i'))(審查雙證 933 群) */
export function computeMainSku(sku: string): string {
  return sku.replace(/-(g|m)-.*$/i, '').toUpperCase();
}
/** numeric(string/number/null)→ 整數 TWD(Math.round、禁浮點);null→null */
function roundTwd(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  return Math.round(Number(v));
}
/** 來源 images [{url}] → string[](抽 .url;對齊 domain images: string[]、非 [{url}]) */
function mapImages(images: { url: string }[] | null | undefined): string[] {
  return (images ?? []).map((i) => i.url).filter(Boolean);
}
/**
 * 變體專屬圖(Sean 拍):來源 v.images 是「全群共用圖池」、過濾出檔名含該變體 sku 前綴的圖。
 * 檔名規則(已驗):變體 APRILIA-01-G-F 圖檔名含 'aprilia-01-g-f-XX';sku 小寫 + '-' 為精準前綴
 * (不誤匹配 g-h / m-f)。own 空(如 12K 特殊款可能無專屬檔)→ [](DB 瘦、16c Q3=C fallback 商品代表圖;
 * 不塞整群池、不塞 rep image 進變體)。
 */
function ownVariantImages(v: SourceProductRow): string[] {
  const prefix = v.sku.toLowerCase() + '-';
  return mapImages(v.images).filter((url) => url.toLowerCase().split('?')[0]!.includes(prefix));
}
/**
 * stock_status → availability。來源 CHECK 4 值 in_stock/low/out/discontinued;
 * low(低庫存)仍可買 → in-stock(對齊權威 view COALESCE 映法、PCM-SCHEMA-ALIGN);
 * out/discontinued → out-of-stock。(RPM 現只 in_stock/out 兩值、low 對齊用、防未來 sync)
 */
function availabilityOf(stock: string): 'in-stock' | 'out-of-stock' {
  return stock === 'in_stock' || stock === 'low' ? 'in-stock' : 'out-of-stock';
}
/** subtitle = 適用車款(mv vehicle_label)+ 材質碳纖維(Q1 Webike 式) */
function buildSubtitle(vehicleLabel: string | null | undefined): string {
  const v = (vehicleLabel ?? '').trim();
  return v ? `${v} · 碳纖維` : '碳纖維';
}
/**
 * fitments:全群所有變體 fitment_parsed 聯集去重(Q-B=A、41 群分歧)。
 * 取 5 key {motoBrand,modelCode,yearStart?,yearEnd,unconfirmed?}、丟其餘 8 內部 key。
 * year_start null/缺 → 省略 yearStart(對齊 domain yearStart?: number、語意=無下限、非 0;
 *   Sean「存 null」意圖=別當 0、JSON 無此 key 即無下限);year_end null → null(domain nullable)。
 * 去重鍵 = 4 軸(motoBrand/modelCode/yearStart/yearEnd);同車款 confirmed 優先(覆寫 unconfirmed)。
 */
function mergeFitments(variants: SourceProductRow[]): FitmentSpec[] {
  const seen = new Map<string, FitmentSpec>();
  for (const v of variants) {
    for (const e of v.fitment_parsed ?? []) {
      const f: FitmentSpec = {
        motoBrand: e.brand,
        modelCode: e.model,
        ...(e.year_start != null ? { yearStart: e.year_start } : {}),
        yearEnd: e.year_end ?? null,
        ...(e.unconfirmed === true ? { unconfirmed: true } : {}),
      };
      const key = `${f.motoBrand}|${f.modelCode}|${f.yearStart ?? ''}|${f.yearEnd ?? ''}`;
      const prev = seen.get(key);
      // 未見過 → 收;已見且舊的 unconfirmed、新的 confirmed → 用 confirmed 覆寫
      if (!prev || (prev.unconfirmed && !f.unconfirmed)) seen.set(key, f);
    }
  }
  return [...seen.values()];
}

// ── transform ──
export interface ProductRow {
  external_id: string;
  handle: string;
  title: string;
  subtitle: string;
  description: string | null;
  price_general: number | null;
  price_store: number | null;
  price_by_tier: Record<string, { amount: number; currency: string }>;
  fitments: FitmentSpec[];
  images: string[];
  availability: string;
  brand_id: string;
  category_id: string;
  metadata: Record<string, unknown>;
  updated_at: string;
}
export interface VariantRow {
  sku: string;
  spec: Record<string, string>;
  price_general: number | null;
  price_store: number | null;
  availability: string;
  images: string[];
  sort_order: number;
  metadata: Record<string, unknown>;
  updated_at: string;
}

export function transformGroup(
  mainSku: string,
  variants: SourceProductRow[],
  vehicleLabel: string | null,
  brandId: string,
  categoryId: string,
  now: string,
): ProductRow {
  // 基準款 = 群內 min(price_listing)、tie-break sku ASC(general/store 同款、語意一致)
  const sorted = [...variants].sort((a, b) => {
    const d = Number(a.price_listing) - Number(b.price_listing);
    return d !== 0 ? d : a.sku < b.sku ? -1 : 1;
  });
  const basis = sorted[0];
  if (!basis) throw new Error(`群 ${mainSku} 無變體(分群保證 ≥1、不應發生)`);
  const priceGeneral = roundTwd(basis.price_listing); // 🔴 只取 price_listing
  const priceStore = roundTwd(basis.price_store);
  // 群代表圖:第一個非空 image_url → 任一變體 images[0] → placeholder(empty_images=0 通常用不到)
  const repImage =
    variants.find((v) => v.image_url)?.image_url ??
    variants.flatMap((v) => mapImages(v.images))[0] ??
    PLACEHOLDER_IMAGE;
  return {
    external_id: `rpm-${mainSku}`.toUpperCase(), // UPPER(§12-27)、帶 rpm 前綴
    handle: `rpm-${mainSku.toLowerCase()}`, // SEO slug、lower
    title: basis.product_name_zh || basis.product_name, // Q1:中文部位詞優先、回退英文(對齊權威 COALESCE、防 NOT NULL;zh 已驗 7277 全有、回退為防禦)
    subtitle: buildSubtitle(vehicleLabel),
    description: basis.description_origin ?? null, // Q1:英文 HTML 全文
    price_general: priceGeneral,
    price_store: priceStore,
    price_by_tier: {
      general: { amount: priceGeneral ?? 0, currency: TWD },
      store: { amount: priceStore ?? 0, currency: TWD },
    }, // 兩 key、禁 premiumStore(現役 CHECK)
    fitments: mergeFitments(variants),
    images: [repImage],
    availability: variants.some((v) => availabilityOf(v.stock_status) === 'in-stock')
      ? 'in-stock'
      : 'out-of-stock', // 群 bool_or(任一變體可買=in-stock)、含 low 對齊
    brand_id: brandId, // 🔴 固定 RPM CARBON
    category_id: categoryId,
    metadata: {
      name_en: basis.product_name, // 英文全名留參考
      source_corrected_count: variants.filter((v) => v.manually_corrected).length,
      shopee: roundTwd(basis.price_shopee),
      cost: roundTwd(basis.price_cost),
      source_amount: roundTwd(basis.price_source_amount),
      source_currency: basis.price_source_currency,
    }, // 🔴 內部、view 排除
    updated_at: now, // 顯式帶(無 trigger)
  };
}

export function transformVariant(v: SourceProductRow, now: string, sortOrder: number): VariantRow {
  return {
    sku: v.sku, // 🔴 原樣、不 UPPER(join key、讀當前值)
    spec: v.raw_jsonb?.spec ?? {}, // {weave,finish}+optional special、值全 string
    price_general: roundTwd(v.price_listing), // 🔴 只 price_listing
    price_store: roundTwd(v.price_store),
    availability: availabilityOf(v.stock_status),
    images: ownVariantImages(v), // 該變體專屬圖(檔名比對 sku 前綴);空→[] 靠 16c Q3=C fallback
    sort_order: sortOrder,
    metadata: {
      shopee: roundTwd(v.price_shopee),
      cost: roundTwd(v.price_cost),
      source_amount: roundTwd(v.price_source_amount),
      source_currency: v.price_source_currency,
      source_corrected: v.manually_corrected, // per-變體鎖死值標記(M-5-03 sync 別覆寫)
    }, // 🔴 內部、view 排除
    updated_at: now,
  };
}

/** 變體排序:weave 字母 ASC → finish ASC → special 末 → sku ASC(確定性、不用 price) */
export function variantSortKey(v: SourceProductRow): string {
  const s = v.raw_jsonb?.spec ?? {};
  return `${s.weave ?? ''}|${s.finish ?? ''}|${s.special ? '1' : '0'}|${v.sku}`;
}
