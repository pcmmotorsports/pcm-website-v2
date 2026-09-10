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
import { moneyCronHeartbeatJobs } from '@pcm/domain';
import { getSettleChargeDeps, getAnomalyAlertDeps } from '@/lib/payment/composition';
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

/**
 * 🔴🔴 **金流那兩支排程的心跳** —— `pcm-settle-retry` · `pcm-expire-unpaid-orders`。
 * ⟦b4-SWEEPDEAD1⟧ 續。Sean 2026-09-10 拍甲:「只縮金流那兩支,加一支每 10 分的輕檢查」。
 *
 * ## 🛑 這一片縮的是【多久有人來看】,**不是**【多久算掛了】
 * 那兩支的過期判準本來就是 `staleMinutes` 30 / 180 分(見 `cron-jobs.ts` 的登記表),
 * 而**唯一會呼叫心跳檢查的是 `pcm-anomaly-alert`,它一天只跑一次**。
 * ```
 * 之前  staleMinutes + 最多 24 小時(等下一次 anomaly-alert)
 * 之後  staleMinutes + 最多 10 分鐘(本檔搭 pcm-capture-recheck 的 每10分 順風車)
 * ```
 * 📌 **`expire-unpaid-orders` 的 180 分【一分鐘都沒有變短】** —— 下一個人看到「加了每 10 分的檢查」
 *    很容易讀成「門檻變成 10 分」。改門檻要回去問 Sean —— `cron-jobs.ts` 檔內那句逐字
 *    「改這裡的任何一個 `staleMinutes` ⇒ 儀表板側與告警側【兩邊都要動】」。
 *    🔵 **錨在那句話, 不錨行號** —— 本檔有一道守門禁止「檔名:行號」引用(行號會漂而漂掉時沒有訊號)。
 *
 * ## 🔴 為什麼【三條出口各叫一次】,而不是在最前面叫一次
 * 本檔的上膛閘:`CAPTURE_RECHECK_CUTOFF_DAYS` 沒設 ⇒ **整段不跑、回 200、而且刻意不寫心跳**。
 * ⇒ 🛑 **這個檢查若只放在那道閘之後,只要那顆 env 沒設,它一輪都不會跑 —— 而回應仍然是 200。**
 * ⇒ 📌 **一個「裝好了」的檢查,在一個沒人注意的 env 沒設的世界裡,靜靜地一次都不跑。**
 *    那一格有測試釘著(見 route.test.ts「CUTOFF_DAYS 未設也要跑」)。
 *
 * 🔴 **而它也不可以擺在【本業之前】**(codex 2026-09-10 R1 must-fix ①):
 *    `await` 它 ⇒ 本業要等 DB 查詢 + 所有通知送完才開始,而三者共用同一個 `maxDuration`
 *    ⇒ 📌 **一輪本來 55 秒的請款重查,加上 9 秒的通知就會被平台砍掉** ——
 *      而那時候 `catch` 保不住回應,也補不了心跳。
 * ✅ **⇒ 本業先跑、它自己的心跳先寫,然後才輪到這個搭便車的觀察者。**
 *    ⇒ 所以呼叫點是**三條出口各一次**(沒上膛 / 跑完 / 本業炸了),不是入口一次。
 *
 * ## 🛑 天花板:`pcm-capture-recheck` 自己掛了 ⇒ 這個檢查跟著啞
 * 而發現它啞的只有一天一次那支 ⇒ **那段時間兩支金流回到沒人看,而畫面什麼都不會變。**
 * 📌 **這個盲點【從裡面關不掉】** —— 把 capture-recheck 放進名單沒有用:它跑得起來才會回報。
 * 而另開一支獨立 cron **也沒消滅它**,只是把「誰看觀察者」往上推一層(plan §二有兩案對照)。
 *
 * ## 🔵 不節流(Sean 2026-09-10 批),而上界寫在這裡
 * 這條告警路徑上**沒有任何節流或去重** —— 「每天只跑一次」本身就是之前的節流,而本片把它拿掉。
 * ⇒ 壞掉時 **6 則/小時,而那是【每個管道】**(LINE 與 Email 都會收)。
 * 📌 **那是刻意的**:一支金流排程掛了,吵是對的;修好它的時間窗以小時計。
 *    要節流就得存「上次叫的時間」⇒ 那會把本片從「不動 schema」變成「動 schema」。
 *
 * ## 🛑 它【不改】本 route 的回應,也不動 capture-recheck 自己的心跳
 * 這是一個**搭便車的觀察者**。它壞掉不可以弄壞本業(本業是請款重查)。
 * ⇒ 任何例外都在這裡吃掉並 `console.error`,**不往外冒**。
 * ⚠️ **而那個吃掉有代價,明寫**:`getAnomalyAlertDeps()` 會 `requireEnv('PAYMENT_CONFIRMER_DB_URL')`
 *    ⇒ 那顆 env 缺了 ⇒ 這個檢查每輪安靜失敗,而 capture-recheck 照樣回 200。
 *    ⇒ 📌 **所以那個 `console.error` 是這一格唯一的訊號** —— 它不是裝飾。
 */
