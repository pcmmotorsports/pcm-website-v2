// @vitest-environment node
// route.test.ts — /api/cron/email-sweep GET handler 測試(M-4a Email 片 E2a-c)
//
// node env(route 用 node:crypto timingSafeEqual + Buffer + 全域 Request/Response)。
// mock:server-only / @pcm/use-cases(sweepEmailOutbox)/ @/lib/email/composition(getSweepEmailOutboxDeps)。
// 驗:① GET-only 契約 + runtime/dynamic/maxDuration 段設定 ② 認證(CRON_SECRET 未設/弱→500、Bearer 缺/錯→401、
//     正確 Bearer→過)③ 認證過+errors=0→200 計數、errors>0→503 不偽 200、🔴 deferred>0→仍 200(非錯誤)、
//     deps/sweep throw→503 ④ 🔴 maxRunSeconds === route.maxDuration + source-contract(引用 maxDuration 非寫死 60)
//     + options 注入(50/60/3600)⑤ 🔴 counts allowlist(PII sentinel 不進 200/503/log;不 blind spread ...result)
//     ⑥ 應用層限流(認證後 5 次放行、超限 429、排序 認證→限流→deps)⑦ 零 PII ⑧ 🔴 零告警(deps 僅 outbox+sender)
//     ⑨ 🔴 source-contract:認證用 node:crypto timingSafeEqual(非一般字串比較)。
//
// ⚠️ mock 邊界誠實揭示:本檔 mock 掉 @/lib/email/composition → 只驗 route 對 sweep/deps 的**接線**;composition
//    本身的 lazy / 零告警 / adapter 正確性由 `../../../../lib/email/composition.test.ts`(載入真 factory、只 mock
//    adapter 建構子)覆蓋(codex 關卡2 must-fix:route mock 無法證 composition 退化)。

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { sweepSpy, getDepsSpy, enqueueSpy, getEnqueueDepsSpy } = vi.hoisted(() => ({
  sweepSpy: vi.fn(),
  getDepsSpy: vi.fn(),
  // 🔴 B-5:enqueue 那半有**自己的** use-case 與**自己的** deps factory(plan §3.1)。
  enqueueSpy: vi.fn(),
  getEnqueueDepsSpy: vi.fn(),
}));

vi.mock('@pcm/use-cases', () => ({
  sweepEmailOutbox: sweepSpy,
  enqueueOrderCreatedEmails: enqueueSpy,
}));
vi.mock('@/lib/email/composition', () => ({
  getSweepEmailOutboxDeps: getDepsSpy,
  getEnqueueOrderCreatedDeps: getEnqueueDepsSpy,
}));

import * as route from './route';
import { CRON_RATE_MAX_HITS, resetCronRateLimit } from '@/lib/cron/rate-limit';

const { GET } = route;

const SECRET = 'a'.repeat(48); // ≥32

/** 乾淨結果(errors=0、零待處理;Phase I 無流量的常態;鏡像 SweepEmailOutboxResult 全 7 欄)。 */
const CLEAN_RESULT = {
  reclaimed: 0,
  claimed: 0,
  sent: 0,
  failed: 0,
  deferred: 0,
  staleMarks: 0,
  errors: 0,
};

const DEPS = { outbox: {}, sender: {} };

/** route.ts 原始碼(source-contract 斷言用:鎖住無法由「結果相等」測到的實作契約)。 */
const ROUTE_SOURCE = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

function makeReq(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers['authorization'] = authorization;
  return new Request('http://localhost:3000/api/cron/email-sweep', { method: 'GET', headers });
}

