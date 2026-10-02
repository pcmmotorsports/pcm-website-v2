/**
 * 經銷價的兩個來源:**上游 `dealer_price_v`** 與 **本站現值**。
 *
 * 🔴 **本檔的每一個回傳都帶著「我讀到幾筆 / 應該幾筆」** —— 因為這一族的失敗形狀是:
 *   **讀漏一批** 與 **這些 sku 本來就沒經銷價**,在資料上**長得一模一樣、零紅**。
 *   ⇒ 沒有那兩個數就分不出來,而分不出來就會把「讀漏」寫成 `null` 清價。
 */
import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseAmount, parseCount } from './dealer-price-parse.js';
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
  // 🔴 **`count` 的所有形狀走 `parseCount` 一支** —— 見 `dealer-price-parse.ts` 檔頭。
  //   `null` 而無錯誤 = 【沒讀到】不是零筆:當成 0 會略過整個讀取迴圈**而且通過守門**
  //   (got 0 = expected 0)⇒ allowlist 空也會把既有經銷價清成 null。合成資料已重現。
  const c = parseCount(count, cErr);
  if (!c.ok) throw new Error('readLocalDealerPrices: count 沒讀到(null 或錯誤)⇒ 不是零筆');
  const expected = c.count;

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
    for (const r of (data ?? []) as unknown as { sku: string; price_store: unknown }[]) {
      rows++;
      // 🔴 走同一支 —— 本站欄位理應是 int4,而 `pg`/PostgREST 對 numeric 會回**字串**,
      //   且這個值等一下會被 `carry_old` **原樣寫回去**。
      const p = parseAmount(r.price_store);
      bySku.set(r.sku, p.kind === 'value' ? p.value : null);
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
      // 🔴 走同一支 `parseAmount` —— PG numeric 經 `pg` 回**字串**,而 `jsonb_typeof`
      //   對字串會 RAISE 整群(`20260825120000:151`)⇒ 這裡就轉乾淨。
      // 🛑 **`invalid` 拒收整批,不得降級成 `absent`** —— 兩者在資料上長得一樣而後果相反:
      //   `NaN`/`"abc"` 當成 null 會**把既有真經銷價清空**(鍵與筆數守門都擋不住);
      //   負價與超界會讓**變體寫入被 DB 拒絕**,而此時商品與先前批次已寫入 ⇒ 半套同步。
      const parsed = parseAmount(r.price_store);
      if (parsed.kind === 'invalid') return { ok: false, why: 'bad_value' };
      const price: number | null = parsed.kind === 'value' ? parsed.value : null;
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
 * 🔴 2026-10-02 改成帶金鑰的 HMAC-SHA256(主視窗 pcm-website-v2-ce 派, 資安):repo 公開, 核對碼印在 Actions 紀錄;
 *   舊版是不帶金鑰的 sha256, 而部分供應商經銷價 = 一般價 × 固定比例 ⇒ 列舉比例就能從核對碼反推經銷價。
 *   金鑰是 GitHub secret `DEALER_PRICE_CHECKSUM_KEY`;空的就丟錯, 不退回成沒有金鑰的雜湊。
 */
export function dealerBatchChecksum(rows: readonly UpstreamDealerRow[], key: string): string {
  if (key.trim() === '') throw new Error('dealerBatchChecksum: 缺金鑰 DEALER_PRICE_CHECKSUM_KEY');
  const body = [...rows]
    .map((r) => `${r.supplier_slug}\t${r.sku}\t${r.price_store ?? 'NULL'}`)
    .sort() // 🔵 排序後才雜湊:來源列序不保證穩定, 不排會讓同一批算出不同的 checksum
    .join('\n');
  return createHmac('sha256', key).update(body, 'utf8').digest('hex');
}

/** 正式跑在紀錄裡只印核對碼前幾碼(夠人對照, 不夠拿來比對)。 */
export const CHECKSUM_LOG_PREFIX = 8;

/**
 * 核對碼判定:這一輪可不可以寫新的經銷價(ok = false ⇒ gate 走 A1 帶舊值), 以及要印哪幾行。
 * · 沒有金鑰 ⇒ 一律不放行(含排程), 印清楚要設哪個 secret;missingKey = true 讓呼叫端把這一輪標成失敗
 *   (只走 A1 的話 job 是綠的、告警信不會寄 ⇒ 經銷價凍住而沒人知道;Fable R1 M1)。
 * · 有期望值 ⇒ 必須相符(首灌用它綁 Sean 核准的那批)。
 * · 沒期望值 ⇒ 只有排程(日常同步)放行;手動與本機一律要帶(首灌與中途失敗補跑都是手動)。
 * · 印:乾跑印完整值(要貼回 workflow_dispatch);其餘只印前 8 碼, 不符時期望值也只印前 8 碼。
 */
export function checksumVerdict(args: {
  rows: readonly UpstreamDealerRow[];
  key: string | undefined;
  expect: string;
  trigger: string;
  dryRun: boolean;
}): { ok: boolean; missingKey: boolean; lines: { level: 'log' | 'error'; text: string }[] } {
  const key = (args.key ?? '').trim();
  if (key === '') {
    return {
      ok: false,
      missingKey: true,
      lines: [{
        level: 'error',
        text: '🔴 [dealer-price] 沒有設定 DEALER_PRICE_CHECKSUM_KEY ⇒ 算不出核對碼 ⇒ 不寫新經銷價(走 A1 帶舊值)。請到 GitHub repo Settings → Secrets and variables → Actions 新增這個 secret 後重跑。',
      }],
    };
  }
  const actual = dealerBatchChecksum(args.rows, key);
  const short = (v: string) => `${v.slice(0, CHECKSUM_LOG_PREFIX)}…`;
  const lines: { level: 'log' | 'error'; text: string }[] = [
    args.dryRun
      ? { level: 'log', text: `[dealer-price] 本批核對碼(完整, 貼進 workflow_dispatch 用):${actual}` }
      : { level: 'log', text: `[dealer-price] 本批核對碼(前 ${CHECKSUM_LOG_PREFIX} 碼):${short(actual)}` },
  ];
  if (args.expect !== '') {
    const ok = actual === args.expect;
    if (!ok) lines.push({ level: 'error', text: `🔴 [dealer-price] 核對碼不符:期望 ${short(args.expect)} / 實際 ${short(actual)}` });
    return { ok, missingKey: false, lines };
  }
  if (args.trigger !== 'schedule') {
    lines.push({
      level: 'error',
      text: `🔴 [dealer-price] 觸發方式 [${args.trigger || '(本機)'}] 非 schedule ⇒ 必須帶 EXPECT_CHECKSUM ⇒ 不寫新值(走 A1 帶舊值)。請用 dry-run 印的完整核對碼貼進 workflow_dispatch。`,
    });
    return { ok: false, missingKey: false, lines };
  }
  lines.push({ level: 'log', text: '[dealer-price] schedule 觸發且未提供 EXPECT_CHECKSUM ⇒ 日常同步, 照常跟上游' });
  return { ok: true, missingKey: false, lines };
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
  // 🔴 回 `null` = **讀取失敗**(錯誤 / 讀漏);回**空 Map** = 讀到了而該家一列都沒有(真的全新品)。
  //   🛑 **這兩者必須分得開** —— 把失敗當成空集合會讓既有品被當新品、`store` 蓋回 general,
  //     而 allowlist 關著時之後那些列走「既有品不輸出」⇒ **那個蓋掉是永久的, 不是一輪。**
  try {
    const { count, error: cErr } = await tgt
      .from('products')
      .select('external_id', { count: 'exact', head: true })
      .eq('supplier_slug', supplierSlug);
    // 🔴 走同一支 `parseCount`;讀不到 ⇒ 回 null(呼叫端判 A2), 不是零筆
    const c = parseCount(count, cErr);
    if (!c.ok) return null;
    const expected = c.count;
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
        // 🔴 走同一支 `parseAmount` —— jsonb **存什麼就回什麼**,所以 `amount` 可能是字串
        //   `"555"`。原本只收 `typeof === 'number'` ⇒ `"555"` 被讀成 null ⇒ 之後補成
        //   general ⇒ **allowlist 空仍會覆寫有效經銷價**。合成資料已重現 `"555" → 100`。
        //   🛑 而**真的沒有值**(缺 key / null / 非數字字串)仍要回 null —— 那才是「本來就沒有」。
        const p = parseAmount(r.price_by_tier?.store?.amount);
        out.set(r.external_id, p.kind === 'value' ? p.value : null);
      }
    }
    // 🔴 讀漏也要看得出來:相異鍵數 ≠ 應有筆數 ⇒ 回 null(呼叫端判 A2)
    return out.size === expected ? out : null;
  } catch {
    return null;
  }
}
