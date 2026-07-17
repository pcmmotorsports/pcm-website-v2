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

type BackoffPolicy = 'quota_24h' | 'rate_limited_short' | 'exponential';

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
 * 算下次重試時間(= `markFailed` 的 `nextRetryAt`)。
 *
 * @param errorCode sender 回報的失敗碼(union 成員;runtime allowlist 由 adapter 把關)。
 * @param attempts 本次認領後的 attempts(`ClaimedEmailJob.attempts`,已含認領 +1、恆 ≥1)。
 *                 只有兜底列用它算指數;quota 列依 §⑨ **禁指數**、rate_limited 為固定短退避,皆不看 attempts。
 * @param failedAt 失敗時點(§⑨:quota 列 = 失敗時點 + 24h,非任何日曆邊界)。
 * @param random   jitter 亂數來源(測試注入)。
 */
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
    case 'exponential': {
      // attempts 恆 ≥1(認領時 +1);防禦性 clamp 擋非法輸入(0/負數/NaN → 當第 1 次)。
      const exponent = Number.isFinite(attempts) && attempts >= 1 ? Math.floor(attempts) - 1 : 0;
      delayMs = Math.min(EXPONENTIAL_CAP_MS, EXPONENTIAL_BASE_MS * 2 ** exponent);
      break;
    }
  }
  return new Date(failedAt.getTime() + delayMs);
}