/**
 * 🔴 這個搭便車的觀察者最多能佔用多久(毫秒)。
 * 本 route 的 `maxDuration` 是 60 秒,而本業(請款重查)最壞 ≈ 12.5 秒。
 * 🛑 **上限存在的理由不是效能, 是【它不可以把本業的回應拖過平台上限】** ——
 *    DB 那一側有自己的逾時, 而**通知那一側是外部 HTTP**, 它慢起來沒有天花板。
 * ⚠️ 而逾時**不代表沒事**:超時走 `catch`, 那裡會 `console.error`。
 */
const MONEY_HB_BUDGET_MS = 10_000;

/**
 * 🔴 整輪的平台上限(毫秒)—— **對齊本檔的 `maxDuration`**。
 * 🛑 它是**平台砍掉整次執行**的那條線, 不是某一段的預算。
 */
const ROUTE_BUDGET_MS = 60_000;

/** 🔵 留給「把回應送出去」的餘裕 —— 算到 0 才停等於算得剛剛好, 而剛剛好會被砍。 */
const RESPONSE_MARGIN_MS = 2_000;

/**
 * 🔴🔴 **量「過了多久」一律用單調時鐘, 不用牆上時鐘**(codex 2026-09-10 R3 must-fix)。
 *    ⛔ ~~我前一版用 `Date.now()`~~ ⇒ 反證:已經跑了 55 秒而**系統時鐘被回撥 10 秒**
 *      ⇒ 算出來的 elapsed 是 45 秒 ⇒ 給滿 10 秒預算, **而真正剩下的只有 5 秒**。
 *      同一個回撥也會讓 `deadline` 那道檢查放行一個早就該停的通知。
 *    📌 **`Date.now()` 量的是「現在幾點」, 不是「過了多久」** —— 而它們只有在沒有人調時鐘的時候相等。
 *    🔵 這與本 repo 既有那條紀律同源:`get_cron_heartbeat_stale_counts` 用 `clock_timestamp()`
 *      而不是 `now()`, 理由也是「量的受詞不對」。
 */
const monotonicNow = (): number => performance.now();

/**
 * @param startedAt 這一輪 route 進來的時刻(**單調時鐘** `monotonicNow()`)。
 *
 * 🔴🔴 **預算要從【整輪】扣, 不是從觀察者自己啟動才開始算**(codex 2026-09-10 R2 must-fix ①)。
 *    ⛔ ~~我第一版寫死 10 秒, 從觀察者啟動起跳~~
 *    ⇒ 反證:本業 55 秒 + 觀察者 9 秒 ⇒ 回應在第 **64 秒**才生出來,
 *      **而觀察者自己的計時器根本還沒逾時** ⇒ 那個上限量錯了受詞。
 *    📌 **一個「10 秒上限」保護的是它自己, 不是那一輪。**
 */
