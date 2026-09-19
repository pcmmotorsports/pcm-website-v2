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

/** 兜底列:指數底 5 分。🔴 取捨方向 = **偏慢**(寧可晚寄, 不要把一封毒信打成一串重試風暴)。 */
const EXPONENTIAL_BASE_MS = 5 * MINUTE_MS;
/** 兜底列:上限 2 小時。🔴 同一個方向的另一半 —— 封頂讓【長故障】不會退到天邊而看起來像沒事。 */
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
 *
 * ══ 🔴 第二個取捨:**死信門檻**(⟦mail-BACKOFFDIESSOONER⟧, 2026-09-20 補)══════════
 * 🛑 **這一段講的【不是】 `:51` / `:54` 那個取捨** —— 兩個軸同一組常數, 不要讀成同一件事:
 *   · `EXPONENTIAL_BASE_MS`(`:51`「取捨方向 = 偏慢」)與 `EXPONENTIAL_CAP_MS`(`:54`「封頂」)
 *     管的是 **每一次重試的節奏** —— 偏慢, 為的是不要把一封毒信打成一串重試風暴。
 *   · 🔴 **而本段管的是【一封信什麼時候算死透】** —— 那是**另一個軸**, 而它的方向【沒有人寫過】。
 *
 * 🔬 **數字, 而【時點要講清楚是哪一個】**(2026-09-20 訂正 —— 原本寫「約 5 小時」, 見下方 🔴):
 *   · **新版**:本函式產出 5 / 10 / 20 / 40 分(這是 `max_attempts` 預設 5 之下**實際會等到的**那幾格;
 *     函式本身 attempts=5 會算出 80 分、≥6 才被 2h 封頂夾住 —— 只是那一列已死, 等不到)
 *     ⇒ 第 5 次失敗累計約在**第 75 分鐘**。
 *     🔴 **而新版這兩個時點是【同一刻】**:失敗當下 `markFailed` 就寫 `status='failed'` 且 `attempts=5`,
 *     而死信判準是 `status IN ('pending','failed') AND attempts >= max_attempts`
 *     ⇒ **attempts 用完 ≡ 進死信 ≡ 第 75 分鐘。**
 *     🛑 **而那【不是無條件的】**(2026-09-20 審查補):若第 5 次認領之後 sweep 自己掛掉 / 逾時
 *     ⇒ 走不到 `markFailed`、也走不到 `releaseClaimAfterPrepareFailure`
 *     ⇒ 那一列留在 `sending` 且 `attempts=5` ⇒ **不符死信述詞**(要 `status IN ('pending','failed')`)
 *     ⇒ **仍然要等一輪租約回收**。📌 **⇒ 所以「同一刻」在【sweep 自己出事的那一天】是假的 ——
 *     而那正好是它最該成立的那一天。**
 *   · **舊版**(失敗留在 `sending` 等 lease 回收)⇒ 🔴 **兩個時點【差一整輪回收】**:
 *     **attempts 用完 ≈ 4h20m**(算法:每回來一次 = 租約 3600s + 退避 5 分 = 1h05m, 而要等 4 次 ⇒ 4 × 1h05m);
 *     **而進死信要再等最後一次回收 ≈ 5h20m。**
 *   · 🎯 **⇒ 本段比的是【進死信】** ⇒ **75 分鐘 vs 約 5h20m。**
 *   · 📌 **而那個不對稱本身就是這個取捨的一部分**:新版失敗即死信, 舊版死之前還多一輪可以被撿回去。
 *   · ⚠️ **兩個數的誤差來源(審查補, 不影響結論)**:75 分與 1h05m **都含 cron 量化** ——
 *     `pcm-email-sweep` 是**五分鐘一輪**的排程(`cron-jobs.ts:90`)⇒ 誤差 ≤5 分, 而且**只會晚不會早**。
 *     🛑 **這裡刻意【不寫那個 cron 字面】** —— 它含 `*` 接 `/`, 而那兩個字元會【就地結束這個註解區塊】。
 *     📌 2026-09-20 實際踩到:我寫了它, 而**抓到的是那發機械證明**(剝註解後 2,563 變 3,956), 不是我。
 *   · ⚠️ **「舊版」的射程比字面窄**(改前就有, 本次沒有放大):這裡的「舊版」指的是
 *     **失敗留在 `sending` 等回收**那一族的舊行為;而 **sender 真的送信失敗那條路一直是走 `markFailed`**。
 * 🛑 **⛔ ~~原本這裡寫「舊版約第 5 小時」~~** —— 那**不算錯, 而是【模糊】**:它在 4h20m 與 5h20m 之間
 *    分不出是哪一個, 而那正是 `sweep-email-outbox.ts` 裡**那段以逐字
 *    「**而【三個時點要分開,不要合成一句】**」開頭的推導**明文警告過的病
 *    (撰寫時在 `:2563-2576`, 而**行號會漂 —— 請用上面那句話找它**;理由見該檔同一段旁的註記)
 *    (逐字「**而【三個時點要分開, 不要合成一句】**」, codex 2026-09-01 must-fix)。
 *    🔴 **⇒ 修法不是把它換成 4h20m** —— 那會讓這一邊站【attempts 用完】而另一邊(75 分)站【進死信】,
 *    **等於把那段警告在警告的病重新裝回去。** ⇒ 所以兩個時點都寫, 並點名在比哪一個。
 *    🔵 同一組數字 codex `gpt-6-astra` 2026-09-07 也寫過(`sweep-email-outbox.ts` 的 docstring
 *    逐字「新版(退避 0 / 5 / 15 / 35 / 75 分)」)—— 🛑 **而那【不是獨立來源】**:被引的就是同一次產出的同一份文字。
 *
 * 🎯 **⇒ 取捨方向(本段就是把它寫下來的那一句)**:
 *    **我們選擇【短故障恢復得快】, 而接受【長故障更早永久停寄】。**
 *    · 短故障(幾分鐘)⇒ 新版 5 分就重試, 舊版要等 1 小時 ⇒ **新版明顯好**
 *    · 🔴 長故障(例如 context 壞 90 分鐘)⇒ **新版可能已經永久停寄, 而舊版還有機會**
 *
 * 🛑 **而 2 小時封頂(`EXPONENTIAL_CAP_MS`, 常數在 `:54`、那句「封頂」的字面在 `:53`)在這裡【咬不到】**
 *    —— **實際會等到的**最大單次延遲是 40 分 < 2 小時
 *    ⇒ 📌 **所以「偏慢 + 封頂」那句話, 解釋不了門檻為什麼掉到 75 分。那正是兩個軸的分界。**
 *
 * ✅ **而這個取捨有出口, 所以它是取捨不是缺陷**:死信救得回 ——
 *    `admin_requeue_dead_email` 收 `attempts >= max_attempts` 的列並把 `attempts` 歸零。
 *    ⚠️ 而那條救援路自己的已知缺陷在板列 ⟦mail-REQUEUERESETSGEN⟧(它歸零的那個欄同時是世代柵欄)。
 * ⚠️ **未量**:真實故障的長度分布 —— 「長故障多常見」今天沒有人知道,
 *    而**那不影響上面這個方向**:寫下取捨方向不需要先知道發生率。
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
