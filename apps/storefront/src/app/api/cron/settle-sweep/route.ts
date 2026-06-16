// app/api/cron/settle-sweep/route.ts — 3DS 對帳兜底 sweeper cron route(M-3 3DS-4c;master plan v5 §2;plan §5.3)
//
// Vercel cron(3DS-4d vercel.json crons、**本片不含**)週期觸發 → 跑 sweepSettlements(3DS-4b-2 use-case):
// 掃 webhook inbox(processed=false 退避)+ stuck unsettled attempt(pending+charged-unpaid)兩來源 → 共呼
// settleCharge(Record API 唯一權威),callback(3DS-3)/ webhook(3DS-2)漏接的「最終一致保證」。
//
// 🔴 鐵則 12(payment 端點 + 威脅模型):
//   1. 認證 = CRON_SECRET Bearer 硬驗(Vercel cron 自動帶 `Authorization: Bearer ${CRON_SECRET}`)+ timingSafeEqual:
//      env CRON_SECRET 未設/弱 → 500 fail-closed(設定錯、拒不執行、非放行);Bearer 缺/不符 → 401(不揭內部)。
//   2. 🔴 sequencing gate = CRON_SWEEPER_ENABLED:預設 false → 認證過後 200 no-op(4a migration 未進 prod 時的
//      安全態、不偽結算、不噪);Sean 於 4a 進 prod 後顯式設 'true' 才真跑(plan §5.3 / §5.4 部署 sequencing)。
//   3. enabled 後 deps/env 缺(factory throw)→ 503;本輪 RPC missing / DB error(result.errors>0)→ 503 + 結構化
//      counts log(零 PII)、**不可吞成 200 偽裝成功**(壞掉的 sweeper 靜默不結算 = master §2 中間態最怕的事)。
//   4. 不採信任何外部輸入:無 client 參數 / 無 query / 無 body;批次/節流/並發皆 route 端常數;orderId 全 from DB
//      (claim RPC 回);settleCharge 冪等 + Record 唯一權威 + 金額整數 → 即使被觸發亦不雙扣/不偽 paid(縱深)。
//
// 🔴 GET handler(Vercel cron 走 GET;寫成 POST 等 → cron 永不觸發 = 靜默不結算;plan §5.3 群5)。
// ⚠️ 誠實中間態(master §2 / plan §5.4):4c route commit 到 dev 即可,但 **prod 不跑** 直到 ① 4d(vercel.json
//    crons 段)② Sean 於 Vercel Production env 設 CRON_SWEEPER_ENABLED='true' ③ 4a migration 進 prod;route 預設
//    disabled + fail-closed → commit 4c **零部署風險**(Phase I 結帳關閉、零 pending、即使誤啟亦 no-op)。
//
// @see docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md §5.3
// @see docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §2/§9
// @see packages/use-cases/src/sweep-settlements.ts(3DS-4b-2 use-case)

import { timingSafeEqual } from 'node:crypto';
import { sweepSettlements, type SweepSettlementsDeps } from '@pcm/use-cases';
import { getSettleChargeDeps, getWebhookInbox } from '@/lib/payment/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * 🔴 函式 timeout 60s(plan Q3=A)。< claim lease(5min)→ 即使 4a migration token guard 已 decouple
 * maxDuration 耦合(4a-1 K2 r1),maxDuration < lease 仍保 late-worker race 結構性關閉(縱深、不依賴單片)。
 */
export const maxDuration = 60;

/** CRON_SECRET 最小長度(code enforce 防 env 誤設短字串;沿 3DS-2 requireNotifySecret MIN_SECRET_LEN)。 */
const MIN_SECRET_LEN = 32;
/** Bearer 前綴(Vercel cron `Authorization: Bearer ${CRON_SECRET}`;含尾空格)。 */
const BEARER_PREFIX = 'Bearer ';

/**
 * 🔴 批次/節流/並發 = route 端常數(不採信外部輸入;plan Q2/Q3=A、§5.2 群7)。
 * - inbox/stuck 各每輪上限 50(Record 節流、超出留下輪;預算 50×~500ms=25s < maxDuration 60s)。
 * - stuckAgeSeconds=600(10 分;避 racing 即時 callback/webhook、對齊 s2d user_in_flight 10 分閘)。
 * - concurrency=1(嚴格順序;群7 連線預算、避 N×per-request pg Client 撞 session pooler ceiling)。常數即「有限
 *   正整數」(不接受外部輸入 = 最強形式的驗證;use-case 端另有 Number.isFinite guard 縱深、4b-2 N4)。
 */
