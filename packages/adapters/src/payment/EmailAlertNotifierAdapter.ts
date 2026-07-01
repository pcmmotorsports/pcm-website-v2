/**
 * @module @pcm/adapters/payment/EmailAlertNotifierAdapter — Email 告警推播(M-3 #250、Q1=C)
 *
 * **🔴 server-only**:持 Resend API key(敏感、絕不進 client bundle)。送固定格式**零 PII** 告警 email 給 Sean。
 *
 * 用原生 fetch POST `https://api.resend.com/emails`(零新依賴、不裝 resend package);非 2xx / transport
 * 失敗 → throw **通用訊息 + status(不含 API key)**。use-case 計入 error → cron route 503(管道壞必須可見)。
 *
 * @see docs/phase-1-backlog.md #250
 */
import 'server-only';

import type { IAlertNotifier } from '@pcm/ports';
import type { AnomalyAlertMessage } from '@pcm/domain';
import type { FetchLike } from './LineAlertNotifierAdapter';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export type EmailAlertNotifierConfig = {
  /** Resend API key(server-only 密鑰)。 */
  apiKey: string;
  /** 寄件者(需 Resend 已驗證網域;e.g. alerts@pcmmotorsports.com)。 */
  from: string;
  /** 收件者(Sean)。 */
  to: string;
};

export class EmailAlertNotifierAdapter implements IAlertNotifier {
  constructor(
    private readonly cfg: EmailAlertNotifierConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async notify(message: AnomalyAlertMessage): Promise<void> {
    const res = await this.fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
      },
      body: JSON.stringify({
        from: this.cfg.from,
        to: this.cfg.to,
        subject: message.subject,
        text: message.text, // 純文字內文、零 PII 只含計數
      }),
    });
    if (!res.ok) {
      // 🔴 錯誤訊息只含通用描述 + status,絕不含 API key / 收件者。
      throw new Error(`Email 告警寄送失敗(status ${res.status})`);
    }
  }
}
