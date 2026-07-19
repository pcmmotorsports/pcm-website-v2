/**
 * rpm-delta — S3b 價格 delta gate(兩層硬 gate)+ pv_spec_unique preflight
 *
 * 鐵則 12 pricing:S3b 切換零售價來源(price_listing→price_retail)是全站改價、非 no-op。
 *   - 兩層 delta:products by external_id(前台列表/卡片吃商品層基準價)+ variants by sku、各比 price_general。
 *   - 硬 gate:異常列(新價 null/0/負/NaN)不可覆寫硬 abort;任何正式寫入須帶 --confirm-write(見 rpm-import)。
 * pv_spec_unique preflight:非首灌升級若同群 spec 重複/孤兒撞 → 批次 upsert 部分寫後才 23505;
 *   先 source 群內查 + target 模擬(新 product 用 external_id synthetic key)、有撞先 abort 不寫。
 *
 * 全程唯讀 target(SELECT、別大 .in() 撞 GET URL 上限);只比 price_general(公開零售、非敏感)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductRow, VariantRow } from './rpm-transform';

const READ_BATCH = 300;
const ABSURD_PRICE = 500_000; // 單價離譜上限(碳纖維部品零售遠低於此、超過疑倉庫資料打錯、列離群給 Sean 瞄)

/** spec 穩定序列化(key 排序、確定性比對) */
function stableSpec(spec: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(spec).sort()) sorted[k] = spec[k]!;
  return JSON.stringify(sorted);
}

/** 分批讀 target 現存 price_general(by key 欄、避免大 .in() 撞 URL 上限) */
async function readExistingPrices(
  tgt: SupabaseClient,
  supplierSlug: string,
  table: string,
  keyCol: string,
  keys: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (let i = 0; i < keys.length; i += READ_BATCH) {
    const batch = keys.slice(i, i + READ_BATCH);
    const { data, error } = await tgt
      .from(table)
      .select(`${keyCol}, price_general`)
      .eq('supplier_slug', supplierSlug)
      .in(keyCol, batch);
    if (error) throw new Error(`readExistingPrices ${table}@${i}: ${error.message}`);
    // supabase-js 動態 select(模板字串)回 ParserError 型、無法靜態推 → 雙 cast escape hatch(同 rpm-load)
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
      out.set(r[keyCol] as string, (r.price_general as number | null) ?? null);
    }
  }
  return out;
}

export interface DeltaLine {
  key: string;
  oldPrice: number | null;
  newPrice: number | null;
  pct: number | null;
}
export interface DeltaReport {
  productChanges: DeltaLine[];
  variantChanges: DeltaLine[];
  newProducts: number;
  newVariants: number;
  newProductKeys: string[]; // M1:新品 external_id(target 查無)——首灌驗價的對象
  newVariantKeys: string[]; // M1:新變體 sku
  abnormal: DeltaLine[]; // 新價 null/0/負/NaN(硬 abort、不可覆寫)
  outliers: DeltaLine[]; // 漲價/大跌>30%/單價離譜(防呆瞄、非硬擋)
}

function pct(oldP: number | null, newP: number | null): number | null {
  if (oldP == null || oldP === 0 || newP == null) return null;
  return Math.round(((newP - oldP) / oldP) * 1000) / 10;
}
function isAbnormal(newP: number | null): boolean {
  return newP == null || !Number.isFinite(newP) || newP <= 0; // 🔴 NaN/Infinity 也算異常(codex k2 審查 must-fix 2)
}
/**
 * 離群價(防呆給 Sean 瞄、非硬擋):降價政策下「漲價」可疑 / 跌幅 >30% / 單價離譜高。
 * 異常列(null/0/負/NaN)已由 isAbnormal 硬擋、不重列此處。
 */
function isOutlier(line: DeltaLine): boolean {
  if (line.newPrice != null && Number.isFinite(line.newPrice) && line.newPrice > ABSURD_PRICE) return true;
  if (line.pct == null) return false;
  return line.pct > 0 || line.pct < -30;
}

