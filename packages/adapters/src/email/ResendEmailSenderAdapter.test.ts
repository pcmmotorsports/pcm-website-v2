// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ResendEmailSenderAdapter } from './ResendEmailSenderAdapter';
import type { FetchLike } from '../payment/LineAlertNotifierAdapter';
import type { SendEmailInput } from '@pcm/ports';

const KEY = 're_secret_key_e1b';
const FROM = 'orders@pcmmotorsports.com';
const INPUT: SendEmailInput = {
  to: 'customer@example.com',
  subject: 'PCM 訂單 PCM-2026-0001 付款成功通知',
  text: '您的訂單已完成付款。',
  idempotency: {
    eventType: 'order_created',
    outboxId: '11111111-2222-3333-4444-555555555555',
  },
};

describe('ResendEmailSenderAdapter.send(Resend emails)', () => {
  it('POST Resend endpoint、Bearer key、🔴 Idempotency-Key 由座標組字面、body 含 from/to/subject/text', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as FetchLike;
    const result = await new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, f).send(INPUT);
    expect(result).toEqual({ kind: 'sent' });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    // codex R1:port 收結構化座標、adapter 組 <event_type>/<outbox_id>,呼叫端無法誤餵自由字串。
    expect(init.headers['Idempotency-Key']).toBe(
      'order_created/11111111-2222-3333-4444-555555555555',
    );
    const body = JSON.parse(init.body);
    expect(body.from).toBe(FROM);
    expect(body.to).toBe(INPUT.to);
    expect(body.subject).toBe(INPUT.subject);
    expect(body.text).toBe(INPUT.text);
  });

  it('🔴 畸形回應 fail-closed(codex R1 nit):null / 缺 ok/status / getter 拋錯 → 不外洩為 throw', async () => {
    const fNull = vi.fn(async () => null) as unknown as FetchLike;
    await expect(
      new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, fNull).send(INPUT),
    ).resolves.toEqual({ kind: 'failed', errorCode: 'provider_error' });

    const fNoStatus = vi.fn(async () => ({ ok: false })) as unknown as FetchLike;
    await expect(
      new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, fNoStatus).send(INPUT),
    ).resolves.toEqual({ kind: 'failed', errorCode: 'provider_error' });

    const fThrowingGetter = vi.fn(async () => ({
      get ok(): boolean {
        throw new Error('broken response');
      },
    })) as unknown as FetchLike;
    await expect(
      new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, fThrowingGetter).send(INPUT),
    ).resolves.toEqual({ kind: 'failed', errorCode: 'network_error' });
  });

  it('allowlist 內狀態碼 → 對應 http_* 錯誤碼(422/429)', async () => {
    for (const [status, code] of [
      [422, 'http_422'],
      [429, 'http_429'],
    ] as const) {
      const f = vi.fn(async () => ({ ok: false, status })) as unknown as FetchLike;
      const result = await new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, f).send(INPUT);
      expect(result).toEqual({ kind: 'failed', errorCode: code });
    }
  });

  it('🔴 非 allowlist 狀態碼 → provider_error 兜底(禁動態產碼)', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 418 })) as unknown as FetchLike;
    const result = await new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, f).send(INPUT);
    expect(result).toEqual({ kind: 'failed', errorCode: 'provider_error' });
  });

  it('🔴 transport 失敗 → network_error,且錯誤碼不含 provider message 內容(禁由 .message 轉碼)', async () => {
    const f = vi.fn(async () => {
      throw new Error(`connect failed while sending to ${INPUT.to}`);
    }) as unknown as FetchLike;
    const result = await new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, f).send(INPUT);
    expect(result).toEqual({ kind: 'failed', errorCode: 'network_error' });
  });

  it('可預期失敗不 throw(outbox 需錯誤碼落表退避、不混流程式錯誤)', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as FetchLike;
    await expect(
      new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, f).send(INPUT),
    ).resolves.toEqual({ kind: 'failed', errorCode: 'http_500' });
  });

  it('🔴 錯誤碼恆符合 DB CHECK 格式 ^[a-z0-9_]{1,64}$(格式 backstop 對齊)', async () => {
    for (const status of [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504, 418, 599]) {
      const f = vi.fn(async () => ({ ok: false, status })) as unknown as FetchLike;
      const result = await new ResendEmailSenderAdapter({ apiKey: KEY, from: FROM }, f).send(INPUT);
      if (result.kind === 'failed') {
        expect(result.errorCode).toMatch(/^[a-z0-9_]{1,64}$/);
      }
    }
  });
});
