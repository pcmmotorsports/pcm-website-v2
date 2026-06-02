/**
 * rpm-transform — RPM Carbon 同步:純轉換段(S3b 改吃乾淨 view 列)
 *
 * 來源 wire(SourceProductRow=view 列)→ 目標 DB row(ProductRow / VariantRow)。無 IO、純函式。
 *
 * 🔴 紅線(S3b、命名地雷正解 + 經銷防護):
 *   - price_general 一律取 view.price_retail(報價單側零售真相欄、view 正名 price_retail);網站 price_general=零售。
 *   - 獨立 price_store integer 欄一律 null(Q2=A、view 無經銷價、絕不接 view 任何欄到 price_store)。
 *   - price_by_tier.store 填 price_retail placeholder(現役 CHECK 逼 general+store 兩 key 都要值);
 *     ⚠️ 此 placeholder 非真經銷價、M-2-08 tier-aware 取價別信此欄、真經銷價回報價單 dealer view 取。
 *   - metadata 不寫任何敏感欄(shopee/cost/source_*、S1 CHECK 硬擋);只留 name_en(非敏感)。
 *   - 金額一律 Math.round 整數(禁浮點)。
 *   - external_id=乾淨 main_sku(無 RPM- 前綴、對齊 S3a 洗淨值);handle='rpm-'+lower(S3a 保留 handle key)。
 *
 * S3b(2026-06-02):取代 S2 版「吃 raw products + 寫敏感 metadata + 加 RPM- 前綴」。
 *   主料號改用 view.main_sku(廢 computeMainSku regex);spec/images/vehicle_label/stock_status 直接吃 view 欄。
 */

import type { FitmentSpec } from '@pcm/domain';
import type { SourceProductRow } from './rpm-fetch';

// ── constants ──
const PLACEHOLDER_IMAGE = '/placeholder-product.png';
const TWD = 'TWD' as const;

// ── helpers ──
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
 * 變體專屬圖(Sean 拍):view.images 是「全群共用圖池」、過濾出檔名含該變體 sku 前綴的圖。
 * 檔名規則(已驗):變體 APRILIA-01-G-F 圖檔名含 'aprilia-01-g-f-XX';sku 小寫 + '-' 為精準前綴
 * (不誤匹配 g-h / m-f)。own 空(如 12K 特殊款可能無專屬檔)→ [](DB 瘦、16c fallback 商品代表圖)。
 */
function ownVariantImages(v: SourceProductRow): string[] {
  const prefix = v.sku.toLowerCase() + '-';
  return mapImages(v.images).filter((url) => url.toLowerCase().split('?')[0]!.includes(prefix));
}
/**
 * stock_status → availability。view 現吐 in_stock / out(已驗);low(低庫存)對齊權威仍可買 → in-stock;
 * out/discontinued → out-of-stock。
 */
function availabilityOf(stock: string): 'in-stock' | 'out-of-stock' {
  return stock === 'in_stock' || stock === 'low' ? 'in-stock' : 'out-of-stock';
}
/** subtitle = 適用車款(view.vehicle_label)+ 材質碳纖維(Q1 Webike 式);通用件 label 空→只「碳纖維」 */
function buildSubtitle(vehicleLabel: string | null | undefined): string {
  const v = (vehicleLabel ?? '').trim();
  return v ? `${v} · 碳纖維` : '碳纖維';
}
/**
 * fitments:全群所有變體 fitment_parsed 聯集去重(Q-B=A)。
 * 取 5 key {motoBrand,modelCode,yearStart?,yearEnd,unconfirmed?}、丟其餘內部 key(menu_path / year_str 等)。
 * 通用件空 entry({} 或 brand+model 皆空)→ 跳過(防呆、避免吐 undefined fitment row)。
 * year_start null/缺 → 省略 yearStart(domain yearStart?: number、語意=無下限);year_end null → null。
 * 去重鍵 = 4 軸(motoBrand/modelCode/yearStart/yearEnd);同車款 confirmed 優先(覆寫 unconfirmed)。
 */
