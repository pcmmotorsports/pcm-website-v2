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
import type { VariantImageStrategy } from './supplier-config';

// ── constants ──
const PLACEHOLDER_IMAGE = '/placeholder-product.png';
const TWD = 'TWD' as const;

// ── helpers ──
/** numeric(string/number/null)→ 整數 TWD(Math.round、禁浮點);null/非法數字→null */
function roundTwd(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null; // 🔴 NaN/Infinity(非法來源值)→ null(codex k2 審查 must-fix 2)
}
/** 來源 images → string[](對齊 domain images: string[])。W3:兼容兩形狀 —
 *  rpm=[{url}] 物件陣列(抽 .url、現行路徑 byte 不變)、bonamici/cncracing=純字串陣列(直用)。 */
function mapImages(images: ({ url: string } | string)[] | null | undefined): string[] {
  return (images ?? []).map((i) => (typeof i === 'string' ? i : i.url)).filter(Boolean);
}
/**
 * 變體專屬圖 — 依 supplier-config.variantImages 策略分支(W3、#267):
 * - 'sku-prefix-pool'(rpm、Sean 拍):view.images 是「全群共用圖池」、過濾出檔名含該變體 sku 前綴的圖。
 *   檔名規則(已驗):變體 APRILIA-01-G-F 圖檔名含 'aprilia-01-g-f-XX';sku 小寫 + '-' 為精準前綴
 *   (不誤匹配 g-h / m-f)。own 空(如 12K 特殊款可能無專屬檔)→ [](DB 瘦、16c fallback 商品代表圖)。
 * - 'per-variant'(bonamici/cncracing/gbracing、2026-07-04 view 實測):view.images 已是該變體
 *   自己的圖組、直接全用不過濾(RPM 前綴規則對這些家檔名永遠 miss —— sku 後跟 / . _ 而非 '-',
 *   過濾會把全部變體圖丟成 [] = 選色不換圖)。
 */
