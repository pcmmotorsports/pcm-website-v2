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
// ⛔ 2026-08-17:下面那句「**prod 不跑**」**現在是假的** —— Sean 已於 Vercel Production env 設
//    `CRON_SWEEPER_ENABLED='true'` 並重新部署(來源:主視窗轉述 Sean;我未親自看 Vercel 設定畫面)。
//    🔴 原文刻意保留 —— 它記錄的是當時的中間態,那個記錄沒有錯;錯的是【拿它當現況】。
//    正本(為什麼曾經這樣定 / 何時解除 / 現在靠什麼守 / 🔴 **仍未完成的兩條硬前置**)在
//    `docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md` 檔頭那一段。
//    📎 這一處是同族舊字面掃描**漏掉**的載體:它的措辭是「prod 不跑」,而當時掃的四個 pattern
//       都是「不設 / 不開 / 不開放」⇒ 一個都對不上(code-reviewer 2026-08-17 抓)。
//       教訓:**pattern 的寬度決定了「零命中」的意義**,而寫宣稱的人只記得自己掃過。
// ⚠️ 誠實中間態(master §2 / plan §5.4):4c route commit 到 dev 即可,但 **prod 不跑** 直到 ① 4d(vercel.json
//    crons 段)② Sean 於 Vercel Production env 設 CRON_SWEEPER_ENABLED='true' ③ 4a migration 進 prod;route 預設
//    disabled + fail-closed → commit 4c **零部署風險**(Phase I 結帳關閉、零 pending、即使誤啟亦 no-op)。
//
// @see docs/specs/2026-06-15-m3-3ds-4-sweeper-cron-plan.md §5.3
// @see docs/specs/2026-06-13-m3-3ds-webhook-master-plan.md §2/§9
// @see packages/use-cases/src/sweep-settlements.ts(3DS-4b-2 use-case)

import { timingSafeEqual } from 'node:crypto';
import {
  reconfirmExpiredOrphans,
  sweepSettlements,
  type ReconfirmExpiredOrphansResult,
  type SweepSettlementsDeps,
} from '@pcm/use-cases';
// 🔴 不變式(N2、審查側 4c sign-off):getSettleChargeDeps / getWebhookInbox factory **必須維持 lazy**——
//    建構子只存連線字串、零 module-top env 讀取 / 零連線池建立(連線延遲到首次呼叫)。下方 GET 的 disabled
//    路徑(CRON_SWEEPER_ENABLED gate 在「建 deps 前」return)之「零 DB env 依賴」保證仰賴此跨包不變式;
//    若未來把 env 讀取 / pool 建立搬到 module-top(import 時求值),僅 import 本 route 即需 DB env →
//    disabled 200 no-op 靜默回歸要 DB env。改 @/lib/payment/composition 前必守此 lazy 契約。
import { getSettleChargeDeps, getWebhookInbox } from '@/lib/payment/composition';
import { checkCronRateLimit } from '@/lib/cron/rate-limit';

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
 * - inbox/stuck 各每輪上限 50(Record 節流、超出留下輪)。🔴 預算(N3、審查側字面精化):concurrency=1
 *   順序處理 → 單輪最壞 = (inbox 50 + stuck 50) × ~500ms ≈ 50s < maxDuration 60s(真餘量 ~10s)。per-source
 *   各 50×~500ms=25s 為半段(對齊 plan §5.1b L60 framing);total 100 筆 ≈ 50s 對齊 plan §5.2 L93。
 * - stuckAgeSeconds=600(10 分;避 racing 即時 callback/webhook、對齊 s2d user_in_flight 10 分閘)。
 * - concurrency=1(嚴格順序;群7 連線預算、避 N×per-request pg Client 撞 session pooler ceiling)。常數即「有限
 *   正整數」(不接受外部輸入 = 最強形式的驗證;use-case 端另有 Number.isFinite guard 縱深、4b-2 N4)。
 */
const INBOX_LIMIT = 50;
const STUCK_LIMIT = 50;
const STUCK_AGE_SECONDS = 600;
const SWEEP_CONCURRENCY = 1;