async function checkMoneyCronHeartbeat(startedAt: number): Promise<void> {
  const remaining = ROUTE_BUDGET_MS - (monotonicNow() - startedAt) - RESPONSE_MARGIN_MS;
  const budget = Math.min(MONEY_HB_BUDGET_MS, remaining);
  if (budget <= 0) {
    // 🔵 本業已經把整輪吃光 ⇒ **這一輪就不看了**, 而那要出聲 —— 不出聲的話
    //    「看過而健康」與「根本沒看」在 log 上是同一片空白。
    console.error('[capture-recheck] 🔴 金流排程心跳這一輪沒有預算可跑', {
      reason: 'money_cron_heartbeat_no_budget',
      elapsedMs: Math.round(monotonicNow() - startedAt),
    });
    return;
  }
  const deadline = monotonicNow() + budget;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runMoneyCronHeartbeat(deadline),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`money cron heartbeat 超過 ${budget}ms 預算`)),
          budget,
        );
      }),
    ]);
  } catch (err) {
    // 🛑 吃掉,不往外冒 —— 本業不能被觀察者弄壞。而 reason code 要分得出是哪一種。
    console.error('[capture-recheck] 🔴 金流排程心跳這一輪沒跑成', {
      reason: 'money_cron_heartbeat_failed',
      kind: err instanceof Error ? err.name : typeof err,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 真正做事的那一半 —— 例外一律往外丟,由 `checkMoneyCronHeartbeat` 統一吃掉並記錄。
 *
 * @param deadline 過了這一刻就**不准再開始**新的外部動作(**單調時鐘**比對)。
 *
 * 🔴🔴 **`Promise.race` 只是【停止等待】, 它不會停止那個還在跑的工作**(codex R2 must-fix ②)。
 *    ⇒ 反證:查詢慢 12 秒 ⇒ route 在第 10 秒記錯並回 200,
 *      **而原本那個 promise 在第 12 秒才開始送通知** ⇒ 一個沒有人在等的通知,
 *      而它可能在函式被凍結時送到一半。
 * ✅ **⇒ 在【每一個外部動作之前】問一次還有沒有時間** —— 這裡沒有取消訊號可用,
 *    而「不開始」比「開始了再被砍」乾淨。
 */
async function runMoneyCronHeartbeat(deadline: number): Promise<void> {
  {
    // 🔴 名單從白名單依名字挑 + 斷言恰 2 筆,挑不到就 throw(見 `moneyCronHeartbeatJobs` 的說明)。
    //    📌 **兩處各自都對,而它們沒對過話 —— 那支函式的註解就是那次對話。**
    const jobs = moneyCronHeartbeatJobs();
    const deps = getAnomalyAlertDeps();
    const hb = await deps.reader.getCronHeartbeatStaleCounts(jobs);

    // 🔵 `null` = 那支 DB 函式還不在(部署窗口)⇒ **【查不到】不是【零異常】**,要出聲而不假裝正常。
    if (hb === null) {
      console.error('[capture-recheck] 🔴 金流排程心跳查不到 ⇒ 那支函式不在(部署窗口?)', {
        reason: 'money_cron_heartbeat_fn_missing',
        jobs: jobs.map((j) => j.jobName),
      });
      return;
    }
    if (hb.abnormalCount === 0) return;

    const names = hb.abnormalJobs.join(' / ');
    const message = {
      subject: '🔴 金流排程沒在跑',
      // 🛑 零 PII:只有排程名與數字,那些是我們自己寫死的字面。
      text:
        `這幾支金流排程太久沒有成功:${names}\n` +
        `異常支數:${hb.abnormalCount}\n\n` +
        '這代表「距離上次成功」超過了它的門檻,不代表它剛剛失敗了一次。\n' +
        '(這兩支是純 SQL 排程,失敗次數量不到 —— 唯一看得到的就是多久沒成功。)',
    };
    // 🔴 **通知是外部 HTTP, 它慢起來沒有天花板** ⇒ 過了 deadline 就不開始。
    if (monotonicNow() >= deadline) {
      throw new Error('money cron heartbeat 已逾時 ⇒ 不開始送通知(有異常而這一輪沒送出)');
    }
    const sent = await Promise.allSettled(deps.notifiers.map((n) => n.notify(message)));
    const failed = sent.filter((r) => r.status === 'rejected').length;
    // 🔴 零管道也算故障:那不是「沒事」,是**沒有任何管道可以告訴你有事**。
    if (failed > 0 || deps.notifiers.length === 0) {
      console.error('[capture-recheck] 🔴 金流排程心跳告警送不出去', {
        reason: 'money_cron_heartbeat_undeliverable',
        notifiersTotal: deps.notifiers.length,
        failed,
      });
    }
  }
}

export async function GET(request: Request): Promise<Response> {
  // 🔴 整輪的起點 —— 觀察者的預算要從這裡扣(見 `checkMoneyCronHeartbeat`)。
  //    🛑 單調時鐘:量的是「過了多久」, 不是「現在幾點」。
  const startedAt = monotonicNow();
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
    // 🔴 **這支排程沒上膛, 而心跳檢查【照樣要跑】** —— 見 `checkMoneyCronHeartbeat` 的說明。
    //    (擺在這條 return 之前, 而不是擺在上膛閘之前 —— 兩者在這個世界等價,
    //     而擺這裡本業就不必等它;見該函式「不侵占本業時間」那一段。)
    await checkMoneyCronHeartbeat(startedAt);
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
    // 🔴 **本業與它自己的心跳都寫完了才跑這個附加檢查** —— codex 2026-09-10 R1 must-fix ①。
    await checkMoneyCronHeartbeat(startedAt);
    return Response.json({ ok: true, enabled: true, cutoffDays, limit: RECHECK_LIMIT, ...result }, { status: 200 });
  } catch {
    // 🔴 不回 200 —— 「跑壞了」與「本來就沒東西」不得在回應上長得一樣。
    await recordHeartbeatFailure(CRON_JOB_NAME.captureRecheck);
    // 🔵 本業炸了也照跑 —— 金流排程有沒有掛與請款重查有沒有掛是兩件事。
    await checkMoneyCronHeartbeat(startedAt);
    return new Response(null, { status: 503 });
  }
}
