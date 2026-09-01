/**
 * IAnomalyAlertReader:雙扣 anomaly 告警聚合讀 port(M-3 #250)。
 *
 * 🔴 **server-only payment_confirmer 受控窗**:實作(`PgAnomalyAlertReaderAdapter`)走 payment_confirmer
 * 窄權連線呼 owner-defined SECDEF 聚合 RPC `get_payment_anomaly_alert_summary(p_refunding_stuck_seconds,
 * p_pending_dc_window_seconds, p_pending_dc_stuck_seconds)`(SECDEF、`search_path=''`;#250 六計數 + #256 第 7
 * 計數 pending 雙扣候選)。payment_confirmer 對 anomaly 兩表 / attempts / orders 零表權 → 只能經此 SECDEF
 * 受控窗讀 **零 PII 計數**(不下放任何 amount/user/order/rec)。
 *
 * 回傳 / 例外:成功 → `AnomalyAlertSummary`(計數);**transport / 回應形狀不符 → throw**
 * (use-case 不吞、上拋至 cron route → 503 fail-closed,壞掉的告警必須可見)。
 */
import type { AnomalyAlertSummary } from '@pcm/domain';

export interface IAnomalyAlertReader {
  /**
   * 讀雙扣 anomaly + 死卡列 + pending 雙扣候選零 PII 計數摘要。
   * @param refundingStuckSeconds refunding 卡住門檻秒數(route 常數注入、營運參數非 SLA)。
   * @param pendingDcWindowSeconds #256 pending 雙扣候選:兩 paid 單 paid_at 差窗秒數(route 常數、預設 12h)。
   * @param pendingDcStuckSeconds #256 卡住指紋門檻秒數(charged attempt updated_at-created_at 逾此才算卡住;route 常數、預設 10min)。
   */
  getAlertSummary(
    refundingStuckSeconds: number,
    pendingDcWindowSeconds: number,
    pendingDcStuckSeconds: number,
    /**
     * 🔵 出貨信起始線(ISO 8601 UTC;對應 env `SHIPPED_EMAIL_CUTOFF`;2026-08-31 Sean `2 甲`)。
     * 🛑 **`null` = 那一段整段不查** —— 而那不是失敗, 是「還沒上膛」;
     *   實作要落 `shippedGapUnknown`, **不得寫成 0**。
     */
    shippedCutoffIso: string | null,
    /** 🔵 出貨信寬限秒數(Sean `2 甲` = 15 分鐘 = 3 次掃描;呼叫端常數注入、無 DEFAULT)。 */
    shippedGraceSeconds: number,
    /**
     * 🔵 訊號 4 的起始線(ISO 8601 UTC;env `B4_DEPLOY_CUTOFF`,**與寄信端同一顆**)。
     * 🛑 `null` = 那一段整段不查(還沒上膛 / 值不合法)⇒ 落 `orderCreatedGapUnknown`。
     * 🔴 **它與 `shippedCutoffIso` 是兩顆不同的 env** —— 那兩條線分別上線,起始線不是同一刻。
     */
    orderCreatedCutoffIso: string | null,
  ): Promise<AnomalyAlertSummary>;

  /**
   * ⟦b9-ENUMWATCH⟧ 片 2:近 `windowSeconds` 秒的**客戶搜尋稽核計數**(零識別字元)。
   *
   * 🔴 **為什麼是【第二支方法】而不是把鍵加進 `getAlertSummary`**:
   *    那支的定義散在四支 migration,而 `20260819130000:208` 逐字寫著
   *    「本函式**不動** summary RPC 一個字 —— 那支有四代定義分散在四支 migration,
   *      **重貼整支會安靜倒退兩代**」。repo 已經為同一個問題決定過兩次(另一次 `20260824040000:9`)。
   *
   * 🛑 **回 `null` = 【查不到】,不是【零筆】** —— 呼叫端必須把它落成
   *    `manualCustomerSearchUnknown`,**不得寫成 0**。
   *    那兩者在畫面上會印同一個數字,而它們是相反的意思。
   *
   * 🔴🔴 **`null` 的唯一合法來源是「那支 RPC 還沒被 apply」**(部署窗口)——
   *    片 2 的碼會比 migration 早上線,而**那是刻意的**:
   *    若 adapter 直接呼叫一支不存在的函式 ⇒ 每輪 cron 炸 ⇒ route 503
   *    ⇒ **整個異常告警停擺** ⇒ 那會是「為了加一個觀測而弄壞了主要功能」,比不加還糟。
   *
   * ⚠️ **而【函式存在但它的函式體壞掉】不得走 `null`,要原封上拋** ——
   *    理由與量測見實作端(`PgAnomalyAlertReaderAdapter`)。
   */
  getManualCustomerSearchSummary(windowSeconds: number): Promise<{
    readonly count: number;
    readonly actors: number;
    /**
     * 🔴🔴 **實作【回傳它真的用了的那個窗口】—— 而這是 R3 must-fix 2。**
     *
     * ⛔ 我原本讓呼叫端在組訊息時自己把 `windowSeconds` 併進物件, 而我的理由逐字是
     *    「那個窗口是【這份量測的一部分】⇒ 它跟著資料走, 就不會失配」。
     * 🛑 **而那句話是假的, 而它正是這一輪被指定去找的那個【大家都同意的前提】**:
     *    **把相關欄位放進同一個物件, 不等於它們來自同一次量測** —— TypeScript 只驗形狀, 不驗來源。
     *    ⇒ 呼叫端可以把 24 小時的計數配上 `3600` ⇒ **型別過、測試過、信上說 1 小時。**
     * ✅ ⇒ 改由**實作**回傳它收到的那個值 ⇒ **那才真的是同一次量測。**
     */
    readonly windowSeconds: number;
  } | null>;
}
