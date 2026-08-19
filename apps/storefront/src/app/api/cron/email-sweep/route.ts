// app/api/cron/email-sweep/route.ts — 交易信 outbox sweeper cron route(M-4a Email 片 E2a-c;plan v3.3 §5)
//
// 週期觸發(🔴 排程走 E2b 的 pg_cron〔*/5〕→ pg_net → 本 route;**本片不進 vercel.json crons**:Hobby cron 一天一次
// 放不了 5 分鐘一輪)→ 跑 sweepEmailOutbox(E2a-b use-case):①lease 回收 stale sending〔§⑩ 落 failed+lease_reclaimed〕
// ②claimDue CAS 認領 ③逐封順序寄送 → markSent/markFailed(email-backoff 退避)。E1c/E2a-a/E2a-b 立好的狀態機 + Resend
// Idempotency-Key = at-least-once 送達保證;寄信失敗絕不影響下單扣款(寫入在訂單交易外)。
//
// 🔴 部署 sequencing(誠實中間態;本片**不設** *_ENABLED gate,理由見 docs/specs/2026-07-18-m4a-email-e2a-c-plan.md
//    「決策與偏離」):與兩 sibling cron route(settle-sweep / anomaly-alert 皆掛 vercel.json、需 gate 擋自動觸發)不同,
//    本 route **不進 vercel.json**、firing 由 E2b 的 pg_cron 是否存在控制 = 天然開關。真寄前的自然閘 = ①ORDER_EMAIL_FROM
//    必填未設 → requireEnv throw → 503(= Sean 設 env 即 go)②E2b pg_cron 尚未排程 → 無人呼叫 ③E3 未落地 → email_outbox
//    零列 → sweep 全零 counts。三者疊起 = route 已 deploy 亦零副作用,無需額外 env gate。
// 🔴 **2026-08-19 更正:上面第 ② 個「天然閘」在 E2b 排程 apply 的那一刻就不成立了。**
//    新增的 `supabase/migrations/20260819160000_m4a_e2b_email_sweep_pgcron.sql` 就是去排那個 pg_cron
//    ⇒ apply 之後**每 5 分鐘真的會有人呼叫本 route**。
//    ⚠️ **而這句話變假的時候,不會有任何東西紅** —— 那支 migration 的 diff 裡沒有本檔,
//    測試不會動、型別不會動。**它是【另一支檔的動作】讓【這一句】過期。**
//    ⇒ 剩下的閘只有 ① 與 ③:`ORDER_EMAIL_FROM` 未設 → 503、`B4_DEPLOY_CUTOFF` 未設 → 200
//      且 `enqueueStatus:'skipped_no_cutoff'`(**不寄任何信**)。
//      ⇒ 🔴 **真正的「上膛」動作是設 `B4_DEPLOY_CUTOFF`**,不是排程。
//
// 🔴 鐵則 12(cron 端點 + 威脅模型;鏡像 settle-sweep / anomaly-alert route):
//   1. 認證 = CRON_SECRET Bearer 硬驗 + timingSafeEqual:env 未設/弱 → 500 fail-closed(設定錯、拒不執行);
//      Bearer 缺/不符 → 401(不揭內部)。pg_net 呼叫時帶 `Authorization: Bearer ${CRON_SECRET}`(E2b 設定)。
//   2. 認證+限流過後 deps/env 缺(requireEnv throw:RESEND_API_KEY / ORDER_EMAIL_FROM)→ 503;本輪寄送有失敗
//      (result.errors>0)→ 503 + 結構化 counts log(零 PII)、**不可吞成 200 偽裝成功**(壞掉的 sweeper 靜默不寄
//      = 客人永遠收不到信、無人知)。🔴 result.deferred>0 = 時間預算調參訊號、**非錯誤**、不 503。
//   3. 不採信任何外部輸入:無 client 參數 / 無 query / 無 body;claimLimit/lease 皆 route 端常數。回應 **counts-only
//      allowlist**(顯式挑 7 個數值欄、不 blind spread ...result;recipient_email 只進 sender.send 的 to、物理擋 PII)。
//   4. 🔴 **零告警**(Sean Q13=A;plan §3.6):五訊號全歸 E2a-2 獨立管道 —— sweeper 不可自我監看(死時告警一起死)。
//      本 route 只回 counts、零告警管道注入,判讀交給獨立 cron。
//
// 🔴 GET handler(pg_net 走 GET;寫成 POST 等 → 永不觸發 = 靜默不寄)。
// 🔴 不變式(lazy 跨包契約、鏡像 settle-sweep route 警語):getSweepEmailOutboxDeps factory **必須維持 lazy**——env 在
//    呼叫時才讀、零 module-top;認證/限流未過即在建 deps 前 return。改 @/lib/email/composition 前必守此 lazy 契約。
//
// @see docs/specs/2026-07-16-m4a-email-notify-plan.md §5(E2a-c)
// @see docs/specs/2026-07-18-m4a-email-e2a-c-plan.md
// @see packages/use-cases/src/sweep-email-outbox.ts(E2a-b use-case)