const bearer = (s: string = SECRET) => `Bearer ${s}`;

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  sweepSpy.mockReset().mockResolvedValue({ ...CLEAN_RESULT });
  getDepsSpy.mockReset().mockReturnValue({ ...DEPS });
  resetCronRateLimit(); // #254 限流器 module scope 狀態跨測試存活 → 每測試前全清隔離
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe('GET /api/cron/email-sweep — 契約 + route 段設定', () => {
  it('只 export GET、不 export POST(pg_net 走 GET、寫 POST=永不觸發)', () => {
    expect(typeof GET).toBe('function');
    expect((route as Record<string, unknown>).POST).toBeUndefined();
  });

  it('runtime=nodejs / dynamic=force-dynamic / maxDuration=60', () => {
    expect(route.runtime).toBe('nodejs');
    expect(route.dynamic).toBe('force-dynamic');
    expect(route.maxDuration).toBe(60);
  });
});

describe('GET email-sweep — 認證(CRON_SECRET Bearer 硬驗)', () => {
  it('無 Authorization header → 401、不跑 sweeper、不建 deps', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    expect(sweepSpy).not.toHaveBeenCalled();
    expect(getDepsSpy).not.toHaveBeenCalled();
  });

  it('錯 Bearer secret(等長)→ 401、不跑 sweeper', async () => {
    const res = await GET(makeReq(bearer('b'.repeat(48))));
    expect(res.status).toBe(401);
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it('錯 Bearer secret(不等長)→ 401(safeEqual 長度守衛先擋)', async () => {
    const res = await GET(makeReq(bearer('b'.repeat(10))));
    expect(res.status).toBe(401);
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it('Authorization 無 "Bearer " 前綴(裸 secret)→ 401(presented="" → 不符)', async () => {
    const res = await GET(makeReq(SECRET));
    expect(res.status).toBe(401);
    expect(sweepSpy).not.toHaveBeenCalled();
  });

  it('CRON_SECRET 未設 → 500 fail-closed(拒不執行、非放行)', async () => {
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

  // 🔴 source-contract(codex 關卡2 must-fix):認證只驗結果 → 把 timingSafeEqual 改成一般 `===` 全部案例仍綠。
  // 鎖住實作確實用 node:crypto timingSafeEqual constant-time 比對(等長守衛 + timingSafeEqual = 沿 settle-sweep)。
  it("🔴 source-contract:safeEqual 用 node:crypto timingSafeEqual(非一般字串比較)", () => {
    expect(ROUTE_SOURCE).toMatch(/import\s*\{\s*timingSafeEqual\s*\}\s*from\s*'node:crypto'/);
    // ① safeEqual 函式體必須呼叫 timingSafeEqual(擋「safeEqual 內改成 a === b」的突變)。
    //    regex 限定在 safeEqual 區塊內(到函式結尾 `}`)、不跨到別的函式(codex 關卡2 R2)。
    expect(ROUTE_SOURCE).toMatch(/function\s+safeEqual\([^)]*\)[^{]*\{[\s\S]*?return\s+timingSafeEqual\([\s\S]*?\n\}/);
    // ② 🔴 GET 認證分支必須實際**呼叫** safeEqual(presented, expected)(codex 關卡2 R2 must-fix:僅驗
    //    safeEqual 內部正確不夠——把 GET 改成 `presented !== expected`、safeEqual 留著不用,①仍綠 = 假綠)。
    expect(ROUTE_SOURCE).toMatch(/if\s*\(\s*!safeEqual\(presented,\s*expected\)\s*\)/);
  });
});

describe('GET email-sweep — 執行 + 結果映射', () => {
  it('errors=0 → 200 + ok:true + 計數摘要(零 PII counts)', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, claimed: 2, sent: 2 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, claimed: 2, sent: 2, errors: 0 });
  });

  it('🔴 errors>0(寄送/段級失敗)→ 503 + ok:false、**不偽 200 偽裝成功**', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, failed: 1, errors: 3 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503); // 不是 200
    expect(await res.json()).toMatchObject({ ok: false, errors: 3 });
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('"errors":3');
    errSpy.mockRestore();
  });

  // 🔴 E2a-c 特有:deferred = 時間預算耗盡的調參訊號(claimLimit 相對 maxRunSeconds 太大)、非錯誤 → 仍 200。
  it('🔴 deferred>0 但 errors=0 → 仍 200(deferred 是調參訊號、非錯誤,不 503)', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, claimed: 50, sent: 40, deferred: 10, errors: 0 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, deferred: 10, errors: 0 });
  });

  it('🔴 getSweepEmailOutboxDeps throw(env 缺)→ 503 fail-closed、不跑 sweeper、log 固定 reason code 零洩漏面', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDepsSpy.mockImplementation(() => {
      throw new Error('缺少必要環境變數:ORDER_EMAIL_FROM');
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(sweepSpy).not.toHaveBeenCalled();
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain('deps_or_unexpected_throw'); // 固定 reason code(非 raw err.message)
    expect(logged).not.toContain(SECRET); // 不洩 CRON_SECRET
    expect(logged).not.toContain('ORDER_EMAIL_FROM'); // 連 env 名都不入 log(零洩漏面、縱深)
    errSpy.mockRestore();
  });

  it('🔴 sweepEmailOutbox throw(非預期 / lease 下界違反)→ 503 fail-closed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockRejectedValue(new Error('unexpected'));
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    errSpy.mockRestore();
  });
});