/**
 * 🔴 M-4a 人工待確認佇列的重查(B1b、`reconfirmExpiredOrphans`)—— **本輪加掛在既有 sweeper 之後**。
 *
 * 為什麼掛這裡而不是新蓋一條:B1a(`claim_expired_pending_attempts`)**本來就**不濾 `needs_manual_review`、
 * 繞 ceiling、有自己的 6h throttle(`supabase/migrations/20260627120000_…`:**SQL 在 `:94`**
 * `a.last_expired_settle_at < now() - interval '6 hours'`;設計說明在 `:22` / `:30-32`,COMMENT 在 `:69`),
 * 而 `ReconfirmExpiredOrphansDeps` **就是** `SettleChargeDeps`(`packages/use-cases/src/reconfirm-expired-orphans.ts:37`)
 * ⇒ 本 route 既有的 `getSettleChargeDeps()` 直接餵得動,零新欄、零新 RPC、零新認領路徑。
 *
 * 🔴🔴 **射程限定(讀這段 code 的人要當場知道,不要去翻 plan)**:
 *   B1a 的年齡閘是**硬寫的 12 小時** —— **SQL 在同檔 `:92`**
 *   (`a.created_at < pg_catalog.now() - interval '12 hours'`;`:13` 是根因散文、不是那行 SQL),
 *   而它的簽章只吃 `p_limit` ⇒ **調不了**。
 *   而一列大約 **1 小時**就會進人工佇列(8 次退避、封頂 16min)。
 *   ⇒ **未滿 12 小時的列,這條路一列都不收。**
 *   ⇒ 這條路不是「按了立刻查」,是「**12 小時後才收得到**」。等多久算可接受 = 產品決定(plan §16 標待裁)。
 *
 * 🔴 limit=5 是**保守值,不是量出來的**:既有註解自陳單輪最壞 ≈50s / `maxDuration` 60s ⇒ 真餘量 ~10s。
 *   5 × ~500ms ≈ 2.5s。**而真正防止吃穿的不是這個數字,是下面的剩餘預算閘** —— 見 `RECONFIRM_MIN_BUDGET_MS`。
 *   佇列列數天生少(它們是卡住的例外)+ B1a 有 6h throttle ⇒ 每輪 5 筆足夠;不夠再調,forward-only。
 */
const RECONFIRM_LIMIT = 5;

/**
 * 🔴 剩餘預算閘:主 sweep 跑完之後,**只有在還剩得下**才跑重查。
 *
 * 為什麼要這道而不是只靠 `RECONFIRM_LIMIT`:主 sweep 的耗時是**變動的**(取決於本輪有幾筆、
 * Record API 多慢),而「單輪最壞 ≈50s」是**既有註解的估、我沒有在正式站量過**。
 * ⇒ 與其猜一個安全的 limit,不如**讓它不需要猜**:跑之前看時鐘,不夠就跳過並誠實回報。
 * ⇒ 跳過的代價 = 那幾筆留到下一輪(B1a throttle 本來就是 6h 級,不差這一輪);
 *   而**吃穿的代價 = 整輪 timeout ⇒ 主 sweep 也一起沒跑完**,兩者不對稱。
 */
