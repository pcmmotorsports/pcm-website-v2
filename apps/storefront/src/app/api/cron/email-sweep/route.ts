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
//      allowlist**(顯式挑欄、不 blind spread ...result;recipient_email 只進 sender.send 的 to、物理擋 PII)。
//      ⚠️ **欄數不寫死**(2026-08-30 由 8 → 10;寫死的數字會在下一次加欄時安靜地變假)—— `pickCounts` 那張清單才是權威。
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
  enqueueOrderShippedEmails,
  readDeployCutoff,
  resolveShippedEmailCutoff,
  sweepEmailOutbox,
  type DeployCutoffRead,
  type EnqueueOrderCreatedEmailsDeps,
  type EnqueueOrderShippedEmailsDeps,
  type SweepEmailOutboxDeps,
} from '@pcm/use-cases';
import {
  getEnqueueOrderCreatedDeps,
  getEnqueueOrderShippedDeps,
  getSweepEmailOutboxDeps,
} from '@/lib/email/composition';
// eslint-disable-next-line no-restricted-imports -- 受控例外:只取型別守衛用的錯誤類別(不建任何 adapter);它只帶 stage/code 兩個固定欄、零 PII。
import { ScanQueryError } from '@pcm/adapters/server';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';
import { CRON_JOB_NAME, recordHeartbeatSuccess, recordHeartbeatFailure } from '@/lib/cron/heartbeat';

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
 *
 * ⚠️ **「單封 ~數百 ms」是【未量測】的**(codex R3 nit,2026-08-30)——
 * repo 內查無 Resend 單封延遲的量測或紀錄,那個數字是估的,不是量到的。
 * 🔵 而 ⟦b4-SWEEPBUDGET1⟧ 把可寄窗口從 60s 收緊成 55s ⇒ **這個沒被量過的前提被收得更緊**。
 * ⇒ 誠實的界線:超量不會壞掉正確性,會走既有的 `deferred`(剩餘列留 sending、下輪回收)
 *   ⇒ 症狀是「信慢了一輪」,不是「信不見了」。
 * ⇒ 要拿掉這個「未量」標記,缺的檢查是:在真環境記一輪的實際耗時與封數,不是再估一次。
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
 * 🔴 **`B4_DEPLOY_CUTOFF` 的解析已搬到 `@pcm/use-cases` 的 `readDeployCutoff`**(2026-08-31,線出貨)。
 * ⛔ ~~原本這裡有一份本地的 `ISO_UTC_SHAPE` / `CutoffRead` / `readCutoff`~~
 * ⇒ 訊號 4 的告警端要讀**同一顆 env**;各寫一份 ⇒ **兩個消費者、兩套驗證**
 * ⇒ 而那個病同一天在 `SHIPPED_EMAIL_CUTOFF` 上量到過:
 *   寄信端有格式檢查與下界、告警端只 `trim()` ⇒ 設一個早於下界的值
 *   ⇒ **寄信端擋下一封不寄,而告警端收下照數** ⇒ 告警叫一件寄信端做不到的事。
 * 🛑 **搬移是【搬】不是【複製】** —— 這裡不留第二份;那些理由(round-trip、
 *   `raw === undefined` 才算沒設)全部跟著搬過去,逐字未改。
 */
type CutoffRead = DeployCutoffRead;

