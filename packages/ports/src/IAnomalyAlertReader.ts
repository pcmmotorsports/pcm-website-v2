/**
 * IAnomalyAlertReader:雙扣 anomaly 告警聚合讀 port(M-3 #250)。
 *
 * 🔴 **server-only payment_confirmer 受控窗**:實作(`PgAnomalyAlertReaderAdapter`)走 payment_confirmer
 * 窄權連線呼 owner-defined SECDEF 聚合 RPC `get_payment_anomaly_alert_summary(p_refunding_stuck_seconds)`
 * (SECDEF、`search_path=''`)。payment_confirmer 對 anomaly 兩表零表權 → 只能經此 SECDEF 受控窗讀
 * **零 PII 計數**(不下放任何 amount/user/order/rec)。
 *
 * 回傳 / 例外:成功 → `AnomalyAlertSummary`(計數);**transport / 回應形狀不符 → throw**
 * (use-case 不吞、上拋至 cron route → 503 fail-closed,壞掉的告警必須可見)。
 */
import type { AnomalyAlertSummary } from '@pcm/domain';

export interface IAnomalyAlertReader {
  /**
   * 讀雙扣 anomaly + 死卡列零 PII 計數摘要。
   * @param refundingStuckSeconds refunding 卡住門檻秒數(route 常數注入、營運參數非 SLA)。
   */
  getAlertSummary(refundingStuckSeconds: number): Promise<AnomalyAlertSummary>;
}
