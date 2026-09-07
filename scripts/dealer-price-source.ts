/**
 * 經銷價的兩個來源:**上游 `dealer_price_v`** 與 **本站現值**。
 *
 * 🔴 **本檔的每一個回傳都帶著「我讀到幾筆 / 應該幾筆」** —— 因為這一族的失敗形狀是:
 *   **讀漏一批** 與 **這些 sku 本來就沒經銷價**,在資料上**長得一模一樣、零紅**。
 *   ⇒ 沒有那兩個數就分不出來,而分不出來就會把「讀漏」寫成 `null` 清價。
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DealerPriceGateReason } from './dealer-price-gate';

/** 🔵 與既有 `rpm-delta.ts:18` 同值 —— 那支已實證分批可行;
 *  ⚠️ **不分批會撞 supabase-js 預設 1,000 列上限**(rpm 8,435 ⇒ 一發漏 7,435,靜默)。 */
const READ_BATCH = 300;

export interface OldValueRead {
  readonly bySku: ReadonlyMap<string, number | null>;
  /** 本站該家變體總數(分母)。 */
  readonly expected: number;
  /** 實際讀回的相異 sku 數(分子)。 */
  readonly got: number;
  /** 本站鍵是否唯一(相異 sku 數 === 總列數)。 */
  readonly localKeyUnique: boolean;
}

/** 讀本站該家全部 `(sku → price_store)`。**分批,且回傳分子分母讓呼叫端能判讀漏。** */
export async function readLocalDealerPrices(
  tgt: SupabaseClient,
  supplierSlug: string,
): Promise<OldValueRead> {
  const { count, error: cErr } = await tgt
    .from('product_variants')
    .select('sku', { count: 'exact', head: true })
    .eq('supplier_slug', supplierSlug);
  if (cErr) throw new Error(`readLocalDealerPrices count: ${cErr.message}`);
  const expected = count ?? 0;

  const bySku = new Map<string, number | null>();
  let rows = 0;
  for (let from = 0; from < expected; from += READ_BATCH) {
    const { data, error } = await tgt
      .from('product_variants')
      .select('sku, price_store')
      .eq('supplier_slug', supplierSlug)
      .order('sku', { ascending: true })
      .range(from, from + READ_BATCH - 1);
    if (error) throw new Error(`readLocalDealerPrices @${from}: ${error.message}`);
    for (const r of (data ?? []) as unknown as { sku: string; price_store: number | null }[]) {
      rows++;
      bySku.set(r.sku, r.price_store ?? null);
    }
  }
  return { bySku, expected, got: bySku.size, localKeyUnique: bySku.size === rows };
}

/** 一列上游經銷價。🔴 `sku` **原樣、不正規化** —— 與 `rpm-transform.ts:458` 同一個判準。 */
export interface UpstreamDealerRow {
  readonly supplier_slug: string;
  readonly sku: string;
  readonly price_store: number | null;
}

export interface UpstreamRead {
  readonly bySku: ReadonlyMap<string, number | null>;
  readonly rows: number;
  readonly keyUnique: boolean;
  /** 🔴 非法鍵**逐筆列出**,不是只給個數 —— 要看得出是哪幾筆。 */
  readonly illegalKeys: readonly string[];
}

/** 把上游列收成 map,順便把**鍵的問題**挑出來。**不做大小寫/空白正規化。** */
export function indexUpstream(
  rows: readonly UpstreamDealerRow[],
  supplierSlug: string,
): UpstreamRead {
  const bySku = new Map<string, number | null>();
  const illegal: string[] = [];
  for (const r of rows) {
    // 🛑 拒收而不是跳過 —— 跳過會讓它落進「來源缺」那一堆被 5% 門檻吸收
    if (r.supplier_slug !== supplierSlug) { illegal.push(`家別不符:${r.supplier_slug}/${r.sku}`); continue; }
    if (r.sku === '' || r.sku.trim() === '' || r.sku !== r.sku.trim()) { illegal.push(`鍵有空白:[${r.sku}]`); continue; }
    bySku.set(r.sku, r.price_store);
  }
  const clean = rows.length - illegal.length;
  return { bySku, rows: rows.length, keyUnique: bySku.size === clean, illegalKeys: illegal };
}

/** 依兩份讀數判出**所有**命中的觸發條件。🔵 收斂成動作是 `resolveGate` 的事,這裡只列事實。 */
export function gateReasons(args: {
  readonly old: OldValueRead;
  readonly upstream: UpstreamRead | null;
  readonly missingCount: number;
  readonly hasUpstreamUrl: boolean;
  readonly checksumOk: boolean;
}): DealerPriceGateReason[] {
  const out: DealerPriceGateReason[] = [];
  if (!args.hasUpstreamUrl) out.push('missing_upstream_url');
  if (args.old.got !== args.old.expected) out.push('old_values_read_short');
  if (!args.old.localKeyUnique) out.push('local_key_not_unique');
  if (args.upstream) {
    if (!args.upstream.keyUnique) out.push('upstream_key_not_unique');
    if (args.upstream.illegalKeys.length > 0) out.push('illegal_key');
  }
  // ③ 既有而來源整列消失 > 該家本站變體數 5%
  if (args.old.expected > 0 && args.missingCount > args.old.expected * 0.05) {
    out.push('missing_over_threshold');
  }
  if (!args.checksumOk) out.push('checksum_mismatch');
  return out;
}