import { timingSafeEqual } from 'node:crypto';
import {
  enqueueOrderCreatedEmails,
  sweepEmailOutbox,
  type EnqueueOrderCreatedEmailsDeps,
  type SweepEmailOutboxDeps,
} from '@pcm/use-cases';
import { getEnqueueOrderCreatedDeps, getSweepEmailOutboxDeps } from '@/lib/email/composition';
// eslint-disable-next-line no-restricted-imports -- 受控例外:只取型別守衛用的錯誤類別(不建任何 adapter);它只帶 stage/code 兩個固定欄、零 PII。
import { ScanQueryError } from '@pcm/adapters/server';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * 🔴 函式 timeout 60s(對齊 settle-sweep / anomaly-alert)。
 * 🔴 **同時 = sweepEmailOutbox 的 `maxRunSeconds` 申告值**(單一來源:GET 內直接引用本 const,不寫第二個字面 →
 *    物理上不可能漂移;route.test 另有 source-contract 斷言鎖 `maxRunSeconds: maxDuration` 引用式):平台在此時限
 *    kill function = 單輪最長執行時間的物理保證來源(E2a-b use-case 檔頭:lease 硬下界 = max(3600, maxRunSeconds+300),
 *    申告值錯 → lease 下界算錯 → 系統性重複寄信)。
 */
export const maxDuration = 60;

/** CRON_SECRET 最小長度(code enforce 防 env 誤設短字串;沿 settle-sweep requireCronSecret)。 */
const MIN_SECRET_LEN = 32;
/** Bearer 前綴(pg_net `Authorization: Bearer ${CRON_SECRET}`;含尾空格)。 */
const BEARER_PREFIX = 'Bearer ';

/**
 * 🔴 每輪認領上限 = route 端常數(不採信外部輸入;營運參數、揭示可調)。
 * PCM 量級 10-30 封/日 << 50;concurrency=1 順序寄送(use-case 內建)+ 單封 ~數百 ms → 單輪最壞遠 < maxDuration 60s。
 * 對齊 settle-sweep per-round 50。死列不佔窗(port claimDue = 認領上限、非掃描上限)。
 */
const CLAIM_LIMIT = 50;

/**
 * 🔴 lease 長度(秒)= 3600(plan §3.5-4「lease ≥1h」建議值)。use-case 硬下界 = max(3600, maxRunSeconds+300)
 * = max(3600, 360) = 3600 → 本值恰通過(違反即 sweepEmailOutbox throw)。lease 遠大於 maxDuration → 在途列不會被
 * 誤判 stale(否則原持有者仍寄出 + 回收翻 failed 再認領 = 重複寄信,只剩 Resend 24h key 兜)。
 */
const LEASE_SECONDS = 3600;

