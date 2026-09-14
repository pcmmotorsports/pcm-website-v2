import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { LinePushSenderAdapter, lineStatusToErrorCode, type FetchLike } from './LinePushSenderAdapter';
import { OUTBOUND_SEND_TIMEOUT_MS } from '../outbound-timeout';

const INPUT = {
  to: 'Uabc',
  text: '您的訂單 PCM-2026-0001 已付款',
  idempotency: { eventType: 'order_created' as const, outboxId: '11111111-1111-4111-8111-111111111111' },
};

function fetchOf(status: number, throws = false) {
  const calls: Array<Parameters<FetchLike>> = [];
  const f: FetchLike = async (...args) => {
    calls.push(args);
    if (throws) throw new Error('ECONNRESET');
    return { ok: status >= 200 && status < 300, status };
  };
  return { f, calls };
}

describe('LinePushSenderAdapter', () => {
  it('🔴 2xx ⇒ sent、providerMessageId null;POST 到 push 端點、Bearer token、to = userId、純文字一則、retry key = outboxId、signal 有上界', async () => {
    const { f, calls } = fetchOf(200);
    const res = await new LinePushSenderAdapter({ accessToken: 'tok' }, f).push(INPUT);
    expect(res).toEqual({ kind: 'sent', providerMessageId: null });
    const [url, init] = calls[0]!;
    expect(url).toBe('https://api.line.me/v2/bot/message/push');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['X-Line-Retry-Key']).toBe(INPUT.idempotency.outboxId);
    expect(JSON.parse(init.body)).toEqual({ to: 'Uabc', messages: [{ type: 'text', text: INPUT.text }] });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(OUTBOUND_SEND_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('🔴 429 ⇒ failed http_429(走既有 quota_24h 政策);5xx ⇒ 對應碼;未知 4xx ⇒ provider_error;不 throw', async () => {
    await expect(new LinePushSenderAdapter({ accessToken: 't' }, fetchOf(429).f).push(INPUT))
      .resolves.toEqual({ kind: 'failed', errorCode: 'http_429' });
    await expect(new LinePushSenderAdapter({ accessToken: 't' }, fetchOf(503).f).push(INPUT))
      .resolves.toEqual({ kind: 'failed', errorCode: 'http_503' });
    await expect(new LinePushSenderAdapter({ accessToken: 't' }, fetchOf(418).f).push(INPUT))
      .resolves.toEqual({ kind: 'failed', errorCode: 'provider_error' });
    expect(lineStatusToErrorCode(400)).toBe('http_400');
  });

  it('🔴 409 = 這把 retry key 已被接受過 ⇒ sent(不是失敗;回應遺失後的重試不得把已送達的通知燒成死信)', async () => {
    await expect(new LinePushSenderAdapter({ accessToken: 't' }, fetchOf(409).f).push(INPUT))
      .resolves.toEqual({ kind: 'sent', providerMessageId: null });
  });

  it('🔴 fetch throw(逾時 / 網路)⇒ failed network_error,不 throw(合約同 IEmailSender)', async () => {
    await expect(new LinePushSenderAdapter({ accessToken: 't' }, fetchOf(0, true).f).push(INPUT))
      .resolves.toEqual({ kind: 'failed', errorCode: 'network_error' });
  });

  it('🔵 超過 LINE 5000 字上限 ⇒ 硬截 + 省略號(不讓 LINE 回 400 把整封吃掉)', async () => {
    const { f, calls } = fetchOf(200);
    await new LinePushSenderAdapter({ accessToken: 't' }, f).push({ ...INPUT, text: 'x'.repeat(6000) });
    const sent = JSON.parse(calls[0]![1].body).messages[0].text as string;
    expect(sent.length).toBeLessThanOrEqual(5000);
    expect(sent.endsWith('…')).toBe(true);
  });

  it('🛑 零密鑰 / 零 PII:失敗結果不含 token、userId、內文', async () => {
    const res = await new LinePushSenderAdapter({ accessToken: 'SECRET-TOKEN' }, fetchOf(500).f).push(INPUT);
    expect(JSON.stringify(res)).not.toMatch(/SECRET-TOKEN|Uabc|PCM-2026/);
  });
});
