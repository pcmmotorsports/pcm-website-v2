// node env;mock 'server-only'(adapter 檔頭 import 'server-only')。
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { EmailAlertNotifierAdapter } from './EmailAlertNotifierAdapter';
import type { FetchLike } from './LineAlertNotifierAdapter';
import type { AnomalyAlertMessage } from '@pcm/domain';

const KEY = 're_secret_key_abc';
const FROM = 'alerts@pcmmotorsports.com';
const TO = 'boss@pcmmotorsports.com';
const MSG: AnomalyAlertMessage = { subject: '⚠️ PCM 付款異常告警', text: '• 雙扣候選(open,待查證)1 筆' };

describe('EmailAlertNotifierAdapter.notify(Resend emails)', () => {
  it('POST Resend endpoint、Bearer API key、body 含 from/to/subject/text', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as FetchLike;
    await new EmailAlertNotifierAdapter({ apiKey: KEY, from: FROM, to: TO }, f).notify(MSG);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body);
    expect(body.from).toBe(FROM);
    expect(body.to).toBe(TO);
    expect(body.subject).toBe(MSG.subject);
    expect(body.text).toContain('雙扣候選');
  });

  it('🔴 非 2xx → throw 通用訊息 + status,**不含 API key / 收件者**', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 422 })) as unknown as FetchLike;
    const adapter = new EmailAlertNotifierAdapter({ apiKey: KEY, from: FROM, to: TO }, f);
    await expect(adapter.notify(MSG)).rejects.toThrow('status 422');
    try {
      await adapter.notify(MSG);
    } catch (e) {
      const m = (e as Error).message;
      expect(m).not.toContain(KEY);
      expect(m).not.toContain(TO);
    }
  });

  it('transport 失敗(fetch reject)→ 上拋', async () => {
    const f = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as FetchLike;
    await expect(
      new EmailAlertNotifierAdapter({ apiKey: KEY, from: FROM, to: TO }, f).notify(MSG),
    ).rejects.toThrow();
  });
});