function ownVariantImages(v: SourceProductRow, strategy: VariantImageStrategy): string[] {
  if (strategy === 'per-variant') return mapImages(v.images);
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
/**
 * subtitle = 適用車款(view.vehicle_label)· 分類詞(categoryTag);通用件 label 空 → 只分類詞。
 * 去碳:材質詞外提為參數、不再硬寫「碳纖維」。categoryTag 由 caller 依 supplier-config 供給:
 *   - rpm(fixed)= 分類 rawPath「碳纖維部品」(Sean 2026-07-03 拍 A:副標隨分類名、故現行「碳纖維」→「碳纖維部品」);
 *   - 試點(per-group)= 該群 major_category_zh(如「操控部品」「車殼外觀」)。
 * categoryTag 空 + 有車款 → 只車款;兩者皆空 → 空字串(通用件無分類、理論邊角)。
 */
function buildSubtitle(vehicleLabel: string | null | undefined, categoryTag: string): string {
  const v = (vehicleLabel ?? '').trim();
  const tag = categoryTag.trim();
  return v && tag ? `${v} · ${tag}` : v || tag;
}
/**
 * handle 片段正規化(#266、Sean 拍 A「正規化」):把來源 mainSku 洗成 URL-safe handle 片段。
 *   1. lowercase;
 *   2. 非白名單字元(空白 / 小數點 / slash 等 URL 危險字元)runs → 單一 hyphen;
 *   3. 連續分隔符(- 或 _ 或混合)收斂成單一 hyphen;
 *   4. 去前後分隔符。
 * 🔴 白名單保留底線(P0-A-4c、bonamici PU_001);對「已合法」片段(rpm APRILIA-01 / gbracing GB-001 等)
 *    = **no-op** → RPM handle byte 不變(rpm-transform.test golden 錨驗)。external_id 仍存原始 mainSku(join key、
 *    大寫),handle 僅 SEO key(backlog #266:handle 走正規化、SKU 保於 external_id)。
 *    ⚠️ 正規化後可能兩個不同髒 SKU 收斂成同 handle → 交由 handle preflight batch-duplicate 攔(dry-run 顯清單)。
 */
export function normalizeHandleSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') // 非白名單(空白 / . / slash 等)runs → 單一 hyphen
    .replace(/[-_]{2,}/g, '-') // 連續分隔符(含 -_ 混合)→ 單一 hyphen
    .replace(/^[-_]+|[-_]+$/g, ''); // 去前後分隔符(避免 HANDLE_RE 前後分隔符違規)
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
  // 🔴 description 為 optional:依 supplier-config.syncDescription 決定寫不寫(§2.9 F2)。
  //    rpm=false → **全批一致省 key** → upsert `?columns` 聯集不含 description → 現有描述不覆寫、byte 等價(回歸鎖驗)。
  //    試點=true → 帶來源繁中 description;來源 null/空白 → 省 key。
  //    ⚠️ load 層限制(backlog #260):試點「有值/省 key」**混批**時,postgrest-js upsert 的 `?columns` 取全批 key 聯集 +
  //       defaultToNull(親驗 PostgrestQueryBuilder.ts:1087-1090)→ 省 key 的列會被寫 **NULL**(非保留現值)。
  //       P0-A-3 乾跑零寫入不觸發;試點 --confirm-write 前須依 #260 處置(分批 by key-signature / missing=default / 統一帶 key)。
  description?: string;
  price_general: number | null;
  price_store: number | null;
  price_by_tier: Record<string, { amount: number; currency: string }>;
  fitments: FitmentSpec[];
  images: string[];
  availability: string;
  brand_id: string;
  category_id: string | null; // fixed=整批固定 id(rpm 恆真實);per-group=逐群 major_category_zh 解析、seed 前對不上→null(dry-run 報告顯示、無 live 風險)
  metadata: Record<string, unknown>;
  // 🔴 S4 復架方向:presence in source = active;upsert 帶 null 自動還原(商品回到 view → 復上架)。
  //    下架方向(source 消失 → 設 now)由 rpm-reconcile 處理、不在 transform。
  delisted_at: string | null;
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

/**
 * 每群 transform 的「已解析情境」(由 rpm-import 依 supplier-config 逐群組裝供給)。
 * 去碳新增的 handlePrefix / subtitleTag / syncDescription 收成具名物件、不擴正位參數
 *   (避免正位參數暴增誤植 = Fable 前審「參數對調」風險)。
 */
export interface GroupTransformContext {
  brandId: string; // 已由 config.brandSlug resolveId(rpm→rpm-carbon)
  categoryId: string | null; // fixed=整批固定 id;per-group=該群 major_category_zh 解析(seed 前→null)
  handlePrefix: string; // handle = `${handlePrefix}-${mainSku.toLowerCase()}`(rpm→'rpm')
  subtitleTag: string; // 副標分類詞:rpm=分類 rawPath「碳纖維部品」、per-group=major_category_zh
  syncDescription: boolean; // true 才把來源 description 寫進 products.description(rpm=false)
}

export function transformGroup(
  mainSku: string,
  variants: SourceProductRow[],
  vehicleLabel: string | null,
  ctx: GroupTransformContext,
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
  // 描述:群內第一個非空來源描述(product-level、群內應一致;防呆取 first non-empty、含純空白視為空、F4)。
  const description = variants.find((v) => (v.description ?? '').trim() !== '')?.description ?? null;
  return {
    supplier_slug: basis.supplier_slug, // view 過濾值、顯式帶
    external_id: mainSku, // 🔴 乾淨主料號、無前綴(view.main_sku 已大寫、對齊 S3a 洗淨值)
    handle: `${ctx.handlePrefix}-${normalizeHandleSegment(mainSku)}`, // SEO slug、供應商命名空間化(rpm→'rpm-');#266 正規化(髒字元→hyphen;rpm 合法 sku=no-op、byte 不變)
    title: basis.product_name_zh || basis.product_name, // 中文部位詞優先、回退英文
    subtitle: buildSubtitle(vehicleLabel, ctx.subtitleTag),
    // 🔴 description 條件寫入(§2.9 F2):syncDescription 且來源非空才展開 key。
    //    rpm(false)→ 展開 {} → 無此 key → byte 等價(回歸鎖驗)。試點混批 load 層 NULL 限制見 ProductRow 註 + backlog #260。
    ...(ctx.syncDescription && description != null ? { description } : {}),
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
    brand_id: ctx.brandId, // 🔴 供應商對照解析(view.brand=車輛品牌、絕不當 brand_id)
    category_id: ctx.categoryId, // fixed=整批固定 / per-group=逐群 major_category_zh 解析(未 seed→null)
    metadata: {
      name_en: basis.product_name, // 英文全名留參考(非敏感、S1 CHECK 不擋)
    }, // 🔴 停寫 shopee/cost/source_*(S1 CHECK 硬擋)+ source_corrected_count(view 無 manually_corrected)
    delisted_at: null, // 🔴 S4 復架:出現在 source = 上架、upsert 還原任何先前下架時戳
    updated_at: now, // 顯式帶(無 trigger)
  };
}

export function transformVariant(
  v: SourceProductRow,
  now: string,
  sortOrder: number,
  // W3:顯式帶策略(無 default、fail-closed 逼呼叫端從 supplier-config 決策;rpm='sku-prefix-pool' byte 錨)
  variantImages: VariantImageStrategy,
): VariantRow {
  return {
    supplier_slug: v.supplier_slug, // 'rpm'(顯式帶)
    sku: v.sku, // 🔴 原樣、不 UPPER(join key、讀當前值)
    spec: v.spec ?? {}, // {weave,finish}+optional special、值全 string(view 直接吐)
    price_general: roundTwd(v.price_retail), // 🔴 view.price_retail → price_general(零售)
    price_store: null, // 🔴 Q2=A 經銷欄留 NULL(變體表無 price_by_tier、無 placeholder 需求)
    availability: availabilityOf(v.stock_status),
    images: ownVariantImages(v, variantImages), // 該變體專屬圖(策略分支);空→[] 靠 16c fallback
    sort_order: sortOrder,
    metadata: {}, // 🔴 停寫全部(4 敏感 S1 CHECK 擋 + source_corrected view 無來源)
    updated_at: now,
  };
}

/**
 * 變體排序:weave 字母 ASC → finish ASC → special 末 → sku ASC(確定性、不用 price)。
 * 🔴 shape-generic fallback(plan §2.1 #13):spec 缺 weave/finish(bonamici {color,material})或 spec=null
 *   (gbracing 單變體)→ 前綴退化為空字串 → 純 sku ASC、不 crash。**故意保留 weave/finish/special 專鍵**:
 *   改成「通用 spec 序列化」會重排 rpm 變體 sort_order = byte 回歸,rpm 順序不動是最高約束。
 */
export function variantSortKey(v: SourceProductRow): string {
  const s = v.spec ?? {};
  return `${s.weave ?? ''}|${s.finish ?? ''}|${s.special ? '1' : '0'}|${v.sku}`;
}