/** 兩層 delta:products(external_id)+ variants(sku),各比現存 vs 新 price_general */
export async function computeDelta(
  tgt: SupabaseClient,
  supplierSlug: string,
  productRows: ProductRow[],
  variantRows: VariantRow[],
): Promise<DeltaReport> {
  const existProd = await readExistingPrices(tgt, supplierSlug, 'products', 'external_id', productRows.map((p) => p.external_id));
  const existVar = await readExistingPrices(tgt, supplierSlug, 'product_variants', 'sku', variantRows.map((v) => v.sku));

  const productChanges: DeltaLine[] = [];
  const abnormal: DeltaLine[] = [];
  const newProductKeys: string[] = [];
  for (const p of productRows) {
    const known = existProd.has(p.external_id);
    const oldPrice = known ? existProd.get(p.external_id)! : null;
    const line: DeltaLine = { key: p.external_id, oldPrice, newPrice: p.price_general, pct: pct(oldPrice, p.price_general) };
    if (!known) newProductKeys.push(p.external_id);
    else if (oldPrice !== p.price_general) productChanges.push(line);
    if (isAbnormal(p.price_general)) abnormal.push(line);
  }

  const variantChanges: DeltaLine[] = [];
  const newVariantKeys: string[] = [];
  for (const v of variantRows) {
    const known = existVar.has(v.sku);
    const oldPrice = known ? existVar.get(v.sku)! : null;
    const line: DeltaLine = { key: v.sku, oldPrice, newPrice: v.price_general, pct: pct(oldPrice, v.price_general) };
    if (!known) newVariantKeys.push(v.sku);
    else if (oldPrice !== v.price_general) variantChanges.push(line);
    if (isAbnormal(v.price_general)) abnormal.push(line);
  }

  const outliers = [...productChanges, ...variantChanges].filter(isOutlier);
  return {
    productChanges,
    variantChanges,
    newProducts: newProductKeys.length,
    newVariants: newVariantKeys.length,
    newProductKeys,
    newVariantKeys,
    abnormal,
    outliers,
  };
}

export function printDeltaReport(r: DeltaReport, opts: { full?: boolean; json?: boolean } = {}): void {
  if (opts.json) {
    console.log(JSON.stringify(r, null, 2)); // --delta-json:機器可讀全量證據
    return;
  }
  const cap = opts.full ? Number.MAX_SAFE_INTEGER : 50;
  console.log('\n=== 價格 delta gate(兩層)===');
  console.log(`商品層變價: ${r.productChanges.length} / 變體層變價: ${r.variantChanges.length}`);
  console.log(`新商品: ${r.newProducts} / 新變體: ${r.newVariants} / 🔴異常(null/0/負/NaN): ${r.abnormal.length} / ⚠️離群: ${r.outliers.length}`);
  // 🔴 離群價(防呆、Sean 瞄此即可、非全 8878 筆):降價政策下漲價可疑 / 跌幅>30% / 單價離譜
  if (r.outliers.length) {
    console.log(`⚠️ 離群價清單(${r.outliers.length}、Sean 瞄此即可、防倉庫資料打錯):`);
    console.table(r.outliers.slice(0, cap));
  } else {
    console.log('✅ 無離群價(全在合理降價區間)');
  }
  console.log(`-- 商品層 delta ${opts.full ? '(全量)' : '前 50'} --`);
  console.table(r.productChanges.slice(0, cap));
  console.log(`-- 變體 delta ${opts.full ? '(全量)' : '前 50'} --`);
  console.table(r.variantChanges.slice(0, cap));
  console.log(`(完整 ${r.productChanges.length} 商品 / ${r.variantChanges.length} 變體變價;--delta-full 印全量、--delta-json 出 JSON 留證)`);
  if (r.abnormal.length) {
    console.log('🔴 異常列(硬 abort、不可覆寫):');
    console.table(r.abnormal.slice(0, cap));
  }
}

// ── M1:新品驗價(Codex R1 2026-07-19 must-fix M1)──
/**
 * 價格 delta gate 的結構性盲區:它只比得出「變價」——**新品沒有舊價可比**(oldPrice=null、
 * pct=null → isOutlier 直接 return false)。首灌時 648 群全是新品 → 整批價格零檢查,
 * 錯 100 倍也照上架(異常列只擋 null/0/負/NaN,10 元跟 100 萬都算「正常」)。
 *
 * 補兩層:
 *   ① **對源逐筆比對**(任何時候都硬擋):把商品/變體要寫的 price_general,對「從來源列獨立重算」
 *      的值。這是查 transform 接線是否還對(接錯欄=接到經銷價/成本、忘了 round、單位錯位),
 *      不是查來源本身對不對。刻意不呼叫 rpm-transform 的實作,避免同一個 bug 兩邊一起錯。
 *   ② **絕對價區間**(僅首灌硬擋、日常只報):落在 [floor, ceiling] 外 → 疑單位/小數點錯位。
 *      日常不硬擋是實查決定(2026-07-19 報價單庫:gbracing 45 筆 < 100 元、eazigrip/evotech 各 2 筆 80 元
 *      = 真實便宜小件);拿它當日常硬閘會天天誤殺 gbracing 同步。首灌是一次性人工監控場景、擋得起。
 */
