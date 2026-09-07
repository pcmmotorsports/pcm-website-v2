import type { EmailSendErrorCode } from '@pcm/ports';

/**
 * email-backoff:逐錯誤碼退避政策(M-4a Email 片 E2a-b;plan v3.3 §3.6 / migration §⑨)。
 *
 * 🔴 權威 = migration `20260717020000` 頭註 **§⑨**(退避三列;漂移以該檔為準)。
 * ⚠️ **兜底列(指數)數值不在 §⑨**:§⑨ :168 僅具名「(+ 兜底列)」、零數值 —— 數值出處 =
 * plan v3.3 `docs/specs/2026-07-16-m4a-email-notify-plan.md` §5 E2a-b 列(勿寫「§⑨ 字面」=
 * 引用不存在的權威;E2a-b 關卡2 must-fix、與 E1c 同病)。
 * 本模組是上述合約的唯一 TS 實作落點:E2a sweeper(`sweep-email-outbox`)與 E3 `after()` 立即
 * 路徑都必須經此計算 `next_retry_at`,不得各自內聯退避數字。
 *
 * 三列(§⑨ 字面)+ 兜底(plan §5):
 * - `quota_daily_exceeded` / `quota_monthly_exceeded` = **失敗時點 + ≥24h + jitter;禁指數退避**
 *   (Sean Q9=A;燒速上限每日 1 次 = `max_attempts=5` 配 +24h 天然成立,不另做機關)。
 *   官方未揭露重置邊界 → 滾動 +24h、不算「隔天午夜」(不依賴時區假設)。
 * - `http_429`(無法分辨的 429)= **一律比照 daily ≥24h**(Sean Q11=A;已知代價=瞬時限流也白等
 *   24h,拍板時已知悉;精準版 = backlog #285)。
 * - `rate_limited` = 保守短退避(§⑨「固定值由 E2a 定」→ 本片定 **15 分鐘 + jitter**,非 Sean 題;
 *   PCM 量級距官方限流門檻數個量級,此格幾乎不會命中)。
 * - 其餘(HTTP 4xx/5xx、network、provider)= **指數 5min × 2^(attempts-1)、上限 2h**(數值出處
 *   = plan §5 E2a-b 列、非 §⑨;無 jitter=照 plan 字面,PCM 量級無 thundering-herd 面)。
 *
 * jitter 一律**只加不減**([base, base+window)):quota 列的「≥24h」是合約字面,雙向 jitter 會
 * 讓下界破功。
 */

/** 毫秒常數(避免魔數散落;測試以同常數斷言)。 */
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** quota / 未知 429:+24h 起跳(§⑨:滾動 +24h、禁指數)。 */
const QUOTA_BASE_MS = DAY_MS;
/** quota 列 jitter 窗(0..30 分,只加不減 → 下界恆 ≥24h)。 */
const QUOTA_JITTER_MS = 30 * MINUTE_MS;
/**
 * ⟦b4-RESEND409⟧ Resend 的 idempotency key 保留窗 —— 官方逐字「within the last 24 hours」
 * (https://resend.com/docs/api-reference/errors, 2026-09-07 親讀)。
 * 🔵 抖動是為了不讓同一批信在窗過期那一秒一起打過去。
 * ⚠️ **這個值綁的是【供應商的窗】不是我們的策略** —— 官方改了它, 這裡要跟著改, 而**沒有東西會通知我們**。
 */
const IDEMPOTENCY_WINDOW_MS = DAY_MS;
const IDEMPOTENCY_JITTER_MS = 30 * MINUTE_MS;

/** rate_limited:15 分起跳(§⑨「固定值由 E2a 定」= 本片拍)。 */
const RATE_LIMITED_BASE_MS = 15 * MINUTE_MS;
/** rate_limited jitter 窗(0..5 分)。 */
const RATE_LIMITED_JITTER_MS = 5 * MINUTE_MS;

/** 兜底列:指數底 5 分。 */
const EXPONENTIAL_BASE_MS = 5 * MINUTE_MS;
/** 兜底列:上限 2 小時。 */
const EXPONENTIAL_CAP_MS = 2 * HOUR_MS;

/**
 * lease 回收後的統一重試延遲(migration §⑩:`nextRetryAt` 由 caller 算、與 markFailed 同慣例)。
 * 🔴 為何是**固定值而非逐列退避**:`reclaimStaleLeases(staleBefore, nextRetryAt)` 對整批回收列
 * 只收**單一** `nextRetryAt`(逐列 attempts 在回收述詞層拿不到)→ 物理上不可能逐列指數。
 * 取 5 分(=指數底)即可:毒信慢燒的節奏由 **lease 長度**(≥1h)主導 —— 毒信每輪要先被認領、
 * 卡滿一整個 lease 才會被回收,5 次 attempts 至少橫跨 ~5 個 lease 週期,遠慢於 crash-loop。
 */
