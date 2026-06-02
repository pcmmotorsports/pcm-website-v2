/**
 * rpm-delta — S3b 價格 delta gate(兩層硬 gate)+ pv_spec_unique preflight
 *
 * 鐵則 12 pricing:S3b 切換零售價來源(price_listing→price_retail)是全站改價、非 no-op。
 *   - 兩層 delta:products by external_id(前台列表/卡片吃商品層基準價)+ variants by sku、各比 price_general。
 *   - 硬 gate:異常列(新價 null/0/負)不可覆寫;正常價格變動須正式跑帶 --confirm-price-delta(見 rpm-import)。
 * pv_spec_unique preflight:非首灌升級若同群 spec 重複/孤兒撞 → 批次 upsert 部分寫後才 23505;
 *   先 source 群內查 + target 模擬(新 product 用 external_id synthetic key)、有撞先 abort 不寫。
 *
 * 全程唯讀 target(SELECT、別大 .in() 撞 GET URL 上限);只比 price_general(公開零售、非敏感)。
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProductRow, VariantRow } from './rpm-transform';

const READ_BATCH = 300;
const SUPPLIER = 'rpm';

/** spec 穩定序列化(key 排序、確定性比對) */
function stableSpec(spec: Record<string, string>): string {
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(spec).sort()) sorted[k] = spec[k]!;
  return JSON.stringify(sorted);
}

/** 分批讀 target 現存 price_general(by key 欄、避免大 .in() 撞 URL 上限) */
async function readExistingPrices(
  tgt: SupabaseClient,
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
      .eq('supplier_slug', SUPPLIER)
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
  abnormal: DeltaLine[]; // 新價 null/0/負(硬 abort、不可覆寫)
}

function pct(oldP: number | null, newP: number | null): number | null {
  if (oldP == null || oldP === 0 || newP == null) return null;
  return Math.round(((newP - oldP) / oldP) * 1000) / 10;
}
function isAbnormal(newP: number | null): boolean {
  return newP == null || newP <= 0;
}

/** 兩層 delta:products(external_id)+ variants(sku),各比現存 vs 新 price_general */
export async function computeDelta(
  tgt: SupabaseClient,
  productRows: ProductRow[],
  variantRows: VariantRow[],
): Promise<DeltaReport> {
  const existProd = await readExistingPrices(tgt, 'products', 'external_id', productRows.map((p) => p.external_id));
  const existVar = await readExistingPrices(tgt, 'product_variants', 'sku', variantRows.map((v) => v.sku));

  const productChanges: DeltaLine[] = [];
  const abnormal: DeltaLine[] = [];
  let newProducts = 0;
  for (const p of productRows) {
    const known = existProd.has(p.external_id);
    const oldPrice = known ? existProd.get(p.external_id)! : null;
    const line: DeltaLine = { key: p.external_id, oldPrice, newPrice: p.price_general, pct: pct(oldPrice, p.price_general) };
    if (!known) newProducts++;
    else if (oldPrice !== p.price_general) productChanges.push(line);
    if (isAbnormal(p.price_general)) abnormal.push(line);
  }

  const variantChanges: DeltaLine[] = [];
  let newVariants = 0;
  for (const v of variantRows) {
    const known = existVar.has(v.sku);
    const oldPrice = known ? existVar.get(v.sku)! : null;
    const line: DeltaLine = { key: v.sku, oldPrice, newPrice: v.price_general, pct: pct(oldPrice, v.price_general) };
    if (!known) newVariants++;
    else if (oldPrice !== v.price_general) variantChanges.push(line);
    if (isAbnormal(v.price_general)) abnormal.push(line);
  }

  return { productChanges, variantChanges, newProducts, newVariants, abnormal };
}

export function printDeltaReport(r: DeltaReport): void {
  console.log('\n=== 價格 delta gate(兩層)===');
  console.log(`商品層變價: ${r.productChanges.length} / 變體層變價: ${r.variantChanges.length}`);
  console.log(`新商品: ${r.newProducts} / 新變體: ${r.newVariants} / 🔴異常(null/0/負): ${r.abnormal.length}`);
  const big = [...r.productChanges, ...r.variantChanges].filter((l) => l.pct != null && Math.abs(l.pct) > 30);
  if (big.length) {
    console.log(`⚠️ 單筆 ±>30% (${big.length}、前 50):`);
    console.table(big.slice(0, 50));
  }
  console.log('-- 商品層 delta 前 50 --');
  console.table(r.productChanges.slice(0, 50));
  console.log('-- 變體 delta 前 50 --');
  console.table(r.variantChanges.slice(0, 50));
  console.log(`(上方各列前 50;完整 ${r.productChanges.length} 商品 / ${r.variantChanges.length} 變體變價、S3b-2 點頭證據可 --dry-run > 檔 留全量)`);
  if (r.abnormal.length) {
    console.log('🔴 異常列(硬 abort、不可覆寫、前 50):');
    console.table(r.abnormal.slice(0, 50));
  }
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
 * pv_spec_unique(product_id, spec) preflight。
 * source 群內(external_id 分群)spec 重複 + target 模擬(既有變體孤兒〔target 有、source 無〕併入後是否撞)。
 * 新 product(target 查無 id)→ 只查 source 群內(external_id 即 synthetic key)。
 */
export async function preflightSpecUnique(
  tgt: SupabaseClient,
  variantsByExternalId: Map<string, VariantRow[]>,
): Promise<SpecCollision[]> {
  const externalIds = [...variantsByExternalId.keys()];

  // target:external_id → product id(只查要寫的群)
  const idByExt = new Map<string, string>();
  for (let i = 0; i < externalIds.length; i += READ_BATCH) {
    const batch = externalIds.slice(i, i + READ_BATCH);
    const { data, error } = await tgt
      .from('products')
      .select('id, external_id')
      .eq('supplier_slug', SUPPLIER)
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
        if (!srcSkus.has(ev.sku)) add(ev.sku, ev.spec); // target 孤兒(source 無、upsert 不刪)
      }
    }
    for (const [spec, skus] of bySpec) {
      if (skus.length > 1) collisions.push({ externalId, spec, skus });
    }
  }
  return collisions;
}
