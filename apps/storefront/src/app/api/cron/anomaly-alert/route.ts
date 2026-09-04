// app/api/cron/anomaly-alert/route.ts — 雙扣 anomaly 主動告警 cron route(M-3 #250)
//
// **Supabase pg_cron**(job `pcm-anomaly-alert`、`0 1 * * *` = UTC 01:00 = 台北 09:00)經
// `pcm_cron.invoke_cron_route` 以 `pg_net` 打進來 → 跑 checkAnomalyAlerts(use-case):讀 anomaly + 死卡列計數 **與訂單單號** →
// 🔴 ~~Vercel cron(vercel.json crons)週期觸發~~ **這句是假的,而它是本檔第一行、最容易被讀到的那一句。**
//    排程 2026-07-24 已搬 Supabase pg_cron(commit `a5d76192`);`vercel.json` 與 `apps/admin/vercel.json`
//    **皆無 `crons` 段(不是漏掉)** —— 同一件事本檔下方那段「**兩個前置今日皆已不成立**」
//    早就寫對了,而**沒有人改第一行**。
//    (錨在字面不在行號:本檔有一道守門會擋掉裸行號 —— 我剛剛就是被它擋下才改成這樣。)
//    📌 一份檔案裡兩句相反的話,危險的永遠是【比較容易被讀到】的那一句。
//    (舊字面留刪除線不刪:讓下一個人看得出它曾經被相信過 —— 2026-08-28 我自己就是照它去找 `vercel.json` 的 `crons` 的。)
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
//      🔴 **第三種 503(F-004,2026-08-24 新增)**:`result.orderRefundsStuckUnknown` ——
//      退款卡住計數那支 RPC(`get_order_refunds_stuck_summary`)尚未 apply。
//      刻意**不**進 `shouldAlert`:DB 沒 apply 是**部署問題**,該吵的對象是看 cron 的人,
//      不是每天寄一封「尚未啟用」給老闆(那是把沉默換成無限重寄、同一個病的另一面)。
//      ⚠️ 它**不擋信** —— 本來就要寄的那封照常送出,只是多帶一行「今天查不到」。503 ≠ 信沒寄。
//      📌 這三行是**清單**,而 code-reviewer 2026-08-24 抓到它漏了第三種(鐵則 11 字面 vs 事實)
//         ⇒ 日後再加 503 路徑,**同一顆 commit 更新這裡**。
//   4. 不採信任何外部輸入:無 client 參數 / 無 query / 無 body;refunding 卡住門檻 = route 端常數。告警訊息**含訂單單號**(2026-08-19 Sean 拍板;~~原寫「零 PII」~~ 作廢。⚠️ **route 的回應與 log 仍是 counts-only**,那半沒變)
//      (reader 走 payment_confirmer SECDEF 受控窗、對 anomaly 兩表零表權;
//       🔴 ~~原寫「只計數」~~ 作廢 —— 它同時讀計數**與五組訂單單號**,見 check-anomaly-alerts.ts 檔頭)。
//
// 🔴 GET handler(Vercel cron 走 GET;寫成 POST 等 → cron 永不觸發 = 靜默不告警)。
// 🔴 不變式(lazy 跨包契約、鏡像 settle-sweep route 警語):getAnomalyAlertDeps factory **必須維持 lazy**——建構子
//    只存連線字串/密鑰、零 module-top env 讀取 / 零連線建立。下方 GET 的 disabled 路徑(ANOMALY_ALERT_ENABLED gate
//    在「建 deps 前」return)之「零 DB env 依賴」保證仰賴此;改 @/lib/payment/composition 前必守此 lazy 契約。
// ⛔ 下面兩段【都是對的,只是各自為真於不同的時刻】。兩段都留著,各自帶著自己的時刻標籤。
//    🔴 不用刪除線 —— `//` 註解裡的 `~~` **不會真的劃除**,只會變成兩套並排的互斥事實
//       (codex R2 對本段 A/C 指出;而舊句**沒有錯,它只是過期了** —— 那是兩件事)。
//       📌 本檔另有兩處**既有的** `~~`(都在檔頭「不採信任何外部輸入」那條底下),緊接「作廢」二字、**做事的是那兩個字不是符號**
//          ⇒ 危險性較低,**本片刻意不動**(不是漏掉;動它會讓本片的範圍從「payment 端點註解」
//          擴成「全檔 `~~` 清理」,下一個審的人要重新判斷範圍)。
//
//    ── [2026-08-17 當時為真;已被 2026-08-21 的量測取代,見下] ─────────────────────
//    2026-08-17:下面那句「prod 不推播」很可能已經是假的,而我沒有親自量。
//    依據:`~/pcm-mailbox/B-580-STOP-20260817.md` §6-5/§6-6 記載 ANOMALY_ALERT_ENABLED=true、
//    LINE/Email 密鑰皆存在、pg_cron pcm-anomaly-alert active。那是別人量的,我沒看 Vercel 設定畫面。
//    ⇒ 寫作「未確認」而不是「已解除」—— 缺的那道檢查 = 當場讀一次 Production env。
//    🔴 而同一份 B-580 §6-6 另記一件更重要的:**截至 2026-08-17,沒有人收到過任何一封告警**
//    ⇒「真的沒異常」與「它其實發不出來」印同一句話。⇒ 不得把本 route 存在讀成「告警會叫」。
//    ── [2026-08-21 起為真] ────────────────────────────────────────────────────
//
// ✅ 2026-08-21 實測:它真的寄出去了,而且【兩端各量到一次,而它們對得上】
//    (窗 G,正本 `~/pcm-mailbox/G-c0-告警片實測-它今天真的寄出去了-20260821.md`)
//    系統端:net._http_response id=19701 / created 2026-08-21 01:00:00.908699+00 / status_code 200
//            回應 JSON 逐字 {"ok":true,"enabled":true,"alerted":true,"attemptManualReviewCount":2,
//            "notifiersTotal":2,"notifiersFailed":0,"errors":0}(其餘計數欄皆 0,已省略)
//            🔴 notifiersFailed:0 這次可信 —— 兩支 adapter 都真的檢查回應並 throw:
//               LineAlertNotifierAdapter.ts / EmailAlertNotifierAdapter.ts 皆 `if (!res.ok) {` → `throw`
//               (🔴 錨在【字面】不在行號 —— 這兩支還會再動。跳過去的方法:
//                grep -n 'if (!res.ok)' packages/adapters/src/payment/{Line,Email}AlertNotifierAdapter.ts
//                錨若消失,`route.test.ts` 的『註解引用的錨還在』那格會紅。)
//               ⇒ 非 2xx 會冒成 use-case error → route 503。
//    客人端:Sean 本人 2026-08-21 上午回報【收到】,並貼回內文逐字。
//    🔴 **下面這段是【那天實際寄出去的那一封】的逐字紀錄,不是現行文案 —— 不要更新它。**
//       它證明的是「那封信長這樣、而且送到了」;把它改成新文案會讓這個證據失效。
//       ⚠️ 而其中末兩行的文案**已於 2026-08-21 改掉**:那版叫人「決定要退款還是標記免處理」,
//          而**後台那兩個動作都做不到**(C 窗查證、窗 G 複驗)⇒ 現行文案見
//          `packages/use-cases/src/check-anomaly-alerts.ts` 的 `footer`。
//              ⚠️ PCM 付款有 2 張單要你看
//              【刷卡卡在中間,系統自己處理不了】2 筆
//                2SQH2P
//                GVRDMH
//              https://admin.pcmmotorsports.com (需登入後台)
//              請到後台查這幾筆,看過之後再決定要退款還是標記免處理。
//              ⚠️ 先查清楚再退款 —— 上面每一筆都只是「可能」,不是已經確定。
//    ⇒ 兩個不同的量具、兩端各一次,而它們對得上。
//    ✅ **量到的(這兩件是事實,不要因為下一段的保留而一起抹掉)**:
//       ① **兩個 notifier 各自都收到 2xx**(`notifiersTotal:2` / `notifiersFailed:0`,而兩支 adapter
//          都 `if (!res.ok) throw`)⇒ LINE Messaging API 與 Resend **兩邊都收下了那則訊息**。
//       ② **至少一條**通知抵達 Sean 手上(他貼回內文為證)。
//    🔴 **推不出的(codex R1 MF-1 / R2 nit,射程收在【推論】不收在【量測】)**:
//       「所以兩個收件【對象】都正確」—— 平台收下 ≠ 送到對的人;而他貼回來的是一段文字,
//       那段文字**不會說明它從哪個管道來** ⇒ 兩個收件對象各自是否正確,**未分別驗證**。
//       要分開驗,得讓兩邊帶可區分的標記。
// 🔴 而 n 仍然是 1 —— 不要把上面讀成「天天都成功」:
//    job 自 2026-07-26 起共跑 27 次,而 net._http_response 只保留約 6 小時
//    (當日實測 253 列,窗 = 2026-08-20 21:16 → 2026-08-21 03:15 UTC)
//    ⇒ 前 26 次的回應**已超過保存窗、現在查不到**。
//    🔴 **射程(codex R1 MF-2 收窄)**:它們當時**有沒有被人看到,無法從這裡判斷** ——
//       我量的是【那張表】,而「沒有人看過」是關於【人】的宣稱。要留證據只能當場抄逐字。
// 🔴🔴 查本 route 健康時【不要查 cron.job_run_details】—— 那把尺對這一題恆真:
//    job 的 command = SELECT pcm_cron.invoke_cron_route(...),而它內部的 net.http_get 是【非同步】
//    ⇒ 它記的是「請求排進佇列了」,route 回 401/500/503 它一樣印 succeeded(每次耗時約 15ms、
//      return_message 逐字 "1 row")。
//    實錘(同一發、兩份紀錄,2026-08-20):21:20 與 21:24 兩發 net._http_response status_code=503 / errors:1,
//    而 cron.job_run_details runid 19823 / 19825 都寫 "succeeded";中間 21:22 真的成功那發也寫 "succeeded"
//    ⇒ 成功的那一發與失敗的那兩發印出完全相同的字。**唯一有判別力的是 net._http_response.status_code。**
//    (那兩發 503 屬於 pcm-settle-sweep、不是本 route;已另行開單。)
// ✅ 2026-08-21 01:00 那一發【走了 enabled 分支】—— 從行為量到的,不是讀 Vercel 面板:
//    量到的是:**該次請求走的是 enabled 分支**(disabled 路徑在建 deps 之前就 return、
//    印的是 anomaly_alert_disabled ⇒ 兩個分支印不同的字 ⇒ 這個判別有效)。
//    🔴 **射程(codex R1 MF-3 收窄)**:那是【那一刻走了哪個分支】,
//       **推不出「目前 env 的原始值仍然等於 true」** —— env 可能在那之後被改。
//    ⚠️ 仍未查:env 的【原始值】(含收件對象 LINE_ALERT_TO / ALERT_EMAIL_TO,取值處在
//       @/lib/payment/composition.ts 的 `to: requireEnv('LINE_ALERT_TO'),` 與
//       `to: requireEnv('ALERT_EMAIL_TO'),`)
//       與【它何時被設成這樣】。
//    📎 同族正本在 `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` 檔頭那一段
//       (那段講的是 `CRON_SWEEPER_ENABLED`;本檔的閘是 `ANOMALY_ALERT_ENABLED`,**是兩個不同的 env**)。
// ⚠️ [2026-07 前為真;兩個前置今日皆已不成立,逐格說明如下]
//    誠實中間態:route commit 到 dev 即可,但 prod 不推播直到 ① vercel.json crons 段 ② Sean 設 env
//    【兩個前置今日皆已不成立,逐格說明】:
//    ① **過期** —— 排程已搬 Supabase pg_cron(commit `a5d76192`,2026-07-24);vercel.json 與
//       apps/admin/vercel.json **皆無 crons 段**(不是漏掉)。job 定義在
//       supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql 的
//       cron.schedule('pcm-anomaly-alert', '0 1 * * *') = UTC 01:00 = 台北 09:00。
//       (🔴 這一處原本在檔名後面接了一個行號,而那個行號【是對的】—— 不是因為寫得比較小心,是因為
//        已 apply 的 migration 不可改 ⇒ 檔案凍結,行號才不會漂。上面兩處指向【活的】檔,所以漂了。
//        ⇒ 判別句:我指的那支檔,還會不會有人動它?會 ⇒ 不准用行號。)
//    ② **當時已滿足** —— 2026-08-21 01:00 那一發走了 enabled 分支,且 `notifiersTotal:2`
//       ⇒ 兩組管道 env 在**那一刻**都存在(缺任一 `requireEnv` 會 throw)。
//       🔴 那是**那一刻的狀態**,不是「現在仍然如此」—— env 的原始值仍未查(同上 MF-3)。
//    ⇒ **2026-08-21 01:00 那一發實際送達了**(見上方兩端量測);
//       🔴 **之後 env 或設定若被改動,本結論即失真** —— 這裡沒有任何東西在監看那個改動。
//       ⚠️ 改本檔之前先想清楚:**這條路在那一刻是通的,而收信的是 Sean 本人的手機。**
//
// @see docs/specs/2026-06-23-m3-3ds-abandoned-complete-plan.md §7
// @see docs/phase-1-backlog.md #250
// @see packages/use-cases/src/check-anomaly-alerts.ts