export const LEASE_RECLAIM_RETRY_DELAY_MS = 5 * MINUTE_MS;

/** 亂數來源([0,1);測試注入定值,production 用 Math.random)。 */
export type EmailBackoffRandom = () => number;

type BackoffPolicy = 'quota_24h' | 'rate_limited_short' | 'exponential' | 'idempotency_24h';

/**
 * 🔴 窮舉映射(鏡像 E1c allowlist 慣例):`EmailSendErrorCode` 新增成員而漏配政策 → typecheck
 * 必紅,不會靜默落入任何預設。
 */
const POLICY_BY_CODE: Record<EmailSendErrorCode, BackoffPolicy> = {
  http_400: 'exponential',
  http_401: 'exponential',
  http_403: 'exponential',
  http_404: 'exponential',
  http_408: 'exponential',
  http_409: 'exponential',
  /**
   * 🔴 **它與 `http_409` 分家, 而那不是分類潔癖**:Resend 的 409 有三種
   * (官方 https://resend.com/docs/api-reference/errors, 2026-09-07 親讀), 前兩種重試會成功,
   * 而 `invalid_idempotent_request` **重試永遠不會成功** —— 官方逐字「Change your idempotency key or payload」。
   * ⇒ 指數退避對它只是**把死信的時間表算得比較慢**, 結果一樣。
   * 🛑 **而它不能借 `quota_24h`** —— `isQuotaExhaustionCode()` 由本表推導 ⇒ 借了會汙染額度告警。
   */
  idempotency_payload_mismatch: 'idempotency_24h',
  http_422: 'exponential',
  http_429: 'quota_24h',
  http_500: 'exponential',
  http_502: 'exponential',
  http_503: 'exponential',
  http_504: 'exponential',
  rate_limited: 'rate_limited_short',
  quota_daily_exceeded: 'quota_24h',
  quota_monthly_exceeded: 'quota_24h',
  network_error: 'exponential',
  provider_error: 'exponential',
};

/**
 * **這個碼代表「額度用盡」嗎** —— 分母**由 `POLICY_BY_CODE` 推導,不另抄一份**。
 *
 * 🔴 **為什麼不寫成 `code === 'quota_daily_exceeded' || code === 'quota_monthly_exceeded'`**
 * (2026-08-29 線D 第一版就是那樣寫的,code-reviewer F1/F2 換來的):
 * ① **漏了 `http_429`** —— `IEmailOutbox.ts` 的 `http_429` JSDoc 逐字寫「若實際不含 `name`
 *    → **所有 429 都落本格**」(兩個官方 SDK 對 429 的形狀不一致、標為未確認)
 *    ⇒ **在那個世界裡,日/月額度用盡回的就是 `http_429`** ⇒ 手寫的兩碼判斷會漏掉它,
 *    而漏掉的後果正是這個判斷要防的那件事(回 200、監控說一切正常)。
 * ② **手寫的分母不會跟著長** —— `POLICY_BY_CODE` 是 `Record<EmailSendErrorCode, …>`:
 *    provider 日後多一個 `quota_*` 碼而漏配政策 ⇒ **typecheck 必紅**。
 *    抄一份出去的話,退避那邊編不過、告警這邊**靜靜地算 0、三綠全綠**。
 * 📌 **兩把尺量同一件事時,讓後來的那把去問前面那把,不要各自維護一份名單。**
 *
 * ⚠️ **射程**:`rate_limited`(短暫節流、退避 `rate_limited_short`)**不算**額度用盡 ——
 * 它會自己好,而額度用盡不會。
 */
export function isQuotaExhaustionCode(errorCode: EmailSendErrorCode): boolean {
  return POLICY_BY_CODE[errorCode] === 'quota_24h';
}

/**
 * 算下次重試時間(= `markFailed` 的 `nextRetryAt`)。
 *
 * @param errorCode sender 回報的失敗碼(union 成員;runtime allowlist 由 adapter 把關)。
 * @param attempts 本次認領後的 attempts(`ClaimedEmailJob.attempts`,已含認領 +1、恆 ≥1)。
 *                 只有兜底列用它算指數;quota 列依 §⑨ **禁指數**、rate_limited 為固定短退避,皆不看 attempts。
 * @param failedAt 失敗時點(§⑨:quota 列 = 失敗時點 + 24h,非任何日曆邊界)。
 * @param random   jitter 亂數來源(測試注入)。
 */