describe('GET email-sweep — 🔴 counts allowlist(不 blind spread ...result、PII 物理擋)', () => {
  // codex 關卡2 must-fix:若 use-case 日後誤增 recipient_email 等診斷/PII 欄,route 顯式挑 7 欄 → 不會洩進回應/log。
  it('sweep result 混入 PII sentinel 欄 → 200 回應**不含**該欄(只 7 counts)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockResolvedValue({
      ...CLEAN_RESULT,
      claimed: 1,
      sent: 1,
      recipient_email: 'leak@example.com', // 上游若誤增的 PII 欄(sentinel)
      last_error_message: 'PII leak text',
    });
    const res = await GET(makeReq(bearer()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty('recipient_email');
    expect(body).not.toHaveProperty('last_error_message');
    expect(JSON.stringify(body)).not.toContain('leak@example.com');
    // 🔴 B-5:`enqueueStatus` 是**刻意**多出來的一欄(四態互斥)——
    //    env 沒設 ⇒ `skipped_no_cutoff`。「跳過了」「格式錯」「跑完了」「爆掉了」必須分得開。
    expect(Object.keys(body).sort()).toEqual(
      [
        'claimed', 'deferred', 'enqueueStatus', 'errors', 'failed',
        'ok', 'reclaimed', 'sent', 'staleMarks',
      ].sort(),
    );
    errSpy.mockRestore();
  });

  it('sweep result 混入 PII sentinel 欄 → 503 回應 + error log 皆**不含**該欄', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockResolvedValue({
      ...CLEAN_RESULT,
      errors: 2,
      recipient_email: 'leak@example.com',
    });
    const res = await GET(makeReq(bearer()));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).not.toHaveProperty('recipient_email');
    expect(JSON.stringify(body)).not.toContain('leak@example.com');
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('leak@example.com');
    errSpy.mockRestore();
  });
});