function mergeFitments(variants: SourceProductRow[]): FitmentSpec[] {
  const seen = new Map<string, FitmentSpec>();
  for (const v of variants) {
    for (const e of v.fitment_parsed ?? []) {
      if (!e.brand && !e.model) continue; // 通用件空 entry 防呆
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
  supplier_slug: string; // 🔴 複合鍵欄、顯式寫不靠 DB DEFAULT
  external_id: string;
  handle: string;
  title: string;
  subtitle: string;
  // 🔴 不含 description:S3b 不同步描述欄(view 對 RPM 全空;upsert 不帶此欄 → 現有 933 描述原地保留、
  //    新品 DB 預設 NULL;描述交獨立中文化 workstream。Sean Q-desc 定案 + backlog)。
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
  supplier_slug: string; // 🔴 複合鍵欄、顯式寫不靠 DB DEFAULT
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
  // 基準款 = 群內 min(price_retail)、tie-break sku ASC(零售真相、語意一致)
  const sorted = [...variants].sort((a, b) => {
    const d = Number(a.price_retail) - Number(b.price_retail);
    return d !== 0 ? d : a.sku < b.sku ? -1 : 1;
  });
  const basis = sorted[0];
  if (!basis) throw new Error(`群 ${mainSku} 無變體(分群保證 ≥1、不應發生)`);
  const priceGeneral = roundTwd(basis.price_retail); // 🔴 view.price_retail → 網站 price_general(零售)
  // 群代表圖:第一個非空 image_url → 任一變體 images[0] → placeholder
  const repImage =
    variants.find((v) => v.image_url)?.image_url ??
    variants.flatMap((v) => mapImages(v.images))[0] ??
    PLACEHOLDER_IMAGE;
  return {
    supplier_slug: basis.supplier_slug, // 'rpm'(view 過濾值、顯式帶)
    external_id: mainSku, // 🔴 乾淨主料號、無 RPM- 前綴(view.main_sku 已大寫、對齊 S3a 洗淨值)
    handle: `rpm-${mainSku.toLowerCase()}`, // SEO slug、供應商命名空間化(S3a 保留 handle key、不變)
    title: basis.product_name_zh || basis.product_name, // 中文部位詞優先、回退英文
    subtitle: buildSubtitle(vehicleLabel),
    // description 不寫(移出 S3b scope、upsert 省此欄 → 現有描述保留 / 新品 NULL)
    price_general: priceGeneral,
    price_store: null, // 🔴 Q2=A 獨立經銷欄留 NULL(view 無經銷價、絕不接)
    price_by_tier: {
      general: { amount: priceGeneral ?? 0, currency: TWD },
      // ⚠️ store=零售 placeholder(現役 CHECK 逼 general+store 兩 key);非真經銷價、M-2-08 別信此欄
      store: { amount: priceGeneral ?? 0, currency: TWD },
    },
    fitments: mergeFitments(variants),
    images: [repImage],
    availability: variants.some((v) => availabilityOf(v.stock_status) === 'in-stock')
      ? 'in-stock'
      : 'out-of-stock', // 群 bool_or(任一變體可買=in-stock)
    brand_id: brandId, // 🔴 固定 RPM CARBON(view.brand=車輛品牌、不可當 brand_id)
    category_id: categoryId, // 🔴 固定 碳纖維部品(view RPM major_category 單一 Body)
    metadata: {
      name_en: basis.product_name, // 英文全名留參考(非敏感、S1 CHECK 不擋)
    }, // 🔴 停寫 shopee/cost/source_*(S1 CHECK 硬擋)+ source_corrected_count(view 無 manually_corrected)
    updated_at: now, // 顯式帶(無 trigger)
  };
}

export function transformVariant(v: SourceProductRow, now: string, sortOrder: number): VariantRow {
  return {
    supplier_slug: v.supplier_slug, // 'rpm'(顯式帶)
    sku: v.sku, // 🔴 原樣、不 UPPER(join key、讀當前值)
    spec: v.spec ?? {}, // {weave,finish}+optional special、值全 string(view 直接吐)
    price_general: roundTwd(v.price_retail), // 🔴 view.price_retail → price_general(零售)
    price_store: null, // 🔴 Q2=A 經銷欄留 NULL(變體表無 price_by_tier、無 placeholder 需求)
    availability: availabilityOf(v.stock_status),
    images: ownVariantImages(v), // 該變體專屬圖(檔名比對 sku 前綴);空→[] 靠 16c fallback
    sort_order: sortOrder,
    metadata: {}, // 🔴 停寫全部(4 敏感 S1 CHECK 擋 + source_corrected view 無來源)
    updated_at: now,
  };
}

/** 變體排序:weave 字母 ASC → finish ASC → special 末 → sku ASC(確定性、不用 price) */
export function variantSortKey(v: SourceProductRow): string {
  const s = v.spec ?? {};
  return `${s.weave ?? ''}|${s.finish ?? ''}|${s.special ? '1' : '0'}|${v.sku}`;
}
