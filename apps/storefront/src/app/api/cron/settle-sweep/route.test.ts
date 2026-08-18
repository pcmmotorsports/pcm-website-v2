// @vitest-environment node
// route.test.ts — /api/cron/settle-sweep GET handler 測試(M-3 3DS-4c)
//
// node env(route 用 node:crypto timingSafeEqual + Buffer + 全域 Request/Response)。
// mock:server-only / @pcm/use-cases(sweepSettlements)/ @/lib/payment/composition(getSettleChargeDeps + getWebhookInbox)。
// 驗:① GET-only 契約 + runtime/maxDuration/dynamic 段設定 ② 認證(CRON_SECRET 未設/弱→500、Bearer 缺/錯→401、
//     正確 Bearer→過)③ CRON_SWEEPER_ENABLED gate(預設/false→200 no-op 不建 deps、'true'→跑)④ enabled+errors=0
//     →200 計數、errors>0→503 不偽 200、deps/factory throw→503 ⑤ options/deps 注入(50/50/600/1 + inbox 併入)
//     ⑥ 零 PII(log counts only、無 client 參數路徑)。gate 涵蓋 預設/false/TRUE/whitespace/alias→200 no-op、
//     嚴格只認字面 'true'→跑(N1 參數化鎖契約)。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { sweepSpy, getDepsSpy, getInboxSpy, reconfirmSpy } = vi.hoisted(() => ({
  sweepSpy: vi.fn(),
  getDepsSpy: vi.fn(),
  getInboxSpy: vi.fn(),
  reconfirmSpy: vi.fn(),
}));

vi.mock('@pcm/use-cases', () => ({ sweepSettlements: sweepSpy, reconfirmExpiredOrphans: reconfirmSpy }));
vi.mock('@/lib/payment/composition', () => ({
  getSettleChargeDeps: getDepsSpy,
  getWebhookInbox: getInboxSpy,
}));

import * as route from './route';
import { CRON_RATE_MAX_HITS, resetCronRateLimit } from '@/lib/cron/rate-limit';

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

const CLEAN_RECONFIRM = { claimed: 0, settled: 0, noAttempt: 0, pending: 0, errors: 0 };

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
  reconfirmSpy.mockReset().mockResolvedValue({ ...CLEAN_RECONFIRM });
  resetCronRateLimit(); // #254 限流器 module scope 狀態跨測試存活 → 每測試前全清隔離
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

  // N1(審查側 4c sign-off):鎖嚴格 `!== 'true'` 契約——whitespace/alias/截斷值一律 disabled,
  // 防未來誤加 .trim() / .toLowerCase() / 寬鬆 parse 把 ' true' / '1' / 'yes' 當啟用而靜默開啟 sweeper。
  it.each([' true', 'true ', ' true ', '1', 'yes', 'True', 'enabled', 'on'])(
    "=%j → 200 no-op(非字面 'true' 一律 disabled、不 trim/不 lowercase/不寬鬆 parse)",
    async (val) => {
      process.env.CRON_SWEEPER_ENABLED = val;
      const res = await GET(makeReq(bearer()));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ enabled: false });
      expect(sweepSpy).not.toHaveBeenCalled();
    },
  );
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

describe('GET settle-sweep — 應用層限流(#254 縱深 hardening)', () => {
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

  it('429 在 enabled gate / deps 之前:不建 deps、不跑 sweepSettlements', async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) await GET(makeReq(bearer()));
    getDepsSpy.mockClear();
    getInboxSpy.mockClear();
    sweepSpy.mockClear();
    const limited = await GET(makeReq(bearer()));
    expect(limited.status).toBe(429);
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(getInboxSpy).not.toHaveBeenCalled();
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  // 釘死排序「認證 → 限流 → enabled gate」:disabled 時仍先過限流。若限流被移到 gate 後,disabled 會在限流前
  // 短路成 200 no-op、第 6 次不會是 429 → 本測試會紅(codex/adversarial should-fix、真鎖排序)。
  it('429 在 enabled gate「前」:disabled(未設)時 flood 超限仍回 429', async () => {
    delete process.env.CRON_SWEEPER_ENABLED;
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) {
      expect((await GET(makeReq(bearer()))).status).toBe(200); // disabled no-op、但仍過限流消耗額度
    }
    expect((await GET(makeReq(bearer()))).status).toBe(429); // 限流在 gate 前 → 超限優先於 disabled no-op
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(getInboxSpy).not.toHaveBeenCalled();
  });
});