describe('GET email-sweep — options/deps 注入(不採信外部輸入)', () => {
  it('🔴 maxRunSeconds === route.maxDuration(runtime:同值)', async () => {
    await GET(makeReq(bearer()));
    const optsArg = sweepSpy.mock.calls[0]![1];
    expect(optsArg.maxRunSeconds).toBe(route.maxDuration);
  });

  // 🔴 source-contract(codex 關卡2 must-fix):runtime `=== route.maxDuration` 是假綠——把 route 改成
  // `maxRunSeconds: 60` 寫死(仍 ===60)本測試照樣綠。鎖住 sweep 呼叫用 `maxRunSeconds: maxDuration` **引用式**、
  // 且**無**第二個寫死數字(maxDuration 日後改 → 只改一處,不會漂移出寫死的 60)。
  it("🔴 source-contract:sweep 呼叫用 `maxRunSeconds: maxDuration` 引用、非寫死數字", () => {
    expect(ROUTE_SOURCE).toMatch(/maxRunSeconds:\s*maxDuration\b/);
    expect(ROUTE_SOURCE).not.toMatch(/maxRunSeconds:\s*\d/); // 無 `maxRunSeconds: 60` 之類的寫死第二字面
  });

  it('sweepEmailOutbox 收 route 端常數 options(claimLimit 50 / maxRunSeconds 60 / leaseSeconds 3600)', async () => {
    await GET(makeReq(bearer()));
    expect(sweepSpy).toHaveBeenCalledWith(expect.anything(), {
      claimLimit: 50,
      maxRunSeconds: 60,
      leaseSeconds: 3600,
    });
  });

  it('deps = getSweepEmailOutboxDeps()(outbox + sender)', async () => {
    await GET(makeReq(bearer()));
    expect(getDepsSpy).toHaveBeenCalledTimes(1);
    const depsArg = sweepSpy.mock.calls[0]![0];
    expect(depsArg).toMatchObject({ outbox: expect.anything(), sender: expect.anything() });
  });
});

describe('GET email-sweep — 應用層限流(#254 縱深 hardening)', () => {
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

  it('429 在建 deps「前」:超限不建 deps、不跑 sweepEmailOutbox', async () => {
    for (let i = 0; i < CRON_RATE_MAX_HITS; i++) await GET(makeReq(bearer()));
    getDepsSpy.mockClear();
    sweepSpy.mockClear();
    const limited = await GET(makeReq(bearer()));
    expect(limited.status).toBe(429);
    expect(getDepsSpy).not.toHaveBeenCalled();
    expect(sweepSpy).not.toHaveBeenCalled();
  });
});

