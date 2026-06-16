// @vitest-environment node
// route.test.ts — /api/cron/settle-sweep GET handler 測試(M-3 3DS-4c)
//
// node env(route 用 node:crypto timingSafeEqual + Buffer + 全域 Request/Response)。
// mock:server-only / @pcm/use-cases(sweepSettlements)/ @/lib/payment/composition(getSettleChargeDeps + getWebhookInbox)。
// 驗:① GET-only 契約 + runtime/maxDuration/dynamic 段設定 ② 認證(CRON_SECRET 未設/弱→500、Bearer 缺/錯→401、
//     正確 Bearer→過)③ CRON_SWEEPER_ENABLED gate(預設/false→200 no-op 不建 deps、'true'→跑)④ enabled+errors=0
//     →200 計數、errors>0→503 不偽 200、deps/factory throw→503 ⑤ options/deps 注入(50/50/600/1 + inbox 併入)
//     ⑥ 零 PII(log counts only、無 client 參數路徑)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { sweepSpy, getDepsSpy, getInboxSpy } = vi.hoisted(() => ({
  sweepSpy: vi.fn(),
  getDepsSpy: vi.fn(),
  getInboxSpy: vi.fn(),
}));

vi.mock('@pcm/use-cases', () => ({ sweepSettlements: sweepSpy }));
vi.mock('@/lib/payment/composition', () => ({
  getSettleChargeDeps: getDepsSpy,
  getWebhookInbox: getInboxSpy,
}));

import * as route from './route';

const { GET } = route;

const SECRET = 'a'.repeat(48); // ≥32

/** 乾淨結果(errors=0、零待處理;Phase I 無流量的常態)。 */
const CLEAN_RESULT = {
  inboxClaimed: 0,
  inboxProcessed: 0,
  inboxRetried: 0,
  stuckClaimed: 0,
  stuckSettled: 0,
  stuckRetried: 0,
  deduped: 0,
  expiredInboxAtCeiling: 0,
  expiredStuckAtCeiling: 0,
  flaggedNonUnpaid: 0,
  staleMarks: 0,
  errors: 0,
};

const DEPS = { tappay: {}, attempts: {}, confirmer: {} };
const INBOX = { __inbox: true };

function makeReq(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers['authorization'] = authorization;
  return new Request('http://localhost:3000/api/cron/settle-sweep', { method: 'GET', headers });
}

const bearer = (s: string = SECRET) => `Bearer ${s}`;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  process.env.CRON_SWEEPER_ENABLED = 'true'; // 多數 run 測試預設 enabled;gate 測試顯式覆蓋
  sweepSpy.mockReset().mockResolvedValue({ ...CLEAN_RESULT });
  getDepsSpy.mockReset().mockReturnValue({ ...DEPS });
  getInboxSpy.mockReset().mockReturnValue(INBOX);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.CRON_SWEEPER_ENABLED;
  vi.clearAllMocks();
});

describe('GET /api/cron/settle-sweep — 契約 + route 段設定', () => {
  it('只 export GET、不 export POST(Vercel cron 走 GET、寫 POST=永不觸發)', () => {
    expect(typeof GET).toBe('function');
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });

  it('runtime=nodejs / dynamic=force-dynamic / maxDuration=60(plan §5.3 / Q3=A)', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(60);
  });
});

