/**
 * @module @pcm/adapters/payment/EmailAlertNotifierAdapter — Email 告警推播(M-3 #250、Q1=C)
 *
 * **🔴 server-only**:持 Resend API key(敏感、絕不進 client bundle)。送固定格式告警 email 給 Sean。
 * 🔴 **內容【含訂單單號】,不再是零 PII**(~~原句「零 PII」~~ 2026-08-19 作廢;
 *    誰在什麼時候為什麼打開那道閘,見 `packages/use-cases/src/check-anomaly-alerts.ts` 檔頭)。
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

/**
 * 🔴 管道標記(2026-08-21,窗 G;`G-c0-線G留下的洞…` §1②)。
 *
 * **它要解的不是「Sean 分不出這封在哪個 App」** —— 那他看得出來。
 * 要解的是:**那段文字被【複製出來】之後,來源就掉了。**
 * 2026-08-21 早上他把收到的內文貼回來當證據,而那段文字不會說明它從哪個管道來
 * ⇒ 我們量到「兩個管道都回 2xx」,卻**推不出「兩個收件對象都正確」**(codex R1 MF-1 打的就是這句)。
 * ⇒ 下一次他說「我沒收到」,我們仍然分不出是 LINE 沒到還是 Email 沒到。
 *
 * 🔴 **所以標記必須跟著【文字】走,不是跟著通道走** —— 它要在被複製貼上之後仍然存在。
 * 🔴 而它是給**收件人**看的,不是給程式看的 ⇒ 用白話,不用技術字串。
 * ⚠️ 長度:`fitToLineBudget` 留了 `LINE_BUDGET_HEADROOM = 400` 字元餘裕
 *    (`packages/use-cases/src/check-anomaly-alerts.ts:123`),本行 < 20 字元 ⇒ 不會撐破 LINE 5000 上限。
 * ⚠️ 它加在【截斷之後】⇒ 不受 `fitToLineBudget` 管,也不會擠掉 footer 那三行。
 */
const CHANNEL_MARK = '(這封是從 Email 送出的)';

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
        text: `${message.text}\n\n${CHANNEL_MARK}`, // 純文字內文、**含訂單單號**(見檔頭)+ 管道標記
      }),
    });
    if (!res.ok) {
      // 🔴 錯誤訊息只含通用描述 + status,絕不含 API key / 收件者。
      throw new Error(`Email 告警寄送失敗(status ${res.status})`);
    }
  }
}
