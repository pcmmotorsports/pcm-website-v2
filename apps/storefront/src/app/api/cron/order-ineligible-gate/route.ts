// app/api/cron/order-ineligible-gate/route.ts — 寄送前 ineligible gate cron route(M-4a E2a-2、W3-G 拆出)
//
// 週期觸發(實際排程機制〔pg_cron 或 vercel.json〕未決,不在本次範圍)→ 跑 applyOrderIneligibleGate
// (use-case):讀 due 但訂單已不合格(payment_status='refunded' OR cancelled_at IS NOT NULL)的
// outbox 列 → 逐筆 claimById + markSkippedOrderIneligible。
//
// 🔴🔴 **本片【縮小】寄出不合格信的窗口,沒有【關閉】它**(2026-08-20 codex 關卡2 R2 + W5 獨立盲審
// 交叉命中、主視窗裁定)。唯一不 race 的位置是寄送路徑本身(`sweep-email-outbox.ts`),而那條邊界
// 被拍板釘住(見下一段)。⇒ 只要本片與 `sweepEmailOutbox` 是兩支各自獨立的 cron,就沒有誰先誰後
// 的保證:本片的 scanner 看到某列該擋,呼叫 `claimById` 之前,`sweepEmailOutbox` 可能已搶先認領
// 那一列並即將/已經寄出。真正關閉這個窗口需要把合格性檢查放進 `sweep-email-outbox.ts` 本身,那是
// E2a-b 的邊界、需要 Sean 拍板(尚未問;見 STATUS.md 或 W3-G 交接)。**不得宣稱本片堵住了這個洞。**
//
// 🔴 **為什麼是獨立 route,不掛進 email-sweep**(2026-08-20 W3-G 教訓):plan
// `docs/specs/2026-07-16-m4a-email-notify-plan.md:362` 把 ineligible gate 歸給 E2a-2、不是
// E2a-b(sweepEmailOutbox);`sweep-email-outbox.test.ts:53` 的預設 mock 對
// `markSkippedOrderIneligible` 寫死 reject——那是邊界的證人,本片刻意不碰那支檔案。
//
// 🔴 鐵則 12(cron 端點 + 威脅模型;鏡像 email-sweep / anomaly-alert route):
//   1. 認證 = CRON_SECRET Bearer 硬驗 + timingSafeEqual:env 未設/弱 → 500 fail-closed;Bearer
//      缺/不符 → 401(不揭內部)。
//   2. 認證+限流過後 deps 缺(理論上不會發生:本片不 requireEnv 任何值,見 composition.ts)→
//      仍以 try/catch 兜底 503;本輪有 errors → 503 + counts log(零 PII)、不吞成 200。
//      🔴🔴 raceLost>0 **不是錯誤,也不是「安全」——是「未知」**(見上方殘留 race 說明):route
//      仍回 200(raceLost 不代表整輪壞了,重試也解決不了 race、只會製造噪音),但 raceLost 這個
//      數字必須原樣進 counts 回應與 log,讓它成為這個殘留 race 的**可觀測分母**,不得吞掉或折算。
//   3. 不採信任何外部輸入:無 client 參數 / 無 query / 無 body;limit = route 端常數。回應
//      counts-only allowlist(顯式挑 4 個數值欄、不 blind spread)。
//   4. 零 PII:result 只有數字;本片不接觸 recipient_email(scanner 只回 id/orderId,見 port 檔頭)。
//
// 🔴 GET handler(鏡像 email-sweep;pg_net/Vercel cron 皆走 GET)。
// 🔴 不變式(lazy 跨包契約、鏡像 email-sweep route 警語):getApplyOrderIneligibleGateDeps factory
//    必須維持 lazy——認證/限流未過即在建 deps 前 return。
//
// @see docs/specs/2026-07-16-m4a-email-notify-plan.md §4.1(:329)/ E2a-2 表列(:362)
// @see packages/use-cases/src/apply-order-ineligible-gate.ts(E2a-2 use-case、殘留 race 全文)

import { timingSafeEqual } from 'node:crypto';
import { applyOrderIneligibleGate, type ApplyOrderIneligibleGateDeps } from '@pcm/use-cases';
import { getApplyOrderIneligibleGateDeps } from '@/lib/email/composition';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';
import { CRON_JOB_NAME, recordHeartbeatSuccess, recordHeartbeatFailure } from '@/lib/cron/heartbeat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 函式 timeout 60s(對齊 email-sweep / anomaly-alert;純 DB 讀寫、遠 < 60s)。 */
export const maxDuration = 60;

/** CRON_SECRET 最小長度(code enforce 防 env 誤設短字串;沿 email-sweep requireCronSecret)。 */
const MIN_SECRET_LEN = 32;
/** Bearer 前綴(含尾空格)。 */
const BEARER_PREFIX = 'Bearer ';

/** 🔴 單輪掃描上限 = route 端常數(不採信外部輸入;量級遠低於 email-sweep 的 CLAIM_LIMIT=50)。 */
const SCAN_LIMIT = 50;

/** 等長 constant-time 比對(沿 email-sweep safeEqual)。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 讀 + 強度驗 CRON_SECRET;未設 / <32 → throw(route 接 → 500 fail-closed;沿 email-sweep)。 */
function requireCronSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s || s.length < MIN_SECRET_LEN) {
    throw new Error('CRON_SECRET 未設或強度不足(需 ≥32)');
  }
  return s;
}

/** counts allowlist(顯式挑欄、不 blind spread;鏡像 email-sweep pickCounts 理由)。 */
function pickCounts(result: { scanned: number; markedIneligible: number; raceLost: number; errors: number }) {
  return {
    scanned: result.scanned,
    markedIneligible: result.markedIneligible,
    raceLost: result.raceLost,
    errors: result.errors,
  };
}

export async function GET(request: Request): Promise<Response> {
  // 1. 認證:CRON_SECRET Bearer 硬驗。
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

  // 1b. 應用層限流(鏡像 email-sweep;key 與其他 cron route 各自獨立額度)。
  if (!checkCronRateLimit('order-ineligible-gate')) {
    return new Response(null, { status: 429 });
  }

  // 2. 建 deps + 跑 applyOrderIneligibleGate。
  try {
    const deps: ApplyOrderIneligibleGateDeps = getApplyOrderIneligibleGateDeps();
    const result = await applyOrderIneligibleGate(deps, { limit: SCAN_LIMIT });
    const counts = pickCounts(result);

    // 3. 本輪有 errors → 503 + 結構化 counts log,不偽 200。raceLost 不算錯誤(它是「未知」不是
    //    「安全」,見檔頭殘留 race 說明;重試解決不了 race、只會製造噪音,故不 503,但數字必進 counts)。
    if (result.errors > 0) {
      console.error('[order-ineligible-gate] 🔴 本輪有失敗(回 503;不吞成 200 偽裝成功)', counts);
      await recordHeartbeatFailure(CRON_JOB_NAME.orderIneligibleGate);
      return Response.json({ ok: false, ...counts }, { status: 503 });
    }

    // 4. 認證過 + 無錯 → 200 + 計數摘要。
    await recordHeartbeatSuccess(CRON_JOB_NAME.orderIneligibleGate);
    return Response.json({ ok: true, ...counts }, { status: 200 });
  } catch {
    console.error('[order-ineligible-gate] 🔴 gate 無法執行(deps 缺或非預期 throw、回 503;不吞 200 偽裝成功)', {
      reason: 'deps_or_unexpected_throw',
    });
    await recordHeartbeatFailure(CRON_JOB_NAME.orderIneligibleGate);
    return new Response(null, { status: 503 });
  }
}