describe('GET settle-sweep — 認證(CRON_SECRET Bearer 硬驗)', () => {
  it('無 Authorization header → 401、不跑 sweeper、不建 deps', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(sweepSpy).not.toHaveBeenCalled();
    expect(getDepsSpy).not.toHaveBeenCalled();
  });

  it('錯 Bearer secret → 401、不跑 sweeper', async () => {
    const res = await GET(makeReq(bearer('b'.repeat(48))));
    expect(res.status).toBe(401);
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it('Authorization 無 "Bearer " 前綴(裸 secret)→ 401(presented="" → 不符)', async () => {
    const res = await GET(makeReq(SECRET));
    expect(res.status).toBe(401);
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it('CRON_SECRET 未設 → 500 fail-closed(拒不執行、非放行),即使 enabled', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(500);
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it('CRON_SECRET <32 → 500(強度不足)', async () => {
    process.env.CRON_SECRET = 'short';
    const res = await GET(makeReq(bearer('short')));
    expect(res.status).toBe(500);
    expect(sweepSpy).not.toHaveBeenCalled();
  });
});

describe('GET settle-sweep — CRON_SWEEPER_ENABLED sequencing gate', () => {
  it('未設 → 認證過後 200 no-op、不建 deps、不跑 sweeper(4a 未進 prod 安全態)', async () => {
    delete process.env.CRON_SWEEPER_ENABLED;
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: false, skipped: 'sweeper_disabled' });
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(getInboxSpy).not.toHaveBeenCalled();
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it("='false' → 200 no-op(嚴格 opt-in、非 'true' 一律 disabled)", async () => {
    process.env.CRON_SWEEPER_ENABLED = 'false';
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false });
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it("='TRUE'(大小寫)→ 200 no-op(只認字面 'true')", async () => {
    process.env.CRON_SWEEPER_ENABLED = 'TRUE';
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false });
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it("='true' → 跑 sweepSettlements", async () => {
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(sweepSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GET settle-sweep — enabled 執行 + 結果映射', () => {
  it('errors=0 → 200 + ok:true + 計數摘要(零 PII counts)', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, inboxClaimed: 2, inboxProcessed: 2 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      enabled: true,
      inboxClaimed: 2,
      inboxProcessed: 2,
      errors: 0,
    });
  });

  it('🔴 errors>0(RPC missing / DB error)→ 503 + ok:false、**不偽 200 偽裝成功**', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, errors: 3 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503); // 不是 200
    expect(await res.json()).toMatchObject({ ok: false, enabled: true, errors: 3 });
    // 結構化 error log = counts only(零 PII;route 本就無 order/rec 等可洩欄)
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('"errors":3');
    errSpy.mockRestore();
  });

  it('🔴 getSettleChargeDeps throw(env 缺)→ 503 fail-closed、不跑 sweeper、log 固定 reason code 零洩漏面', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDepsSpy.mockImplementation(() => {
      throw new Error('缺少必要環境變數:PAYMENT_CONFIRMER_DB_URL');
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(sweepSpy).not.toHaveBeenCalled();
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('deps_or_unexpected_throw'); // 固定 reason code(非 raw err.message)
    expect(logged).not.toContain(SECRET); // 不洩 CRON_SECRET
    expect(logged).not.toContain('PAYMENT_CONFIRMER_DB_URL'); // 連 env 名都不入 log(零洩漏面、縱深、codex K2 consider)
    errSpy.mockRestore();
  });

  it('🔴 sweepSettlements throw(非預期)→ 503 fail-closed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockRejectedValue(new Error('unexpected'));
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    errSpy.mockRestore();
  });
});

describe('GET settle-sweep — options/deps 注入(不採信外部輸入)', () => {
  it('sweepSettlements 收 route 端常數 options(inbox 50 / stuck 50 / age 600 / concurrency 1)', async () => {
    await GET(makeReq(bearer()));
    expect(sweepSpy).toHaveBeenCalledWith(expect.anything(), {
      inboxLimit: 50,
      stuckLimit: 50,
      stuckAgeSeconds: 600,
      concurrency: 1,
    });
  });

  it('deps = getSettleChargeDeps() 併入 getWebhookInbox()(tappay/attempts/confirmer + inbox)', async () => {
    await GET(makeReq(bearer()));
    expect(getDepsSpy).toHaveBeenCalledTimes(1);
    expect(getInboxSpy).toHaveBeenCalledTimes(1);
    const depsArg = sweepSpy.mock.calls[0]![0];
    expect(depsArg).toMatchObject({
      tappay: expect.anything(),
      attempts: expect.anything(),
      confirmer: expect.anything(),
      inbox: INBOX,
    });
  });
});
