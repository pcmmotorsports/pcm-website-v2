// @vitest-environment node
// route.test.ts — /api/cron/anomaly-alert GET handler 測試(M-3 #250)
//
// node env(route 用 node:crypto timingSafeEqual + Buffer + 全域 Request/Response)。
// mock:server-only / @pcm/use-cases(checkAnomalyAlerts)/ @/lib/payment/composition(getAnomalyAlertDeps)。
// 驗:① GET-only 契約 + runtime/maxDuration/dynamic ② 認證(CRON_SECRET 未設/弱→500、Bearer 缺/錯→401)
//     ③ ANOMALY_ALERT_ENABLED gate(預設/false/TRUE/whitespace→200 no-op 不建 deps、嚴格 'true'→跑)
//     ④ enabled+errors=0→200 計數、errors>0→503 不偽 200、deps/factory throw→503 ⑤ options 注入
//     (refundingStuckSeconds=86400)⑥ 零 PII(log counts only)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { checkSpy, getDepsSpy } = vi.hoisted(() => ({
  checkSpy: vi.fn(),
  getDepsSpy: vi.fn(),
}));

vi.mock('@pcm/use-cases', () => ({ checkAnomalyAlerts: checkSpy }));
vi.mock('@/lib/payment/composition', () => ({ getAnomalyAlertDeps: getDepsSpy }));

import * as route from './route';
import { CRON_RATE_MAX_HITS, resetCronRateLimit } from '@/lib/cron/rate-limit';

const { GET } = route;

const SECRET = 'a'.repeat(48); // ≥32

/** 乾淨結果(alerted=false、errors=0;Phase I 無流量常態)。 */
const CLEAN_RESULT = {
  alerted: false,
  openCount: 0,
  refundingCount: 0,
  refundingStuckCount: 0,
  attemptManualReviewCount: 0,
  releasedStuckCount: 0,
  pendingDoubleChargeCandidateCount: 0,
  oldestOpenAgeSeconds: null,
  notifiersTotal: 0,
  notifiersFailed: 0,
  errors: 0,
};

const DEPS = { reader: {}, notifiers: [{}] };

function makeReq(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers['authorization'] = authorization;
  return new Request('http://localhost:3000/api/cron/anomaly-alert', { method: 'GET', headers });
}

const bearer = (s: string = SECRET) => `Bearer ${s}`;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.ANOMALY_ALERT_ENABLED = 'true'; // 多數 run 測試預設 enabled;gate 測試顯式覆蓋
  checkSpy.mockReset().mockResolvedValue({ ...CLEAN_RESULT });
  getDepsSpy.mockReset().mockReturnValue({ ...DEPS });
  resetCronRateLimit(); // #254 限流器 module scope 狀態跨測試存活 → 每測試前全清隔離
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.ANOMALY_ALERT_ENABLED;
  vi.clearAllMocks();
});

describe('GET /api/cron/anomaly-alert — 契約 + route 段設定', () => {
  it('只 export GET、不 export POST(Vercel cron 走 GET)', () => {
    expect(typeof GET).toBe('function');
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });

  it('runtime=nodejs / dynamic=force-dynamic / maxDuration=60', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(60);
  });
});

describe('GET anomaly-alert — 認證(CRON_SECRET Bearer 硬驗)', () => {
  it('無 Authorization → 401、不建 deps、不跑', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(checkSpy).not.toHaveBeenCalled();
    expect(getDepsSpy).not.toHaveBeenCalled();
  });

  it('錯 Bearer → 401', async () => {
    const res = await GET(makeReq(bearer('b'.repeat(48))));
    expect(res.status).toBe(401);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('裸 secret 無 "Bearer " 前綴 → 401', async () => {
    const res = await GET(makeReq(SECRET));
    expect(res.status).toBe(401);
  });

  it('CRON_SECRET 未設 → 500 fail-closed(即使 enabled)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(500);
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it('CRON_SECRET <32 → 500', async () => {
    process.env.CRON_SECRET = 'short';
    const res = await GET(makeReq(bearer('short')));
    expect(res.status).toBe(500);
  });
});

describe('GET anomaly-alert — ANOMALY_ALERT_ENABLED sequencing gate', () => {
  it('未設 → 認證過後 200 no-op、不建 deps、不跑', async () => {
    delete process.env.ANOMALY_ALERT_ENABLED;
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: false, skipped: 'anomaly_alert_disabled' });
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it("='false' → 200 no-op", async () => {
    process.env.ANOMALY_ALERT_ENABLED = 'false';
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false });
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it("='TRUE'(大小寫)→ 200 no-op(只認字面 'true')", async () => {
    process.env.ANOMALY_ALERT_ENABLED = 'TRUE';
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false });
    expect(checkSpy).not.toHaveBeenCalled();
  });

  it("='true' → 跑 checkAnomalyAlerts", async () => {
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(checkSpy).toHaveBeenCalledTimes(1);
  });

  // 鎖嚴格 `!== 'true'` 契約:whitespace/alias/截斷值一律 disabled(防未來誤加 trim/lowercase/寬鬆 parse)。
  it.each([' true', 'true ', ' true ', '1', 'yes', 'True', 'enabled', 'on'])(
    "=%j → 200 no-op(非字面 'true' 一律 disabled)",
    async (val) => {
      process.env.ANOMALY_ALERT_ENABLED = val;
      const res = await GET(makeReq(bearer()));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ enabled: false });
      expect(checkSpy).not.toHaveBeenCalled();
    },
  );
});

