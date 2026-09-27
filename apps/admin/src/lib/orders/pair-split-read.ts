import 'server-only';

import { createSupabaseServiceClient } from '@pcm/adapters/server';
import { isPairVariant, pairNoteText, resolvePairSplit, type VariantLike } from './pair-split';

// 讀取端(2026-09-27;plan docs/plans/2026-09-27-ilmberger-pair-shipping-note-plan.md)。
// 只有訂單裡真的有一對款才查:① 用一對款的 sku 查 product_id ② 讀同一個商品的所有款 ③ 交給 resolvePairSplit。
// 🔴 查不到(下單後合卡或改群)、一個 sku 對到兩個商品、讀取出錯 ⇒ 保守句, 不丟例外 —— 提示不可以把出貨頁面擋掉。

type Rows = PromiseLike<{ data: unknown[] | null; error: unknown }>;
type Query = Rows & { select(cols: string): Query; in(col: string, vs: readonly string[]): Query };
/** 只用得到 from().select().in();呼叫端傳 service client。 */
export type PairVariantClient = { from(table: string): Query };

type Item = { variantSku: string; spec: Record<string, unknown> | null };

/** 回傳 { 一對款的 sku: 那一行提示字 };沒有一對款 ⇒ {}。 */
export async function loadPairNotes(client: PairVariantClient, items: readonly Item[]): Promise<Record<string, string>> {
  const pairItems = items.filter((i) => isPairVariant(i.variantSku, i.spec));
  if (pairItems.length === 0) return {};
  const skus = [...new Set(pairItems.map((i) => i.variantSku))];
  const fallback = Object.fromEntries(skus.map((s) => [s, pairNoteText({ left: null, right: null })]));
  try {
    const bySku = await client.from('product_variants').select('sku, product_id').in('sku', skus);
    if (bySku.error) return fallback;
    const productsOf = new Map<string, Set<string>>();
    for (const r of (bySku.data ?? []) as Array<{ sku: string; product_id: string }>) {
      productsOf.set(r.sku, (productsOf.get(r.sku) ?? new Set()).add(r.product_id));
    }
    // 一個 sku 恰好對到一個商品才往下找;對到 0 個或多個 ⇒ 保守句
    const productIds = [...new Set([...productsOf.values()].filter((s) => s.size === 1).map((s) => [...s][0]!))];
    if (productIds.length === 0) return fallback;
    const byProduct = await client.from('product_variants').select('product_id, sku, spec').in('product_id', productIds);
    if (byProduct.error) return fallback;
    const siblingsOf = new Map<string, VariantLike[]>();
    for (const r of (byProduct.data ?? []) as Array<{ product_id: string; sku: string; spec: Record<string, unknown> | null }>) {
      siblingsOf.set(r.product_id, [...(siblingsOf.get(r.product_id) ?? []), { sku: r.sku, spec: r.spec }]);
    }
    const out: Record<string, string> = { ...fallback };
    for (const item of pairItems) {
      const owners = productsOf.get(item.variantSku);
      if (owners === undefined || owners.size !== 1) continue;
      const siblings = siblingsOf.get([...owners][0]!) ?? [];
      out[item.variantSku] = pairNoteText(resolvePairSplit({ sku: item.variantSku, spec: item.spec }, siblings));
    }
    return out;
  } catch {
    return fallback;
  }
}

/**
 * 頁面與出貨候選用的入口:先在本地判定有沒有一對款, 沒有就【不建 client、不查】直接回 {}。
 * 有才用 service client 查(商品款式表只給 service_role 讀全部欄位)。
 */
export async function loadPairNotesForItems(items: readonly Item[]): Promise<Record<string, string>> {
  if (!items.some((i) => isPairVariant(i.variantSku, i.spec))) return {};
  return loadPairNotes(createSupabaseServiceClient() as unknown as PairVariantClient, items);
}