function readCutoff(): CutoffRead {
  // eslint-disable-next-line no-restricted-syntax -- 受控例外:本 route 為 server-only cron 端點,動態 env 不進 client bundle(鏡像 lib/email/composition.ts requireEnv)
  return readDeployCutoff(process.env[CUTOFF_ENV]);
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
 * 🔴 counts allowlist(codex 關卡2 must-fix:route 邊界**顯式挑** SweepEmailOutboxResult 的數值欄(**欄數不寫死**),
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
  /**
   * 本輪因預算已用盡而**沒去認領**(⟦b4-SWEEPBUDGET1⟧)。0 或 1。
   * 🔴 它與 `claimDue` 掛掉的 counts 完全相同 ⇒ **這一欄是唯一分得開的那個字**,
   *    凌晨三點靠它決定要查 enqueue 耗時還是查 DB。同時計 `errors` ⇒ 503 由 errors 帶。
   */
  budgetExhaustedBeforeClaim: number;
  /** 訂單已不合格而正確地沒寄(Sean 2026-08-30「甲 搬」)。非錯誤 ⇒ 不進 503 條件。 */
  skippedIneligible: number;
  /**
   * 合格性【讀不到】而保守地沒寄。⚠️ 與上面那欄是兩個世界:上面是「確定不合格」,
   * 這欄是「不知道」。它同時計 `errors` ⇒ **503 那一格由 `errors` 帶,不必在這裡重複判**。
   */
  eligibilityUnknown: number;
  quotaFailed: number;
  /**
   * 箱被作廢而正確地沒寄(M-4b E4 片3b)。**非錯誤 ⇒ 不進 503 條件** ——
   * 併進去的話,一個員工按「作廢重開」就會讓 cron 回 503、心跳掉、有人半夜起來查。
   */
  skippedShipmentVoided: number;
}) {
  return {
    reclaimed: result.reclaimed,
    claimed: result.claimed,
    sent: result.sent,
    failed: result.failed,
    deferred: result.deferred,
    staleMarks: result.staleMarks,
    budgetExhaustedBeforeClaim: result.budgetExhaustedBeforeClaim,
    errors: result.errors,
    skippedIneligible: result.skippedIneligible,
    eligibilityUnknown: result.eligibilityUnknown,
    quotaFailed: result.quotaFailed,
    skippedShipmentVoided: result.skippedShipmentVoided,
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

/**
 * 🔴 出貨線 enqueue 的 counts allowlist(同 `pickEnqueueCounts` 的理由:**顯式挑欄、不 blind spread**)。
 * 前綴 `shp` 與訂單成立線的 `enq` 分開 —— 兩條線的數字混在同一個平坦物件裡會被讀成同一件事。
 */
function pickShippedEnqueueCounts(result: {
  scanned: number;
  truncated: boolean;
  enqueued: number;
  skippedNoRealEmail: number;
  duplicate: number;
  noRecipient: number;
  errors: number;
}) {
  return {
    shpScanned: result.scanned,
    shpTruncated: result.truncated,
    shpEnqueued: result.enqueued,
    shpSkippedNoRealEmail: result.skippedNoRealEmail,
    shpDuplicate: result.duplicate,
    shpNoRecipient: result.noRecipient,
    shpErrors: result.errors,
  };
}

export async function GET(request: Request): Promise<Response> {
  // 🔴🔴 **平台的碼表從這一行按下去**(`⟦b4-SWEEPBUDGET1⟧`,2026-08-30)。
  //    `maxDuration` 是平台 kill 這個 function 的上界,而它算的是**整個請求**,
  //    不是 `sweepEmailOutbox` 那一段。在這一行之前,sweeper 的時間預算從**它自己**起算
  //    ⇒ 前面兩段 enqueue 花掉的時間沒有被扣掉 ⇒ 它以為自己還有滿滿 60 秒
  //    ⇒ 平台可能在「Resend 已收下、`markSent` 還沒寫」那一格 kill ⇒ 回收 ⇒ **重寄**。
  //    ⇒ 所以要在**最前面**取,不是在 sweep 呼叫點旁邊取(那樣就又變成從自己起算了)。
  const invocationStartedAtMs = Date.now();
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

  // ── 1d. 🔴 M-4b E4 片3b:出貨通知信的掃描式 enqueue ────────────────────────────
  //     **與上面那一段完全平行**(自己的 deps、自己的 try/catch、自己的 env),
  //     而它們刻意**不共用 cutoff** —— 兩條線是分別上線的,起始線不是同一刻。
  //
  // 🔴🔴 **這一段【不會讓任何信寄出去】,而唯一讓它寄的是 Sean 手上那顆 env**:
  //     `SHIPPED_EMAIL_CUTOFF` 沒設 ⇒ `not-configured` ⇒ 整段不跑 ⇒ 一列都不排 ⇒ 一封都不寄。
  //     ⇒ 📌 **真正的開關在他手上,不在這一顆 commit 上。這是安全的預設,而整片依賴它。**
  //
  // ── 🛑🛑 **上膛的【順序】,而它有一個前置不是 env**(Fable 2026-08-30 R3 must-fix 1)──
  // ```
  // ① 先 apply supabase/migrations/20260830060000_m4b_e4_outbox_shipment_voided_status.sql
  // ② 再設 SHIPPED_EMAIL_CUTOFF
  // ③ 再 redeploy（新 env 只有新的 deployment 讀得到）
  // ```
  //     🔴 **① 不能省,而省了不會馬上出事** —— 那支 migration 給 `email_outbox.status`
  //     加第七態 `skipped_shipment_voided`,而它**還不在 `supabase/APPLIED.tsv` 上**
  //     (2026-08-30 實查 `grep -c` ⇒ **0**;負對照用當場生成的隨機字面 ⇒ 0;
  //      正對照:帳本尾端三筆都在 ⇒ 尺是活的)。
  //     ⇒ 沒 apply 就上膛 ⇒ 正式庫的 CHECK 只認六態
  //     ⇒ **第一個「排完信才被作廢」的箱** ⇒ `markSkippedShipmentVoided` 被 **23514 拒**
  //     ⇒ `errors++` ⇒ 503 ⇒ 那一列燒完 attempts 進死信 ⇒ anti-join 永久佔住去重鍵
  //     ⇒ 📌 **一個【正常的業務動作】變成半夜告警,而那封信永久消失。**
  //     ⚠️ 而 `scripts/deploy-order-gate.sh` 掃的是 `.from()` / `.rpc(` ——
  //        **一個寫進 adapter 的 status 字面值對它是隱形的** ⇒ **沒有機制會擋這一條,只有這段話。**
  //
  // ── 🛑 **而【關掉】它也要 redeploy**(R3 must-fix 2)──────────────────────────
  //     ⛔ ~~「把 env 拿掉 ⇒ 寄信就停下來」~~ —— **那句話漏了一步。**
  //     Vercel **刪掉** env 與**設定** env 一樣,只對**新的 deployment** 生效
  //     ⇒ 出事那天刪掉它、以為停了,而**現行 deployment 每五分鐘照樣寄**。
  //     ✅ 停下來的完整動作 = **刪 env ⇒ redeploy ⇒ 看下一輪的 `shippedEnqueueStatus`
  //        是不是 `skipped_no_cutoff`**(那一格才是「真的停了」的證據,不是「我刪過了」)。
  //     ⚠️ 而**已經排進 outbox 的列不受 env 影響**是【另一件事】,由下面那個
  //        `allowOrderShipped` 旗標擋 —— 它與 env 同源,所以刪 env + redeploy 之後兩半一起關。
  //
  // 🔴 `bad-format` ⇒ **503**(與 `skipped_bad_cutoff` 同款):填錯了要吵。
  //    那支純函式的 `why` **不印進 log 的值欄** —— 它是我們自己寫的固定字串、零 PII,
  //    印它是為了讓凌晨三點看 log 的人知道**該去改 env 而不是去查 DB**。
  // 🔴🔴 **「有沒有設」與「設得對不對」是兩個問題,而它們住在兩層。**
  //    `resolveShippedEmailCutoff` 的簽章吃 `string | undefined | null`,它**答不出**
  //    「這顆 env 到底存不存在」—— 它把 `undefined` 與 `''` 都判成 `not-configured`
  //    (那支檔有一格測試逐字釘住 `[undefined, null, '', '   ']` 全回 not-configured)。
  //    ⇒ 而那讓一個**貼錯成空值**的設定回 200 `skipped_no_cutoff`:
  //      **Sean 以為他上膛了,而一封都不會寄,且沒有任何東西會吵。**
  //    ⇒ 📌 這正是姊妹那半(`B4_DEPLOY_CUTOFF`)被 codex R5 must-fix 掉的同一個病。
  // ✅ **修在這一層,不改那支純函式**:presence 是 route 的事(它才看得到 env),
  //    format 是那支函式的事 —— 這裡**沒有第二套格式判準**,只多問一句「它在不在」。
  // eslint-disable-next-line no-restricted-syntax -- 受控例外:同本檔 readCutoff();server-only cron 端點,動態 env 不進 client bundle
  const shippedRaw = process.env['SHIPPED_EMAIL_CUTOFF'];
  const shippedCutoff =
    shippedRaw !== undefined && shippedRaw.trim() === ''
      ? ({ kind: 'bad-format', why: '這顆 env 設了,而值是空的(多半是貼上時只貼到空白)' } as const)
      : resolveShippedEmailCutoff(shippedRaw);
  let shippedCounts: ReturnType<typeof pickShippedEnqueueCounts> | null = null;
  let shippedStatus: 'skipped_no_cutoff' | 'skipped_bad_cutoff' | 'completed' | 'failed' =
    shippedCutoff.kind === 'not-configured'
      ? 'skipped_no_cutoff'
      : shippedCutoff.kind === 'bad-format'
        ? 'skipped_bad_cutoff'
        : 'completed';
  if (shippedCutoff.kind === 'bad-format') {
    console.error('[email-sweep] 🔴 SHIPPED_EMAIL_CUTOFF 格式不合 ⇒ 整段出貨 enqueue 不跑', {
      env: 'SHIPPED_EMAIL_CUTOFF',
      reason: 'bad_cutoff_format',
      why: shippedCutoff.why, // 🔴 我們自己寫的固定字串,不是使用者填的值
    });
  }
  if (shippedCutoff.kind === 'ok') {
    try {
      const shippedDeps: EnqueueOrderShippedEmailsDeps = getEnqueueOrderShippedDeps();
      shippedCounts = pickShippedEnqueueCounts(
        await enqueueOrderShippedEmails(shippedDeps, {
          cutoff: shippedCutoff.iso,
          limit: ENQUEUE_LIMIT,
        }),
      );
    } catch (err) {
      shippedStatus = 'failed';
      // 🔴 只 allowlist 我們自己產的兩個固定欄(同上一段),不碰 message/stack/cause。
      const scan = err instanceof ScanQueryError ? { stage: err.stage, code: err.code } : {};
      console.error('[email-sweep] 🔴 出貨 enqueue 整段失敗(不擋 sweeper;本輪最後回 503)', {
        reason: 'shipped_enqueue_scan_throw',
        ...scan,
      });
    }
  }
  const shippedSection = { shippedEnqueueStatus: shippedStatus, ...(shippedCounts ?? {}) };

  // 🔵🔵 **「還沒上膛」要出聲**(2026-08-30 夜;`-48` 拍板做、codex 不豁免)
  //   量到的:env 沒設 ⇒ `skipped_no_cutoff` ⇒ **不進下面的 503 判斷** ⇒ 回 200,
  //   而本檔成功路徑**一行 log 都沒有**(全檔 console 分母 6,而 6 支全是 `console.error`)
  //   ⇒ 📌 **「設好了」與「沒設好」在 Vercel 那一側印同一個 200、同一片空 log。**
  //   ⇒ 🔴 而那個狀態就是「**一封信都不會寄**」—— 一個還沒上膛的系統, 每 5 分鐘安靜地回一次 200。
  // 🔴 **為什麼是 `console.info` 不是 `console.error`**:`skipped_no_cutoff` 被歸成「正常狀態」是**對的**
  //   (下面那句「而 `skipped_no_cutoff` **不在裡面**」那一格**不改**)——
  //   **錯的是把「正常」讀成「不用講」。「正常」與「該吵」是兩件事。**
  //   ⇒ 它不進 503、不改任何回應碼、不改任何寄信行為;**只是讓那個狀態在 log 上看得見。**
  // 🛑 **零 PII**:只印我們自己寫死的 env 名與 status 列舉值,**不印 env 的值、不印收件人、不印任何計數以外的東西**。
  // ⚠️ **射程**:它只答得出「**這一輪跑的時候, 那顆 env 有沒有被讀到**」——
  //   答不出「Vercel 上設了沒」(設了不 redeploy ⇒ 現行 deployment 仍讀不到 ⇒ 這裡照樣印它, 而那是對的)。
  if (enqueueStatus === 'skipped_no_cutoff' || shippedStatus === 'skipped_no_cutoff') {
    console.info('[email-sweep] 🔵 有 cutoff env 還沒上膛 ⇒ 那一段 enqueue 這輪不跑(不是失敗,回 200)', {
      // 🔴 B-5 那半用既有的 `CUTOFF_ENV` 常數(見本檔 `const CUTOFF_ENV =`)不重打字面。
      //   ⚠️ 而出貨那半**沒有對應的 const** —— 字面 `'SHIPPED_EMAIL_CUTOFF'` 在本檔已出現兩次
      //   (讀 env 的 `process.env['SHIPPED_EMAIL_CUTOFF']`, 與 bad-format 那行的 `env:`);
      //   這裡照它既有的寫法, **不順手新增第三種寫法**。
      //   ⇒ 要收成 const 是另一件事(會動到讀 env 那行 = 行為路徑), 不夾帶進這片。
      b5DeployCutoff: enqueueStatus === 'skipped_no_cutoff' ? `${CUTOFF_ENV} 未設或空` : enqueueStatus,
      shippedCutoff: shippedStatus === 'skipped_no_cutoff' ? 'SHIPPED_EMAIL_CUTOFF 未設或空' : shippedStatus,
    });
  }

  try {
    const deps: SweepEmailOutboxDeps = getSweepEmailOutboxDeps();
    // 🔴 maxRunSeconds = maxDuration 同一 const(單一來源、不寫第二字面);leaseSeconds/claimLimit = route 端常數。
    const result = await sweepEmailOutbox(deps, {
      // 🔴🔴 **同一個 cutoff 同時控【排信】與【寄信】**(codex 2026-08-30 R1 must-fix 1)。
      //    在這一行之前,cutoff 只擋得住 enqueue ⇒ outbox 裡**已經排好的** `order_shipped` 列
      //    會在 env 關著的情況下被 sweeper 照常寄出去
      //    ⇒ 而「設了 env、看到不對、把它拿掉」正是一個人會做的事,
      //      **那個動作在這一行之前【不會讓寄信停下來】。**
      //    ⚠️ 這裡刻意**不另外讀一次 env** —— 用上面那個已解析的結果,兩半不可能分岔。
      allowOrderShipped: shippedCutoff.kind === 'ok',
      claimLimit: CLAIM_LIMIT,
      // 🔴 見 GET 第一行:預算基準 = 整個請求的起點,不是 sweeper 自己的起點。
      runStartedAtMs: invocationStartedAtMs,
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
    // 🔴 **`quotaFailed > 0` 也算失敗**(2026-08-29 線D;主視窗批准「乙」)。
    //    **為什麼不是拿 `result.failed > 0`**:`failed` 混了**單封偶發**的失敗(某一封收件地址壞掉),
    //    那種天天都會有 ⇒ 拿它翻紅 = 告警天天叫 = **等於沒有告警**。
    //    額度用盡不同:它撞的是**帳號層的牆** ⇒ 這一輪剩下的每一封也都會失敗。
    //    ⚠️ 而**迴圈不會 break** —— 剩下的每一封照樣各打一次 Resend、各燒掉一次 `attempts`。
    //       (不是本行造成的、也不在本片修;寫出來是因為「一封都寄不出去」聽起來像它會停下來。)
    // 🔴 **在本行之前發生的事(量到的,不是推的)**:額度爆 ⇒ `failed` 一直爬而 `errors` 恆 0
    //    ⇒ 這個條件不成立 ⇒ 回 **200 `ok:true`** ⇒ `recordHeartbeatSuccess` 前進
    //    ⇒ **一輪一封都沒寄出去,而它回報自己成功。** 本行改掉的就是那一句謊。
    //
    // 🔴🔴 **本行【不會讓任何東西主動叫】—— 這句話要寫在這裡,不要讓下一個人以為告警接上了。**
    //    三個消費端逐一核過(code-reviewer F3 換來的;第一版寫成「遲到的第一格」是講得太滿):
    //    ① 外部死人開關**刻意不打 `/fail`**(`heartbeat.ts` 的「刻意不做的」那段逐字)
    //       ⇒ 本行只讓這一輪**不送成功 ping**,要等 grace 過完才掉。
    //    ② 而下一輪(5 分鐘後)那批已經吃了 +24h 退避 ⇒ **沒有 due 列 ⇒ 回 200**
    //       ⇒ `recordHeartbeatSuccess` 把 `consecutive_failures` 寫回 **0**。
    //    ③ 後台儀表 `pcm-email-sweep` 的門檻是 `staleMinutes: 15`、`abnormal = stale || failing`。
    //    **⇒ 實際產物 = 一次約 5 分鐘的紅點,在一個沒有人一定在看的頁面上,外加 Vercel log 一筆。**
    //    📌 **「不再說謊」與「有人會被通知」是兩件事,本行只做到前者。**
    //    ⇒ 會主動叫的那一格,處方記在 `docs/launch-todo.md`(錨:`叫既有告警系統多看一格` 那條)——
    //       走既有的 LINE 推播、**不走 Resend**(額度爆掉時拿 Resend 發告警等於沒發)。
    //    ⚠️ 因此本行**不違反** Q13=A(「本 use-case 零告警、sweeper 不可自我監看」):
    //       它沒有注入任何告警管道,只是不再把失敗回報成成功。
    //
    // ⚠️ **與 plan §5 訊號 5 不是同一個述詞,不要互相頂替**:
    //    訊號 5 = `status='failed' AND last_error_code IN (額度碼)` = **持久狀態**(爆掉之後每天都成立);
    //    `quotaFailed` = **本輪的嘗試數**(爆完就被 +24h 退避帶走)⇒ **兩者可見窗差一個量級。**
    //
    // ⚠️ **本行只解掉第一格,剩下兩格仍然開著**:額度持續爆 ⇒ 每天重試燒 `attempts`
    //    ⇒ **第 5 天永久死信**,而**目前無死信重送工具**(`IEmailOutbox.ts` 逐字、backlog `#286`)。
    //    ⇒ 那兩格是另一片,題目在 `~/pcm-mailbox/等Sean決策-20260829.md` 的 `Q-死信怎麼辦`。
    // 🔴 而 Sean 2026-07-17 拍 `Q9=A` 的**理由句**裡寫著「5 天緩衝(**每日告警**)」
    //    (`IEmailOutbox.ts` 逐字,錨在字面「5 天緩衝」)—— **那個「每日告警」查無實作**。
    //    數法(寫出來才複現得了;第一版寫「15 處」複現不出來 = code-reviewer F5):
    //      正對照(要會命中)`grep -c quota apps/storefront/src/app/api/cron/anomaly-alert/route.ts` ⇒ **1**
    //        —— 而那 1 筆講的是「密鑰外洩會消耗額度」,**不是對額度發告警**。
    //      真正的空集合 `grep -cE "quota|email|outbox" packages/use-cases/src/check-anomaly-alerts.ts` ⇒ **0**(rc=1)
    //        —— 告警判讀的本體裡,**寄信這條線完全沒有述詞**。
    if (
      result.errors > 0 ||
      result.quotaFailed > 0 ||
      // 🔴🔴 `⟦b4-SWEEP503BLIND⟧`(2026-09-02):**全滅要吵。**
      //    ⛔ 這個判斷式原本【不含 `result.failed`】—— 而 `failed` 是 provider 裁決失敗的封數。
      //    ⇒ Resend 回 5xx / 連不上 / 額度以外的任何失敗 ⇒ `failed++` 而 `errors` 不動
      //    ⇒ ⇒ 回 **200** ⇒ `recordHeartbeatSuccess` ⇒ **儀表綠, 而一整輪一封都沒寄出去。**
      //    📌 而**同一支檔上面那段** `quotaFailed` 的註解(錨:逐字「額度用盡」那一段)
      //       已經記過同一句謊 —— 那次補的是 `quotaFailed`
      //       ⇒ **補丁只補了一個入口, 而這是同一個洞的第二個。**
      //
      // 🛑 **為什麼是 `sent === 0 && failed > 0` 而不是 `failed > 0`** —— 而理由要寫成射程句:
      //    ⛔ ~~我第一版寫「『一封都沒成功而有失敗』不需要基線, 它在結構上就分得出那個世界」~~
      //    🔴 **那句在【一輪只認領 1 封】時是假的**(code-reviewer 2026-09-02):那一輪
      //       `sent===0 && failed>0` 與我否決掉的 `failed>0` **是同一個觀察**。
      //       而 10-30 封/日 ÷ 288 輪 ⇒ **認領 1 封就是最常見的非空輪** ⇒ 大多數輪它不成立。
      //    ✅ **正確的說法**:這個合取只在【同一輪有多封】時才多買到東西;
      //       而它擋掉的告警量, 對照組推算約 **10%**(Poisson λ≈30/288≈0.10/輪)——
      //       🔴 **那是【推算】不是量到的, 而我沒有量過 `failed` 的日常基線。**
      //
      // ⚠️ **噪音有上界, 而它不是一次紅**:一個永久壞掉的收件地址(http_400/422)走 exponential
      //    退避、`max_attempts=5` ⇒ **最多 5 次紅、擠在約 75 分鐘內**, 然後靜靜進死信。
      //    🛑 **⇒ 那是把【單封資料問題】報成【sweeper 故障】。⇒ 明早若頻繁變紅, 先看是不是這個。**
      //
      // 🔴 **而這一格的名字寫「試過而全滅」, 有一個世界不是**(code-reviewer nit):
      //    時間預算耗盡 ⇒ 首封失敗後即 `deferred = jobs.length - i`
      //    ⇒ `sent=0, failed=1, deferred=49` ⇒ 503, **而那 49 封根本沒被試過。**
      //    ⇒ 本片**沒有**排除它 —— 排除它要多讀一欄, 而那會讓這道閘變成兩個判準。明寫, 不假裝沒有。
      //
      // ⚠️ 而 `sent === 0 && failed === 0`(本輪沒有到期的信)**照舊回 200** —— 那是常態。
      //    ⛔ ~~我第一版把上面那條寫成「額度以外的任何失敗」~~ —— 不精確:額度那條**也**走
      //    `result.failed++`(`quotaFailed` 是**加計**不是互斥)⇒ 不影響行為, 而影響讀的人。
      (result.sent === 0 && result.failed > 0) ||
      enqueueStatus === 'failed' ||
      enqueueStatus === 'skipped_bad_cutoff' ||
      (enqueueCounts?.enqErrors ?? 0) > 0 ||
      // 🔴 出貨線那半用**同一套判準**(片3b):整段爆掉、env 填錯、單筆錯,三者都要吵。
      //    ⚠️ 而 `skipped_no_cutoff` **不在裡面** —— 那是「還沒上膛」的正常狀態,不是失敗。
      shippedStatus === 'failed' ||
      shippedStatus === 'skipped_bad_cutoff' ||
      (shippedCounts?.shpErrors ?? 0) > 0
    ) {
      console.error('[email-sweep] 🔴 本輪有失敗(回 503;不吞成 200 偽裝成功)', {
        ...counts,
        ...enqueueSection,
        ...shippedSection,
      });
      await recordHeartbeatFailure(CRON_JOB_NAME.emailSweep);
      return Response.json({ ok: false, ...counts, ...enqueueSection, ...shippedSection }, { status: 503 });
    }

    // 4. 認證過 + 無錯 → 200 + 計數摘要(零 PII counts;含 deferred 供調參可見度)。
    await recordHeartbeatSuccess(CRON_JOB_NAME.emailSweep);
    return Response.json({ ok: true, ...counts, ...enqueueSection, ...shippedSection }, { status: 200 });
  } catch {
    // deps/env 缺(requireEnv throw)或非預期 throw(如 lease 下界違反)→ 503 fail-closed(不偽 200)。
    // 🔴 固定 reason code(零 PII、零洩漏面;不把任意 err.message 入 log 縱深、杜絕密鑰 drift 帶進 log)。
    console.error('[email-sweep] 🔴 sweeper 無法執行(deps/env 缺或非預期 throw、回 503;不吞 200 偽裝成功)', {
      reason: 'deps_or_unexpected_throw',
    });
    await recordHeartbeatFailure(CRON_JOB_NAME.emailSweep);
    return new Response(null, { status: 503 });
  }
}