/**
 * 🔴🔴 **M-4a B-5 掃描式 enqueue 的 cutoff:唯一事實在這裡,不必去讀 plan 或 commit body。**
 *
 * ```
 * env 沒設        ⇒ enqueueStatus = 'skipped_no_cutoff'   整段不跑、200
 * env 格式/日期不合 ⇒ enqueueStatus = 'skipped_bad_cutoff'  整段不跑、🔴 503(填錯了要吵)
 * env 合法        ⇒ 執行掃描 ⇒ 'completed'(整段成功;單筆失敗看 enqErrors)或 'failed'(整段爆掉)
 * ```
 * ⇒ **啟用方式 = 在 Vercel 設這顆 env。不必改 code、不必推一顆新 commit ——
 *   🔴 但【必須產生一個讀得到新 env 的 deployment】(redeploy)。**
 *   設定完不 redeploy 的話,現行 deployment 還是讀不到它 ⇒ 你會看到 `skipped_no_cutoff` 而以為設錯了。
 * ⇒ **監控要看的是 `enqueueStatus`** —— ~~舊版那個 `enqueueSkipped` 布林已經不存在~~。
 *
 * 🔴 **申報偏離(plan §4 原本寫「本片讀常數、不代填」)**:改成讀 env。
 *    理由是 codex 關卡2 R3 must-fix 3 —— 寫死 `null` 的常數讓**啟用之後的主要路徑一格測試都跑不到**,
 *    而那條路上有兩發真行為突變會存活(不 `await`、不接結果)。
 *    ⚠️ env **不是 client 輸入**(server 端),仍然守「零 client 輸入」那條。
 */
const CUTOFF_ENV = 'B4_DEPLOY_CUTOFF';

/**
 * ISO 8601 UTC 的**形狀**(毫秒可有可無)。
 * 🔴 **形狀對 ≠ 日期存在**(codex 關卡2 R4 must-fix 3):`2026-13-40T25:61:61Z` 過得了這個正則。
 *    那種值會一路送進 PostgREST,失敗在那裡 ⇒ 回 `failed` + `stage=orders` + DB code
 *    ⇒ **接手的人會往權限 / schema / 網路查,而不是去看 env** —— 我們設計的分流當場失效。
 *    ⇒ 所以下面還要做一次 **round-trip**:parse 回 Date、再 `toISOString()` 比對回來。
 */
const ISO_UTC_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

type CutoffRead =
  | { kind: 'unset' }
  | { kind: 'invalid' }
  | { kind: 'ok'; cutoff: string };

/**
 * 🔴 **不准隨便填一個看起來合理的時戳**:
 * · 填【早】了 ⇒ 掃到 B-4 之前建的舊單 ⇒ 那些單 `notification_email` 是 NULL ⇒ 走 `customers.email`
 *   ⇒ **客人收到一封關於幾個月前那張單的通知信**,而 repo 內不會有任何東西紅。
 * · 填【晚】了 ⇒ 已由 B-4 新程式處理、但 `created_at < cutoff` 的單**被永久排除**
 *   ⇒ 少數客人沒收到信,而 route 一路 200、counts 正常(codex R3 consider:這一種更不明顯)。
 * ⇒ **啟用前必須先定義「部署瞬間」到底指哪一刻**(deployment ready / alias 切換 / 第一個新版本 request /
 *   最後一個舊版本 request 結束),並對邊界區間做一次性對帳。**那件事不在本片,已寫進 plan §4.3。**
 */
function readCutoff(): CutoffRead {
  // eslint-disable-next-line no-restricted-syntax -- 受控例外:本 route 為 server-only cron 端點,動態 env 不進 client bundle(鏡像 lib/email/composition.ts requireEnv)
  const raw = process.env[CUTOFF_ENV];
  // 🔴 `raw === undefined` 才是「沒設」(codex 關卡2 R5 must-fix)。
  //    原本寫 `!raw` ⇒ **env 設了、但值是空字串** 會被判成「沒設」⇒ 回 200 `skipped_no_cutoff`
  //    ⇒ 有人設定填錯(貼成空值)而**整件事安靜地沒發生**,正是本片一直在防的那種壞法。
  //    空字串過不了下面的形狀檢查 ⇒ 落 `invalid` ⇒ 503,吵得出來。
  if (raw === undefined) return { kind: 'unset' };
  if (!ISO_UTC_SHAPE.test(raw)) return { kind: 'invalid' };
  // 🔴 round-trip:`Date` 對 `2026-13-40T25:61:61Z` 會回 Invalid Date;
  //    對「形狀合法但被正規化過」的值(例 `2026-02-30`)則會回到不同的字面 ⇒ 一併擋掉。
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return { kind: 'invalid' };
  const normalized = parsed.toISOString();
  if (normalized !== raw && normalized !== `${raw.slice(0, 19)}.000Z`) return { kind: 'invalid' };
  return { kind: 'ok', cutoff: raw };
}

