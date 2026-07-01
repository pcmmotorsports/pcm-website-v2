/**
 * IAlertNotifier:告警推播 port(M-3 #250)。
 *
 * 單一管道推播抽象。實作(`LineAlertNotifierAdapter` / `EmailAlertNotifierAdapter`)持各自管道密鑰
 * (server-only),送**固定格式零 PII** 訊息。use-case 對「所有已設定管道」逐一推播(Q1=A+C LINE+Email)。
 *
 * 🔴 fail-closed:notify throw(管道 API 非 2xx / transport 失敗)→ use-case 計入 error → cron route 503
 * (壞掉的告警管道必須可見、不得靜默吞成成功;沉默告警 = 最糟)。密鑰**絕不**入訊息 / 錯誤 / log。
 */
import type { AnomalyAlertMessage } from '@pcm/domain';

export interface IAlertNotifier {
  /** 推播一則固定格式零 PII 告警訊息;失敗 throw(訊息只含通用描述 + status,不含密鑰)。 */
  notify(message: AnomalyAlertMessage): Promise<void>;
}
