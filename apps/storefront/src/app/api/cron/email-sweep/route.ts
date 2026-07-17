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
import { sweepEmailOutbox, type SweepEmailOutboxDeps } from '@pcm/use-cases';
import { getSweepEmailOutboxDeps } from '@/lib/email/composition';
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
    if (result.errors > 0) {
      console.error('[email-sweep] 🔴 本輪寄送有失敗(回 503;不吞成 200 偽裝成功)', counts);
      return Response.json({ ok: false, ...counts }, { status: 503 });
    }

    // 4. 認證過 + 無錯 → 200 + 計數摘要(零 PII counts;含 deferred 供調參可見度)。
    return Response.json({ ok: true, ...counts }, { status: 200 });
  } catch {
    // deps/env 缺(requireEnv throw)或非預期 throw(如 lease 下界違反)→ 503 fail-closed(不偽 200)。
    // 🔴 固定 reason code(零 PII、零洩漏面;不把任意 err.message 入 log 縱深、杜絕密鑰 drift 帶進 log)。
    console.error('[email-sweep] 🔴 sweeper 無法執行(deps/env 缺或非預期 throw、回 503;不吞 200 偽裝成功)', {
      reason: 'deps_or_unexpected_throw',
    });
    return new Response(null, { status: 503 });
  }
}