import { timingSafeEqual } from 'node:crypto';
import {
  checkAnomalyAlerts,
  readDeployCutoff,
  readOrderCreatedStuckMinutes,
  resolveShippedEmailCutoff,
  type CheckAnomalyAlertsDeps,
} from '@pcm/use-cases';
import { getAnomalyAlertDeps } from '@/lib/payment/composition';
import { buildAnomalyQuietHeartbeatMessage } from '@pcm/use-cases';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';
import { safeErrorName } from '@/lib/safe-log';
import { CRON_JOB_NAME, recordHeartbeatSuccess, recordHeartbeatFailure } from '@/lib/cron/heartbeat';

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

/**
 * 🔴 #256 pending-based 雙扣候選偵測參數 = route 端常數(不採信外部輸入;營運參數、揭示可調、非 SLA)。
 * - WINDOW 43200=12h:同 user 同額兩 paid 單 paid_at 差窗(對齊 W1 sibling 12h 判準;codex K1 改自 5min 避結構性漏)。
 * - STUCK 600=10min:charged attempt「卡住指紋」門檻(結帳到扣款拖逾此才算卡住;正常秒扣 <2min 不觸發、
 *   避免誤報正常「同額買兩個」;對齊 begin user_in_flight 10min 放棄窗)。
 */