const INBOX_LIMIT = 50;
const STUCK_LIMIT = 50;
const STUCK_AGE_SECONDS = 600;
const SWEEP_CONCURRENCY = 1;

/** 等長 constant-time 比對;長度不等先回 false(timingSafeEqual 要求等長 Buffer、否則 throw;沿 3DS-2 safeEqual)。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 讀 + 強度驗 CRON_SECRET;未設 / <32 → throw(route 接 → 500 fail-closed、拒不執行;沿 3DS-2 requireNotifySecret)。 */
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

  // 2. 🔴 CRON_SWEEPER_ENABLED sequencing gate(plan §5.3 must-fix #3):嚴格 opt-in、只認字面 'true';預設(未設/
  //    'false'/其他)→ 認證過後 200 no-op(4a 未進 prod 時的安全態)。🔴 deps/env(PAYMENT_CONFIRMER_DB_URL 等)
  //    在此 gate「後」才建 → disabled 路徑零 DB env 依賴(Phase I:route 已 deploy 但 4a 未推、仍 200 no-op 安全)。
  if (process.env.CRON_SWEEPER_ENABLED !== 'true') {
    return Response.json({ ok: true, enabled: false, skipped: 'sweeper_disabled' }, { status: 200 });
  }

  // 3. enabled → 建 deps + 跑 sweepSettlements。
  //    deps 建構(getSettleChargeDeps/getWebhookInbox)缺 env → requireEnv throw → 503 fail-closed(不偽 200)。
  //    🔴 零 PII:deps 建構子純存連線字串(零連線/零 throw)、此處 throw 僅 requireEnv 的 env-name 固定訊息(無密鑰);
  //    pg 連線/RPC 錯誤在 use-case 內 sanitize + try/catch → result.errors,不外拋至此(故 catch log message 安全)。
  try {
    const deps: SweepSettlementsDeps = { ...getSettleChargeDeps(), inbox: getWebhookInbox() };
    const result = await sweepSettlements(deps, {
      inboxLimit: INBOX_LIMIT,
      stuckLimit: STUCK_LIMIT,
      stuckAgeSeconds: STUCK_AGE_SECONDS,
      concurrency: SWEEP_CONCURRENCY,
    });

    // 4. 🔴 本輪有錯 → 503 + 結構化 counts log,**不偽 200**(plan §5.3「RPC missing / DB error 必 5xx」)。
    //    result.errors>0 = DB/RPC 層 throw(claim/mark/guard RPC 失敗)**或** 非預期 per-item throw;對 plan §5.3
    //    「RPC missing / DB error」涵蓋且更寬(主來源為 DB/RPC 失敗,因 settleCharge 本身 fail-closed→pending 不 throw、
    //    normal pending→markRetry 計 inboxRetried 非 errors → 不誤 503)。任一情況行為皆安全且回 503。use-case 已逐筆
    //    fail-closed 續跑 + durable needs_manual_review;HTTP 層誠實標本輪非全綠(cron 標失敗可見、下輪 lease/退避/冪等
    //    重來)。counts only 零 PII。
    if (result.errors > 0) {
      console.error('[settle-sweep] 🔴 本輪有錯(回 503;不吞成 200 偽裝成功)', { ...result });
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    // 5. 認證過 + enabled + 無錯 → 200 + 計數摘要(零 PII counts)。
    return Response.json({ ok: true, enabled: true, ...result }, { status: 200 });
  } catch {
    // deps/env 缺(factory requireEnv throw)或非預期 throw → 503 fail-closed(不偽 200)。
    // 🔴 固定 reason code(零 PII、零洩漏面;codex K2 consider):payment 端點**不**把任意 err.message 入 log 縱深——
    //    雖現況 deps 建構子純存連線字串、buildPgConfig 延遲到呼叫才跑、PG adapter 已 sanitize(無 live 洩漏路徑),
    //    固定碼仍杜絕未來 err.message drift 把連線字串/密鑰帶進 log。需細分時改白名單 env 名(非 raw message)。
    console.error('[settle-sweep] 🔴 sweeper 無法執行(deps/env 缺或非預期 throw、回 503;不吞 200 偽裝成功)', {
      reason: 'deps_or_unexpected_throw',
    });
    return new Response(null, { status: 503 });
  }
}
