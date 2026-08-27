/**
 * image-trim-scan — 商品卡去白邊掃描:entry / orchestration
 *
 * plan 真權威 = docs/specs/2026-07-19-product-image-trim-plan.md v1.1 §3。
 * 目標(寫):pcm-website-v2 `product_image_trim`(service key;anon 無寫權=migration ACL)。
 * 來源:products(非下架)首圖 URL(`images[0]`、供應商公開 CDN)→ fetch bytes → sharp 量測
 *   (核心邏輯在 image-trim-core.ts、可單測)→ upsert(on conflict url)。
 *
 * 跑法(tsx devDep、走 pnpm exec;CI job 同):
 *   pnpm exec tsx scripts/image-trim-scan.ts                       → dry-run:列 worklist 統計+前 10 筆、不抓不寫
 *   pnpm exec tsx scripts/image-trim-scan.ts --confirm-write [--limit=800] [--full]
 *     → 增量掃(沒掃過的 + failed >7 天)並寫入;--full=全部重掃;--limit=上限(CI 用 800)
 *
 * env(repo 根 .env.local、不入 git;CI 走 secrets 注入):
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY(同 rpm-import 目標寫慣例)
 *
 * 紅線(plan §0/§3):
 *   - 單圖失敗絕不中斷批次、結尾 exit 0(CI job 不得因個別 CDN 壞圖翻紅)
 *   - exit 1 僅兩種:①env 缺=設定錯 ②DB upsert 逐列降級後仍有寫不進去的列
 *     (=資料本身違反 DDL CHECK 之類的真問題,非個別 CDN 抓圖失敗)
 *   - 同 host 併發 ≤2(禮貌上限)、逾時 15s、重試 1 次、單圖 ≤10MB
 *   - 只 fetch 供應商公開 CDN 圖 bytes;來源 URL 不改寫、不搬圖
 *   - 可續跑:增量=EXCEPT 已有列,中斷重跑自動接續(OP-首灌依此、無需 checkpoint 檔)
 */

import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
if (existsSync('.env.local')) loadEnvFile('.env.local');

import { createClient } from '@supabase/supabase-js';
import {
  analyzeImageBuffer,
  buildWorklist,
  nonOkRow,
  type ExistingRow,
  type TrimRow,
} from './image-trim-core';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 10 * 1024 * 1024;
const PER_HOST_CONCURRENCY = 2;
const GLOBAL_CONCURRENCY = 8;
const UPSERT_BATCH = 200;

type Args = { confirmWrite: boolean; full: boolean; limit?: number };

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { confirmWrite: false, full: false };
  for (const a of argv) {
    if (a === '--confirm-write') args.confirmWrite = true;
    else if (a === '--full') args.full = true;
    else if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (!Number.isInteger(n) || n <= 0) throw new Error(`invalid --limit: ${a}`);
      args.limit = n;
    } else throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

