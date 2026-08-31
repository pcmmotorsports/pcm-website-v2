/**
 * `GET /api/cron/capture-recheck` — 請款狀態重讀(M-4b、backlog `#785`)
 *
 * ## 這條路存在的理由
 * `capture_state` 只在**授權當下**被寫一次,而銀行是 21 小時後才請款
 * ⇒ 沒有任何路徑會再寫它(`settle-charge.ts` 裡那道 `paid` 短路在 Record 查詢**之前** return)。
 * ⇒ 🔴 **本路徑不動那個短路** —— 它是新造的一條路,不是掛在既有 sweeper 上。
 *
 * ## 🔴 「上膛」的動作是設 env,不是部署、也不是排程
 * `CAPTURE_RECHECK_CUTOFF_DAYS` 未設 ⇒ **整段不跑、一發 Record 都不打**,回 200 + `skipped_no_cutoff`。
 * 形狀照 `api/cron/email-sweep/route.ts` 檔頭那句逐字(「真正的『上膛』動作是設 `B4_DEPLOY_CUTOFF`,不是排程」)。
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
 * (`docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` 裡那段逐字只給「綠界類比」,沒有 TapPay 的數字)。
 * ⇒ 這兩欄讓下一個人有**分母**,而不是再推一次。
 */
import { timingSafeEqual } from 'node:crypto';
import { recheckCaptureState } from '@pcm/use-cases';
import { getSettleChargeDeps } from '@/lib/payment/composition';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';
import { CRON_JOB_NAME, recordHeartbeatSuccess, recordHeartbeatFailure } from '@/lib/cron/heartbeat';

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
 * 25 的來源:既有 `settle-sweep` 每 2 分鐘最多 100 發 Record —— 錨在**字面**:
 * 該檔檔頭那句「單輪最壞 = (inbox 50 + stuck 50) × ~500ms ≈ 50s」,
 * 而那兩個 50 是它的 `INBOX_LIMIT` / `STUCK_LIMIT` ⇒ 每小時 ≤3000。
 * 🔴 ~~原本這裡引的是 `settle-sweep` 那支檔的一個【裸行號】~~ **2026-08-28 量到它已經漂了 5 行**
 *   (原指的那一行現在是 `const BEARER_PREFIX`,而那句話實際搬到後面五行)——
 *   **內容還在、只有指標壞了**,而指標壞掉的時候沒有任何訊號。
 *   ⇒ 改成錨在字面;並把 anomaly-alert / settle-sweep 早就有的那道守門複製進本支的 route.test.ts。
 * 本路徑每 10 分鐘 25 發 ⇒ **每小時新增 ≤150 發**。
 * ⚠️ **刻意不寫成「既有量的 5%」**(W5 R1 MF-2):3000/hr 是 **settle-sweep 自己的預算**,
 * 不是 TapPay 給的上限 ⇒ 對一個不是上限的東西取百分比,會讓人以為有餘裕被量過。
 * 而兩者是**相加**的:總量變成 ≤3150/hr,不是「佔既有的 5%」。
 *
 * ## 🔴 那個「5%」的分母,2026-08-20 查過了 —— 兩條路確實在同一個桶裡
 * 這一段原本是**假設**(「兩條路是不是打同一個端點、吃同一份額度,我沒查」),現在是量到的:
 * - **同一個端點**:兩條路都走 `ITapPayAdapter.recordQuery`
 *   ⇒ `TapPayChargeAdapter.ts` 裡 fetch `config.recordQueryUrl` 那一發
 *   ⇒ `endpoints.ts` 的 `${host}/tpc/transaction/query`。**一支方法、一個 URL,沒有第二條。**
 * - **同一組商戶憑證**:兩條路的 deps 都來自 `composition.ts` 的 `tappay: getTapPayAdapter()`,
 *   而 `getTapPayAdapter()`(同檔)只讀**一組** `TAPPAY_PARTNER_KEY` /
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
    // 🔵🔵 **「還沒上膛」要出聲**(2026-08-31;Sean 答 `5 做`;板上錨 `⟦b9-CAPARM1⟧`)
    //   量到的:本檔在這一片之前**整支檔 `console.*` = 0** —— 5 支 cron route 裡唯一一支。
    //   而這條路回 **200** ⇒ 📌 **「上膛了」與「沒上膛」在 Vercel log 上印同一片空白。**
    // 🔴 **為什麼是 `console.info` 不是 `console.error`**:沒上膛是**正常狀態**, 不是失敗
    //   —— 它不進任何失敗計數、不觸發任何告警、不改回應碼。
    //   **錯的是把「正常」讀成「不用講」。「正常」與「該吵」是兩件事。**
    // 🛑 **它不會自己安靜下來**(終結它的動作是「有人去設那顆 env」= 要人做的)
    //   ⇒ 所以它刻意只用 `info` 一格, 不升級成告警;否則它會變成永久噪音。
    // 🛑 **零 PII**:只印我們自己寫死的 env 名與固定訊息, **不印 env 的值**。
    // ⚠️ **射程**:它只答得出「**這一輪跑的時候, 那顆 env 有沒有被讀到**」——
    //   答不出「Vercel 上設了沒」(設了不 redeploy ⇒ 現行 deployment 仍讀不到 ⇒ 這裡照樣印, 而那是對的)。
    // 🔴 **而【心跳那一格不動】**:這條路**仍然不寫心跳** ⇒ 儀表板照舊會把它標成過期,
    //   而那是「這支排程沒上膛」在線上的另一個訊號。**兩個訊號在不同層, 這一片只加後者。**
    console.info('[capture-recheck] 🔵 還沒上膛 ⇒ 這一輪整段不跑(不是失敗,回 200)', {
      env: 'CAPTURE_RECHECK_CUTOFF_DAYS',
      reason: 'skipped_no_cutoff',
    });
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
    // 🔴🔴 **心跳的「成功」比這支 route 的 `ok:true` 嚴格**(codex R1 finding 1)。
    //    `recheckCaptureState` 對**單列**的查詢/寫回失敗是**計數不拋**
    //    (`recordFailures` / `writeFailures`,見該 use-case 檔頭)⇒ route 照樣回 200。
    //    ⇒ 沿用 `ok:true` 當心跳判準 ⇒ **每一輪都在失敗、而儀表恆綠**。
    //    ⚠️ **本次【不改回應】** —— 200 是這支 route 既有的契約,動它是另一片。
    //      這裡只讓心跳說實話:有任何一列失敗 ⇒ 這一輪不算乾淨。
    const clean = result.recordFailures === 0 && result.writeFailures === 0;
    if (clean) await recordHeartbeatSuccess(CRON_JOB_NAME.captureRecheck);
    else await recordHeartbeatFailure(CRON_JOB_NAME.captureRecheck);
    return Response.json({ ok: true, enabled: true, cutoffDays, limit: RECHECK_LIMIT, ...result }, { status: 200 });
  } catch {
    // 🔴 不回 200 —— 「跑壞了」與「本來就沒東西」不得在回應上長得一樣。
    await recordHeartbeatFailure(CRON_JOB_NAME.captureRecheck);
    return new Response(null, { status: 503 });
  }
}