// ── 🔴 M-4a B-5:掃描式 enqueue 的接線(plan §6 #7/#8 + R3 must-fix 3 的真跑路徑)──
describe('GET email-sweep — 🔴 B-5 enqueue 接線', () => {
  const CUTOFF = '2026-08-19T03:14:00.000Z';
  const ENQ_CLEAN = {
    scanned: 0, scannedPages: 1, truncated: false,
    enqueued: 0, skippedNoRealEmail: 0, duplicate: 0, noRecipient: 0, errors: 0,
  };

  beforeEach(() => {
    // deps factory 是 mock ⇒ 預設回一個物件,否則 `expect.anything()` 對 undefined 會失敗。
    getEnqueueDepsSpy.mockReturnValue({ outbox: {}, scanner: {} });
  });

  afterEach(() => {
    delete process.env.B4_DEPLOY_CUTOFF;
  });

  it('env 沒設 ⇒ 整段 enqueue **不跑**,回應 `enqueueStatus: skipped_no_cutoff`', async () => {
    sweepSpy.mockResolvedValue(CLEAN_RESULT);
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(getEnqueueDepsSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(body.enqueueStatus).toBe('skipped_no_cutoff');
  });

  it('🔴 env 格式不合 ⇒ 不跑、**回 503**、狀態是 skipped_bad_cutoff,且 log 不印那個值', async () => {
    // 填錯而沒有人發現,正是本片要防的那種安靜壞掉 ⇒ 它必須吵。
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.B4_DEPLOY_CUTOFF = '2026-08-19 03:14'; // 不是 ISO UTC
    sweepSpy.mockResolvedValue(CLEAN_RESULT);
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(body.enqueueStatus).toBe('skipped_bad_cutoff');
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('2026-08-19 03:14');
    errSpy.mockRestore();
  });

  it('🔴 R5 must-fix:env 設了但值是【空字串】⇒ skipped_bad_cutoff(不是 no_cutoff)', async () => {
    // 原本寫 `!raw` ⇒ 空字串被判成「沒設」⇒ 回 200 ⇒ **設定貼錯而整件事安靜地沒發生**。
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.B4_DEPLOY_CUTOFF = '';
    sweepSpy.mockResolvedValue(CLEAN_RESULT);
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(body.enqueueStatus).toBe('skipped_bad_cutoff');
    errSpy.mockRestore();
  });

  it.each([
    ['形狀就不對', '2026-08-19 03:14'],
    ['🔴 R4-MF3 形狀對但【日期不存在】', '2026-13-40T25:61:61Z'],
    ['🔴 R4-MF3 形狀對但會被正規化成別天', '2026-02-30T00:00:00Z'],
  ])('cutoff %s ⇒ skipped_bad_cutoff(不得一路送進 DB 才失敗)', async (_label, bad) => {
    // 送進 DB 才失敗的話,回的是 `failed` + `stage=orders` + DB code
    // ⇒ **接手的人會往權限 / schema / 網路查,而不是去看 env** —— 我們設計的分流當場失效。
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.B4_DEPLOY_CUTOFF = bad;
    sweepSpy.mockResolvedValue(CLEAN_RESULT);
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(body.enqueueStatus).toBe('skipped_bad_cutoff');
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(bad); // 不印那個值
    errSpy.mockRestore();
  });

  it.each(['2026-08-19T03:14:00.000Z', '2026-08-19T03:14:00Z'])(
    '合法 cutoff %s(帶不帶毫秒都算合法)⇒ 真的跑',
    async (good) => {
      // 🔴 負對照:上面那組全被擋掉,這一組必須過 —— 不然「擋得很嚴」與「全部擋掉」長得一樣。
      process.env.B4_DEPLOY_CUTOFF = good;
      enqueueSpy.mockResolvedValue(ENQ_CLEAN);
      sweepSpy.mockResolvedValue(CLEAN_RESULT);
      const res = await GET(makeReq(bearer()));
      const body = await res.json();

      expect(enqueueSpy).toHaveBeenCalledWith(expect.anything(), { cutoff: good, limit: 50 });
      expect(body.enqueueStatus).toBe('completed');
      expect(res.status).toBe(200);
    },
  );

  it('🔴 R4-MF1:兩個 limit 的調參建議不得寫成「同步就好」(source-contract)', () => {
    // 接手者照舊註解「順手同步」CLAIM_LIMIT 與 ENQUEUE_LIMIT ⇒ 被濫用時放大面一起變大,而測試全綠。
    expect(ROUTE_SOURCE).not.toContain('兩者不同步沒有意義');
    expect(ROUTE_SOURCE).toContain('不要因為調了 `CLAIM_LIMIT` 就「順手同步」');
  });

  it('🔴🔴 R3-MF3 啟用路徑真的跑:cutoff 有值 ⇒ enqueue 被 await、結果進 body、狀態 completed', async () => {
    // 原本這條路一格 runtime test 都跑不到 ⇒ 兩發真行為突變會存活:
    //   ①`void enqueueOrderCreatedEmails(...)`(不 await)②不把結果指定給 enqueueCounts。
    process.env.B4_DEPLOY_CUTOFF = CUTOFF;
    enqueueSpy.mockResolvedValue({ ...ENQ_CLEAN, scanned: 3, enqueued: 2, duplicate: 1 });
    sweepSpy.mockResolvedValue(CLEAN_RESULT);
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(enqueueSpy).toHaveBeenCalledWith(expect.anything(), { cutoff: CUTOFF, limit: 50 });
    expect(res.status).toBe(200);
    expect(body.enqueueStatus).toBe('completed');
    expect(body.enqScanned).toBe(3);
    expect(body.enqEnqueued).toBe(2);
    expect(body.enqDuplicate).toBe(1);
  });

  it('🔴 R3-MF3:enqueue 必須【resolve 之後】sweeper 才開始(不是只有原始碼順序)', async () => {
    // source-contract 證得了「寫在前面」,證不了「有 await」。這格用呼叫時序證。
    process.env.B4_DEPLOY_CUTOFF = CUTOFF;
    const order: string[] = [];
    enqueueSpy.mockImplementation(async () => {
      order.push('enqueue:start');
      await new Promise((r) => setTimeout(r, 5));
      order.push('enqueue:done');
      return ENQ_CLEAN;
    });
    sweepSpy.mockImplementation(async () => {
      order.push('sweep:start');
      return CLEAN_RESULT;
    });
    await GET(makeReq(bearer()));

    expect(order).toEqual(['enqueue:start', 'enqueue:done', 'sweep:start']);
  });

  it('🔴 enqueue 整段 throw ⇒ 狀態 failed(**不是** skipped)、回 503、sweeper 照樣跑完', async () => {
    // 這是 R3 must-fix 2 的核心:兩種完全不同的世界原本共用同一個訊號。
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.B4_DEPLOY_CUTOFF = CUTOFF;
    enqueueSpy.mockRejectedValue(Object.assign(new Error('boom'), { stage: 'orders', code: 'PGRST500' }));
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, sent: 1 });
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(sweepSpy).toHaveBeenCalled(); // 🔴 掃描壞掉不得阻止已排好的信寄出去
    expect(res.status).toBe(503);
    expect(body.enqueueStatus).toBe('failed');
    expect(body.sent).toBe(1);
    expect(JSON.stringify(errSpy.mock.calls)).toContain('enqueue_scan_throw');
    errSpy.mockRestore();
  });

  it('🔴 單筆 enqueue 有 errors ⇒ 一樣 503(不吞成 200)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.B4_DEPLOY_CUTOFF = CUTOFF;
    enqueueSpy.mockResolvedValue({ ...ENQ_CLEAN, scanned: 2, enqueued: 1, errors: 1 });
    sweepSpy.mockResolvedValue(CLEAN_RESULT);
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.enqueueStatus).toBe('completed'); // 整段沒爆,只是有單筆失敗 —— 兩件事分開講
    expect(body.enqErrors).toBe(1);
    errSpy.mockRestore();
  });

  it('🔴 #7 enqueue result 混入 PII sentinel 欄 ⇒ 回應與 log 皆不含(allowlist 真的跑過)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.B4_DEPLOY_CUTOFF = CUTOFF;
    enqueueSpy.mockResolvedValue({
      ...ENQ_CLEAN,
      recipient_email: 'leak@example.com',
      last_error_message: 'PII leak text',
    });
    sweepSpy.mockResolvedValue(CLEAN_RESULT);
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(body).not.toHaveProperty('recipient_email');
    expect(JSON.stringify(body)).not.toContain('leak@example.com');
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('leak@example.com');
    errSpy.mockRestore();
  });

  it('🔴 #8 enqueue 用【自己的】deps,且排在 sweeper deps **之前**(source-contract)', async () => {
    // plan §3.1:`getSweepEmailOutboxDeps()` 會 requireEnv Resend 兩顆、缺就 throw ⇒ 503。
    // 若 enqueue 共用它,**Resend 沒設好的期間連「排進 outbox」都不會發生**。
    // 🔴 尺要對準【呼叫點】,不是函式名 —— 函式名在註解裡也出現,
    //    我第一版就是被自己寫的那句 1c 註解騙到(它提到 `getSweepEmailOutboxDeps()` 且排在前面)。
    const enqueueCallSite = 'const enqueueDeps: EnqueueOrderCreatedEmailsDeps = getEnqueueOrderCreatedDeps()';
    const sweepCallSite = 'const deps: SweepEmailOutboxDeps = getSweepEmailOutboxDeps()';
    expect(ROUTE_SOURCE).toContain(enqueueCallSite);
    expect(ROUTE_SOURCE).toContain(sweepCallSite);
    expect(ROUTE_SOURCE.indexOf(enqueueCallSite)).toBeLessThan(ROUTE_SOURCE.indexOf(sweepCallSite));
    expect(ROUTE_SOURCE).toContain('function pickEnqueueCounts');
    expect(ROUTE_SOURCE).not.toContain('...enqueueResult');
  });
});