async function fetchImage(url: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const len = Number(res.headers.get('content-length') ?? '0');
      if (len > MAX_BYTES) throw new Error(`too large: ${len}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) throw new Error(`too large: ${buf.byteLength}`);
      if (buf.byteLength === 0) throw new Error('empty body');
      return buf;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** 全域 ≤8、同 host ≤2 的簡易排程(順序不保證;結果各自獨立無妨;export 供單測注入假 worker) */
export async function runPool(
  urls: readonly string[],
  worker: (url: string) => Promise<void>,
): Promise<void> {
  const queue = [...urls];
  const hostActive = new Map<string, number>();
  let active = 0;
  await new Promise<void>((resolve) => {
    const pump = () => {
      if (queue.length === 0 && active === 0) return resolve();
      for (let i = 0; i < queue.length && active < GLOBAL_CONCURRENCY; ) {
        const url = queue[i];
        if (url === undefined) break; // noUncheckedIndexedAccess 收窄;i<length 下實際不可達
        let host = '';
        try {
          host = new URL(url).host;
        } catch {
          /* 非法 URL 也交給 worker 記 failed */
        }
        if ((hostActive.get(host) ?? 0) >= PER_HOST_CONCURRENCY) {
          i++;
          continue;
        }
        queue.splice(i, 1);
        hostActive.set(host, (hostActive.get(host) ?? 0) + 1);
        active++;
        void worker(url)
          .catch(() => {
            /* 單項失敗不掛整池(entry worker 自 catch;此為第二道保險) */
          })
          .finally(() => {
          hostActive.set(host, (hostActive.get(host) ?? 0) - 1);
          active--;
          pump();
        });
      }
    };
    pump();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('missing env NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY');
    process.exit(1);
  }
  const db = createClient(url, key);

  // 1. 候選 URL:products 非下架首圖(.range 分頁繞 Max Rows 1000、對齊 fetchAllPaginated 慣例)
  const candidates: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select('images')
      .is('delisted_at', null)
      .order('id')
      .range(from, from + 999);
    if (error) {
      console.error(`read products failed: ${error.message}`);
      process.exit(1);
    }
    for (const row of data ?? []) {
      const first = Array.isArray(row.images) ? row.images[0] : null;
      if (typeof first === 'string') candidates.push(first);
    }
    if (!data || data.length < 1000) break;
  }

  // 2. 既有列(url/status/analyzed_at 全量分頁讀)
  const existing: ExistingRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('product_image_trim')
      .select('url,status,analyzed_at')
      .order('url')
      .range(from, from + 999);
    if (error) {
      console.error(`read product_image_trim failed: ${error.message}`);
      process.exit(1);
    }
    existing.push(...((data ?? []) as ExistingRow[]));
    if (!data || data.length < 1000) break;
  }

  const worklist = buildWorklist(candidates, existing, {
    full: args.full,
    now: Date.now(),
    limit: args.limit,
  });
  console.log(
    `candidates=${candidates.length} distinct-existing=${existing.length} worklist=${worklist.length} mode=${args.full ? 'full' : 'incremental'}`,
  );

  if (!args.confirmWrite) {
    console.log('dry-run(未帶 --confirm-write):不抓不寫。worklist 前 10 筆:');
    for (const u of worklist.slice(0, 10)) console.log(`  ${u}`);
    return;
  }

  // 3. 掃描(單圖失敗 → failed 列照寫、不中斷)
  const results: TrimRow[] = [];
  let done = 0;
  await runPool(worklist, async (imgUrl) => {
    try {
      const buf = await fetchImage(imgUrl);
      results.push(await analyzeImageBuffer(imgUrl, buf));
    } catch {
      results.push(nonOkRow(imgUrl, 'failed'));
    }
    done++;
    if (done % 200 === 0) console.log(`progress ${done}/${worklist.length}`);
  });

  // 4. upsert(batch;analyzed_at 交給 DB DEFAULT now() — upsert 需顯式帶避免沿用舊值)
  const nowIso = new Date().toISOString();
  let upsertFailures = 0;
  for (let i = 0; i < results.length; i += UPSERT_BATCH) {
    const batch = results.slice(i, i + UPSERT_BATCH).map((r) => ({ ...r, analyzed_at: nowIso }));
    const { error } = await db.from('product_image_trim').upsert(batch, { onConflict: 'url' });
    if (error) {
      // 🔴 一列違反 constraint 不得吞掉整批(更不得中止其餘批次、丟棄整趟掃描結果):
      //    降級逐列 upsert,壞列單獨記錄、其餘照寫(2026-07-19 首灌實證)。
      console.error(`upsert batch ${i / UPSERT_BATCH} failed (${error.message}) — 降級逐列`);
      for (const row of batch) {
        const { error: rowErr } = await db
          .from('product_image_trim')
          .upsert([row], { onConflict: 'url' });
        if (rowErr) {
          upsertFailures++;
          console.error(`  upsert row failed url=${row.url}: ${rowErr.message}`);
        }
      }
    }
  }

  const counts = { ok: 0, no_trim: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  console.log(
    `done scanned=${results.length} ok=${counts.ok} no_trim=${counts.no_trim} failed=${counts.failed} upsert_failures=${upsertFailures}`,
  );
  if (upsertFailures > 0) process.exit(1);
}

// 直跑才執行(單測 import parseArgs 不觸發副作用)
const invokedDirectly = process.argv[1]?.endsWith('image-trim-scan.ts') ?? false;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
