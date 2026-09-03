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
/**
 * 🔴 抽成【具名匯出的純函式】的理由:`main()` 沒有匯出 ⇒ 那個判準測不到,
 *   而**測試若自己重打一份門檻, 改了生產碼它不會紅**(今晚量過的同型:一格叫突變的測試
 *   把判準重打一份 ⇒ 改生產碼四格全綠)。⇒ ✅ 讓守門格與突變格呼叫**同一支函式**。
 *
 * 門檻 5% 的來源:`product_image_trim` 全表歷史分佈(唯讀查網站庫 2026-09-04,
 * 涵蓋 2026-07-19~09-02):ok 16,069 / no_trim 2,669 / **failed 26 = 0.14%**
 * ⇒ 5% ≈ 常態的 35 倍 ⇒ 🎯 **負對照:今天會叫 0 次。**
 */
export const FAILED_RATE_ABORT = 0.05;
export function shouldAbortOnFailedRate(failed: number, scanned: number): boolean {
  if (scanned <= 0) return false; // 掃 0 張 ⇒ 沒有分母 ⇒ 不叫(那是另一種問題, 不歸這一格管)
  return failed / scanned > FAILED_RATE_ABORT;
}

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

  // ══════════════════════════════════════════════════════════════════════════
  // 🔴🔴 2026-09-04:`failed` 這個數字【本來就在收】, 而【沒有任何東西在讀它】。
  //
  // 病史:dbk 首灌當天 Sean 本人回報「很多圖片都沒顯示」——
  //   🔬 實測 40 支 dbk 圖 ⇒ **39 支 502**;而**他們的首頁也是 502** ⇒ 掛的是供應商整個網站。
  //   🟢 同一發對照組(cncracing / bonamici / gilles / extreme / lightech)**40 支全 200**。
  //   🛑 而這支腳本當天照跑, 它會把那些記成 `failed` ⇒ **而它只在 upsert 失敗時才 exit 1**
  //      ⇒ 🎯 **⇒ 一個「供應商站掛了」與一個「一切正常」印同一個退出碼。**
  //
  // 🔵 **門檻怎麼來的(不是拍腦袋)**:讀 `product_image_trim` 全表的歷史分佈
  //   (唯讀查網站庫, 2026-09-04;涵蓋 2026-07-19 ~ 09-02):
  //     ok 16,069(85.64%) · no_trim 2,669(14.22%) · **failed 26(0.14%)**
  //   ⇒ 45 天的常態失敗率是 **0.14%** ⇒ 取 **5%** = 常態的 ~35 倍
  //   ⇒ 🎯 **⇒ 負對照的答案:這道閘在正常狀態【今天會叫 0 次】。**
  //   ⚠️ 而 5% 是**整批混合**的比率 —— 一家全掛(如 dbk 1,508/24,312 ≈ 6.2%)剛好過線,
  //      **而兩家一起掛才會明顯** ⇒ 📌 **這道閘偏向【晚叫】, 不是早叫。**
  //
  // 🛑 **天花板(明寫, 不要讀成保證)**:
  //   ① 它是**抽樣式增量掃**(CI 帶 `--limit=800`)⇒ 剛好沒抽到壞的那一批就不會叫 ⇒ **有偽陰**。
  //   ② 🔴🔴 **今天【沒有人會看到它】—— 這一格是量出來的, 不是保守估計。**
  //      🔬 `rpm-sync.yml:112` 的 `continue-on-error: true` 掛在 **job 層**(`image-trim-scan:`)
  //         ⇒ 這個 job 失敗**不會讓 workflow run 變成 failure** ⇒ 🛑 **連 GitHub 的預設失敗信都不會發。**
  //      🔬 而那支 workflow 唯一的告警管道就是它(該檔 `:29` 逐字:「告警:失敗走 GitHub Actions
  //         預設 email(寄給上次改本檔者);LINE/webhook 升級留 follow-up」)。
  //      🔬 而 repo 內**零腳本在讀** `Supplier Daily Sync` 的 run 結果(掃 `scripts/` + `docs/` + `.husky/`
  //         ⇒ 命中全是**文件在提到那個名字**, 不是讀取端)。
  //      🔬 而它與 push 那條路**結構上接不上**:`scripts/ci-verdict.py:35` 釘 `WORKFLOW = 'CI'`、
  //         `:87` 用 `head_sha` 查 —— 而本 workflow 名叫 `Supplier Daily Sync` 且是 **schedule 觸發,
  //         沒有 commit 可以綁**。⇒ 硬接等於造第二條資料路(主視窗 2026-09-04 裁「讀不到就不要硬接」)。
  //      ⇒ 🎯 **⇒ 所以這道閘現在的用途是:【有人去 Actions 頁面看的時候, 那一步是紅的】。**
  //      ⇒ ⇒ 📌 **一個沒有人讀的告警, 與沒有那個告警, 印同一個結果 —— 而前者更貴。**
  //         **這一句留在這裡, 直到它有一個真的收訊者為止。**
  //      🔵 而 `continue-on-error` **刻意不動**(主視窗 2026-09-04 裁):拿掉它 ⇒ 一家供應商的站掛了
  //         就會擋掉**其餘 16 家的價格同步** ⇒ 那個代價比它買到的大, 而觸發它的是我們控制不了的外部因素。
  //   ③ 它答不出「圖片內容對不對」—— 只答「那個網址現在給不給」。
  //
  // ✅ **出路寫在訊息裡**(而「紅了沒有出路會被整支刪掉」是量過的):
  //   訊息直接指到板列 ⟦supply-DBKIMGHOTLINK⟧, 讓看到紅的人知道下一步去哪, 而不是來關掉這一格。
  // ══════════════════════════════════════════════════════════════════════════
  if (shouldAbortOnFailedRate(counts.failed, results.length)) {
    const rate = counts.failed / results.length;
    console.error(
      `🔴 ALERT 圖片抓取失敗率 ${(rate * 100).toFixed(1)}% (${counts.failed}/${results.length}) ` +
        `超過 ${FAILED_RATE_ABORT * 100}% 上限。\n` +
        `   常態基線 0.14%(product_image_trim 全表 2026-07-19~09-02、26/18,764)⇒ 這不是雜訊。\n` +
        `   🔵 下一步不是關掉這一格:先確認是不是某一家供應商的站掛了\n` +
        `      (判法與前例:板列 ⟦supply-DBKIMGHOTLINK⟧ —— 打那家的【首頁】, 502 就是他們掛了)。`,
    );
    process.exit(1);
  }
}

// 直跑才執行(單測 import parseArgs 不觸發副作用)
const invokedDirectly = process.argv[1]?.endsWith('image-trim-scan.ts') ?? false;
if (invokedDirectly) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
