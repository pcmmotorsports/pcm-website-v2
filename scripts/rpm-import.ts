/**
 * M-1-16b RPM Carbon 匯入腳本(ETL:來源唯讀 → 轉換 → 寫商城)
 *
 * 來源(唯讀、絕不寫):pcm-quote-v2 `dllwkkfanaebrsuyuedy`
 *   products WHERE supplier_slug='rpm'(7277 變體)+ product_groups_mv(取 vehicle_label)
 * 目標(寫):pcm-website-v2 `bmpnplmnldofgaohnaok`
 *   products(933 群)+ product_variants(7277);brands/categories 已 16b-1 seed
 *
 * 跑法:
 *   pnpm dlx tsx scripts/rpm-import.ts --dry-run [--group=APRILIA-01] [--limit=3]
 *   pnpm dlx tsx scripts/rpm-import.ts            # 全量寫入(16b-3)
 *
 * env(repo 根 .env.local、不入 git;用新式 Secret key `sb_secret_…`、非 legacy service_role JWT):
 *   SOURCE_SUPABASE_URL / SOURCE_SUPABASE_SECRET_KEY(來源唯讀)
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(目標寫)
 *   註:import 專用新 SECRET_KEY、不碰 storefront 既有 SUPABASE_SERVICE_ROLE_KEY(legacy、全站遷移留 backlog)
 *
 * 🔴 紅線(對齊 16b plan):
 *   - 每個來源讀取都 .eq('supplier_slug','rpm')(mv 混 6 供應商 7057 群、漏濾=灌別家)
 *   - price_general 一律取 products.price_listing(對外零售);絕不碰 MV 的 store/source 價
 *   - price_store 只進敏感欄(products.price_store / price_by_tier.store);shopee/cost/source 只進 metadata;三者 public view 全排除、絕不對外
 *   - brand_id=RPM CARBON 零件品牌(車廠 brand/model 進 fitments.motoBrand)
 *   - join 用 sku(讀當前值);金額一律 Math.round 整數(禁浮點)
 *   - external_id=UPPER('rpm-'+main_sku)、handle='rpm-'+lower、變體 sku 原樣不 UPPER
 *
 * 檔案大小(鐵則 11 揭示):~411 行、破鐵則 6 元件 400 上限。屬一次性 ETL 腳本(非元件/Hook)、
 *   types / helpers / transform / fetch / main 分段內聚、本片(首灌)判定可接受(code-reviewer 認可);
 *   16d 週同步邏輯疊加前須拆 rpm-transform.ts / rpm-fetch.ts(屆時破 400 硬拆)。
 */

import { loadEnvFile } from 'node:process';
loadEnvFile('.env.local');

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { FitmentSpec } from '@pcm/domain';

// ── constants ──
const SUPPLIER = 'rpm';
const BRAND_SLUG = 'rpm-carbon';
const CATEGORY_RAW_PATH = '碳纖維部品';
const PLACEHOLDER_IMAGE = '/placeholder-product.png';
const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;
const TWD = 'TWD' as const;
const ALLOWED_TARGET_REF = 'bmpnplmnldofgaohnaok'; // prod-safety:只准寫這個 dev project

