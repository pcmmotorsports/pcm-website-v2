// @vitest-environment node
// route.test.ts — /api/cron/bing-weekly(計畫 ~/pcm-mailbox/計畫-Bing週報LINE-20260929.md 第 12～14 節)。
//
// 🔴 Bing 讀取器與 LINE 送出都用【真的】碼, 只把全域 fetch 換成假的 ⇒ 斷言的是真正送進 LINE 的全文,
//    接錯(漏帶、順序反了、把讀不到印成沒問題)都會紅。心跳 mock 掉的是 IO, 判斷哪一條路寫在 route 裡。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { hbOkSpy, hbFailSpy } = vi.hoisted(() => ({ hbOkSpy: vi.fn(), hbFailSpy: vi.fn() }));
vi.mock('@/lib/cron/heartbeat', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  recordHeartbeatSuccess: hbOkSpy,
  recordHeartbeatFailure: hbFailSpy,
}));

import * as route from './route';
import { CRON_RATE_MAX_HITS, resetCronRateLimit } from '@/lib/cron/rate-limit';

const { GET } = route;
const SECRET = 'a'.repeat(48);
const BING_KEY = 'bing-key-SHOULD-NEVER-BE-LOGGED-123';
const NOW = new Date('2026-10-05T01:05:00Z');

/** Bing 原始 JSON 的一列。 */
function raw(date: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Date: `/Date(${Date.parse(`${date}T00:00:00Z`)})/`,
    CrawlErrors: 25, Code4xx: 0, Code5xx: 0, DnsFailures: 0, ConnectionTimeout: 0,
    ContainsMalware: 0, BlockedByRobotsTxt: 4, InIndex: 2884,
    ...over,
  };
}
/** 09-21～10-04, 前 7 天收錄 2,435、這 7 天 2,884。 */
function statsRows(lastDate = '2026-10-04'): Array<Record<string, unknown>> {
  const end = Date.parse(`${lastDate}T00:00:00Z`);
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(end - (13 - i) * 86_400_000).toISOString().slice(0, 10);
    return raw(d, i < 7 ? { InIndex: 2435 } : {});
  });
}

type Bing = { status?: number; stats?: unknown; issues?: unknown; hang?: boolean; throwErr?: Error };
type Line = { status?: number };

const lineBodies: Array<{ to: string; messages: Array<{ type: string; text: string }> }> = [];
let bingCalls = 0;
let bingThrew = 0;