export const NEW_ITEM_PRICE_FLOOR = 100; // 元;低於此疑小數點/單位錯位(實查最低真實價=gbracing 50 元、故僅首灌硬擋)
export const NEW_ITEM_PRICE_CEILING = ABSURD_PRICE; // 與離群價同上限(實查最高真實價=akrapovic 151,600)

export interface NewItemPriceIssue {
  level: 'product' | 'variant';
  key: string;
  price: number | null; // 要寫進網站的值
  sourcePrice: number | null; // 從來源列獨立重算的值
  reason: 'source-mismatch' | 'below-floor' | 'above-ceiling';
  detail: string;
}

/** 來源單值 → 整數 TWD;null/空/非法 → null(獨立實作,不共用 rpm-transform 的 roundTwd) */
export function independentPrice(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

/**
 * 群基準價獨立重算 = min(price_retail) 取整(對齊 rpm-transform 的「群內最低零售價」規則、但另寫一份)。
 * 任一列價非法 → null(transform 那側該群基準也會落 null、再由異常列硬 abort 接手)。
 */
export function independentGroupPrice(rows: { price_retail: string | number | null }[]): number | null {
  if (!rows.length) return null;
  let min: number | null = null;
  for (const r of rows) {
    const n = independentPrice(r.price_retail);
    if (n === null) return null;
    if (min === null || n < min) min = n;
  }
  return min;
}

/**
 * 新品驗價。`items` = 本次判定為新品的商品/變體(key、要寫的價、來源獨立重算價)。
 * `enforceBand`:首灌傳 true(絕對區間也算 issue);日常傳 false(只留對源比對)。
 */
export function checkNewItemPrices(
  items: { level: 'product' | 'variant'; key: string; price: number | null; sourcePrice: number | null }[],
  opts: { enforceBand: boolean; floor?: number; ceiling?: number } = { enforceBand: false },
): NewItemPriceIssue[] {
  const floor = opts.floor ?? NEW_ITEM_PRICE_FLOOR;
  const ceiling = opts.ceiling ?? NEW_ITEM_PRICE_CEILING;
  const issues: NewItemPriceIssue[] = [];
  for (const it of items) {
    const { level, key, price, sourcePrice } = it;
    if (price !== sourcePrice) {
      issues.push({
        level,
        key,
        price,
        sourcePrice,
        reason: 'source-mismatch',
        detail: `要寫 ${price} ≠ 來源獨立重算 ${sourcePrice}(transform 接線疑接錯欄/漏取整/單位錯位)`,
      });
      continue; // 接線已不可信,不必再談區間
    }
    if (!opts.enforceBand || price === null) continue;
    if (price < floor) {
      issues.push({ level, key, price, sourcePrice, reason: 'below-floor', detail: `${price} < 首灌下限 ${floor}(疑小數點/單位錯位)` });
    } else if (price > ceiling) {
      issues.push({ level, key, price, sourcePrice, reason: 'above-ceiling', detail: `${price} > 首灌上限 ${ceiling}(疑倉庫資料打錯)` });
    }
  }
  return issues;
}

export function printNewItemPriceReport(
  issues: NewItemPriceIssue[],
  counts: { newProducts: number; newVariants: number; enforceBand: boolean },
): void {
  console.log('\n=== 新品驗價(M1、對來源逐筆比對)===');
  console.log(
    `新商品 ${counts.newProducts} / 新變體 ${counts.newVariants};` +
      `絕對價區間硬擋=${counts.enforceBand ? '開(首灌)' : '關(日常、只留對源比對)'}`,
  );
  if (!issues.length) {
    console.log('✅ 新品價與來源獨立重算逐筆相符、無區間異常');
    return;
  }
  console.error(`🔴 新品驗價 ${issues.length} 筆問題、寫入模式將 abort:`);
  console.table(issues.slice(0, 50));
  if (issues.length > 50) console.log(`(另有 ${issues.length - 50} 筆未列)`);
}

export function hasPriceChange(r: DeltaReport): boolean {
  return r.productChanges.length > 0 || r.variantChanges.length > 0;
}
export function hasAbnormal(r: DeltaReport): boolean {
  return r.abnormal.length > 0;
}

export interface SpecCollision {
  externalId: string;
  spec: string;
  skus: string[];
}

/**
 * 純模擬(可測):source 群內 spec 重複 + target 既有變體併入。
 * 🔴 V1(2026-07-05 審查 F3):`deletedSkus` = 變體級對賬已排定硬刪的孤兒 sku——變體 upsert 前會先刪,
 * 故**不併入**模擬(否則「變體改名、spec 不變」→ 新 sku 恆撞已死孤兒 → 該供應商同步永久卡死、無工具可解)。
 */
export function simulateSpecCollisions(
  variantsByExternalId: Map<string, { sku: string; spec: Record<string, string> }[]>,
  idByExt: Map<string, string>,
  existByProduct: Map<string, { sku: string; spec: Record<string, string> }[]>,
  deletedSkus: Set<string>,
): SpecCollision[] {
  const collisions: SpecCollision[] = [];
  for (const [externalId, srcVariants] of variantsByExternalId) {
    const srcSkus = new Set(srcVariants.map((v) => v.sku));
    const bySpec = new Map<string, string[]>();
    const add = (sku: string, spec: Record<string, string>): void => {
      const s = stableSpec(spec);
      const arr = bySpec.get(s);
      if (arr) arr.push(sku);
      else bySpec.set(s, [sku]);
    };
    for (const v of srcVariants) add(v.sku, v.spec); // source 群內
    const pid = idByExt.get(externalId);
    if (pid) {
      for (const ev of existByProduct.get(pid) ?? []) {
        // target 既有變體:source 有(將被 upsert 覆寫)跳過;已排定刪除(V1 孤兒)跳過;其餘併入模擬
        if (!srcSkus.has(ev.sku) && !deletedSkus.has(ev.sku)) add(ev.sku, ev.spec);
      }
    }
    for (const [spec, skus] of bySpec) {
      if (skus.length > 1) collisions.push({ externalId, spec, skus });
    }
  }
  return collisions;
}

/**
 * pv_spec_unique(product_id, spec) preflight。
 * source 群內(external_id 分群)spec 重複 + target 模擬(既有變體〔source 無、亦未排定刪除〕併入後是否撞)。
 * 新 product(target 查無 id)→ 只查 source 群內(external_id 即 synthetic key)。
 * `deletedSkus`:V1 變體級對賬排定硬刪的孤兒(upsert 前已清、不參與模擬;預設空=舊行為)。
 */
export async function preflightSpecUnique(
  tgt: SupabaseClient,
  supplierSlug: string,
  variantsByExternalId: Map<string, VariantRow[]>,
  deletedSkus: Set<string> = new Set(),
): Promise<SpecCollision[]> {
  const externalIds = [...variantsByExternalId.keys()];

  // target:external_id → product id(只查要寫的群)
  const idByExt = new Map<string, string>();
  for (let i = 0; i < externalIds.length; i += READ_BATCH) {
    const batch = externalIds.slice(i, i + READ_BATCH);
    const { data, error } = await tgt
      .from('products')
      .select('id, external_id')
      .eq('supplier_slug', supplierSlug)
      .in('external_id', batch);
    if (error) throw new Error(`preflight products@${i}: ${error.message}`);
    for (const r of (data ?? []) as { id: string; external_id: string }[]) idByExt.set(r.external_id, r.id);
  }

  // target:product_id → 既有變體 (sku, spec)
  const existByProduct = new Map<string, { sku: string; spec: Record<string, string> }[]>();
  const productIds = [...idByExt.values()];
  for (let i = 0; i < productIds.length; i += READ_BATCH) {
    const batch = productIds.slice(i, i + READ_BATCH);
    const { data, error } = await tgt
      .from('product_variants')
      .select('product_id, sku, spec')
      .in('product_id', batch);
    if (error) throw new Error(`preflight variants@${i}: ${error.message}`);
    for (const r of (data ?? []) as { product_id: string; sku: string; spec: Record<string, string> | null }[]) {
      const arr = existByProduct.get(r.product_id);
      const entry = { sku: r.sku, spec: r.spec ?? {} };
      if (arr) arr.push(entry);
      else existByProduct.set(r.product_id, [entry]);
    }
  }

  return simulateSpecCollisions(variantsByExternalId, idByExt, existByProduct, deletedSkus);
}
