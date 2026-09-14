import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `@/lib/auth/line` 帶 server-only(它讀 LINE_CHANNEL_SECRET);vitest 沒有 server/client 之分 ⇒ 本檔換空替身(同 auth/line 那族測試)。
vi.mock('server-only', () => ({}));

const h = vi.hoisted(() => ({ setLineFriendAt: vi.fn(), after: vi.fn(), forward: vi.fn() }));
vi.mock('@/lib/line/friend-repository', () => ({ setLineFriendAt: h.setLineFriendAt }));
vi.mock('next/server', () => ({ after: h.after }));
vi.mock('@/lib/line/forward-webhook', async (orig) => ({
  ...(await orig<typeof import('@/lib/line/forward-webhook')>()),
  forwardLineWebhook: h.forward,
}));

import { POST } from './route';

// route.test.ts — webhook 的門(S3)。承重:簽章錯 ⇒ 401 且 repository 一次都沒被呼叫;沒設 secret ⇒ 503 零寫入。
const SECRET = 'line-channel-secret-for-test';
const U = 'U' + 'b'.repeat(32);
const sign = (body: string) => createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');
const req = (body: string, sig: string | null) =>
  new Request('http://localhost/api/line/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(sig === null ? {} : { 'x-line-signature': sig }) },
    body,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('LINE_WEBHOOK_CHANNEL_SECRET', SECRET);
  vi.stubEnv('LINE_WEBHOOK_FORWARD_URL', '');
  h.setLineFriendAt.mockResolvedValue('updated');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe('POST /api/line/webhook 轉發到報價單(LINE_WEBHOOK_FORWARD_URL)', () => {
  const body = JSON.stringify({ events: [{ type: 'message', webhookEventId: 'evt-9', timestamp: 1789300000000, source: { type: 'user', userId: U }, message: { type: 'text', text: 'hi' } }] });

  it('沒設 env ⇒ 不排 after、不轉;本地行為照舊 200', async () => {
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    expect(h.after).not.toHaveBeenCalled();
    expect(h.forward).not.toHaveBeenCalled();
  });

  it('🔴 設了 env ⇒ 先回 200, 轉發排進 after();body 逐 byte 原封 + 原簽章 + event ids', async () => {
    vi.stubEnv('LINE_WEBHOOK_FORWARD_URL', 'https://quote.example/api/line/webhook');
    h.forward.mockResolvedValue('ok');
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    expect(h.after).toHaveBeenCalledTimes(1);
    expect(h.forward).not.toHaveBeenCalled();
    await (h.after.mock.calls[0]![0] as () => Promise<unknown>)();
    expect(h.forward).toHaveBeenCalledTimes(1);
    const arg = h.forward.mock.calls[0]![0] as { forwardUrl: string; rawBytes: Uint8Array; signature: string; eventIds: string[] };
    expect(arg.forwardUrl).toBe('https://quote.example/api/line/webhook');
    expect(Buffer.from(arg.rawBytes).toString('utf8')).toBe(body);
    expect(arg.signature).toBe(sign(body));
    expect(arg.eventIds).toEqual(['evt-9']);
  });

  it('🔴 簽章錯 ⇒ 401 且【不轉】(不當 relay 放大器)', async () => {
    vi.stubEnv('LINE_WEBHOOK_FORWARD_URL', 'https://quote.example/api/line/webhook');
    expect((await POST(req(body, 'bad'))).status).toBe(401);
    expect(h.after).not.toHaveBeenCalled();
  });

  it('轉發失敗 / 我們 DB 寫失敗 ⇒ 互不影響:after 回呼 rejected 不改 200;DB 500 仍排轉發', async () => {
    vi.stubEnv('LINE_WEBHOOK_FORWARD_URL', 'https://quote.example/api/line/webhook');
    h.forward.mockResolvedValue('failed');
    expect((await POST(req(body, sign(body)))).status).toBe(200);
    const follow = JSON.stringify({ events: [{ type: 'follow', timestamp: 1789300000000, source: { type: 'user', userId: U } }] });
    h.setLineFriendAt.mockRejectedValue(Object.assign(new Error('x'), { code: '57014' }));
    expect((await POST(req(follow, sign(follow)))).status).toBe(500);
    expect(h.after).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/line/webhook', () => {
  it('🔴 簽章錯 ⇒ 401,repository 一次都沒被呼叫(不驗 = 任何人可竄改好友狀態)', async () => {
    const body = JSON.stringify({ events: [{ type: 'unfollow', timestamp: 1789300000000, source: { type: 'user', userId: U } }] });
    const res = await POST(req(body, 'bad'));
    expect(res.status).toBe(401);
    expect(h.setLineFriendAt).not.toHaveBeenCalled();
    const res2 = await POST(req(body, null));
    expect(res2.status).toBe(401);
    expect(h.setLineFriendAt).not.toHaveBeenCalled();
  });

  it('🔴 沒設 LINE_WEBHOOK_CHANNEL_SECRET ⇒ 503,零寫入(不驗簽章就不收)', async () => {
    vi.stubEnv('LINE_WEBHOOK_CHANNEL_SECRET', '');
    const body = JSON.stringify({ events: [{ type: 'follow', timestamp: 1789300000000, source: { type: 'user', userId: U } }] });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(503);
    expect(h.setLineFriendAt).not.toHaveBeenCalled();
  });

  it('🔴 缺 header ⇒ 401 且【不讀 body】;content-length 超過上限 ⇒ 413', async () => {
    const body = JSON.stringify({ events: [] });
    const r = new Request('http://localhost/api/line/webhook', { method: 'POST', body });
    const spy = vi.spyOn(r, 'arrayBuffer');
    expect((await POST(r)).status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    const big = new Request('http://localhost/api/line/webhook', { method: 'POST', headers: { 'x-line-signature': sign(body), 'content-length': '2000000' }, body });
    expect((await POST(big)).status).toBe(413);
    expect(h.setLineFriendAt).not.toHaveBeenCalled();
  });

  it('follow ⇒ 寫事件 timestamp(friendAt = eventAt);unfollow ⇒ friendAt null、eventAt 仍帶;其餘忽略;skipped 不炸;回應不帶 userId', async () => {
    h.setLineFriendAt.mockResolvedValueOnce('updated').mockResolvedValueOnce('skipped');
    const body = JSON.stringify({
      events: [
        { type: 'follow', timestamp: 1789300000000, source: { type: 'user', userId: U } },
        { type: 'unfollow', timestamp: 1789300001000, source: { type: 'user', userId: U } },
        { type: 'message', timestamp: 1789300002000, source: { type: 'user', userId: U }, message: { type: 'text', text: 'hi' } },
      ],
    });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(200);
    expect(h.setLineFriendAt).toHaveBeenCalledTimes(2);
    expect(h.setLineFriendAt).toHaveBeenNthCalledWith(1, U, new Date(1789300000000).toISOString(), new Date(1789300000000).toISOString());
    expect(h.setLineFriendAt).toHaveBeenNthCalledWith(2, U, null, new Date(1789300001000).toISOString());
    const json = await res.json();
    expect(json).toEqual({ ok: true, updated: 1, skipped: 1, ignored: 1 });
    expect(JSON.stringify(json)).not.toContain(U);
  });

  it('LINE 後台「驗證」那一發(空 events)⇒ 200;壞 body ⇒ 400 零寫入', async () => {
    const empty = '{"events":[]}';
    expect((await POST(req(empty, sign(empty)))).status).toBe(200);
    const bad = '{"nope":1}';
    expect((await POST(req(bad, sign(bad)))).status).toBe(400);
    expect(h.setLineFriendAt).not.toHaveBeenCalled();
  });

  it('第 2 筆 DB 寫失敗 ⇒ 500(第 1 筆已寫;重送靠冪等 + event_at 擋亂序);回應與 log 不帶 message', async () => {
    h.setLineFriendAt.mockResolvedValueOnce('updated').mockRejectedValueOnce(Object.assign(new Error('boom U-secret'), { code: '42501' }));
    const body = JSON.stringify({
      events: [
        { type: 'follow', timestamp: 1789300000000, source: { type: 'user', userId: U } },
        { type: 'unfollow', timestamp: 1789300001000, source: { type: 'user', userId: U } },
      ],
    });
    const res = await POST(req(body, sign(body)));
    expect(res.status).toBe(500);
    expect(h.setLineFriendAt).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await res.json())).not.toContain('boom');
    const logged = JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls);
    expect(logged).not.toContain('boom');
    expect(logged).toContain('42501');
  });
});
