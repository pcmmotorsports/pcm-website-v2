/**
 * `GET /api/cron/capture-recheck` — 請款狀態重讀(M-4b、backlog `#785`)
 *
 * ## 這條路存在的理由
 * `capture_state` 只在**授權當下**被寫一次,而銀行是 21 小時後才請款
 * ⇒ 沒有任何路徑會再寫它(`settle-charge.ts:70` 的 paid 短路在 Record 查詢**之前** return)。
 * ⇒ 🔴 **本路徑不動那個短路** —— 它是新造的一條路,不是掛在既有 sweeper 上。
 *
 * ## 🔴 「上膛」的動作是設 env,不是部署、也不是排程
 * `CAPTURE_RECHECK_CUTOFF_DAYS` 未設 ⇒ **整段不跑、一發 Record 都不打**,回 200 + `skipped_no_cutoff`。
 * 形狀照 `api/cron/email-sweep/route.ts:18-20` 逐字(「真正的『上膛』動作是設 `B4_DEPLOY_CUTOFF`,不是排程」)。
 *
 * ⚠️ **而那個數字沒有被 Sean 逐字確認**:主視窗 2026-08-20 端給他的建議是「每 10 分鐘、只問最近 3 天」,
 * 他回「要」—— 沒有推翻,也沒有明確採納。⇒ **主視窗暫定,Sean 未逐字確認。**
 * ⇒ 所以它必須是一個**要有人明確去設**的值,而不是一個寫死在程式裡的預設。
 *
 * ## 認證與限流
 * 照 `settle-sweep`:`CRON_SECRET` Bearer + `timingSafeEqual`;env 未設/弱 ⇒ 500 fail-closed(拒不執行)、
 * Bearer 缺/不符 ⇒ 401(不揭內部)。限流在**認證之後**才計數(未持有效 secret 的 flood 不佔額度)。
 *
 * ## 🔴 回應一定帶 recordCalls / recordFailures
 * 「既有 sweeper 的量沒撞到 TapPay rate limit」目前是**推的、沒量過**
 * (`docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md:234` 逐字只給「綠界類比」,沒有 TapPay 的數字)。
 * ⇒ 這兩欄讓下一個人有**分母**,而不是再推一次。
 */
import { timingSafeEqual } from 'node:crypto';
import { recheckCaptureState } from '@pcm/use-cases';
import { getSettleChargeDeps } from '@/lib/payment/composition';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** 對齊 settle-sweep;單輪最壞 = LIMIT 25 × ~500ms ≈ 12.5s,餘裕足。 */
export const maxDuration = 60;

/** CRON_SECRET 最小長度(沿 settle-sweep)。 */
const MIN_SECRET_LEN = 32;
const BEARER_PREFIX = 'Bearer ';

/**
 * 單輪上限(節流)。**寫在這裡而不是靠「集合天然小」** —— 集合大小是資料決定的,不是我們決定的。
 *
 * 25 的來源:既有 `settle-sweep` 每 2 分鐘最多 100 發 Record(`settle-sweep/route.ts:65` 逐字
 * 「單輪最壞 =(inbox 50 + stuck 50)× ~500ms ≈ 50s」)⇒ 每小時 ≤3000。
 * 本路徑每 10 分鐘 25 發 ⇒ **每小時新增 ≤150 發**。
 * ⚠️ **刻意不寫成「既有量的 5%」**(W5 R1 MF-2):3000/hr 是 **settle-sweep 自己的預算**,
 * 不是 TapPay 給的上限 ⇒ 對一個不是上限的東西取百分比,會讓人以為有餘裕被量過。
 * 而兩者是**相加**的:總量變成 ≤3150/hr,不是「佔既有的 5%」。
 *
 * ## 🔴 那個「5%」的分母,2026-08-20 查過了 —— 兩條路確實在同一個桶裡
 * 這一段原本是**假設**(「兩條路是不是打同一個端點、吃同一份額度,我沒查」),現在是量到的:
 * - **同一個端點**:兩條路都走 `ITapPayAdapter.recordQuery`
 *   ⇒ `TapPayChargeAdapter.ts:512` fetch `config.recordQueryUrl`
 *   ⇒ `endpoints.ts:33` = `${host}/tpc/transaction/query`。**一支方法、一個 URL,沒有第二條。**
 * - **同一組商戶憑證**:兩條路的 deps 都來自 `composition.ts:125`(`tappay: getTapPayAdapter()`),
 *   而 `getTapPayAdapter()`(`composition.ts:69-79`)只讀**一組** `TAPPAY_PARTNER_KEY` /
 *   `TAPPAY_MERCHANT_ID` —— repo 內零第二組憑證路徑(負對照掃不存在的設定名 ⇒ 0)。
 * ⇒ ⇒ **同端點 + 同商戶** ⇒ 不論 TapPay 的額度是「每端點」還是「每商戶」算,
 *   兩條路都切在**同一份額度**上 ⇒ **5% 這個比例成立。**
 *
 * ⚠️ **仍然沒有的**:TapPay 額度的**絕對數字**。官方文件與 repo 都查無
 * (`docs/reference/tappay-reference.md` 掃 rate limit / QPS / 每分鐘 ⇒ 0 命中)。
 * ⇒ 我們知道的是「本片是既有量的 5%」,**不是**「本片安全」——
 *   後者要等下面 `recordCalls` / `recordFailures` 累積出真的分母。
 */
const RECHECK_LIMIT = 25;

/** 等長 constant-time 比對(沿 settle-sweep safeEqual)。 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 讀 + 強度驗 CRON_SECRET;未設 / <32 → throw(route 接 → 500 fail-closed)。 */
function requireCronSecret(): string {
  const s = process.env.CRON_SECRET;
  if (!s || s.length < MIN_SECRET_LEN) {
    throw new Error('CRON_SECRET 未設或強度不足(需 ≥32)');
  }
  return s;
}

/**
 * 讀 cutoff 天數。
 *
 * 🔴 **未設 / 非正整數 ⇒ 回 null ⇒ 整段不跑。** 刻意沒有預設值:
 * 有預設值等於「部署就生效」,而這個數字還沒有被 Sean 逐字確認。
 */
function readCutoffDays(): number | null {
  const raw = process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(request: Request): Promise<Response> {
  // 1. 認證(env 未設/弱 → 500;Bearer 不符 → 401)
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

  // 2. 限流(認證後才計數)
  if (!checkCronRateLimit('capture-recheck')) {
    return new Response(null, { status: 429 });
  }

  // 3. 🔴 上膛閘:cutoff 未設 ⇒ 200 no-op、**零 Record 呼叫、零 DB env 依賴**(deps 在此閘之後才建)。
  const cutoffDays = readCutoffDays();
  if (cutoffDays === null) {
    return Response.json(
      { ok: true, enabled: false, skipped: 'skipped_no_cutoff' },
      { status: 200 },
    );
  }

  // 4. 跑一輪。deps 建構缺 env → throw → 503 fail-closed(不偽 200)。
  try {
    const result = await recheckCaptureState(getSettleChargeDeps(), {
      cutoffDays,
      limit: RECHECK_LIMIT,
    });
    return Response.json({ ok: true, enabled: true, cutoffDays, limit: RECHECK_LIMIT, ...result }, { status: 200 });
  } catch {
    // 🔴 不回 200 —— 「跑壞了」與「本來就沒東西」不得在回應上長得一樣。
    return new Response(null, { status: 503 });
  }
}
