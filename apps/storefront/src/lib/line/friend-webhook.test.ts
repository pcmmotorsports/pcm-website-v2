import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { parseLineWebhookEvents, verifyLineSignature } from './friend-webhook';

// friend-webhook.test.ts — 簽章 + 事件解析(S3)。承重:簽章錯一個 byte ⇒ false;userId / timestamp 不合格 ⇒ 當 other。
const SECRET = 'line-channel-secret-for-test';
const U = 'U' + 'a'.repeat(32);
const NOW = Date.parse('2026-09-14T09:00:00Z');
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body, 'utf8').digest('base64');

describe('verifyLineSignature', () => {
  it('對的 secret + 對的 bytes ⇒ true;body 改一個字 / 前面多 BOM / secret 換 / 簽章少一碼 / 缺 header / secret 空 ⇒ false', () => {
    const body = '{"events":[]}';
    expect(verifyLineSignature(Buffer.from(body, 'utf8'), sign(body), SECRET)).toBe(true);
    expect(verifyLineSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyLineSignature(body + ' ', sign(body), SECRET)).toBe(false);
    // 🔴 對原始 bytes 算:多一個 BOM 就不是同一份 body(req.text() 會吃掉 BOM ⇒ 舊寫法會放行)
    expect(verifyLineSignature(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, 'utf8')]), sign(body), SECRET)).toBe(false);
    expect(verifyLineSignature(body, sign(body, 'other'), SECRET)).toBe(false);
    expect(verifyLineSignature(body, sign(body).slice(0, -1), SECRET)).toBe(false);
    expect(verifyLineSignature(body, null, SECRET)).toBe(false);
    expect(verifyLineSignature(body, '', SECRET)).toBe(false);
    expect(verifyLineSignature(body, sign(body, ''), '')).toBe(false);
  });
});

describe('parseLineWebhookEvents', () => {
  it('follow / unfollow 帶合法 userId + timestamp ⇒ 事件(eventAt = 事件 timestamp,重送同值);其餘 ⇒ other', () => {
    const body = JSON.stringify({
      events: [
        { type: 'follow', timestamp: NOW - 1000, source: { type: 'user', userId: U } },
        { type: 'unfollow', timestamp: NOW - 500, source: { type: 'user', userId: U } },
        { type: 'message', timestamp: NOW, source: { type: 'user', userId: U } },
      ],
    });
    expect(parseLineWebhookEvents(body, NOW)).toEqual([
      { kind: 'follow', userId: U, eventAt: new Date(NOW - 1000).toISOString() },
      { kind: 'unfollow', userId: U, eventAt: new Date(NOW - 500).toISOString() },
      { kind: 'other' },
    ]);
  });

  it('🔴 userId 格式錯(不是 U+32hex)⇒ other,不寫 DB;群組來源沒 userId ⇒ other', () => {
    const body = JSON.stringify({
      events: [
        { type: 'follow', timestamp: NOW, source: { type: 'user', userId: 'not-a-line-id' } },
        { type: 'follow', timestamp: NOW, source: { type: 'group', groupId: 'C123' } },
        { type: 'follow', timestamp: NOW, source: { type: 'user', userId: "U' OR 1=1 --" } },
      ],
    });
    expect(parseLineWebhookEvents(body, NOW)).toEqual([{ kind: 'other' }, { kind: 'other' }, { kind: 'other' }]);
  });

  it('🔴 timestamp 是亂序判準:缺 / 非整數 / 1e20(Date 會 RangeError)/ 2019 / 未來兩天 ⇒ other,不用 now() 補', () => {
    const mk = (timestamp: unknown) => JSON.stringify({ events: [{ type: 'follow', timestamp, source: { type: 'user', userId: U } }] });
    for (const bad of [undefined, '1789300000000', 1.5, 1e20, Number.NaN, Date.parse('2019-12-31T00:00:00Z'), NOW + 2 * 86_400_000]) {
      expect(parseLineWebhookEvents(mk(bad), NOW), String(bad)).toEqual([{ kind: 'other' }]);
    }
    expect(parseLineWebhookEvents(mk(NOW + 3600_000), NOW)![0]!.kind, '時鐘差一小時內要收').toBe('follow');
  });

  it('空 events(LINE 後台「驗證」那一發)⇒ [];壞 JSON / 陣列 / 沒 events / null ⇒ null', () => {
    expect(parseLineWebhookEvents('{"events":[]}', NOW)).toEqual([]);
    expect(parseLineWebhookEvents('{', NOW)).toBeNull();
    expect(parseLineWebhookEvents('[]', NOW)).toBeNull();
    expect(parseLineWebhookEvents('{"destination":"x"}', NOW)).toBeNull();
    expect(parseLineWebhookEvents('null', NOW)).toBeNull();
  });
});
