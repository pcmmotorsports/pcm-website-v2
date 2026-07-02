// lib/cron/rate-limit.ts — cron route 應用層簡易限流器(M-3 #254、#250 縱深 hardening)
//
// 威脅模型(backlog #254):cron route 認證 = CRON_SECRET Bearer 硬驗(正確),但 Vercel cron 平台只帶「單一」
// CRON_SECRET(settle-sweep 與 anomaly-alert 共用)。若 CRON_SECRET 洩漏 → 攻擊者可持有效 secret 高頻觸發:
//   - anomaly-alert:反覆推播 → 消耗 LINE/Resend quota + 告警轟炸 Sean(economic/abuse)。
//   - settle-sweep:反覆打 Record API(縱深:settleCharge 冪等 + 金額整數 → 不雙扣/不偽 paid,但仍放大查詢)。
// **非資料外洩、非可即利用破口**(LOW hardening)。此限流器把「持有效 secret 的 flood」的放大倍率壓下來、爭取
// 時間讓 Sean 輪替 secret;鏡像既有 route 常數範式(不採信外部輸入、參數揭示可調)。
//
// 🔴 誠實邊界(必讀、勿過度承諾):
//   1. **per-instance best-effort、非全域硬上限**。狀態在 module scope 記憶體 → 每個 serverless 實例各有一份計數。
//      Vercel Fluid Compute 會重用實例(冷啟少)→ 比傳統 one-request-per-instance serverless 有效得多,但攻擊者
//      跨多實例 / 冷啟仍可繞過部分額度;有效上限 ≈ MAX_HITS × 熱實例數,不是硬保證。時戳走 Date.now() wall clock,
//      系統時鐘倒退跳會令視窗短暫多擋、實例回收即自愈(best-effort 可接受、不另處理)。
//   2. **真全域硬上限需 DB-durable throttle**(比照 payment_charge_attempts.next_settle_at 的 durable 節流範式,
//      需 migration + db push)。對 LOW 的 cron 濫用 hardening 過重 → 本片刻意走記憶體版;若日後升 hourly(Vercel
//      Pro)或告警量上升需硬上限,升級為 DB throttle(可與 #255 去重狀態表併設計)。
//   3. **secret 洩漏的主要對策仍是輪替 CRON_SECRET**,本限流器是縱深、不是替代。
//   4. 🔴 **限流器自身引入的取捨**:限流 key = route 名、非 caller(合法 Vercel cron 與持洩漏 secret 的攻擊者帶
//      同一 secret、結構上不可區分)→ **活躍 flood 期間、同一熱實例的合法 cron 落在額滿視窗也會吃 429 = 告警壓制
//      窗**。非新破口(flood 前提=secret 已洩、無限流時攻擊者亦可打爆管道 quota 達成類似壓制),但屬本限流器帶來
//      的取捨:收口仍靠輪替 secret;偵測面 = Vercel cron failed-run 面板(429 刻意不 log、見 route)。
//
// 🔴 合法流量(常態、無 flood):Vercel cron 目前 daily(≤1/天),即使升 hourly 亦 1/小時 << 每窗 MAX_HITS;視窗常數
//    對合法 cron 極寬鬆、僅同窗高頻才觸發(容忍 Vercel 偶發 at-least-once 重觸發 + 人工重跑)。活躍 flood 下的例外
//    見上誠實邊界 4。
//
// @see docs/phase-1-backlog.md #254
// @see apps/storefront/src/app/api/cron/anomaly-alert/route.ts
// @see apps/storefront/src/app/api/cron/settle-sweep/route.ts

import 'server-only'; // 純伺服端 infra、禁誤打包到 client(本模組無密鑰/DB,server-only 為縱深衛生防線)

/**
 * 🔴 限流視窗 = 60 秒(營運參數、揭示可調、非 SLA;沿 route 常數「不採信外部輸入」範式)。
 * 合法 cron ≤1/小時 → 視窗內幾乎恆 0 筆歷史,永不誤擋;僅對同窗高頻 flood 生效。
 */
export const CRON_RATE_WINDOW_MS = 60_000;

/**
 * 🔴 每視窗允許次數 = 5(營運參數、揭示可調)。> 合法 cron 頻率(容忍 Vercel 偶發重觸發 + 人工重跑),
 * 同時把 per-instance flood 壓到 ≤5/分。調小=更嚴(誤擋人工重跑風險升)、調大=更鬆。
 */
export const CRON_RATE_MAX_HITS = 5;

/**
 * per-key 的近期允許時戳(sliding window)。key = route 名(anomaly-alert / settle-sweep)→ 兩 route 各自獨立
 * 額度,一條被 flood 不會餓死另一條。module scope = 同一實例內跨請求存活(見檔頭誠實邊界 1)。
 */
const buckets = new Map<string, number[]>();

/**
 * sliding-window 限流檢查。回 true=放行(並記錄本次)、false=超限(不記錄本次 = 被擋請求不延長鎖定視窗)。
 * 🔴 「不延長」≠「攻擊持續時仍保障合法 cron」:持有效 secret 的攻擊者若每個新視窗都搶先用掉前 MAX_HITS 次,
 *    合法 cron 仍可能長期吃 429(見檔頭誠實邊界 4);本函式不提供攻擊持續時的公平性保證、主對策為輪替 CRON_SECRET。
 *
 * @param key    路由識別(例 'anomaly-alert' / 'settle-sweep')
 * @param now    現在時戳毫秒(預設 Date.now();測試可注入固定時間驗視窗/老化)
 * @returns      true=未超限放行、false=超限應回 429
 */
export function checkCronRateLimit(key: string, now: number = Date.now()): boolean {
  const windowStart = now - CRON_RATE_WINDOW_MS;
  // 半開窗 (windowStart, now]:只留 t > windowStart 的允許時戳;剛好 = windowStart 的舊 hit 已過期(對「過期判定」
  // 從嚴 = 對「放行」從寬 1ms 級,對 best-effort 限流無實質影響)。
  const recent = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= CRON_RATE_MAX_HITS) {
    // 超限:寫回已剪枝清單(不 push 本次)→ 被擋請求不延長鎖定視窗(非「攻擊持續時保障合法 cron」、見函式 doc)。
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

/**
 * 清空限流狀態(測試隔離用;未帶 key=全清、帶 key=清單一路由)。生產碼不呼叫(module scope 狀態隨實例生命週期)。
 */
export function resetCronRateLimit(key?: string): void {
  if (key === undefined) {
    buckets.clear();
  } else {
    buckets.delete(key);
  }
}
