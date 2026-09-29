/**
 * indexnow-submit.ts —— 每日同步後, 把最近變動的商品網址送給 IndexNow(Bing 等搜尋引擎共用的通知協定)。
 *
 * 計畫:~/pcm-mailbox/計畫-IndexNow-20260929.md(Fable R1 FAIL → R2 PASS)。由 `.github/workflows/rpm-sync.yml`
 * 的 `indexnow` job 在完整的日常同步之後跑, 一天一批。
 *
 * 送哪些(最近 48 小時, R1 必修 3:備援排程下午才開跑, 26 小時會漏):
 *   ① `content_changed_at` 有變、目前上架中 —— 新上架、改價、改內容(migration 20260915220000 的 13 欄)
 *   ② `delisted_at` 有變、而且 `delisted_at > created_at` —— 下架;後台手動建立的商品建立時就是下架狀態,
 *      兩個時間相同 ⇒ 排除, 不把從未公開的網址送出去(R1 建議 5)
 *   ③ `admin_audit_log` 的 `product.listing.change` —— 重新上架不會動 content_changed_at(R1 建議 4)
 * 全部分頁撈(R1 必修 1:PostgREST 一次最多回 2000 列), 去重後每批 10,000 筆送出。
 *
 * 失敗只記錄、不擋同步:HTTP 失敗印一行 `::warning::`(run 頁最上方看得到)並寫 job summary, 仍 exit 0。
 * 只印件數與狀態碼, 不印網址清單、金鑰、request body 與回應原文。
 *
 * env:NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(只讀;anon 看不到下架列, 見計畫「影響」)、INDEXNOW_KEY。
 *   INDEXNOW_KEY 沒設 ⇒ 印一行就結束(exit 0), 什麼都不送 —— 刪掉 GitHub Secret 就能停用。
 * 用法:pnpm exec tsx scripts/indexnow-submit.ts [--dry-run] [--hours=48]
 */
import { loadEnvFile } from 'node:process';
import { appendFileSync, existsSync } from 'node:fs';
if (existsSync('.env.local')) loadEnvFile('.env.local');

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SITE = 'https://www.pcmmotorsports.com';
export const ENDPOINT = 'https://api.indexnow.org/indexnow';
export const BATCH_SIZE = 10_000;
export const LARGE_BATCH_WARN = 5_000;
const PAGE = 1000;

/** IndexNow 規範:8–128 字元, 只能是英數與連字號。 */
export function isValidKey(key: string | undefined): key is string {
  return typeof key === 'string' && /^[a-zA-Z0-9-]{8,128}$/.test(key);
}

export function buildUrls(handles: readonly string[], site: string = SITE): string[] {
  const seen = new Set<string>();
  for (const h of handles) {
    const t = h.trim();
    if (t) seen.add(`${site}/products/${encodeURIComponent(t)}`);
  }
  return [...seen];
}

export function chunk<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** 依序撈到不滿一頁為止;任一頁出錯就丟出(不靜靜回傳一半)。 */
export async function fetchAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<Page<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** 稽核紀錄的 target 是 `product:<uuid>`(20260819040000:169)⇒ 去掉前綴;其他種類不收。 */
export function productIdsFromAuditTargets(targets: readonly (string | null)[]): string[] {
  const ids = new Set<string>();
  for (const t of targets) {
    const m = typeof t === 'string' ? /^product:(.+)$/.exec(t) : null;
    if (m?.[1]) ids.add(m[1]);
  }
  return [...ids];
}

export type SubmitArgs = { host: string; key: string; keyLocation: string };
export type SubmitResult = { ok: boolean; status: number };

