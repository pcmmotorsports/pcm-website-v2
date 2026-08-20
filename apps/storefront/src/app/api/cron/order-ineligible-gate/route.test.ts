// @vitest-environment node
// route.test.ts — /api/cron/order-ineligible-gate GET handler 測試(M-4a E2a-2、W3-G 拆出)
//
// node env(route 用 node:crypto timingSafeEqual + Buffer + 全域 Request/Response)。
// mock:server-only / @pcm/use-cases(applyOrderIneligibleGate)/ @/lib/email/composition
// (getApplyOrderIneligibleGateDeps)。
// 驗:① GET-only 契約 + runtime/maxDuration/dynamic ② 認證(CRON_SECRET 未設/弱→500、Bearer 缺/錯→401)
//     ③ errors=0→200 計數、errors>0→503 不偽 200、raceLost>0 不算錯誤 ④ deps/use-case throw→503
//     ⑤ options 注入(limit=50)⑥ 零 PII(log counts only)⑦ 應用層限流。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { applySpy, getDepsSpy } = vi.hoisted(() => ({
  applySpy: vi.fn(),
  getDepsSpy: vi.fn(),
}));

vi.mock('@pcm/use-cases', () => ({ applyOrderIneligibleGate: applySpy }));
vi.mock('@/lib/email/composition', () => ({ getApplyOrderIneligibleGateDeps: getDepsSpy }));

import * as route from './route';
import { CRON_RATE_MAX_HITS, resetCronRateLimit } from '@/lib/cron/rate-limit';

const { GET } = route;

const SECRET = 'a'.repeat(48); // ≥32

/** 乾淨結果(零候選、零錯誤;常態)。 */
const CLEAN_RESULT = { scanned: 0, markedIneligible: 0, raceLost: 0, errors: 0 };

const DEPS = { outbox: {}, scanner: {} };

function makeReq(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers['authorization'] = authorization;
  return new Request('http://localhost:3000/api/cron/order-ineligible-gate', { method: 'GET', headers });
}

const bearer = (s: string = SECRET) => `Bearer ${s}`;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  applySpy.mockReset().mockResolvedValue({ ...CLEAN_RESULT });
  getDepsSpy.mockReset().mockReturnValue({ ...DEPS });
  resetCronRateLimit(); // #254 限流器 module scope 狀態跨測試存活 → 每測試前全清隔離
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe('GET /api/cron/order-ineligible-gate — 契約 + route 段設定', () => {
  it('只 export GET、不 export POST(cron 觸發皆走 GET)', () => {
    expect(typeof GET).toBe('function');
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });

  it('runtime=nodejs / dynamic=force-dynamic / maxDuration=60', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(60);
  });
});

describe('GET order-ineligible-gate — 認證(CRON_SECRET Bearer 硬驗)', () => {
  it('無 Authorization → 401、不建 deps、不跑', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(applySpy).not.toHaveBeenCalled();
    expect(getDepsSpy).not.toHaveBeenCalled();
  });

  it('錯 Bearer → 401', async () => {
    const res = await GET(makeReq(bearer('b'.repeat(48))));
    expect(res.status).toBe(401);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('裸 secret 無 "Bearer " 前綴 → 401', async () => {
    const res = await GET(makeReq(SECRET));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRET 未設 → 500 fail-closed', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(500);
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('CRON_SECRET <32 → 500', async () => {
    process.env.CRON_SECRET = 'short';
    const res = await GET(makeReq(bearer('short')));
    expect(res.status).toBe(500);
  });
});

describe('GET order-ineligible-gate — 執行 + 結果映射', () => {
  it('errors=0 → 200 + ok:true + 計數摘要(零 PII counts)', async () => {
    applySpy.mockResolvedValue({ scanned: 3, markedIneligible: 2, raceLost: 1, errors: 0 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, scanned: 3, markedIneligible: 2, raceLost: 1, errors: 0 });
  });

  it('🔴 raceLost>0 不是錯誤(未知,不是安全;重試解決不了 race)⇒ 仍 200,數字必進回應', async () => {
    applySpy.mockResolvedValue({ scanned: 5, markedIneligible: 3, raceLost: 2, errors: 0 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });

  it('🔴 errors>0 → 503 + ok:false、不偽 200', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    applySpy.mockResolvedValue({ scanned: 2, markedIneligible: 0, raceLost: 0, errors: 2 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, errors: 2 });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('"errors":2');
    errSpy.mockRestore();
  });

  it('🔴 getApplyOrderIneligibleGateDeps throw → 503 fail-closed、不跑、log 固定 reason code 零洩漏', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDepsSpy.mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(applySpy).not.toHaveBeenCalled();
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('deps_or_unexpected_throw');
    expect(logged).not.toContain(SECRET);
    errSpy.mockRestore();
  });

  it('🔴 applyOrderIneligibleGate throw(scanner/outbox 段級 throw 上拋)→ 503 fail-closed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    applySpy.mockRejectedValue(new Error('scanner down'));
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    errSpy.mockRestore();
  });
});

describe('GET order-ineligible-gate — options 注入(不採信外部輸入)', () => {
  it('applyOrderIneligibleGate 收 route 端常數 limit=50', async () => {
    await GET(makeReq(bearer()));
    expect(applySpy).toHaveBeenCalledWith(expect.anything(), { limit: 50 });
  });

  it('deps = getApplyOrderIneligibleGateDeps() 注入', async () => {
    await GET(makeReq(bearer()));
    expect(getDepsSpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0]![0]).toMatchObject({ outbox: expect.anything(), scanner: expect.anything() });
  });
});

describe('GET order-ineligible-gate — 應用層限流(縱深 hardening)', () => {
  it(`認證後前 ${CRON_RATE_MAX_HITS} 次放行、超限 → 429`, async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) {
      expect((await GET(makeReq(bearer()))).status).toBe(200);
    }
    expect((await GET(makeReq(bearer()))).status).toBe(429);
  });

  it('限流在認證「後」:錯 Bearer 的 flood(仍 401)不佔額度、真 secret 首打即放行', async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS + 1; i++) {
      expect((await GET(makeReq(bearer('b'.repeat(48))))).status).toBe(401);
    }
    expect((await GET(makeReq(bearer()))).status).toBe(200); // 401 flood 未消耗額度
  });

  it('429 在建 deps / 跑 use-case 之前:不建 deps、不跑', async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) await GET(makeReq(bearer()));
    getDepsSpy.mockClear();
    applySpy.mockClear();
    const limited = await GET(makeReq(bearer()));
    expect(limited.status).toBe(429);
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
  });
});