/**
 * ⟦b4-EMAILTRIAGE⟧ 甲-7:**送信【之前】就失敗**的那些列(context 讀不到 / deps 缺 / 單號對不上)
 * 要放回 `failed` 時用的退避 —— 走 `exponential` 那一條。
 *
 * 🔴 **為什麼不能直接叫 `computeEmailBackoff`**:它的第一個參數是 `EmailSendErrorCode`,
 *    而甲-7 這一族的碼(`prepare_failed`)**刻意不是那個值域的成員** ——
 *    理由在 `SupabaseEmailOutboxAdapter.ts:131` 逐字寫著:走 `markFailed` 會被 allowlist
 *    改寫成 `provider_error`, **稽核碼被靜默吃掉**;而告警與統計都是按那個值域切的。
 * 🔵 **算式只有一份, 而它是【一個函式】不是一句約定** —— 兩邊都呼叫 `exponentialDelayMs`。
 *    (⛔ ~~第一版兩邊各寫一份、靠註解說「一起改」~~ —— codex 指出那不是機制。)
 * 🛑 **不沿用舊的 `next_retry_at`**:被放回去的列若帶著**已經過期**的重試時間, 下一輪會立刻
 *    再被撈到、把 claim 名額佔滿 ⇒ 後面的取消信 / 出貨信永遠排不進來
 *    (codex `gpt-6-astra` 2026-09-07 在送出層 cutoff 那片打出來的同一個病)。
 */
export function computePrepareFailureBackoff(attempts: number, failedAt: Date): Date {
  return new Date(failedAt.getTime() + exponentialDelayMs(attempts));
}

/**
 * 指數退避的延遲毫秒數 —— **兩個呼叫端共用這一份**:
 * `computeEmailBackoff` 的 `exponential` 分支, 與 `computePrepareFailureBackoff`。
 * ⛔ ~~原本兩邊各寫一份算式, 而我在註解裡寫「算式只有一份」~~ ——
 *    codex `gpt-6-astra` 2026-09-07 指出**那句不成立**:共用常數只能同步數值,
 *    擋不住日後有人只改其中一份的算法。
 * ⇒ 📌 **把「請兩邊一起改」這種靠人的約定, 換成一個函式。**
 * 🔵 `attempts` 恆 ≥1(認領時 +1);防禦性 clamp 擋非法輸入(0/負數/NaN → 當第 1 次)。
 */
function exponentialDelayMs(attempts: number): number {
  const exponent = Number.isFinite(attempts) && attempts >= 1 ? Math.floor(attempts) - 1 : 0;
  return Math.min(EXPONENTIAL_CAP_MS, EXPONENTIAL_BASE_MS * 2 ** exponent);
}

export function computeEmailBackoff(
  errorCode: EmailSendErrorCode,
  attempts: number,
  failedAt: Date,
  random: EmailBackoffRandom = Math.random,
): Date {
  const policy = POLICY_BY_CODE[errorCode];
  let delayMs: number;
  switch (policy) {
    case 'quota_24h':
      delayMs = QUOTA_BASE_MS + Math.floor(random() * QUOTA_JITTER_MS);
      break;
    case 'rate_limited_short':
      delayMs = RATE_LIMITED_BASE_MS + Math.floor(random() * RATE_LIMITED_JITTER_MS);
      break;
    /**
     * 🔴 **等 Resend 那把 idempotency key 的 24 小時窗過期。**
     * 窗過了之後, **同一個 body 就寄得出去** —— 這一格要的不是「更久的退避」, 是**跨過那個窗**。
     * 🔵 時間長度與 `quota_24h` 相同而**刻意是兩個 case** —— 它們同值是巧合不是關聯:
     *    📌 **把兩件事寫成同一個 case, 下一次調整其中一個就會安靜地動到另一個。**
     */
    case 'idempotency_24h':
      delayMs = IDEMPOTENCY_WINDOW_MS + Math.floor(random() * IDEMPOTENCY_JITTER_MS);
      break;
    case 'exponential':
      // 🔵 與 `computePrepareFailureBackoff` **呼叫同一支**(理由見 `exponentialDelayMs` 的註解)。
      delayMs = exponentialDelayMs(attempts);
      break;
  }
  return new Date(failedAt.getTime() + delayMs);
}