function stubFetch(bing: Bing = {}, line: Line = {}) {
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
    if (url.startsWith('https://ssl.bing.com/')) {
      bingCalls++;
      if (bing.hang) return new Promise(() => {});
      if (bing.throwErr) {
        bingThrew++;
        throw bing.throwErr;
      }
      const body = url.includes('/GetCrawlStats') ? (bing.stats ?? { d: statsRows() }) : (bing.issues ?? { d: [] });
      const status = bing.status ?? 200;
      return { ok: status < 300, status, json: async () => body };
    }
    if (url === 'https://api.line.me/v2/bot/message/push') {
      lineBodies.push(JSON.parse(init!.body!));
      const status = line.status ?? 200;
      return { ok: status < 300, status };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

const req = (auth = `Bearer ${SECRET}`) =>
  new Request('http://localhost:3000/api/cron/bing-weekly', { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  process.env.CRON_SECRET = SECRET;
  process.env.BING_WEBMASTER_API_KEY = BING_KEY;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'line-token';
  process.env.LINE_ALERT_TO = 'Useanid';
  lineBodies.length = 0;
  bingCalls = 0;
  bingThrew = 0;
  resetCronRateLimit();
  stubFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  for (const k of ['CRON_SECRET', 'BING_WEBMASTER_API_KEY', 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_ALERT_TO']) delete process.env[k];
});

describe('GET /api/cron/bing-weekly — 契約與驗證', () => {
  it('只有 GET;runtime=nodejs、dynamic=force-dynamic、maxDuration=60', () => {
    expect((route as Record<string, unknown>).POST).toBeUndefined();
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(60);
  });

  it('沒帶或帶錯密鑰 ⇒ 401, 不打 Bing、不送 LINE、不寫心跳', async () => {
    expect((await GET(req(''))).status).toBe(401);
    expect((await GET(req('Bearer wrong'))).status).toBe(401);
    expect(bingCalls).toBe(0);
    expect(lineBodies).toHaveLength(0);
    expect(hbOkSpy).not.toHaveBeenCalled();
    expect(hbFailSpy).not.toHaveBeenCalled();
  });

  it('超過限流 ⇒ 429', async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) await GET(req());
    expect((await GET(req())).status).toBe(429);
  });

  it('🔴 缺 BING_WEBMASTER_API_KEY ⇒ 503 + 失敗心跳, 不打 Bing、不送 LINE', async () => {
    delete process.env.BING_WEBMASTER_API_KEY;
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(bingCalls).toBe(0);
    expect(lineBodies).toHaveLength(0);
    expect(hbFailSpy).toHaveBeenCalledWith('pcm-bing-weekly');
    expect(hbOkSpy).not.toHaveBeenCalled();
  });

  it('缺 LINE 設定 ⇒ 503 + 失敗心跳, 不打 Bing', async () => {
    delete process.env.LINE_ALERT_TO;
    expect((await GET(req())).status).toBe(503);
    expect(bingCalls).toBe(0);
    expect(hbFailSpy).toHaveBeenCalledWith('pcm-bing-weekly');
  });
});

describe('GET /api/cron/bing-weekly — 送出的 LINE 全文', () => {
  it('ok 沒問題 ⇒ 標題 + 附兩週數字那一句;200 + 成功心跳', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: 'ok' });
    expect(lineBodies).toHaveLength(1);
    expect(lineBodies[0]!.to).toBe('Useanid');
    expect(lineBodies[0]!.messages).toEqual([
      { type: 'text', text: 'PCM Bing 週報\nBing 09-28～10-04：沒有新問題（爬取錯誤每日 25、上週 25；收錄 2,884、上週末 2,435）' },
    ]);
    expect(hbOkSpy).toHaveBeenCalledWith('pcm-bing-weekly');
    expect(hbFailSpy).not.toHaveBeenCalled();
  });

  it('stale ⇒「資料停在」那一句, 不是「沒有新問題」', async () => {
    stubFetch({ stats: { d: statsRows('2026-09-20') } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: 'stale' });
    expect(lineBodies[0]!.messages[0]!.text).toBe('PCM Bing 週報\nBing 資料停在 09-20，本週無法判斷。');
  });

  it('🔴 讀不到(Bing 500)⇒ 照樣送「讀不到」那一句, 200 + 成功心跳, log 只有固定 reason(R5 必修 2)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ status: 500 });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kind: 'unreadable' });
    expect(lineBodies[0]!.messages[0]!.text).toBe('PCM Bing 週報\n這週讀不到 Bing 的資料，下週一會再試。');
    expect(warn).toHaveBeenCalledWith('[bing-weekly] 讀不到 Bing', { reason: 'http_other' });
    expect(hbOkSpy).toHaveBeenCalledWith('pcm-bing-weekly');
  });

  it.each([401, 403])('%i ⇒ 提示金鑰可能失效', async (status) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ status });
    await GET(req());
    expect(lineBodies[0]!.messages[0]!.text).toBe(
      'PCM Bing 週報\n這週讀不到 Bing 的資料（金鑰可能失效），請檢查 Bing 設定。',
    );
  });

  it('🔴 Bing 永遠不回應 ⇒ 15 秒後照常送「讀不到」(route 層截止, 假計時器推進)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ hang: true });
    const pending = GET(req());
    await vi.advanceTimersByTimeAsync(14_999);
    expect(lineBodies).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const res = await pending;
    expect(res.status).toBe(200);
    expect(lineBodies[0]!.messages[0]!.text).toBe('PCM Bing 週報\n這週讀不到 Bing 的資料，下週一會再試。');
  });

  it('🔴 LINE 送不出去 ⇒ 503, 只寫失敗心跳、不寫成功心跳', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    stubFetch({}, { status: 500 });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalledWith('pcm-bing-weekly');
    expect(hbOkSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/bing-weekly — 金鑰不外洩', () => {
  it('🔴 Bing 丟出的錯誤訊息帶金鑰 ⇒ log、回應、LINE 都不含金鑰', async () => {
    const logs: unknown[][] = [];
    for (const m of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a));
    }
    stubFetch({ throwErr: new TypeError(`fetch failed https://ssl.bing.com/x?apikey=${BING_KEY}`) });
    const res = await GET(req());
    const body = await res.text();
    // 正對照:假 Bing 真的被呼叫、而且真的丟了帶金鑰的錯
    expect(bingCalls).toBeGreaterThan(0);
    expect(bingThrew).toBeGreaterThan(0);
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain(BING_KEY);
    expect(body).not.toContain(BING_KEY);
    expect(JSON.stringify(lineBodies)).not.toContain(BING_KEY);
  });
});
