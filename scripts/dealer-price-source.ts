/**
 * 經銷價的兩個來源:**上游 `dealer_price_v`** 與 **本站現值**。
 *
 * 🔴 **本檔的每一個回傳都帶著「我讀到幾筆 / 應該幾筆」** —— 因為這一族的失敗形狀是:
 *   **讀漏一批** 與 **這些 sku 本來就沒經銷價**,在資料上**長得一模一樣、零紅**。
 *   ⇒ 沒有那兩個數就分不出來,而分不出來就會把「讀漏」寫成 `null` 清價。
 */
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DealerPriceGateReason } from './dealer-price-gate';

/** 🔵 與既有 `rpm-delta.ts:18` 同值 —— 那支已實證分批可行;
 *  ⚠️ **不分批會撞 supabase-js 預設 1,000 列上限**(rpm 8,435 ⇒ 一發漏 7,435,靜默)。 */
const READ_BATCH = 300;

/** 🔴 逾時的數字寫在這裡,而 A 檔也要有同一組 —— 沒有逾時就進不了 A2,會被 45 分上限殺掉。
 *  連線 10 秒:上游是同區 pooler,連不上 10 秒也不會突然好。
 *  查詢 60 秒:最大一家 samco 14,525 列,而這支只 SELECT 三欄。 */
const CONNECT_TIMEOUT_MS = 10_000;
const QUERY_TIMEOUT_MS = 60_000;

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


/**
 * 從上游 `dealer_price_v` 讀那一家的經銷價。
 *
 * 🔴 **這條路與既有的 `rpm-fetch` 不同,而差異是刻意的**:
 *   `rpm-fetch` 走 Supabase client 讀**公開** view(`storefront_catalog_v`,已砍掉所有敏感價欄);
 *   而 `dealer_price_v` **不授 anon / authenticated**,只授 `dealer_price_reader`
 *   ⇒ **只能 Postgres 直連**,REST / anon 鑰匙讀不到(`~/quote-wt-merge/docs/STOREFRONT_CATALOG_CONTRACT.md:451-456`)。
 *
 * 🛑 **錯誤處理刻意【不往上拋原例外】** —— `rpm-import.ts:906` 那個出口會
 *   `console.error('[rpm-import] FAILED:', e)` 把整個例外印出來、並把 `String(e)` 寫進同步紀錄;
 *   而 PG 連線失敗的例外裡**帶著 host 與 user**。⇒ 這裡只回「檔在不在 / 能不能連」兩個字。
 */