describe('GET settle-sweep — M-4a 人工佇列重查(reconfirmExpiredOrphans)加掛', () => {
  it('預算夠 → 跑重查,且收 route 端常數(limit 5 / concurrency 1)', async () => {
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(reconfirmSpy).toHaveBeenCalledTimes(1);
    // deps 沿用同一份(不重建、不多開連線)
    expect(reconfirmSpy.mock.calls[0]![0]).toMatchObject(DEPS);
    expect(reconfirmSpy.mock.calls[0]![1]).toEqual({ limit: 5, concurrency: 1 });
  });

  it('🔴 回應體【只加鍵不改鍵】:reconfirm 巢狀,不覆蓋 sweep 的同名鍵(errors / pending)', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, inboxClaimed: 7 });
    reconfirmSpy.mockResolvedValue({ ...CLEAN_RECONFIRM, claimed: 3, pending: 2 });
    const body = await (await GET(makeReq(bearer()))).json();
    expect(body).toMatchObject({ ok: true, enabled: true, inboxClaimed: 7, errors: 0 });
    expect(body.reconfirm).toMatchObject({ claimed: 3, pending: 2, errors: 0, skipped: null });
    // 🔴 sweep 的 errors 沒有被 reconfirm 的同名鍵覆蓋(展開就會靜默覆蓋 = 這格的存在理由)
    expect(body.pending).toBeUndefined();
  });

  it('🔴 重查 errors>0 → 503(與 sweep errors 同等待遇,不吞成 200)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reconfirmSpy.mockResolvedValue({ ...CLEAN_RECONFIRM, errors: 2 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, reconfirm: { errors: 2 } });
    errSpy.mockRestore();
  });

  it('🔴 預算不夠 → 跳過重查,而【誠實回報 skipped】不靜默(靜默跳過與「本來就沒東西」分不出來)', async () => {
    // 主 sweep 慢到吃掉預算:Date.now 前後差 > maxDuration*1000 - RECONFIRM_MIN_BUDGET_MS
    const realNow = Date.now;
    let t = realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => t);
    sweepSpy.mockImplementation(async () => {
      t += 55_000; // 55s 已花掉 ⇒ 剩 5s < 12s 門檻
      return { ...CLEAN_RESULT };
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(reconfirmSpy).not.toHaveBeenCalled(); // 🔴 沒跑
    expect((await res.json()).reconfirm).toMatchObject({ skipped: 'budget', claimed: 0, errors: 0 });
    vi.mocked(Date.now).mockRestore();
    expect(Date.now).toBe(realNow);
  });

  it('負向對照:同一把時鐘、只把耗時改小 → 重查【必須】有跑(證明上一格的紅是預算造成的)', async () => {
    let t = Date.now();
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => t);
    sweepSpy.mockImplementation(async () => {
      t += 1_000; // 只花 1s ⇒ 剩 59s > 12s
      return { ...CLEAN_RESULT };
    });
    const res = await GET(makeReq(bearer()));
    expect(reconfirmSpy).toHaveBeenCalledTimes(1);
    // 🔴「有跑」與「回應照實說有跑」是兩件事(fable nit)⇒ 兩個都要驗
    expect((await res.json()).reconfirm.skipped).toBeNull();
    spy.mockRestore();
  });
});

describe('GET settle-sweep — 🔴 重查的三道閘(fable 關卡2 must-fix)', () => {
  it('🔴 reconfirm 自己 hang 住 → 硬砍回 skipped:timeout,而【sweep 的 counts 照常送出去】', async () => {
    // 這一格排除的世界:閘只在起跑前看時鐘 ⇒ reconfirm 自己吃穿 ⇒ 整個函式被平台砍 ⇒ 回應全沒了。
    // 🔴 mock 世界裡 reconfirm 恆為即回 promise,所以【耗時這個維度】必須自己造出來。
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, inboxClaimed: 9 });
    reconfirmSpy.mockImplementation(() => new Promise(() => {})); // 永不 resolve = Record API 黑洞
    vi.useFakeTimers();
    const p = GET(makeReq(bearer()));
    await vi.advanceTimersByTimeAsync(60_000);
    const res = await p;
    vi.useRealTimers();
    expect(res.status).toBe(200);
    const body = await res.json();
    // 🔴 timeout 回的是【沒有計數】不是【計數為零】(GR R2 N1):
    //    race 的輸家取消不掉 ⇒ claim 已發生、throttle 已蓋 ⇒ 送 0 是一句關於世界的假話
    expect(body.reconfirm).toEqual({ skipped: 'timeout' });
    expect(body.reconfirm.claimed).toBeUndefined(); // **不知道** 與 **零** 在下游是兩件事
    expect(body.inboxClaimed).toBe(9); // 🔴 sweep 的數字沒有跟著消失 —— 這才是這道閘買到的東西
  });

  it('🔴 sweep 本輪有錯 → 不跑重查(不健康的一輪不該對人工列蓋 6h throttle)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, errors: 1 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(reconfirmSpy).not.toHaveBeenCalled();
    expect((await res.json()).reconfirm).toMatchObject({ skipped: 'sweep_errors' });
    errSpy.mockRestore();
  });

  it('🔴 503 的 log 指名【是哪一側壞的】—— 頂層 errors 是 sweep 的,人眼會先看錯地方', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    reconfirmSpy.mockResolvedValue({ ...CLEAN_RECONFIRM, errors: 4 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    // 🔴 這一格釘的是【現況會誤導人】,不是【頂層 errors 應該永遠是 0】(GR R2 N2)。
    expect((await res.json()).errors, 
      '🔴 這個紅【可能是進步】:若有人把頂層 errors 改成涵蓋 reconfirm,請【改本格】不要改回行為。'
    ).toBe(0);
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('"failedSide":"reconfirm"'); // ⇒ 所以 log 要講清楚
    errSpy.mockRestore();
  });
});
