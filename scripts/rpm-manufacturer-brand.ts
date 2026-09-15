/**
 * rpm-manufacturer-brand — 逐群掛製造商品牌(DBK 目錄裡的別家商品;Sean Q7 甲)。
 *
 * plan:`docs/plans/2026-09-15-dbk-manufacturer-brand-plan.md`
 *   · Q1 甲:英文品名含 Termignoni 就算(報價單 5e 窗據此填 storefront_catalog_v.manufacturer_brand)
 *   · 10 件配件全搬(Sean 2026-09-16 00:4x 甲)⇒ 網站這邊不再排除配件字,只看那一欄
 *
 * 規則(只在 supplier-config 開了 perRowBrand 的那一家生效,今天只有 dbk):
 *   · 一群裡【每一列】都是同一個認得的製造商 ⇒ 掛那家
 *   · 整群沒有值(欄還沒上 / 報價單填 null)⇒ 照舊掛供應商品牌
 *   · 群內有的有值有的沒有、或兩家不同 ⇒ 照舊掛供應商品牌並列出(一件商品不能有兩個品牌)
 *   · 值不在允許清單(打錯字 / 還沒建品牌頁的家)⇒ 照舊掛供應商品牌並列出(不靜默落回,打錯字才看得到)
 *   · 要搬去的品牌底下【別家供應商】已經有同料號 ⇒ 不搬、照舊掛供應商品牌並列出(防同一件商品在品牌頁出現兩次)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { SourceProductRow } from './rpm-fetch';

const READ_BATCH = 300;
const PAGE_SIZE = 1000;

/** 報價單的值可能是 slug 也可能是品牌名(Öhlins / TERMIGNONI)⇒ 去重音、小寫、只留英數。空 ⇒ null。 */
export function normalizeManufacturerBrand(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = raw.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return s === '' ? null : s;
}

/** 料號比對用:大寫、只留英數(DBK 與原廠供應商的料號寫法常差一個連字號)。 */
export function normalizeSku(sku: string): string {
  return sku.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type GroupBrandReason = 'supplier' | 'manufacturer' | 'mixed' | 'unknown' | 'duplicate';

export interface GroupBrandDecision {
  slug: string;
  reason: GroupBrandReason;
  /** reason=manufacturer 以外、而報價單有給值時:它原本想掛哪家(報告用)。 */
  wanted: string | null;
  /** reason=duplicate:撞到的料號(原樣)。 */
  duplicateSkus: string[];
}

/**
 * 一群要掛哪個品牌。
 * @param otherSupplierSkus slug ⇒ 該品牌底下【別家供應商】已上架變體的正規化料號
 */
export function decideGroupBrand(
  rows: readonly Pick<SourceProductRow, 'sku' | 'manufacturer_brand'>[],
  supplierBrandSlug: string,
  allowedSlugs: readonly string[],
  otherSupplierSkus: ReadonlyMap<string, ReadonlySet<string>>,
): GroupBrandDecision {
  const values = rows.map((r) => normalizeManufacturerBrand(r.manufacturer_brand));
  const distinct = new Set(values.filter((v): v is string => v !== null));
  if (distinct.size === 0) return { slug: supplierBrandSlug, reason: 'supplier', wanted: null, duplicateSkus: [] };
  const wanted = [...distinct].sort().join('+');
  if (distinct.size > 1 || values.includes(null)) {
    return { slug: supplierBrandSlug, reason: 'mixed', wanted, duplicateSkus: [] };
  }
  if (!allowedSlugs.includes(wanted)) return { slug: supplierBrandSlug, reason: 'unknown', wanted, duplicateSkus: [] };
  const taken = otherSupplierSkus.get(wanted);
  const duplicateSkus = taken ? rows.map((r) => r.sku).filter((sku) => taken.has(normalizeSku(sku))) : [];
  if (duplicateSkus.length > 0) return { slug: supplierBrandSlug, reason: 'duplicate', wanted, duplicateSkus };
  return { slug: wanted, reason: 'manufacturer', wanted: null, duplicateSkus: [] };
}

/**
 * 每個允許品牌底下、【不是本供應商】匯進來的變體料號(正規化)。
 * 🔴 讀失敗一律 throw —— 讀不到就等於查不出重複,靜默當成「沒有重複」會把重複上架寫進去。
 */
export async function readOtherSupplierSkus(
  tgt: SupabaseClient,
  brandIdBySlug: ReadonlyMap<string, string>,
  ownSupplierSlug: string,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const [slug, brandId] of brandIdBySlug) {
    const productIds: string[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await tgt
        .from('products')
        .select('id')
        .eq('brand_id', brandId)
        .neq('supplier_slug', ownSupplierSlug)
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`讀 ${slug} 既有商品失敗(查重複料號):${error.message}`);
      const rows = (data ?? []) as { id: string }[];
      productIds.push(...rows.map((r) => r.id));
      if (rows.length < PAGE_SIZE) break;
    }
    const skus = new Set<string>();
    for (let i = 0; i < productIds.length; i += READ_BATCH) {
      const { data, error } = await tgt
        .from('product_variants')
        .select('sku')
        .in('product_id', productIds.slice(i, i + READ_BATCH));
      if (error) throw new Error(`讀 ${slug} 既有變體失敗(查重複料號):${error.message}`);
      for (const r of (data ?? []) as { sku: string }[]) skus.add(normalizeSku(r.sku));
    }
    out.set(slug, skus);
  }
  return out;
}

/** 乾跑 / 寫入都印:每個品牌搬幾群、沒搬的為什麼。 */
export function printManufacturerBrandReport(
  decisions: readonly { mainSku: string; decision: GroupBrandDecision }[],
): void {
  const moved = new Map<string, number>();
  for (const { decision } of decisions) {
    if (decision.reason === 'manufacturer') moved.set(decision.slug, (moved.get(decision.slug) ?? 0) + 1);
  }
  const summary = [...moved.entries()].sort().map(([slug, n]) => `${slug} ${n} 群`).join(' / ') || '0 群';
  console.log(`[rpm-import] 逐群製造商品牌:改掛 ${summary}`);
  const held = decisions.filter(({ decision }) => ['mixed', 'unknown', 'duplicate'].includes(decision.reason));
  if (held.length) {
    console.warn(`[rpm-import] ⚠️ 報價單有給製造商而沒搬的 ${held.length} 群(照舊掛供應商品牌):`);
    console.table(
      held.map(({ mainSku, decision }) => ({
        mainSku,
        reason: decision.reason,
        wanted: decision.wanted,
        duplicateSkus: decision.duplicateSkus.join(', '),
      })),
    );
  }
}