export async function submitBatch(
  urlList: readonly string[],
  args: SubmitArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitResult> {
  try {
    const r = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ...args, urlList }),
    });
    return { ok: r.status === 200 || r.status === 202, status: r.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** 產出要印的警告(每條單行, R2 nit:GitHub 的 ::warning:: 只顯示第一行)。 */
export function summarize(s: { urls: number; results: readonly SubmitResult[] }): { warnings: string[] } {
  const warnings: string[] = [];
  const failed = s.results.filter((r) => !r.ok);
  if (failed.length > 0) {
    const codes = [...new Set(failed.map((r) => r.status))].join('、');
    warnings.push(
      `::warning::IndexNow 送出失敗(狀態碼 ${codes}, ${failed.length}/${s.results.length} 批), 今天的變動沒有通知搜尋引擎;明天那一輪會用 48 小時的範圍再送一次。`,
    );
  }
  if (s.urls > LARGE_BATCH_WARN) {
    warnings.push(
      `::warning::IndexNow 這次有 ${s.urls} 個網址(超過 ${LARGE_BATCH_WARN}), 照樣送出;若不是真的有這麼多商品改動, 可能是資料整批變動(例如分類重對應)。`,
    );
  }
  return { warnings };
}

/** 三組查詢(見檔頭 ①②③)。export 給單測核查詢條件;db 只需要 from() 鏈。
 *  offset 分頁途中若有人下架商品(列消失)可能漏一列, 隔天 48 小時窗會補上。 */
export async function collectHandles(db: Pick<SupabaseClient, 'from'>, sinceIso: string): Promise<string[]> {
  type HandleRow = { handle: string | null; delisted_at?: string | null; created_at?: string | null };
  const changed = await fetchAllPages<HandleRow>((from, to) =>
    db.from('products').select('handle').is('delisted_at', null).gte('content_changed_at', sinceIso).order('id').range(from, to),
  );
  const delisted = await fetchAllPages<HandleRow>((from, to) =>
    db.from('products').select('handle, delisted_at, created_at').gte('delisted_at', sinceIso).order('id').range(from, to),
  );
  const audit = await fetchAllPages<{ target: string | null }>((from, to) =>
    db.from('admin_audit_log').select('target').eq('action', 'product.listing.change').gte('created_at', sinceIso).order('id').range(from, to),
  );
  const relistIds = productIdsFromAuditTargets(audit.map((a) => a.target));
  const relisted: HandleRow[] = [];
  for (const ids of chunk(relistIds, 200)) {
    const { data, error } = await db.from('products').select('handle').in('id', ids);
    if (error) throw new Error(error.message);
    relisted.push(...(data ?? []));
  }
  const handles = [
    ...changed,
    ...delisted.filter((r) => r.delisted_at && r.created_at && Date.parse(r.delisted_at) > Date.parse(r.created_at)),
    ...relisted,
  ].map((r) => r.handle ?? '');
  console.log(`候選:內容有變 ${changed.length}、下架 ${delisted.length}、上下架紀錄 ${relistIds.length}`);
  return handles;
}

function writeSummary(line: string): void {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (f) appendFileSync(f, `${line}\n`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const hours = Number(argv.find((a) => a.startsWith('--hours='))?.slice(8) ?? 48);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.log('::warning::IndexNow:--hours 要是正數, 這次沒有送出。');
    return;
  }
  const key = process.env.INDEXNOW_KEY?.trim();
  // 乾跑只算件數、不送 ⇒ 不需要金鑰(上線前先用正式庫唯讀乾跑看量)。
  if (!dryRun && !isValidKey(key)) {
    // 沒設 = 刻意停用(一般訊息);有設但格式不合 = 設錯了, 要讓人看到(R1 建議)。
    console.log(
      key
        ? '::warning::IndexNow:INDEXNOW_KEY 格式不合(要 8–128 個英數或連字號), 這次沒有送出。'
        : 'INDEXNOW_KEY 沒設 ⇒ 不送 IndexNow(刪掉 secret 就是停用)。',
    );
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    console.log('::warning::IndexNow:缺 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY, 這次沒有送出。');
    return;
  }
  const db = createClient(url, secret);
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const urls = buildUrls(await collectHandles(db, since));
  console.log(`最近 ${hours} 小時要通知的網址:${urls.length} 個`);
  if (dryRun || urls.length === 0 || !isValidKey(key)) {
    if (dryRun) console.log('乾跑 ⇒ 不送出。');
    return;
  }
  const args: SubmitArgs = { host: new URL(SITE).host, key, keyLocation: `${SITE}/indexnow-key.txt` };
  const results: SubmitResult[] = [];
  for (const batch of chunk(urls, BATCH_SIZE)) {
    const r = await submitBatch(batch, args);
    console.log(`送出 ${batch.length} 個 ⇒ 狀態碼 ${r.status}`);
    results.push(r);
  }
  const { warnings } = summarize({ urls: urls.length, results });
  for (const w of warnings) console.log(w);
  writeSummary(
    warnings.length === 0
      ? `IndexNow:已送出 ${urls.length} 個網址。`
      : warnings.map((w) => w.replace(/^::warning::/, '')).join('\n'),
  );
}

// 直跑才執行(單測 import 不觸發副作用)
const invokedDirectly = process.argv[1]?.endsWith('indexnow-submit.ts') ?? false;
if (invokedDirectly) {
  main().catch((e: unknown) => {
    // 失敗只記錄、不擋同步:讀資料庫失敗也印警告後正常結束。
    console.log(`::warning::IndexNow 沒有送出:${e instanceof Error ? e.message.split('\n')[0] : '未知錯誤'}`);
  });
}