const ALERT_PENDING_DC_WINDOW_SECONDS = 43200;
const ALERT_PENDING_DC_STUCK_SECONDS = 600;

/**
 * 🔵 出貨信缺口的寬限秒數 = **15 分鐘**(Sean 2026-08-31 逐字答 `2 甲`)。
 * 🔴 **15 分鐘 = 3 次掃描** —— 寄信佇列的排程是【每 5 分鐘一次】的 cron
 *   ⚠️ (那個 cron 字面**不寫在這個註解裡** —— 它含 `*` 加斜線, 而那兩個字元
 *    連在一起會【把這個區塊註解關掉】。2026-08-31 當場踩到:typecheck 報
 *    `TS1109: Expression expected` 三行, 而那三行看起來與註解無關。)
 *   (`apps/admin/src/lib/dashboard/cron-heartbeat-read.ts` 的白名單逐字)。
 *   ⇒ **連錯三次才叫**, 不會因為「剛好在兩次掃描中間」誤報。
 * 🛑 改它之前先答一句:你要它連錯【幾次】才叫?那個數字不是 15, 是 3。
 */
/**
 * ⟦b9-ENUMWATCH⟧ 片 2:客戶搜尋計數的回看窗口 = 24 小時。
 * 🔵 **它不是門檻** —— 本片刻意不設門檻(板 `⟦b4-ENUM3⟧` 逐字「門檻不要用猜的」);
 *    這個數字**不進 `shouldAlert`**,它只搭已經要寄的那封信的便車,而它產生的正是那個基線。
 * ⚠️ **而天花板要一起記**:那封信只在別的異常觸發時才寄
 *    ⇒ 一整週沒有別的異常 ⇒ **這個數字一次都不會被看到。往前一格,不是解決。**
 */
const ALERT_MANUAL_CUSTOMER_SEARCH_WINDOW_SECONDS = 86400;

