/**
 * @module @pcm/adapters/payment/LineAlertNotifierAdapter — LINE 告警推播(M-3 #250、Q1=A)
 *
 * **🔴 server-only**:持 LINE Messaging API channel access token(敏感、絕不進 client bundle)。
 * 送固定格式告警訊息到 Sean 的 LINE(userId / groupId)。
 *
 * 🔴 **訊息【含訂單單號】,不再是零 PII** —— ~~原句「固定格式**零 PII** 告警訊息」~~ 2026-08-19 作廢。
 *    打開那道閘的是 Sean 本人(理由與代價見 `packages/use-cases/src/check-anomaly-alerts.ts` 檔頭)。
 * ⚠️ **而這件事對【本檔】特別重要**:`cfg.to` 若指向一個**群組**,單號就進了一個多人房間。
 *    那顆 env 的實際值 repo 內查不到 ⇒ **上線前要有人去看一眼它指向誰。**
 *
 * 用原生 fetch POST `https://api.line.me/v2/bot/message/push`(零新依賴);非 2xx / transport 失敗 → throw
 * **通用訊息 + status(不含 token)**。use-case 計入 error → cron route 503(壞掉的管道必須可見)。
 *
 * 🔴 注意:舊「LINE Notify」2025 已停用,本 adapter 走官方帳號 Messaging API push。
 *
 * @see docs/phase-1-backlog.md #250
 */
import 'server-only';

import type { IAlertNotifier } from '@pcm/ports';
import type { AnomalyAlertMessage } from '@pcm/domain';

/** 最小 fetch 抽象(避 DOM lib 依賴 + 便於測試注入)。 */
export type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number }>;

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

export type LineAlertNotifierConfig = {
  /** LINE Messaging API channel access token(server-only 密鑰)。 */
  accessToken: string;
  /** 推播對象(Sean 的 LINE userId 或 groupId)。 */
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
const CHANNEL_MARK = '(這封是從 LINE 送出的)';

export class LineAlertNotifierAdapter implements IAlertNotifier {
  constructor(
    private readonly cfg: LineAlertNotifierConfig,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
  ) {}

  async notify(message: AnomalyAlertMessage): Promise<void> {
    const res = await this.fetchImpl(LINE_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.accessToken}`,
      },
      body: JSON.stringify({
        to: this.cfg.to,
        // 純文字訊息(**含訂單單號**,見檔頭);subject 併首行。
        messages: [{ type: 'text', text: `${message.subject}\n\n${message.text}\n\n${CHANNEL_MARK}` }],
      }),
    });
    if (!res.ok) {
      // 🔴 錯誤訊息只含通用描述 + status,絕不含 token / 對象 id。
      throw new Error(`LINE 告警推播失敗(status ${res.status})`);
    }
  }
}