/**
 * 🔴 單輪 enqueue 上限 = route 端常數(不採信外部輸入)。
 *
 * 🔴🔴 **不要因為調了 `CLAIM_LIMIT` 就「順手同步」這一顆**(codex 關卡2 R4 must-fix 1;
 *    ~~原註解寫「兩者同量級、不同步沒有意義」,那句話是錯的~~)。**它們控制的是不同的東西**:
 * ```
 * ENQUEUE_LIMIT 控制「這一輪【寫】幾列進 outbox」⇒ 成本 = orders/outbox/customers 的讀 + outbox 的寫
 * CLAIM_LIMIT   控制「這一輪【寄】幾封」        ⇒ 成本 = Resend 呼叫 + 寄送時間預算
 * ```
 * 兩者中間隔著一個 **既有 backlog** —— 這一輪排進去的信**不保證就是這一輪認領的那批**。
 * ⇒ 調任一顆之前先問:**我要解的是「排不夠快」還是「寄不夠快」?** 答錯就把放大面調大了:
 *    持有 `CRON_SECRET` 的人可以高頻觸發,兩顆一起調大 = DB 讀量與 outbox 寫入量一起放大
 *    (限流是 per-instance best-effort,不是全域硬上限,見 `lib/cron/rate-limit.ts`)。
 */
const ENQUEUE_LIMIT = 50;

/** 等長 constant-time 比對;長度不等先回 false(timingSafeEqual 要求等長 Buffer;沿 settle-sweep safeEqual)。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 讀 + 強度驗 CRON_SECRET;未設 / <32 → throw(route 接 → 500 fail-closed;沿 settle-sweep）。 */
function requireCronSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s || s.length < MIN_SECRET_LEN) {
    throw new Error('CRON_SECRET 未設或強度不足(需 ≥32)');
  }
  return s;
}

/**
 * 🔴 counts allowlist(codex 關卡2 must-fix:route 邊界**顯式挑** SweepEmailOutboxResult 的 7 個數值欄,
 * **不 blind spread `...result`** → use-case 日後誤增 recipient_email 等診斷/PII 欄時,blind spread 會靜默洩進
 * log / HTTP 回應;顯式挑欄 = 物理擋、非約定。全欄皆數值 counts、零 PII)。
 */
function pickCounts(result: {
  reclaimed: number;
  claimed: number;
  sent: number;
  failed: number;
  deferred: number;
  staleMarks: number;
  errors: number;
}) {
  return {
    reclaimed: result.reclaimed,
    claimed: result.claimed,
    sent: result.sent,
    failed: result.failed,
    deferred: result.deferred,
    staleMarks: result.staleMarks,
    errors: result.errors,
  };
}

/**
 * 🔴 enqueue 的 counts allowlist(同 `pickCounts` 的理由:**顯式挑欄、不 blind spread**)。
 * use-case 日後誤增診斷欄時,blind spread 會把它靜默洩進 HTTP 回應與 log。
 */
/**
 * 🔴 **取捨已明寫(codex 關卡2 R4 consider,決定=保留)**:本 route 的 200/503 body 會把
 * 掃描量 / 頁數 / 截斷 / 重複 / 缺收件人 / 寄送量這些**營運數字**回給呼叫者。
 * 它不是 PII,但**有商業與系統偵察價值**(能推估合格訂單量、backlog、缺收件資料比例、B-5 有沒有啟用)。
 * ⇒ **`CRON_SECRET` 在本 route 的定義因此是「同時授權讀取營運 telemetry」**,不只是「授權觸發」。
 *   這與既有 sweep counts(`sent`/`failed`/`claimed`…)的信任面**同級**,本片沒有擴大它。
 * ⇒ 要收窄的話是**整支 route 的契約改動**(連既有七欄一起),不是本片單獨加的這幾欄的事。
 */
