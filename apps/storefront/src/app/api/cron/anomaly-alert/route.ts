// app/api/cron/anomaly-alert/route.ts — 雙扣 anomaly 主動告警 cron route(M-3 #250)
//
// Vercel cron(vercel.json crons)週期觸發 → 跑 checkAnomalyAlerts(use-case):讀 anomaly + 死卡列零 PII 計數 →
// 任一門檻踩(open 雙扣候選 / refunding 卡逾時 / pending 孤兒 / released 死卡)→ 對所有已設定管道(LINE/Email)
// 推播固定格式告警。把雙扣偵測從 pull(W1 報表有空才查)→ push(發生即主動通知)、杜絕沉默故障 + 錯過客訴黃金期。
//
// 🔴 鐵則 12(payment 端點 + 威脅模型;鏡像 settle-sweep route):
//   1. 認證 = CRON_SECRET Bearer 硬驗(Vercel cron 自動帶 `Authorization: Bearer ${CRON_SECRET}`)+ timingSafeEqual:
//      env CRON_SECRET 未設/弱 → 500 fail-closed(設定錯、拒不執行);Bearer 缺/不符 → 401(不揭內部)。
//   2. 🔴 sequencing gate = ANOMALY_ALERT_ENABLED:預設 false → 認證過後 200 no-op(告警管道未備妥時的安全態、
//      不噪);Sean 於管道密鑰(LINE/Resend)設好後顯式設 'true' 才真跑。
//      🔴 CRON_SECRET sequencing(關卡1 codex M2):route 先驗 CRON_SECRET 再看此 gate → prod 須先設 CRON_SECRET
//      (與 settle-sweep 共用)否則 cron 命中得 500 非 dormant no-op(500 本身 fail-closed 安全、僅噪)。
//   3. enabled 後 deps/env 缺(factory throw:PAYMENT_CONFIRMER_DB_URL 或「enabled 但零管道」)→ 503;本輪告警管道
//      推播失敗(result.errors>0)→ 503 + 結構化 counts log(零 PII)、**不可吞成 200 偽裝成功**(壞掉的告警管道
//      靜默不推 = 沉默故障、#250 最怕的事)。
//   4. 不採信任何外部輸入:無 client 參數 / 無 query / 無 body;refunding 卡住門檻 = route 端常數。告警訊息零 PII
//      (只計數;reader 走 payment_confirmer SECDEF 受控窗、對 anomaly 兩表零表權)。
//
// 🔴 GET handler(Vercel cron 走 GET;寫成 POST 等 → cron 永不觸發 = 靜默不告警)。
// 🔴 不變式(lazy 跨包契約、鏡像 settle-sweep route 警語):getAnomalyAlertDeps factory **必須維持 lazy**——建構子
//    只存連線字串/密鑰、零 module-top env 讀取 / 零連線建立。下方 GET 的 disabled 路徑(ANOMALY_ALERT_ENABLED gate
//    在「建 deps 前」return)之「零 DB env 依賴」保證仰賴此;改 @/lib/payment/composition 前必守此 lazy 契約。
// ⚠️ 誠實中間態:route commit 到 dev 即可,但 prod 不推播直到 ① vercel.json crons 段 ② Sean 於 Vercel Production env
//    設 ANOMALY_ALERT_ENABLED='true' + 管道密鑰(LINE_CHANNEL_ACCESS_TOKEN/LINE_ALERT_TO 或 RESEND_API_KEY/
//    ALERT_EMAIL_FROM/ALERT_EMAIL_TO);route 預設 disabled + fail-closed → commit 零部署風險。
//
// @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
// @see docs/phase-1-backlog.md #250
// @see packages/use-cases/src/check-anomaly-alerts.ts

import { timingSafeEqual } from 'node:crypto';
import { checkAnomalyAlerts, type CheckAnomalyAlertsDeps } from '@pcm/use-cases';
import { getAnomalyAlertDeps } from '@/lib/payment/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 函式 timeout 60s(對齊 settle-sweep;讀聚合 + ≤2 管道推播遠 < 60s)。 */
export const maxDuration = 60;