const RECONFIRM_MIN_BUDGET_MS = 12_000;

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
  // 🔴 **時鐘要在最前面起**(fable 關卡2 nit):認證 / 限流 / flag 閘也吃時間,
  //    起太晚 ⇒ 剩餘預算被**系統性高估**。仍不含冷啟與 module init —— **那兩段量不到**,
  //    所以 RECONFIRM_MIN_BUDGET_MS 的餘裕本來就要吸得掉它們(而那個門檻是**我定的、沒有量測依據**)。
  const startedAt = Date.now();
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
  //     cron;真正威脅 = CRON_SECRET 洩漏後持有效 secret 高頻觸發放大 Record API 查詢。超限 → 429,在建 deps /
  //     掃描「前」擋掉。🔴 per-instance best-effort、非全域硬上限(見 lib/cron/rate-limit.ts 誠實邊界);secret 洩漏
  //     的主對策仍是輪替 CRON_SECRET。不 log(避免每筆被擋請求放大成 log 量 = 二次濫用面)。
  if (!checkCronRateLimit('settle-sweep')) {
    return new Response(null, { status: 429 });
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

    // 3b. 🔴 M-4a 人工待確認佇列的重查(B1b)—— 主 sweep 之後、**只有在預算還剩得下才跑**。
    //     · deps 直接沿用上面那份(ReconfirmExpiredOrphansDeps === SettleChargeDeps)⇒ 不重建、不多開連線。
    //     · 🔴 跳過時**誠實回報 reconfirm.skipped**,不靜默 —— 靜默的跳過與「本來就沒東西」在回應上分不出來。
    //     · 射程限定見 RECONFIRM_LIMIT 的註解:**未滿 12 小時的列這條路一列都不收。**
    //
    //     🔴🔴 **三道閘,而它們擋的是【不同的】東西**(fable 關卡2 must-fix:前一版只有第一道):
    //       ① sweep 有錯 ⇒ 不跑(`sweep_errors`)。不健康的一輪不該對人工列蓋 6h throttle ——
    //          蓋了就是把那幾筆推遲 6 小時,而這一輪本來就不可信。
    //       ② 起跑前預算不足 ⇒ 不跑(`budget`)。
    //       ③ 🔴 **跑起來之後自己吃穿 ⇒ 硬砍**(`timeout`)。
    //          **為什麼 ② 擋不住 ③**:settleCharge 的 Record 呼叫**沒有傳 signal/timeout**
    //          (`TapPayChargeAdapter.recordQuery` 支援 `options.signal`,而 settleCharge 路徑不傳)
    //          ⇒ Record API 掛住不回時,5 筆順序 hang 可以吃掉整個 60s ⇒ **函式被平台砍、
    //          連 sweep 的 counts 都一起消失、無 503、無 log**。而 ② 只在【起跑前】看時鐘,對這個世界零判別力。
    //          ⇒ `Promise.race` 上界到期 ⇒ 回 `skipped:'timeout'`,**讓 sweep 的 counts 照常送出去**。
    //          ⚠️ 被砍的那幾筆 throttle 已經蓋了(6h) —— 冪等、6h 後自癒,**不是錢的 bug**,而要寫下來。
    //          🔴🔴 **而 ③ 只蓋 reconfirm 這半邊**(GR R2 N3):**sweep 自己的 Record 呼叫同樣不帶 signal**
    //          ⇒ **sweep hang 住仍然會滅掉整輪**(連 ③ 都跑不到)。那是本片【沒有解】的舊病。
    //          ⇒ 不要把 ③ 讀成「hang 的問題解決了」—— 它只保證**新加的這半不會是兇手**。
    //
    //     ⚠️ **已知浪費(不修,寫下來)**:B1a 不濾 manual/ceiling ⇒ 主 sweep 這輪剛 settleRetry 過的
    //       >12h pending 列,幾秒後可能被本段再 claim、再打一次 Record。冪等、每列每 6h 至多一次
    //       ⇒ 純浪費額度而非正確性問題;佇列小,可接受。要修得在 use-case 層排除,超出本片範圍。
    // 🔴 `skipped` 用**字面聯集**不是 `string`(GR R2 Q2):四個值由構造保證互斥窮盡,
    //    而型別要跟著說 —— 打錯字或新增第五種原因,TS 當場紅。
    //
    // 🔴🔴 **timeout 那格【不帶計數】,而那是刻意的**(GR R2 N1):
    //    `Promise.race` 的輸家**沒有被取消、也取消不了**(settleCharge 不傳 signal)
    //    ⇒ timeout 之後它還在跑:**claim 已經發生、throttle 已經蓋了、settle 可能事後才完成。**
    //    ⇒ 這時候送 `claimed: 0` 是**一句關於世界的假話**(監控端跨輪加總會低估)。
    //    ⇒ 所以 timeout 回的是「**沒有計數**」不是「計數為零」——
    //      **不知道**與**零**在下游是兩件事,而它們長得一樣。
    type ReconfirmReport =
      | { skipped: 'timeout' }
      | (ReconfirmExpiredOrphansResult & { skipped: null | 'sweep_errors' | 'budget' });
    const NO_ACTIVITY: ReconfirmExpiredOrphansResult = {
      claimed: 0,
      settled: 0,
      noAttempt: 0,
      pending: 0,
      errors: 0,
    };
    const budgetLeftMs = maxDuration * 1000 - (Date.now() - startedAt);
    let reconfirm: ReconfirmReport;
    if (result.errors > 0) {
      reconfirm = { skipped: 'sweep_errors', ...NO_ACTIVITY };
    } else if (budgetLeftMs < RECONFIRM_MIN_BUDGET_MS) {
      reconfirm = { skipped: 'budget', ...NO_ACTIVITY };
    } else {
      // 🔴 硬上界:留 RECONFIRM_MIN_BUDGET_MS 給收尾(回應序列化 + log),其餘給 reconfirm。
      let timer: ReturnType<typeof setTimeout> | undefined;
      const capMs = budgetLeftMs - RECONFIRM_MIN_BUDGET_MS;
      const raced = await Promise.race([
        reconfirmExpiredOrphans(deps, { limit: RECONFIRM_LIMIT, concurrency: SWEEP_CONCURRENCY }),
        new Promise<'timeout'>((r) => {
          timer = setTimeout(() => r('timeout'), capMs);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
      reconfirm = raced === 'timeout' ? { skipped: 'timeout' } : { skipped: null, ...raced };
    }

    // 4. 🔴 本輪有錯 → 503 + 結構化 counts log,**不偽 200**(plan §5.3「RPC missing / DB error 必 5xx」)。
    //    result.errors>0 = DB/RPC 層 throw(claim/mark/guard RPC 失敗)**或** 非預期 per-item throw;對 plan §5.3
    //    「RPC missing / DB error」涵蓋且更寬(主來源為 DB/RPC 失敗,因 settleCharge 本身 fail-closed→pending 不 throw、
    //    normal pending→markRetry 計 inboxRetried 非 errors → 不誤 503)。任一情況行為皆安全且回 503。use-case 已逐筆
    //    fail-closed 續跑 + durable needs_manual_review;HTTP 層誠實標本輪非全綠(cron 標失敗可見、下輪 lease/退避/冪等
    //    重來)。counts only 零 PII。
    // 🔴 **回應體只加鍵、不改既有鍵**:reconfirm 的計數**巢狀**在 `reconfirm` 底下,不展開 ——
    //    ~~它與 sweep 的 result 有同名鍵(errors / pending)~~ 🔴 **真正相撞的只有 `errors`**
    //    (fable 關卡2:`SweepSettlementsResult` 逐欄核過**沒有 `pending` 鍵**,
    //     `packages/use-cases/src/sweep-settlements.ts:55-77`;而測試裡 `expect(body.pending).toBeUndefined()`
    //     正是那個證據)。**巢狀這個決定不變,而理由要寫對。**
    //    展開會**靜默覆蓋既有鍵**,
    //    而既有消費者讀到的 errors 會變成別人的數字。
    const reconfirmErrors = 'errors' in reconfirm ? reconfirm.errors : 0;
    if (result.errors > 0 || reconfirmErrors > 0) {
      // 🔴 **指名是哪一側壞的**(fable 關卡2):body 頂層 `errors` 是 sweep 的,
      //    reconfirm 壞掉時頂層仍是 0 ⇒ **人眼查 503 會先看錯地方**。log 先講清楚。
      const failedSide =
        result.errors > 0 && reconfirmErrors > 0 ? 'both' : result.errors > 0 ? 'sweep' : 'reconfirm';
      console.error('[settle-sweep] 🔴 本輪有錯(回 503;不吞成 200 偽裝成功)', {
        failedSide,
        ...result,
        reconfirm,
      });
      return Response.json({ ok: false, enabled: true, ...result, reconfirm }, { status: 503 });
    }

    // 5. 認證過 + enabled + 無錯 → 200 + 計數摘要(零 PII counts)。
    return Response.json({ ok: true, enabled: true, ...result, reconfirm }, { status: 200 });
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