describe('GET anomaly-alert — enabled 執行 + 結果映射', () => {
  it('errors=0 → 200 + ok:true + 計數摘要(零 PII counts)', async () => {
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, alerted: true, openCount: 2, notifiersTotal: 2 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: true, alerted: true, openCount: 2, errors: 0 });
  });

  it('🔴 errors>0(管道推播失敗)→ 503 + ok:false、**不偽 200**', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, alerted: true, openCount: 1, notifiersTotal: 2, notifiersFailed: 1, errors: 1 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, enabled: true, errors: 1 });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('"errors":1');
    errSpy.mockRestore();
  });

  it('🔴 getAnomalyAlertDeps throw(env 缺 / 零管道)→ 503 fail-closed、不跑、log 固定 reason code 零洩漏', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDepsSpy.mockImplementation(() => {
      throw new Error('ANOMALY_ALERT_ENABLED=true 但未設定任何告警管道(LINE/Email)');
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(checkSpy).not.toHaveBeenCalled();
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('deps_or_unexpected_throw');
    expect(logged).not.toContain(SECRET);
    errSpy.mockRestore();
  });

  it('🔴 checkAnomalyAlerts throw(reader throw 上拋)→ 503 fail-closed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkSpy.mockRejectedValue(new Error('reader down'));
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    errSpy.mockRestore();
  });
});

describe('GET anomaly-alert — options 注入(不採信外部輸入)', () => {
  it('checkAnomalyAlerts 收 route 端常數 refundingStuckSeconds=86400 + pending 雙扣窗 12h/卡住 10min', async () => {
    await GET(makeReq(bearer()));
    expect(checkSpy).toHaveBeenCalledWith(expect.anything(), {
      refundingStuckSeconds: 86400,
      pendingDoubleChargeWindowSeconds: 43200,
      pendingDoubleChargeStuckSeconds: 600,
    });
  });

  it('deps = getAnomalyAlertDeps() 注入', async () => {
    await GET(makeReq(bearer()));
    expect(getDepsSpy).toHaveBeenCalledTimes(1);
    expect(checkSpy.mock.calls[0]![0]).toMatchObject({ reader: expect.anything(), notifiers: expect.anything() });
  });
});

describe('GET anomaly-alert — 應用層限流(#254 縱深 hardening)', () => {
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

  it('429 在 enabled gate / deps 之前:不建 deps、不跑 checkAnomalyAlerts', async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) await GET(makeReq(bearer()));
    getDepsSpy.mockClear();
    checkSpy.mockClear();
    const limited = await GET(makeReq(bearer()));
    expect(limited.status).toBe(429);
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(checkSpy).not.toHaveBeenCalled();
  });

  // 釘死排序「認證 → 限流 → enabled gate」:disabled 時仍先過限流。若限流被移到 gate 後,disabled 會在限流前
  // 短路成 200 no-op、第 6 次不會是 429 → 本測試會紅(codex/adversarial should-fix、真鎖排序)。
  it('429 在 enabled gate「前」:disabled(未設)時 flood 超限仍回 429', async () => {
    delete process.env.ANOMALY_ALERT_ENABLED;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) {
      expect((await GET(makeReq(bearer()))).status).toBe(200); // disabled no-op、但仍過限流消耗額度
    }
    expect((await GET(makeReq(bearer()))).status).toBe(429); // 限流在 gate 前 → 超限優先於 disabled no-op
    expect(getDepsSpy).not.toHaveBeenCalled();
  });
});
