/**
 * @module @pcm/adapters/payment/LineAlertNotifierAdapter — LINE 告警推播(M-3 #250、Q1=A)
 *
 * **🔴 server-only**:持 LINE Messaging API channel access token(敏感、絕不進 client bundle)。
 * 送固定格式**零 PII** 告警訊息到 Sean 的 LINE(userId / groupId)。
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
        // 純文字訊息(零 PII、只含計數);subject 併首行。
        messages: [{ type: 'text', text: `${message.subject}\n\n${message.text}` }],
      }),
    });
    if (!res.ok) {
      // 🔴 錯誤訊息只含通用描述 + status,絕不含 token / 對象 id。
      throw new Error(`LINE 告警推播失敗(status ${res.status})`);
    }
  }
}