function pickEnqueueCounts(result: {
  scanned: number;
  scannedPages: number;
  truncated: boolean;
  enqueued: number;
  skippedNoRealEmail: number;
  duplicate: number;
  noRecipient: number;
  errors: number;
}) {
  return {
    enqScanned: result.scanned,
    enqScannedPages: result.scannedPages,
    enqTruncated: result.truncated,
    enqEnqueued: result.enqueued,
    enqSkippedNoRealEmail: result.skippedNoRealEmail,
    enqDuplicate: result.duplicate,
    enqNoRecipient: result.noRecipient,
    enqErrors: result.errors,
  };
}

export async function GET(request: Request): Promise<Response> {
  // 1. 認證:CRON_SECRET Bearer 硬驗。env 未設/弱 → 500(設定錯、拒不執行);Bearer 缺/不符 → 401(不揭內部)。
  let expected: string;
  try {
    expected = requireCronSecret();
  } catch {
    return new Response(null, { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  const presented = auth.startsWith(BEARER_PREFIX) ? auth.slice(BEARER_PREFIX.length) : '';
  if (!safeEqual(presented, expected)) {
    return new Response(null, { status: 401 });
  }

  // 1b. 🔴 應用層限流(#254 縱深 hardening):認證通過「後」才計數 → 未持有效 secret 的 flood 不佔額度、不餓死合法
  //     cron;真正威脅 = CRON_SECRET 洩漏後持有效 secret 高頻觸發放大 Resend 寄送 + 額度耗盡。超限 → 429,在建 deps /
  //     寄送「前」擋掉。🔴 per-instance best-effort、非全域硬上限(見 lib/cron/rate-limit.ts 誠實邊界);secret 洩漏
  //     的主對策仍是輪替 CRON_SECRET。不 log(避免每筆被擋請求放大成 log 量 = 二次濫用面)。key='email-sweep'、與
  //     兩 sibling route 各自獨立額度。
  if (!checkCronRateLimit('email-sweep')) {
    return new Response(null, { status: 429 });
  }

  // 2. 建 deps + 跑 sweepEmailOutbox。
  //    deps 建構(getSweepEmailOutboxDeps)缺 env → requireEnv throw → 503 fail-closed(不偽 200;= 真寄前的自然閘)。
  //    🔴 零 PII:deps 建構子純存 client/密鑰(零連線/零 throw〔除 requireEnv env-name 固定訊息〕);sender/DB
  //    錯誤在 use-case/adapter 內 sanitize + per-job try/catch → result.errors,不外拋至此。
  // 1c. 🔴 M-4a B-5:**先排信、再寄信**,而且用**自己的 deps**(plan §3.1)。
  //     順序是承重的,不是美觀:`getSweepEmailOutboxDeps()` 會 requireEnv Resend 兩顆,缺就 throw ⇒ 503
  //     ⇒ 若把 enqueue 放在它後面(或共用它的 deps),Resend 沒設好的期間**連排進 outbox 都不會發生**。
  //     🔴 這一段自己包 try/catch:**掃描壞掉不得阻止 sweeper 把【已經排好的】信寄出去**。
  //     🔴 `enqueueStatus` 四態互斥(codex 關卡2 R3 must-fix 2)——
  //        原本「沒設 cutoff」與「跑了但爆掉」共用同一個 `enqueueSkipped: true`,
  //        凌晨三點看到 `503 + enqueueSkipped:true` **判不出是刻意跳過還是執行失敗**。
  const cutoffRead = readCutoff();
  let enqueueCounts: ReturnType<typeof pickEnqueueCounts> | null = null;
  let enqueueStatus: 'skipped_no_cutoff' | 'skipped_bad_cutoff' | 'completed' | 'failed' =
    cutoffRead.kind === 'unset'
      ? 'skipped_no_cutoff'
      : cutoffRead.kind === 'invalid'
        ? 'skipped_bad_cutoff'
        : 'completed';
  if (cutoffRead.kind === 'invalid') {
    console.error('[email-sweep] 🔴 B-5 cutoff 格式不合(需 ISO 8601 UTC)⇒ 整段 enqueue 不跑', {
      env: CUTOFF_ENV,
      reason: 'bad_cutoff_format', // 🔴 只印 env 名與固定 reason,**不印那個值**
    });
  }
  if (cutoffRead.kind === 'ok') {
    try {
      const enqueueDeps: EnqueueOrderCreatedEmailsDeps = getEnqueueOrderCreatedDeps();
      enqueueCounts = pickEnqueueCounts(
        await enqueueOrderCreatedEmails(enqueueDeps, {
          cutoff: cutoffRead.cutoff,
          limit: ENQUEUE_LIMIT,
        }),
      );
    } catch (err) {
      enqueueStatus = 'failed';
      // 🔴 只 allowlist 兩個【我們自己產的固定欄】(階段名 + PostgREST code),不碰 message/stack/cause。
      //    沒有這兩欄的話,權限壞 / schema 漂 / 網路 reject 在 log 上長得一模一樣(R3 must-fix 2)。
      const scan = err instanceof ScanQueryError ? { stage: err.stage, code: err.code } : {};
      console.error('[email-sweep] 🔴 B-5 enqueue 整段失敗(不擋 sweeper;本輪最後回 503)', {
        reason: 'enqueue_scan_throw',
        ...scan,
      });
    }
  }
  const enqueueSection = { enqueueStatus, ...(enqueueCounts ?? {}) };

  try {
    const deps: SweepEmailOutboxDeps = getSweepEmailOutboxDeps();
    // 🔴 maxRunSeconds = maxDuration 同一 const(單一來源、不寫第二字面);leaseSeconds/claimLimit = route 端常數。
    const result = await sweepEmailOutbox(deps, {
      claimLimit: CLAIM_LIMIT,
      maxRunSeconds: maxDuration,
      leaseSeconds: LEASE_SECONDS,
    });
    const counts = pickCounts(result); // 🔴 PII allowlist(見 pickCounts):不 blind spread ...result

    // 3. 🔴 本輪有寄送/段級失敗 → 503 + 結構化 counts log,**不偽 200**(壞掉的 sweeper 必須可見)。
    //    result.errors = 單封 throw(合約違反 / order_shipped fail-closed / mark* DB 錯)或段級(回收 / claim)throw;
    //    >0 → 下輪 cron 重試(列留 sending 由下輪 ① 回收、at-least-once)。🔴 result.deferred>0 = 時間預算耗盡的
    //    調參訊號(claimLimit 相對 maxRunSeconds 太大)、**非錯誤、不 503**。counts only 零 PII。
    // 🔴 B-5:enqueue 那半的失敗**同樣不可吞成 200**(單筆 errors 或整段 throw 都算)。
    // 🔴 `skipped_bad_cutoff` 也算失敗:env 填錯了而沒有人會發現,正是本片要防的那種安靜壞掉。
    if (
      result.errors > 0 ||
      enqueueStatus === 'failed' ||
      enqueueStatus === 'skipped_bad_cutoff' ||
      (enqueueCounts?.enqErrors ?? 0) > 0
    ) {
      console.error('[email-sweep] 🔴 本輪有失敗(回 503;不吞成 200 偽裝成功)', {
        ...counts,
        ...enqueueSection,
      });
      return Response.json({ ok: false, ...counts, ...enqueueSection }, { status: 503 });
    }

    // 4. 認證過 + 無錯 → 200 + 計數摘要(零 PII counts;含 deferred 供調參可見度)。
    return Response.json({ ok: true, ...counts, ...enqueueSection }, { status: 200 });
  } catch {
    // deps/env 缺(requireEnv throw)或非預期 throw(如 lease 下界違反)→ 503 fail-closed(不偽 200)。
    // 🔴 固定 reason code(零 PII、零洩漏面;不把任意 err.message 入 log 縱深、杜絕密鑰 drift 帶進 log)。
    console.error('[email-sweep] 🔴 sweeper 無法執行(deps/env 缺或非預期 throw、回 503;不吞 200 偽裝成功)', {
      reason: 'deps_or_unexpected_throw',
    });
    return new Response(null, { status: 503 });
  }
}