export async function fetchUpstreamDealerPrices(
  supplierSlug: string,
): Promise<{ readonly ok: true; readonly rows: UpstreamDealerRow[] } | { readonly ok: false; readonly why: 'no_url' | 'cannot_connect' | 'bad_value' }> {
  const url = process.env.DEALER_PRICE_DATABASE_URL;
  // 🔴 只認這一個變數。**不得 fallback 到 pg 的 PGHOST/PGPASSWORD 預設** —— 那是靜默 fallback,
  //   會讓「沒設好」看起來像「連上了」,與「缺 env 走 A2」正好相反。
  if (!url) return { ok: false, why: 'no_url' };
  // 🔴 **`new Client()` 必須在 try 【裡面】** —— codex 總審 must-fix:URL 格式錯時它會拋出
  //   **含完整 URL 的 `TypeError`**,建構子在 try 外就會落進外層的完整例外輸出 ⇒ **憑證外洩**。
  let client: import('pg').Client | null = null;
  try {
    // 動態 import:沒有 allowlist 的家根本不會走到這裡,不必為它付 require 成本
    const { Client } = await import('pg');
    client = new Client({
      connectionString: url,
      // 🔴 **逾時是必要的** —— 上游連上卻不回應時,沒有逾時就進不了 A2,
      //   最後被 workflow 的 45 分上限殺掉、**拖住後續供應商**(它們是 max-parallel:1 序列跑)。
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      query_timeout: QUERY_TIMEOUT_MS,
      statement_timeout: QUERY_TIMEOUT_MS,
    });
    await client.connect();
    const res = await client.query(
      'SELECT supplier_slug, sku, price_store FROM public.dealer_price_v WHERE supplier_slug = $1',
      [supplierSlug],
    );
    const rows: UpstreamDealerRow[] = [];
    for (const r of res.rows as Record<string, unknown>[]) {
      const raw = r.price_store;
      let price: number | null;
      if (raw === null || raw === undefined) {
        price = null;
      } else {
        // 🔴 型別:PG numeric 經 `pg` 回**字串**,而 `jsonb_typeof` 對字串會 RAISE 整群
        //   (`20260825120000:151`)⇒ 這裡就轉乾淨。
        const n = Math.round(Number(raw));
        // 🛑 **`NaN` 拒收整批,不得當成 null** —— codex 總審 must-fix:
        //   `NaN` 序列化會變成 `null` ⇒ **把既有真經銷價清空**,而鍵與筆數守門都擋不住。
        if (!Number.isFinite(n)) return { ok: false, why: 'bad_value' };
        price = n;
      }
      rows.push({ supplier_slug: String(r.supplier_slug), sku: String(r.sku), price_store: price });
    }
    return { ok: true, rows };
  } catch {
    // 🛑 例外整個吞掉、不往上拋、不印內容 —— 它帶著 host 與 user。
    return { ok: false, why: 'cannot_connect' };
  } finally {
    await client?.end().catch(() => undefined);
  }
}

/**
 * 這一批的 checksum —— **dry-run 印它、寫入前重算比對,不同就停**。
 * 🔴 沒有這一步,「Sean 核准的那批」與「真正寫進去的那批」**沒有任何綁定**
 *   (正式跑會重新讀來源,而來源每天在動)。
 */
export function dealerBatchChecksum(rows: readonly UpstreamDealerRow[]): string {
  const body = [...rows]
    .map((r) => `${r.supplier_slug}\t${r.sku}\t${r.price_store ?? 'NULL'}`)
    .sort() // 🔵 排序後才雜湊:來源列序不保證穩定, 不排會讓同一批算出不同的 checksum
    .join('\n');
  return createHash('sha256').update(body, 'utf8').digest('hex');
}


/**
 * 讀本站該家全部 `(external_id → price_by_tier.store)`。
 * 🔴 **商品層的舊值只能從商品自己讀** —— 從變體重算就是覆寫(codex 總審 must-fix)。
 * 🛑 **失敗回 `null` 而不是 throw** —— 讀不到 ⇒ 由呼叫端判成 A2,不是把整家同步炸掉。
 */
export async function readLocalProductStore(
  tgt: SupabaseClient,
  supplierSlug: string,
): Promise<ReadonlyMap<string, number | null> | null> {
  try {
    const { count, error: cErr } = await tgt
      .from('products')
      .select('external_id', { count: 'exact', head: true })
      .eq('supplier_slug', supplierSlug);
    if (cErr) return null;
    const expected = count ?? 0;
    const out = new Map<string, number | null>();
    for (let from = 0; from < expected; from += READ_BATCH) {
      const { data, error } = await tgt
        .from('products')
        .select('external_id, price_by_tier')
        .eq('supplier_slug', supplierSlug)
        .order('external_id', { ascending: true })
        .range(from, from + READ_BATCH - 1);
      if (error) return null;
      for (const r of (data ?? []) as unknown as { external_id: string; price_by_tier: Record<string, { amount?: unknown }> | null }[]) {
        const raw = r.price_by_tier?.store?.amount;
        out.set(r.external_id, typeof raw === 'number' && Number.isFinite(raw) ? raw : null);
      }
    }
    // 🔴 讀漏也要看得出來:相異鍵數 ≠ 應有筆數 ⇒ 回 null(呼叫端判 A2)
    return out.size === expected ? out : null;
  } catch {
    return null;
  }
}