const ALERT_SHIPPED_GRACE_SECONDS = 900;

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

  // 1b. 🔴 應用層限流(#254 縱深 hardening):認證通過「後」才計數 → 未持有效 secret 的 flood 不佔額度、不餓死合法
  //     cron;真正威脅 = CRON_SECRET 洩漏後持有效 secret 高頻觸發消耗 LINE/Resend quota + 告警轟炸。超限 → 429,
  //     在建 deps / 推播「前」擋掉。🔴 per-instance best-effort、非全域硬上限(見 lib/cron/rate-limit.ts 誠實邊界);
  //     secret 洩漏的主對策仍是輪替 CRON_SECRET。不 log(避免每筆被擋請求放大成 log 量 = 二次濫用面)。
  if (!checkCronRateLimit('anomaly-alert')) {
    return new Response(null, { status: 429 });
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

    /**
     * 🔵 **出貨信缺口那一段的起始線**(2026-08-31;Sean 逐字答 `2 甲`)。
     * 它與寄信端用**同一顆 env** `SHIPPED_EMAIL_CUTOFF` —— **刻意共用**:
     * 兩邊各讀一顆 ⇒ 它們可以分岔, 而分岔時**告警會對著一個不同的起始線報數字**。
     *
     * 🛑 **沒設 ⇒ 那一段整段不查**, 而**它要出聲** —— 照今晚 `⟦b9-SHIPTZ1⟧` / `⟦b9-CAPARM1⟧` 那條:
     *   一個「還沒上膛」的狀態若不出聲, 它與「一切正常」在 log 上印同一片空白。
     * 🔴 而這裡用 `console.info` 不是 `error`:**沒上膛是正常狀態, 不是失敗** ——
     *   它不進 `errors`、不改回應碼、不觸發任何告警。
     */
    /**
     * 🔴🔴 **同一顆 env 由【同一支 resolver】裁決**(2026-08-31 must-fix,線出貨 `-1e`)。
     *
     * ⛔ ~~舊寫法:這裡自己 `trim()` 一下就當合法~~ —— 而**寄信端不是這樣判的**:
     *   數法 `grep -c resolveShippedEmailCutoff <email-sweep/route.ts>` ⇒ **3**;本檔改前 ⇒ **0**。
     * 🔴 **後果是具體的**:`resolveShippedEmailCutoff` 有格式檢查與**下界
     *   `EARLIEST_SANE = 2026-08-30`**
     *   (常數名在 `packages/use-cases/src/shipped-email-cutoff.ts`,`grep -n EARLIEST_SANE` 找它——
     *    **本檔有一道守門禁止寫【檔名:行號】,因為行號會漂而漂掉時沒有訊號**;我第一版寫了,被它擋下)。
     *   有人設 `2026-08-11` ⇒ **寄信端判 bad-format,一封都不排、不寄**;
     *   而舊的本檔會**收下那個字串、照樣去數** ⇒ 數到一批「貨出了沒通知」
     *   ⇒ 📌 **告警每天叫一件寄信端【結構上做不到】的事。**
     *   ⇒ 而一個叫了而沒有人能把它關掉的告警,下一步是**被整組關掉**(板上 `⟦b4-EMAIL2ND⟧` 前科)。
     * 📌 **⇒ 兩個消費者、兩套驗證 ⇒ 它們對同一個字串有不同的世界觀。這裡把它收成一套。**
     */
    // eslint-disable-next-line no-restricted-syntax -- 受控例外:server-only cron 端點,動態 env 不進 client bundle
    const shippedCutoffRaw = process.env['SHIPPED_EMAIL_CUTOFF'];
    const shippedCutoff = resolveShippedEmailCutoff(shippedCutoffRaw);
    const shippedCutoffIso = shippedCutoff.kind === 'ok' ? shippedCutoff.iso : null;
    if (shippedCutoff.kind === 'not-configured') {
      console.info('[anomaly-alert] 🔵 出貨信缺口那一段還沒上膛 ⇒ 這一輪不查(不是失敗)', {
        env: 'SHIPPED_EMAIL_CUTOFF',
        reason: 'skipped_no_cutoff',
      });
    }
    /**
     * 🔴🔴 **第七種 503**:那顆 env **設了、而值不合法**。
     *
     * 🛑 **它與「還沒上膛」是相反的兩件事,不可以共用同一條路**:
     *   沒設 = 正常狀態(功能還沒開)⇒ `info`、不 503。
     *   **設了而不合法 = 寄信端此刻【一封都不寄】,而設的人以為他開好了。**
     *   ⇒ 📌 **那是本片要治的病本身:一個關掉了的功能,外觀與一個健康的系統相同。**
     * 🔴🔴 **而【它要排在哪裡】被 codex 2026-08-31 R1 擊破過一次,原句留著**:
     *   ⛔ ~~我的第一版在這裡就 `return 503`~~ —— codex must-fix 逐字:
     *      「route 在 `checkAnomalyAlerts` 前直接 return 503 ⇒ **同輪付款、退款等其他真異常全部不通知**」。
     *   📌 **⇒ 一顆打錯的出貨 env,會讓【整支告警】啞掉一天。而那比它要治的病更嚴重。**
     *   ✅ 改法:這裡只 `console.error` + 把出貨段當「不查」(`shippedCutoffIso = null`),
     *      **503 排到 `checkAnomalyAlerts` 跑完之後**,與第三～六種同一個位置。
     *   🛑 判別句:**一個新加的 fail-closed,它擋掉的東西可能比它守的東西寬。**
     * ✅ 形狀沿用第三～六種:**它不擋信**(本來就要寄的那封照常送出),也不擋別類告警。
     * 🛑 **零 PII**:`why` 是 `shipped-email-cutoff.ts` 裡我們自己寫死的字串,**不是使用者填的值**;
     *   `shippedCutoffRaw` 本身**不進 log**。
     */
    if (shippedCutoff.kind === 'bad-format') {
      console.error(
        '[anomaly-alert] 🔴 SHIPPED_EMAIL_CUTOFF 設了而形狀不合 ⇒ 寄信端此刻一封都不寄;出貨那一段本輪不查(本輪結束後回 503)',
        { env: 'SHIPPED_EMAIL_CUTOFF', reason: 'bad_cutoff_format', why: shippedCutoff.why },
      );
    }

    /**
     * 🔵 **訊號 4 的起始線**(2026-08-31;Sean 拍 5️⃣ 甲)。env `B4_DEPLOY_CUTOFF`,
     * **與寄信端(`email-sweep`)同一顆**,而且**用同一支 `readDeployCutoff` 裁決** ——
     * 🔴 那不是順手:同一天在 `SHIPPED_EMAIL_CUTOFF` 上量到過「兩個消費者、兩套驗證」
     *   ⇒ 寄信端擋下一封不寄、告警端收下照數 ⇒ **告警叫一件寄信端結構上做不到的事。**
     * 🛑 **三種結果都不 503,也都不擋別類告警** —— 照本檔 codex R1 那條 must-fix:
     *   **一個新加的 fail-closed,它擋掉的東西可能比它守的東西寬。**
     *   · `unset`   = 那條線還沒上膛 = **正常** ⇒ `info` 一行(不出聲的話與「一切正常」同形)
     *   · `invalid` = 設了而值不合法 ⇒ **寄信端此刻一列都不排** ⇒ `error` 一行
     *   · 兩者都讓這一段當「不查」⇒ 落 `orderCreatedGapUnknown`(不進 `shouldAlert`)
     */
    // eslint-disable-next-line no-restricted-syntax -- 受控例外:server-only cron 端點,動態 env 不進 client bundle
    const orderCreatedCutoffRead = readDeployCutoff(process.env['B4_DEPLOY_CUTOFF']);
    const orderCreatedCutoffIso =
      orderCreatedCutoffRead.kind === 'ok' ? orderCreatedCutoffRead.cutoff : null;
    if (orderCreatedCutoffRead.kind === 'unset') {
      console.info('[anomaly-alert] 🔵 訊號4(訂單成立信沒被建出來)還沒上膛 ⇒ 這一輪不查(不是失敗)', {
        env: 'B4_DEPLOY_CUTOFF',
        reason: 'skipped_no_cutoff',
      });
    }
    if (orderCreatedCutoffRead.kind === 'invalid') {
      // 🛑 零 PII:只印我們自己寫死的 env 名與固定字串,**不印那顆 env 的值**。
      console.error(
        '[anomaly-alert] 🔴 B4_DEPLOY_CUTOFF 設了而形狀不合 ⇒ 寄信端此刻一列都不排;訊號4 本輪不查',
        { env: 'B4_DEPLOY_CUTOFF', reason: 'bad_cutoff_format' },
      );
    }

    /**
     * 🔵 **訊號4【持續失敗】那一格的門檻**(板 `⟦b4-SIG4ERRORS⟧`;
     *   Sean 2026-09-01 答「甲 1 小時」⇒ 那顆 env 填 `60`)。
     * 🛑 **三態與 `B4_DEPLOY_CUTOFF` 同形, 而它們是【兩顆各自獨立的 env】** ——
     *   本顆沒設 ⇒ 那一格不查 ⇒ **行為與加這一片之前逐字相同**(落地零風險)。
     * 🔴 而 `invalid` 要出聲、不可以靜靜當成沒設 —— 有人貼成空值而整件事安靜地沒發生,
     *   正是這一整片在防的那種壞法。
     */
    // eslint-disable-next-line no-restricted-syntax -- 受控例外:server-only cron 端點,動態 env 不進 client bundle
    const stuckRead = readOrderCreatedStuckMinutes(process.env['B4_ORDER_CREATED_STUCK_MINUTES']);
    const orderCreatedStuckMinutes = stuckRead.kind === 'ok' ? stuckRead.minutes : null;
    if (stuckRead.kind === 'unset') {
      console.info('[anomaly-alert] 🔵 訊號4【持續失敗】那一格還沒上膛 ⇒ 這一輪不查(不是失敗)', {
        env: 'B4_ORDER_CREATED_STUCK_MINUTES',
        reason: 'skipped_no_stuck_threshold',
      });
    }
    if (stuckRead.kind === 'invalid') {
      // 🛑 零 PII:只印我們自己寫死的 env 名與固定字串, **不印那顆 env 的值**。
      console.error(
        '[anomaly-alert] 🔴 B4_ORDER_CREATED_STUCK_MINUTES 設了而值不合法 ⇒ 訊號4 持續失敗那一格本輪不查',
        { env: 'B4_ORDER_CREATED_STUCK_MINUTES', reason: 'bad_stuck_threshold' },
      );
    }

    const result = await checkAnomalyAlerts(deps, {
      refundingStuckSeconds: ALERT_REFUNDING_STUCK_SECONDS,
      pendingDoubleChargeWindowSeconds: ALERT_PENDING_DC_WINDOW_SECONDS,
      pendingDoubleChargeStuckSeconds: ALERT_PENDING_DC_STUCK_SECONDS,
      shippedCutoffIso,
      shippedGraceSeconds: ALERT_SHIPPED_GRACE_SECONDS,
      orderCreatedCutoffIso,
      manualCustomerSearchWindowSeconds: ALERT_MANUAL_CUSTOMER_SEARCH_WINDOW_SECONDS,
      orderCreatedStuckMinutes,
    });

    // 4. 🔴 本輪有推播失敗 → 503 + 結構化 counts log,**不偽 200**(壞掉的告警管道必須可見)。
    //    result.errors = notifiersFailed(管道 API 非 2xx / transport 失敗);>0 → 下輪 cron 重試(無去重、持續提醒)。
    //    counts only(route 本就無 order/rec/amount 等可洩欄)。
    //    🔴🔴 ⛔ ~~「零 PII」~~ **那個標籤在 2026-09-01 之後不再成立**(R3 must-fix 3)——
    //       `⟦b9-ENUMWATCH⟧` 片 2 加了 `manualCustomerSearchActors`, 而**同批 migration 自己寫著**:
    //       「【計數本身在小樣本下仍可能可再識別】(actors=1 + 已知班表 ⇒ 連得回唯一員工),
    //         **不得宣稱絕對零 PII**;要外送到內部告警管道以外時重新判」。
    //    📌 **⇒ 一個錯的安全標籤比沒有標籤貴** —— 它會讓後續的 log / 轉寄 / 外送
    //       沿用一個不存在的隱私保證, 而沒有人會回頭查那個標籤是什麼時候變假的。
    //    ✅ 正確字面:**本回應只有計數, 而其中 `manualCustomerSearchActors` 在小樣本下可再識別。**
    if (result.errors > 0) {
      console.error('[anomaly-alert] 🔴 本輪告警管道推播有失敗(回 503;不吞成 200 偽裝成功)', { ...result });
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    // 4b. 🔴 **F-004 部署窗口:退款計數那支 RPC 還沒 apply ⇒ 503,而【不是】寄信。**
    //     為什麼放這一層,不放進 `shouldAlert`(codex 關卡1 R2):
    //       進 shouldAlert ⇒ DB 一直沒 apply 就每天寄一封「尚未啟用」給 Sean
    //       ⇒ 久了變例行雜訊 ⇒ 那是**把沉默換成無限重寄**,同一個病的另一面。
    //     ⇒ 「DB 函式沒 apply」是**部署問題**,該吵的對象是看 cron 的人,不是老闆。
    //     ⚠️ 而它**不擋信** —— 上面那封信(若本來就要寄)照常送出,只是多帶一行「今天查不到」。
    //        ⇒ 503 與「信沒寄」是兩件事,不要讀成同一件。
    /**
     * 🔴🔴 **第六種 503(2026-08-31;codex R1 must-fix 1)**:起始線【有設】而那支 RPC 讀不到。
     *
     * 🛑 **判斷式帶 `shippedCutoffIso !== null` 是這一格的全部** ——
     *   沒設起始線 = 「**還沒上膛**」= 正常狀態(上面已經印一行 info)⇒ **不得 503**,
     *   否則一個還沒設定的功能會讓整支 cron 每天紅一次。
     * ✅ 而**有設**卻讀不到 ⇒ 那是**部署問題**(RPC 沒 apply / 權限)⇒ 該吵的對象是看 cron 的人。
     * ⚠️ 形狀逐字沿用第三、四種:**它不擋信** —— 上面那封信(若本來就要寄)照常送出。
     * 📌 **⇒ 而這一格存在的理由**:片1 給那支 RPC 裝了 fail-closed(NULL 參數 ⇒ RAISE),
     *   **若這裡不看那個旗標, 那道 fail-closed 在下游就被拆掉了** —— route 會安靜回 200。
     */
    /**
     * 🔴🔴 **第七種 503(2026-08-31,線出貨 `-1e`;位置由 codex R1 must-fix 決定)**:
     * 那顆 env **設了、而值不合法**。
     * 🛑 它與「還沒上膛」是相反的兩件事:沒設 = 功能還沒開 = 正常 ⇒ `info`、不 503;
     *   **設了而不合法 = 寄信端此刻一封都不寄, 而設的人以為他開好了。**
     * ✅ **而它排在 `checkAnomalyAlerts` 之後** —— 付款、退款那些告警**照常送出**,
     *   只是回應碼帶 503 讓看 cron 的人知道那顆 env 壞了。
     */
    if (shippedCutoff.kind === 'bad-format') {
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json(
        { ok: false, enabled: true, reason: 'bad_cutoff_format', ...result },
        { status: 503 },
      );
    }

    /**
     * 🔴🔴 **第八種 503(2026-08-31,codex R1 must-fix)**:訊號 4 的起始線【有設】而那支 RPC 讀不到。
     *
     * ⛔ ~~我第一版【完全沒消費 `orderCreatedGapUnknown`】~~ —— codex 逐字:
     *   「adapter 降級為 `orderCreatedGapUnknown=true`,但 route 未消費旗標,
     *    仍記成功心跳並回 200;`42883` 甚至沒有 error log,**監控會把『查不到』誤認為健康**」。
     * 📌 **⇒ 那正是本片要治的病本身:一個讀不到的量具, 與一個健康的系統, 印同一個 200。**
     * 🛑 而 adapter 那道 fail-closed(42883/P0001 ⇒ 降級成 unknown 而不是 0)**在下游就被拆掉了** ——
     *   與片 4 `shippedGapUnknown` 那一格逐字同構,而我在同一支檔裡重犯了一次。
     *
     * 🛑 **判斷式帶 `orderCreatedCutoffIso !== null` 是這一格的全部** ——
     *   沒設起始線 = 「還沒上膛」= 正常(上面已印一行 info)⇒ **不得 503**。
     * ✅ 形狀與位置逐字沿用第三～七種:**排在 `checkAnomalyAlerts` 之後**、**不擋信**、不擋別類告警。
     */
    /**
     * 🔴🔴 **這一格【回 503】,而我第一版寫的是「刻意不回」—— codex 打掉了那個理由,它是錯的。**
     *
     * ⛔ ~~我的理由:「回 503 ⇒ recordHeartbeatFailure ⇒ 這個功能會把自己判成不正常,
     *    然後為此每天寄一封信」~~
     * 🔴 **那句話的後半段不成立**:`cronHeartbeatUnknown` 時 `cronHeartbeatAbnormalCount` 是
     *    **`null`** ⇒ `(… ?? 0) > 0` 是 `false` ⇒ **它根本進不了 `shouldAlert`** ⇒ 不會寄信。
     *    ⇒ 📌 **我用一個「會每天寄信」的後果去支持一個決定, 而那個後果不會發生。**
     *      (同族:本檔上面 `emailQuotaSuspectedCount` 那一段也記過我拿假理由支持對決定的事。)
     *
     * ✅ **而 codex 指出的真正代價才是承重的**:回 200 + 記成功 ⇒
     *    **「這把量具壞了」被記成「一切健康」** —— 而那正是這一整片要治的病本身。
     * ⇒ 所以照上面每一種的成例 503:**部署窗口會看得見, 而看得見正是重點。**
     *
     * 🛑 **代價明寫(它是真的)**:片3 上線到片4(Sean 貼 SQL)之間,這支 route **每天回 503**,
     *   而 `pcm-anomaly-alert` 那一列會被記成失敗。**那不是誤報,那就是事實** ——
     *   在那支 RPC 存在之前,這條告警線確實少一隻眼睛。
     * ⚠️ 而它**不會**變成信:那段期間 `count` 是 `null`,進不了 `shouldAlert`(見上面)。
     */
    /**
     * ⟦b9-RLSHARDEN⟧ 甲(片B):**「量不到」那一格**。
     *
     * 🔴 **`bypassRlsRevoked` 不在這裡** —— 它進 `shouldAlert`,走 LINE + Email 到 Sean。
     *    這一格處理的是**另一種**:函式不存在(尚未 apply)、或 `service_role` 這個角色不見了。
     * 🎯 **兩種訊號、兩個觀眾,而這是刻意的**:錢與權限的事吵 Sean;部署/環境的事吵看 cron 的人。
     *
     * 🛑 **而它為什麼要 503 而不是靜靜回 200**(沿用本檔上面每一種的成例):
     *    回 200 + 記成功 ⇒ **「這把量具壞了」被記成「一切健康」** ——
     *    而本片存在的全部理由,就是不要有一個【看起來正常而實際上瞎了】的狀態。
     * 🔵 而它**不會**變成信:`bypassRlsUnknown` 時 `bypassRlsRevoked` 是 `false`
     *    ⇒ 進不了 `shouldAlert`(見 use-case 那道閘)。
     */
    if (result.bypassRlsUnknown) {
      console.error(
        '[anomaly-alert] 🔴 get_privileged_role_bypassrls_state 讀不到(函式未 apply 或 service_role 不存在)⇒ 權限強化那一格今天是【查不到】不是【沒事】(回 503)',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    if (result.cronHeartbeatUnknown) {
      console.error(
        '[anomaly-alert] 🔴 get_cron_heartbeat_stale_counts 讀不到 ⇒ 排程心跳今天是【查不到】不是【六支都健康】(回 503)',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    /**
     * 🔴🔴 **第九種 503(2026-09-01,code-reviewer must-fix)**:訊號4【持續失敗】那一格讀不到。
     * ⛔ ~~我第一版算了 `orderCreatedStuckUnknown` 而【沒有給它出口】~~ ——
     *   兩顆 env 都設好、而那支 RPC 沒 apply ⇒ 42883 → 降級 → `null` → `?? 0`
     *   ⇒ ⇒ **不叫、零 log、回 200。**
     * 🛑 而本檔上面那一格逐字寫著「**我在同一支檔裡重犯了一次**」—— **這是第三次。**
     *   📌 ⇒ 一個【寫下來的教訓】擋不住同一個人在同一支檔裡再犯;擋住它的是這一段碼。
     * 🛑 **判斷式要帶【兩顆 env 都設了】** —— 任一沒設 = 還沒上膛 = 正常, **不得 503**。
     */
    if (
      orderCreatedCutoffIso !== null &&
      orderCreatedStuckMinutes !== null &&
      result.orderCreatedStuckUnknown
    ) {
      console.error(
        '[anomaly-alert] 🔴 兩顆 env 都設了而 get_order_created_stuck_count 讀不到 ⇒ 訊號4 持續失敗那一格今天是【查不到】不是【沒事】',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    if (orderCreatedCutoffIso !== null && result.orderCreatedGapUnknown) {
      console.error(
        '[anomaly-alert] 🔴 起始線有設而 get_order_created_gap_counts 讀不到 ⇒ 訊號4 今天是【查不到】不是【0】(回 503)',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    // 🔴🔴 **codex 2026-09-03 must-fix**:我把三格接進 summary / shouldAlert / result,
    //    **而漏了這一層** ⇒ cutoff 有設、新 RPC 還沒 apply ⇒ `unpaidCancelledGapUnknown = true`
    //    而 route 照回 200、信裡是一片綠 ⇒ 📌 **「安靜」與「這道告警沒裝上」印同一個畫面。**
    // 🎯 而那正是我自己在 plan §8 寫下的驗收條件 —— **我寫了它, 然後沒有做它。**
    //    ⇒ 一句寫在計畫裡的話, 不會讓自己被實作。
    if (orderCreatedCutoffIso !== null && result.unpaidCancelledGapUnknown) {
      console.error(
        '[anomaly-alert] 🔴 起始線有設而 get_order_unpaid_cancelled_gap_counts 讀不到 ⇒ 取消信收件人那一段今天是【查不到】不是【0】(回 503)',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    if (shippedCutoffIso !== null && result.shippedGapUnknown) {
      console.error(
        '[anomaly-alert] 🔴 起始線有設而 get_shipped_email_gap_counts 讀不到 ⇒ 出貨缺口那一段今天是【查不到】不是【0】(回 503)',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    if (result.orderRefundsStuckUnknown) {
      console.error(
        '[anomaly-alert] 🔴 get_order_refunds_stuck_summary 尚未 apply ⇒ 退款卡住那一類今天是【查不到】不是【0】(回 503)',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    /**
     * 🔴 **第四種 503(M-4a,2026-08-29):`result.emailOutboxUnknown`** ——
     * 形狀**逐字沿用**上面第三種,而理由也一樣:寄信那五格**刻意不進 `shouldAlert`**
     * (不進的理由:DB 沒 apply 就每天寄一封「尚未啟用」= 把沉默換成無限重寄)。
     * 🔴 **而「不進告警」只有在【另一條路存在】時才成立** ——
     *    沒有這一段,RPC 一直沒 apply ⇒ **這片完全沉默,而那正是它要治的病。**
     * ⚠️ 它同樣**不擋信**:該寄的照寄,只是這一輪回 503 讓看 cron 的人知道少查了一類。
     */
    if (result.emailOutboxUnknown) {
      console.error(
        '[anomaly-alert] 🔴 get_email_outbox_deadman_counts 尚未 apply ⇒ 寄信那五類今天是【查不到】,不是【沒事】',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    /**
     * 🔵 ⟦b9-ENUMWATCH⟧ 片 2:客戶搜尋計數**查不到**時要留一行 —— codex R1 must-fix 3。
     *
     * 🔴 **而它【刻意不改 200 / 不記 heartbeat failure】**:
     *    那個 Unknown 有一種**完全預期**的成因 —— 那支 RPC 還沒 apply(部署窗口)。
     *    把它升成 503 ⇒ 心跳變紅 ⇒ **一個【還沒上膛】的觀測會讓整支 cron 看起來壞了**,
     *    而那正是本片 plan 自己寫的「為了加一個觀測而弄壞主要功能」。
     * 🛑 **而不留訊號也不行**(那正是 codex 指的):RPC **長期**缺席 ⇒ 沒有人會發現。
     *    ⇒ 折衷 = **回應照舊 200 + 這一行 log**,而 `manualCustomerSearchUnknown` 本來就在
     *      `...result` 裡跟著回應走 ⇒ 打那支 route 的人看得到。
     * ⚠️ **而【誰在讀這一行】沒有解決** —— 它與 `⟦b9-ENUMWATCH⟧` 這一列本身是同一個病的下一層。
     *    ⇒ 那要等這個計數真的接進告警判斷之後才收得掉。**明寫,不假裝這一行等於有人在看。**
     */
    // 🔴🔴 **codex 2026-09-04 must-fix ③:route 原本【完全沒有消費】這兩格** ——
    //    RPC 讀取失敗 ⇒ 只留一行 log、照樣回 200、照樣記「今天健康」
    //    ⇒ 📌 **一個「我讀不到」的世界被回報成「一切正常」。**
    //    ⇒ 而兩格的處置【不同】, 這正是先前把它們拆開的理由:
    //      `searchLogFailed`  = 真的壞了 ⇒ 🔴 **回 503**(與其他讀取失敗同款, 監控看得到)
    //      `searchLogUnknown` 而沒 failed = 那支 RPC 還沒 apply ⇒ 🔵 只 warn, 回 200
    //      (部署窗口是預期中的;為它回 503 會讓「還沒貼」變成每輪一次的假紅)
    if (result.searchLogFailed) {
      console.error(
        '[anomaly-alert] 🔴 搜尋日誌健康度讀取失敗 ⇒ 回 503(不是「一切正常」)',
        { reason: 'search_log_health_read_failed' },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }
    /**
     * 🔴🔴 **⟦b4-NEEDSHUMANNOWATCHER⟧:前提 + Unknown**(主視窗 2026-09-05 裁甲)。
     *
     * 🎯 **前提 = 匯款結帳的入口開著。** 理由是他的原話:
     *    **「部署窗口那幾天線關著不吵, 線一開儀器缺了就必須響。」**
     *    ⇒ flag 關著時那支 RPC 沒貼**不是問題**(客人根本走不到那條路);
     *      flag 開了而它沒貼 ⇒ 🔴 **那些客人正在累積, 而沒有人看得到。**
     *
     * ⚠️ **形狀照 `orderCreatedGapUnknown` 那格(前提 + Unknown), 不是照 `searchLogUnknown`。**
     *    ⛔ ~~原本的裁決寫「與 searchLog 同調 ⇒ 503」~~ —— 而我開檔核了:
     *    🔬 `searchLogUnknown` 那格**只 `console.warn` 不 503**(見下方 :620 一帶)
     *    ⇒ 📌 **「同調」會做出與意圖相反的東西。依據換掉, 意圖不變。**
     *
     * 🔴 **兩個消費端明寫**:這顆 env 的另一個消費端是
     *    `apps/storefront/src/lib/payment/bank-transfer-flag.ts`(結帳 action 層)。
     *    ⇒ **改那顆 env 的語意時, 兩處都要看。**
     *    ⚠️ 而它們**可能不同步** —— 這裡讀的是同一顆 env 而各自解讀, 沒有共用常數。
     *      🔵 沒有抽成共用的理由:那支是 client-facing 的 server action、這裡是 cron route,
     *        為此開一個共用模組會讓一個 env 多一層間接。**代價寫出來, 不假裝解決了。**
     */
    // 🔴 **靜態存取, 不是 `process.env['…']`** —— 那道 lint 逐字:
    //    「禁動態 `process.env[變數]` 存取:Next.js 不 inline ⇒ client bundle 取 undefined ⇒ runtime 壞」
    //    ⚠️ **而我第一版就是寫成中括號的** ⇒ 三綠當場紅。🔵 那道閘擋對了。
    const bankTransferCheckoutEnabled = process.env.BANK_TRANSFER_CHECKOUT_ENABLED === 'true';
    if (bankTransferCheckoutEnabled && result.stuckBankUnknown) {
      console.error(
        '[anomaly-alert] 🔴 匯款結帳開著, 而 get_stuck_bank_orders_health 讀不到 ⇒ 卡住的匯款單今天是【查不到】不是【零張】',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }
    /**
     * 🔴🔴 **「沒貼」與「讀壞了」要分開**(codex R2 must-fix ②, 主視窗 2026-09-05 裁甲)。
     * ⛔ ~~我原本只分「flag 開/關」~~ —— 而那讓**真實讀取失敗**在 flag 關著時只 warn、route 回 200,
     *    而且**後續還會記健康心跳** ⇒ 🔴 **一個壞掉的讀取被記成「今天健康」。**
     * 🎯 **⇒ 而這正是 R1 那條「算出來而沒人讀」的同型復發** ——
     *    我為了折它補了 `stuckBankFailed` 這個欄位, **而我沒有接它。**
     *    ⇒ 📌 **我折一條 finding 的方式, 製造了同一條的第二個實例。**
     * ✅ 現在:`stuckBankFailed`(真的丟例外)**一律 503, flag 開關不管** ——
     *    那是儀器故障, 不是部署窗口。
     */
    if (result.stuckBankFailed) {
      console.error(
        '[anomaly-alert] 🔴 get_stuck_bank_orders_health 讀取【失敗】(不是還沒 apply)⇒ 儀器壞了',
        { ...result },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }
    if (!bankTransferCheckoutEnabled && result.stuckBankUnknown) {
      // 🔵 flag 關著 ⇒ 不吵, 而**仍然留一行** —— 讓翻開 flag 的人回頭看 cron log 時,
      //    知道這件事在翻開之前就已經是「查不到」了。
      // 🔵 到這裡 ⇒ **一定是「還沒 apply」** —— 讀取失敗那條已經在上面 503 了。
      //    ⛔ ~~原訊息逐字斷言「那支 RPC 還沒 apply」而 Unknown 也含讀取失敗~~(codex R2 nit)
      //    ⇒ ✅ 現在那句話是真的, 因為上面那格已經把另一個成因分走了。
      // 🛑 **而這個世界有一個【安靜的漏】, 主視窗 2026-09-05 裁「留著寫板列」**:
      //    flag 關著 **不代表庫裡沒有卡單** —— 後台手動建單 / 直接打 RPC / 曾經開過又關掉,
      //    三條路都留得下。而此時 RPC 沒貼 ⇒ 那些單真的存在, 而沒有人看得到。
      //    🔵 **這個世界在那支 RPC 貼進正式庫那一刻消失**(它在早上佇列 §A 第 6 位)。
      //    ⇒ 🔴 而不選「一律 503」的理由是他的原話:**「窗口幾天、每天一封假警報會被關掉,
      //      而關掉的閘比安靜的漏更難回來。」** ⇒ 板列 ⟦b4-STUCKBANKBLINDWINDOW⟧。
      console.warn(
        '[anomaly-alert] 🔵 卡住匯款單健康度查不到 ⇒ 那支 RPC 還沒 apply(而匯款入口關著 ⇒ 本輪不告警)',
        { reason: 'stuck_bank_health_unknown_flag_off' },
      );
    }

    if (result.searchLogUnknown) {
      console.warn(
        '[anomaly-alert] 🔵 搜尋日誌健康度查不到 ⇒ get_search_log_health 還沒 apply',
        { reason: 'search_log_health_unknown' },
      );
    }

    /**
     * 🔴🔴 **`manualCustomerSearchFailed` 原本【零處被讀】**(2026-09-05, 由本輪新增的
     *    `*Unknown`/`*Failed` 對帳閘第一次跑就抓到 —— 見 `anomaly-alert-key-contract.test.ts` 末段)。
     * 🔬 而它**不是誤報**(錨用字面, 不用行號 —— 那三支檔今晚都有人在寫):
     *    `check-anomaly-alerts.ts` 有算它、`check-anomaly-alerts.test.ts` 有兩處斷言,
     *    而 route 零處讀 ⇒ 三處都 grep `manualCustomerSearchFailed` 即到
     *    ⇒ **真實讀取失敗時 cron 回 200, 沒有人知道。**
     * 🔵 **本格與上面 `searchLogFailed` 那格【逐字同型】** —— 刻意不自己發明形狀。
     * ⚠️ **這一格是線【信】`-mail` 順手接的, 而那支欄位是線【資料】`-db` 的片(`3a848c58e`)**
     *    ⇒ 🛑 **我沒有那片的上下文, 只照 sibling 的形狀接 ⇒ 請 `-db` 覆核。**
     */
    if (result.manualCustomerSearchFailed) {
      console.error(
        '[anomaly-alert] 🔴 客戶搜尋計數讀取失敗 ⇒ 回 503(不是「一切正常」)',
        { reason: 'manual_customer_search_read_failed' },
      );
      await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
      return Response.json({ ok: false, enabled: true, ...result }, { status: 503 });
    }

    if (result.manualCustomerSearchUnknown) {
      console.warn(
        '[anomaly-alert] 🔵 客戶搜尋計數查不到 ⇒ 那支 RPC 還沒 apply, 或它讀取失敗(失敗那一種在 use-case 另有一行 error log)',
        { reason: 'manual_customer_search_unknown' },
      );
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔵 安靜日心跳(2026-09-03;Sean 拍甲)—— **位置就是它的正確性**
    // ════════════════════════════════════════════════════════════════════════
    //
    // 🔴🔴 **它為什麼一定要在【這裡】, 不能在 use-case 裡**(codex R1+R2 兩輪打出來的):
    //    這封信說的是「今天沒有需要你處理的事」, 而**那句話的前提是我們讀得到**。
    //    ⇒ 上面**每一個 503 分支**都是「我們讀不到 / 設定壞了」——
    //      在它們之前寄 ⇒ **收信人拿到綠燈, 而 route 隨後回 503** ⇒ 一封說謊的信。
    //    ⛔ 我第一版把它做在 use-case 裡, 並在那邊**自己抄一份「什麼時候會 503」的清單**來擋。
    //       🔴 R2 逐條打回:那份副本**抄不全也抄不準** ——
    //         `orderCreatedGapUnknown`/`shippedGapUnknown` 在 cutoff 有設時會 503 而沒擋;
    //         `orderCreatedStuckUnknown` 要兩顆設定都有才 503 而被無條件擋;
    //         `SHIPPED_EMAIL_CUTOFF` 格式錯也 503 而 **use-case 看不到那顆 env**。
    //    🎯 **⇒ 那是一份【代理】, 而代理與本尊會漂開。**
    //    ✅ **⇒ 放在這裡, 條件不必抄:能走到這一行, 就代表全部檢查都過了。**
    //
    // 🛑🛑 **不要把這一段往上搬** —— 往上一行都會讓某一種 503 先被綠燈蓋掉。
    //    守門:`route.test.ts` 那格「任一 503 條件成立 ⇒ 一封心跳都不寄」。
    //
    // 🔴 心跳寄不出去 ⇒ **503**(與告警信同一條紀律):一封心跳送不出去 = 告警管道壞了 = 該紅。
    //    ⚠️ 而它**不改 `result`** —— `result.errors` 是 use-case 那一輪的數,
    //    這裡另外回一個 `heartbeat` 欄位, 兩者不混。
    if (!result.alerted) {
      // 🔴 只列【自己不會讓 route 回 503】的那些讀不到項 —— 會 503 的那幾種根本走不到這一行。
      //    ⇒ 所以這個清單與上面那些 503 分支【互補】, 不重疊。
      const unreadable = result.manualCustomerSearchUnknown ? ['客戶搜尋計數'] : [];
      const heartbeat = buildAnomalyQuietHeartbeatMessage(new Date(), unreadable);
      const sent = await Promise.allSettled(deps.notifiers.map((n) => n.notify(heartbeat)));
      const heartbeatFailed = sent.filter((r) => r.status === 'rejected').length;
      if (heartbeatFailed > 0 || deps.notifiers.length === 0) {
        // 🔴 零 notifier 也算故障:那不是「今天沒事」, 是**沒有任何管道可以告訴你今天沒事**。
        console.error('[anomaly-alert] 🔴 安靜日心跳送不出去 ⇒ 告警管道不可用', {
          reason: 'quiet_heartbeat_undeliverable',
          notifiersTotal: deps.notifiers.length,
          heartbeatFailed,
        });
        await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
        return Response.json(
          { ok: false, enabled: true, ...result, heartbeatFailed },
          { status: 503 },
        );
      }
    }

    // 5. 認證過 + enabled + 無錯 → 200 + 計數摘要(零 PII counts)。
    await recordHeartbeatSuccess(CRON_JOB_NAME.anomalyAlert);
    return Response.json({ ok: true, enabled: true, ...result }, { status: 200 });
  } catch (err) {
    // deps/env 缺(factory requireEnv throw / enabled 但零管道)或非預期 throw(reader throw)→ 503 fail-closed(不偽 200)。
    // 🔴 固定 reason code(零 PII、零洩漏面;不把任意 err.message 入 log 縱深、杜絕連線字串/密鑰 drift 帶進 log)。
    // 🔴 errorName = 例外的【類別名】,不是 message(J-003 MF-1)。
    //    composition-alert-failclosed.test.ts 釘住「程式錯誤(TypeError)≠ 設定錯誤(Error),分得開」,
    //    而在【裸的 catch{} + 只記固定碼】之下,那個分辨在這裡就死了 ⇒ 那格守門沒有消費者。
    //    ⚠️ 這不是說固定碼寫錯 —— 固定碼是刻意的(不讓連線字串/密鑰漏進 log)。
    //       補的是【最小可辨識量】:設定漏填 ⇒ 'Error';有人把 code 改壞 ⇒ 'TypeError'。
    //    ⚠️ 它**不是**「例外的類別名」(codex R2 nit,我原本這樣寫而那與行為矛盾)——
    //       它是**白名單過濾後的值**:名單外的一律 `'other'`,自訂錯誤類別也會被壓成 `'other'`。
    //    🔴 射程:它只讓那個分辨【抵達 log】。**沒有人驗過這行 console.error 在 Vercel log 裡出得來**
    //       (J-003 MF-3,窗 G 自報)⇒ 「分得開」到此為止,不等於「有人會看到」。
    const errorName = safeErrorName(err);
    console.error('[anomaly-alert] 🔴 告警無法執行(deps/env 缺、零管道或 reader throw、回 503;不吞 200 偽裝成功)', {
      reason: 'deps_or_unexpected_throw',
      errorName,
    });
    await recordHeartbeatFailure(CRON_JOB_NAME.anomalyAlert);
    return new Response(null, { status: 503 });
  }
}