/** CRON_SECRET 最小長度(code enforce 防 env 誤設短字串;沿 settle-sweep requireCronSecret)。 */
const MIN_SECRET_LEN = 32;
/** Bearer 前綴(Vercel cron `Authorization: Bearer ${CRON_SECRET}`;含尾空格)。 */
const BEARER_PREFIX = 'Bearer ';

/**
 * 🔴 refunding 卡住門檻 = route 端常數(不採信外部輸入)。
 * 預設 86400=24h。**營運參數、揭示可調、非 PRD SLA**(W1 runbook line150「不杜撰 SLA」;比照 B1a throttle 6h
 * 先例〔canonical 僅定性、已揭示可調〕)。
 */
const ALERT_REFUNDING_STUCK_SECONDS = 86400;

/** 等長 constant-time 比對;長度不等先回 false(timingSafeEqual 要求等長 Buffer;沿 settle-sweep safeEqual)。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 讀 + 強度驗 CRON_SECRET;未設 / <32 → throw(route 接 → 500 fail-closed;沿 settle-sweep)。 */
function requireCronSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s || s.length < MIN_SECRET_LEN) {
    throw new Error('CRON_SECRET 未設或強度不足(需 ≥32)');
  }
  return s;
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

  // 2. 🔴 ANOMALY_ALERT_ENABLED sequencing gate:嚴格 opt-in、只認字面 'true';預設(未設/'false'/其他)→ 認證過後
  //    200 no-op(管道未備妥時的安全態)。🔴 deps/env(PAYMENT_CONFIRMER_DB_URL / 管道密鑰)在此 gate「後」才建 →
  //    disabled 路徑零 DB env 依賴(route 已 deploy 但未設密鑰、仍 200 no-op 安全)。
  if (process.env.ANOMALY_ALERT_ENABLED !== 'true') {
    return Response.json({ ok: true, enabled: false, skipped: 'anomaly_alert_disabled' }, { status: 200 });
  }

  // 3. enabled → 建 deps + 跑 checkAnomalyAlerts。
  //    deps 建構(getAnomalyAlertDeps)缺 env / enabled 但零管道 → throw → 503 fail-closed(不偽 200)。
  //    🔴 零 PII:deps 建構子純存連線字串/密鑰(零連線/零 throw〔除 requireEnv env-name 固定訊息〕);pg/管道 API
  //    錯誤在 use-case/adapter 內 sanitize + Promise.allSettled → result.errors,不外拋至此。
  try {
    const deps: CheckAnomalyAlertsDeps = getAnomalyAlertDeps();
    const result = await checkAnomalyAlerts(deps, {
      refundingStuckSeconds: ALERT_REFUNDING_STUCK_SECONDS,
    });

    // 4. 🔴 本輪有推播失敗 → 503 + 結構化 counts log,**不偽 200**(壞掉的告警管道必須可見)。
    //    result.errors = notifiersFailed(管道 API 非 2xx / transport 失敗);>0 → 下輪 cron 重試(無去重、持續提醒)。
    //    counts only 零 PII(route 本就無 order/rec/amount 等可洩欄)。
    if (result.errors > 0) {
      console.error('[anomaly-alert] 🔴 本輪告警管道推播有失敗(回 503;不吞成 200 偽裝成功)', { ...result });
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    // 5. 認證過 + enabled + 無錯 → 200 + 計數摘要(零 PII counts)。
    return Response.json({ ok: true, enabled: true, ...result }, { status: 200 });
  } catch {
    // deps/env 缺(factory requireEnv throw / enabled 但零管道)或非預期 throw(reader throw)→ 503 fail-closed(不偽 200)。
    // 🔴 固定 reason code(零 PII、零洩漏面;不把任意 err.message 入 log 縱深、杜絕連線字串/密鑰 drift 帶進 log)。
    console.error('[anomaly-alert] 🔴 告警無法執行(deps/env 缺、零管道或 reader throw、回 503;不吞 200 偽裝成功)', {
      reason: 'deps_or_unexpected_throw',
    });
    return new Response(null, { status: 503 });
  }
}
