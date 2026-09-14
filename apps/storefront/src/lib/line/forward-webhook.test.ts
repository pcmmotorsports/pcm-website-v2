import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { LINE_FORWARD_ATTEMPTS, LINE_FORWARD_BACKOFF_MS, extractLineEventIds, forwardLineWebhook } from './forward-webhook';

const SECRET = 'line-channel-secret-for-test';
const body = JSON.stringify({ events: [{ type: 'message', webhookEventId: 'evt-1', timestamp: 1789300000000, source: { type: 'user', userId: 'U' + 'a'.repeat(32) }, message: { type: 'text', text: '你好 ✓' } }] });
const rawBytes = new TextEncoder().encode(body);
const signature = createHmac('sha256', SECRET).update(rawBytes).digest('base64');
const sleeps: number[] = [];
const sleepImpl = async (ms: number) => { sleeps.push(ms); };

beforeEach(() => {
  sleeps.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('forwardLineWebhook', () => {
  it('沒設 URL ⇒ 不打任何一發', async () => {
    const fetchImpl = vi.fn();
    expect(await forwardLineWebhook({ forwardUrl: undefined, rawBytes, signature, eventIds: [], fetchImpl: fetchImpl as never })).toBe('skipped_no_url');
    expect(await forwardLineWebhook({ forwardUrl: '  ', rawBytes, signature, eventIds: [], fetchImpl: fetchImpl as never })).toBe('skipped_no_url');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('🔴 body 逐 byte 相同、原簽章與 Content-Type 逐字帶到 ⇒ 對方用同一把 secret 驗得過', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }));
    const r = await forwardLineWebhook({ forwardUrl: 'https://quote.example/api/line/webhook', rawBytes, signature, eventIds: ['evt-1'], fetchImpl: fetchImpl as never });
    expect(r).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('https://quote.example/api/line/webhook');
    expect(init.method).toBe('POST');
    const sent = init.body as Uint8Array;
    expect(Buffer.from(sent).equals(Buffer.from(rawBytes))).toBe(true);
    expect(createHmac('sha256', SECRET).update(sent).digest('base64')).toBe(signature);
    const headers = init.headers as Record<string, string>;
    expect(headers['x-line-signature']).toBe(signature);
    expect(headers['Content-Type']).toBe('application/json');
    expect(Object.keys(headers)).toHaveLength(2);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');
  });

  it('🔴 URL 不是 https ⇒ 不打(明文 / 設錯)', async () => {
    const fetchImpl = vi.fn();
    expect(await forwardLineWebhook({ forwardUrl: 'http://quote.example/x', rawBytes, signature, eventIds: [], fetchImpl: fetchImpl as never })).toBe('skipped_bad_url');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('🔴 對方掛了 ⇒ 1 + 3 次、退避 1s/3s/9s、最後 failed + console.error 帶 event ids 不帶 userId', async () => {
    const fetchImpl = vi.fn(async () => new Response('down', { status: 503 }));
    const r = await forwardLineWebhook({ forwardUrl: 'https://quote.example/x', rawBytes, signature, eventIds: ['evt-1'], fetchImpl: fetchImpl as never, sleepImpl });
    expect(r).toBe('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(LINE_FORWARD_ATTEMPTS);
    expect(sleeps).toEqual([...LINE_FORWARD_BACKOFF_MS]);
    expect(console.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(logged).toContain('evt-1');
    expect(logged).toContain('http_503');
    expect(logged).not.toContain('a'.repeat(32));
  });

  it('第一發 throw(逾時)第二發 200 ⇒ ok, 只睡一次', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('t'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const r = await forwardLineWebhook({ forwardUrl: 'https://quote.example/x', rawBytes, signature, eventIds: [], fetchImpl: fetchImpl as never, sleepImpl });
    expect(r).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([LINE_FORWARD_BACKOFF_MS[0]]);
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('extractLineEventIds', () => {
  it('抽 webhookEventId;壞 JSON / 沒 events ⇒ 空', () => {
    expect(extractLineEventIds(body)).toEqual(['evt-1']);
    expect(extractLineEventIds('{')).toEqual([]);
    expect(extractLineEventIds('{"events":[{"type":"follow"}]}')).toEqual([]);
  });
});