// ── CLI args ──
const DRY_RUN = process.argv.includes('--dry-run');
const GROUP_FILTER = argValue('--group'); // dry-run 單群
const LIMIT = Number(argValue('--limit') ?? '0') || 0; // dry-run 前 N 群

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set(填 repo 根 .env.local)`);
  return v;
}

// ── source row types(wire、只在本檔出現)──
interface SourceFitmentEntry {
  brand: string;
  model: string;
  year_start: number | null;
  year_end: number | null;
  unconfirmed?: boolean;
}
interface SourceProductRow {
  sku: string;
  product_name: string;
  product_name_zh: string;
  description_origin: string | null;
  price_listing: string | number;
  price_store: string | number;
  price_shopee: string | number | null;
  price_cost: string | number | null;
  price_source_amount: string | number | null;
  price_source_currency: string | null;
  stock_status: string;
  manually_corrected: boolean;
  fitment_parsed: SourceFitmentEntry[] | null;
  images: { url: string }[] | null;
  image_url: string | null;
  raw_jsonb: { spec?: Record<string, string> } | null;
}

// ── helpers ──
/** main_sku = upper(regexp_replace(sku,'-(g|m)-.*$','','i'))(審查雙證 933 群) */
function computeMainSku(sku: string): string {
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
interface ProductRow {
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
interface VariantRow {
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

function transformGroup(
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

function transformVariant(v: SourceProductRow, now: string, sortOrder: number): VariantRow {
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
function variantSortKey(v: SourceProductRow): string {
  const s = v.raw_jsonb?.spec ?? {};
  return `${s.weave ?? ''}|${s.finish ?? ''}|${s.special ? '1' : '0'}|${v.sku}`;
}

// ── source fetch(分頁、全程 supplier_slug='rpm')──
async function fetchAllRpmProducts(src: SupabaseClient): Promise<SourceProductRow[]> {
  const cols =
    'sku, product_name, product_name_zh, description_origin, price_listing, price_store, ' +
    'price_shopee, price_cost, price_source_amount, price_source_currency, stock_status, ' +
    'manually_corrected, fitment_parsed, images, image_url, raw_jsonb';
  const all: SourceProductRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await src
      .from('products')
      .select(cols)
      .eq('supplier_slug', SUPPLIER) // 🔴 紅線
      .order('sku')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as SourceProductRow[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchVehicleLabels(src: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await src
    .from('product_groups_mv')
    .select('main_sku, vehicle_label')
    .eq('supplier_slug', SUPPLIER) // 🔴 紅線(mv 混 6 供應商)
    .limit(5000);
  if (error) throw error;
  const map = new Map<string, string>();
  for (const r of (data ?? []) as { main_sku: string; vehicle_label: string | null }[]) {
    map.set(r.main_sku, r.vehicle_label ?? '');
  }
  return map;
}

async function resolveId(
  tgt: SupabaseClient,
  table: string,
  col: string,
  val: string,
): Promise<string> {
  const { data, error } = await tgt.from(table).select('id').eq(col, val).single();
  if (error || !data) throw new Error(`${table}.${col}='${val}' 不存在(16b-1 seed 未跑?):${error?.message}`);
  return (data as { id: string }).id;
}

/**
 * 分批 upsert(冪等 onConflict)。給 `select` 則每批 `.select(select)` 累積回傳 rows
 * (用於 products 收 id↔external_id 對照、免事後大 `.in(933 值)` 超 GET URL 上限)。
 */
async function upsertBatched(
  tgt: SupabaseClient,
  table: string,
  rows: object[],
  onConflict: string,
  select?: string,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const base = tgt.from(table).upsert(batch, { onConflict });
    if (select) {
      const { data, error } = await base.select(select);
      if (error) throw new Error(`upsert ${table} batch@${i}: ${error.message}`);
      // supabase-js 動態 select(string)回 GenericStringError[]、無法靜態推型 → 雙 cast escape hatch
      out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    } else {
      const { error } = await base;
      if (error) throw new Error(`upsert ${table} batch@${i}: ${error.message}`);
    }
    console.log(`  ${table}: upserted ${Math.min(i + BATCH_SIZE, rows.length)}/${rows.length}`);
  }
  return out;
}

// ── main ──
async function main(): Promise<void> {
  const now = new Date().toISOString();
  const source = createClient(
    requireEnv('SOURCE_SUPABASE_URL'),
    requireEnv('SOURCE_SUPABASE_SECRET_KEY'),
  );
  const targetUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  if (!targetUrl.includes(ALLOWED_TARGET_REF)) {
    throw new Error(`prod-safety:目標 URL 非 ${ALLOWED_TARGET_REF}、拒寫(${targetUrl})`);
  }
  const target = createClient(targetUrl, requireEnv('SUPABASE_SECRET_KEY'));

  console.log(`[rpm-import] ${DRY_RUN ? 'DRY-RUN' : 'WRITE'} 模式 / 來源唯讀讀取…`);
  const [products, vehicleLabels, brandId, categoryId] = await Promise.all([
    fetchAllRpmProducts(source),
    fetchVehicleLabels(source),
    resolveId(target, 'brands', 'slug', BRAND_SLUG),
    resolveId(target, 'categories', 'raw_path', CATEGORY_RAW_PATH),
  ]);
  console.log(`[rpm-import] 來源 RPM 變體 ${products.length} 筆;brand_id=${brandId} category_id=${categoryId}`);

  // 分群(main_sku)
  const groups = new Map<string, SourceProductRow[]>();
  for (const p of products) {
    const mainSku = computeMainSku(p.sku);
    const list = groups.get(mainSku);
    if (list) list.push(p);
    else groups.set(mainSku, [p]);
  }
  console.log(`[rpm-import] 分群 ${groups.size} 群(預期 933)`);

  // 篩選(dry-run --group / --limit)
  let entries = [...groups.entries()];
  if (GROUP_FILTER) entries = entries.filter(([m]) => m === GROUP_FILTER.toUpperCase());
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);

  // 轉換
  const productRows: ProductRow[] = [];
  const variantsByExternalId = new Map<string, VariantRow[]>();
  for (const [mainSku, variants] of entries) {
    const pr = transformGroup(mainSku, variants, vehicleLabels.get(mainSku) ?? '', brandId, categoryId, now);
    productRows.push(pr);
    const sorted = [...variants].sort((a, b) => (variantSortKey(a) < variantSortKey(b) ? -1 : 1));
    variantsByExternalId.set(
      pr.external_id,
      sorted.map((v, idx) => transformVariant(v, now, idx)),
    );
  }

  if (DRY_RUN) {
    for (const pr of productRows) {
      const vrs = variantsByExternalId.get(pr.external_id)!;
      console.log('\n' + '─'.repeat(60));
      console.log(JSON.stringify({ product: pr, variant_count: vrs.length, sample_variants: vrs.slice(0, 3) }, null, 2));
    }
    console.log(`\n[rpm-import] DRY-RUN:${productRows.length} 群 / ${[...variantsByExternalId.values()].reduce((n, a) => n + a.length, 0)} 變體(未寫入)`);
    return;
  }

  // 寫入:products(每批 .select 累積 id↔external_id 對照、免大 .in() 超 URL 上限)→ product_variants
  const savedProducts = await upsertBatched(target, 'products', productRows, 'external_id', 'id, external_id');
  const idByExtId = new Map(savedProducts.map((r) => [r.external_id as string, r.id as string]));

  const variantRows = productRows.flatMap((pr) =>
    variantsByExternalId.get(pr.external_id)!.map((vr) => ({ ...vr, product_id: idByExtId.get(pr.external_id)! })),
  );
  // 變體 upsert onConflict sku(首次匯入空表冪等)。註:16d 週同步若來源 re-parse 令同群兩變體
  // spec 互換,可能撞 pv_spec_unique(product_id,spec) 而非 sku 約束(23505) → 16d 處理(首灌無此風險)。
  await upsertBatched(target, 'product_variants', variantRows, 'sku');
  console.log(`[rpm-import] WRITE 完成:${productRows.length} 商品 / ${variantRows.length} 變體`);
}

main().catch((e) => {
  console.error('[rpm-import] FAILED:', e);
  process.exit(1);
});
