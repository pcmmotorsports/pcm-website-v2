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
}
