// app/api/cron/anomaly-alert/route.ts — 雙扣 anomaly 主動告警 cron route(M-3 #250)
//
// Vercel cron(vercel.json crons)週期觸發 → 跑 checkAnomalyAlerts(use-case):讀 anomaly + 死卡列計數 **與訂單單號** →
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
//       (codex R2 `:25` A/C 指出;而舊句**沒有錯,它只是過期了** —— 那是兩件事)。
//       📌 本檔另有兩處**既有的** `~~`(`:17` / `:19`),緊接「作廢」二字、**做事的是那兩個字不是符號**
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
//               LineAlertNotifierAdapter.ts:58-60 / EmailAlertNotifierAdapter.ts:50-52 皆 `if (!res.ok) throw`
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
//    ⚠️ 仍未查:env 的【原始值】(含收件對象 LINE_ALERT_TO / ALERT_EMAIL_TO,取值處
//       @/lib/payment/composition.ts:223 與 :234)與【它何時被設成這樣】。
//    📎 同族正本在 `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` 檔頭那一段
//       (那段講的是 `CRON_SWEEPER_ENABLED`;本檔的閘是 `ANOMALY_ALERT_ENABLED`,**是兩個不同的 env**)。
// ⚠️ [2026-07 前為真;兩個前置今日皆已不成立,逐格說明如下]
//    誠實中間態:route commit 到 dev 即可,但 prod 不推播直到 ① vercel.json crons 段 ② Sean 設 env
//    【兩個前置今日皆已不成立,逐格說明】:
//    ① **過期** —— 排程已搬 Supabase pg_cron(commit `a5d76192`,2026-07-24);vercel.json 與
//       apps/admin/vercel.json **皆無 crons 段**(不是漏掉)。job 定義在
//       supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql:131
//       cron.schedule('pcm-anomaly-alert', '0 1 * * *') = UTC 01:00 = 台北 09:00。
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
import { checkAnomalyAlerts, type CheckAnomalyAlertsDeps } from '@pcm/use-cases';
import { getAnomalyAlertDeps } from '@/lib/payment/composition';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';

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
    const result = await checkAnomalyAlerts(deps, {
      refundingStuckSeconds: ALERT_REFUNDING_STUCK_SECONDS,
      pendingDoubleChargeWindowSeconds: ALERT_PENDING_DC_WINDOW_SECONDS,
      pendingDoubleChargeStuckSeconds: ALERT_PENDING_DC_STUCK_SECONDS,
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
