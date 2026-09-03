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

const {
  sweepSpy, getDepsSpy, enqueueSpy, getEnqueueDepsSpy, hbOkSpy, hbFailSpy,
  shippedEnqueueSpy, getShippedDepsSpy,
} = vi.hoisted(() => ({
  hbOkSpy: vi.fn(),
  hbFailSpy: vi.fn(),
  sweepSpy: vi.fn(),
  getDepsSpy: vi.fn(),
  // 🔴 B-5:enqueue 那半有**自己的** use-case 與**自己的** deps factory(plan §3.1)。
  enqueueSpy: vi.fn(),
  getEnqueueDepsSpy: vi.fn(),
  // 🔴 M-4b E4 片3b:出貨線那半同樣自己一套(自己的 env、自己的 deps、自己的 try/catch)。
  shippedEnqueueSpy: vi.fn(),
  getShippedDepsSpy: vi.fn(),
}));

// 🔴 **`resolveShippedEmailCutoff` 刻意【不 mock】** —— 它是一支純函式,而
//    「env 填錯了會不會被擋下來」正是本 route 這一段要證的事。
//    把它換成替身的話,route 與那支函式之間的接線就沒有任何一格在量了
//    (而它自己的單元測試證不到「route 有沒有把 env 交給它」)。
//    ⇒ 用 `importOriginal` 保留真貨,只換掉三個會做 I/O 的。
vi.mock('@pcm/use-cases', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  sweepEmailOutbox: sweepSpy,
  enqueueOrderCreatedEmails: enqueueSpy,
  enqueueOrderShippedEmails: shippedEnqueueSpy,
}));
vi.mock('@/lib/email/composition', () => ({
  getSweepEmailOutboxDeps: getDepsSpy,
  getEnqueueOrderCreatedDeps: getEnqueueDepsSpy,
  getEnqueueOrderShippedDeps: getShippedDepsSpy,
}));

// b4-CRON6 片1:心跳寫入端。mock 掉的是 IO,不是判斷 —— 判斷(哪一條路寫)在 route 裡。
vi.mock('@/lib/cron/heartbeat', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  recordHeartbeatSuccess: hbOkSpy,
  recordHeartbeatFailure: hbFailSpy,
}));

import * as route from './route';
import { CRON_RATE_MAX_HITS, resetCronRateLimit } from '@/lib/cron/rate-limit';

const { GET } = route;

const SECRET = 'a'.repeat(48); // ≥32

/** 乾淨結果(errors=0、零待處理;Phase I 無流量的常態;鏡像 SweepEmailOutboxResult 全 10 欄)。 */
const CLEAN_RESULT = {
  reclaimed: 0,
  claimed: 0,
  sent: 0,
  failed: 0,
  deferred: 0,
  staleMarks: 0,
  errors: 0,
  // Sean 2026-08-30「Q2 取消信縫 = 甲 搬」新增兩欄(確定不合格 / 讀不到合格性,兩個世界)
  skippedIneligible: 0,
  eligibilityUnknown: 0,
  quotaFailed: 0,
  // M-4b E4 片3b:箱被作廢而正確地沒寄(非錯誤、不進 503 條件)
  skippedShipmentVoided: 0,
};

const DEPS = { outbox: {}, sender: {}, ineligibleScanner: {} };

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
  // 🔴 出貨線的 env 預設**沒設** —— 它是那條線的開關,漏清會讓別的測項意外走進 enqueue。
  delete process.env.SHIPPED_EMAIL_CUTOFF;
  shippedEnqueueSpy.mockReset();
  getShippedDepsSpy.mockReset().mockReturnValue({ outbox: {}, scanner: {} });
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

  /**
   * 🔴 `⟦b4-SWEEP503BLIND⟧`(2026-09-02):這三格是【一組】, 拆開任何一格另外兩格就沒有判別力。
   *
   * 舊條件不含 `result.failed` ⇒ **provider 全掛時 route 回 200 ⇒ 心跳綠 ⇒ 儀表正常**,
   * 而一整輪一封都沒寄出去。⇒ 而寄信是對外不可回收的。
   *
   * 🛑 而【只加一格「全滅 ⇒ 503」】會讓下面兩個世界也變 503, 那就是把有用的訊號換成噪音:
   *   ② 有寄成功也有失敗 ⇒ 那是常態(單封可重試)
   *   ③ 本輪沒有到期的信 ⇒ 那是最常見的一輪
   */
  it('🔴 全滅(sent=0 而 failed>0)→ 503:一封都沒成功而試過了', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, claimed: 5, sent: 0, failed: 5 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, sent: 0, failed: 5 });
    errSpy.mockRestore();
  });

  it('🟢 對照②:有寄出去也有失敗(sent>0 && failed>0)→ 仍 200(單封失敗是常態, 不是全滅)', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, claimed: 5, sent: 4, failed: 1 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 4, failed: 1 });
  });

  it('🟢 對照③:本輪沒有到期的信(sent=0 且 failed=0)→ 仍 200(那是最常見的一輪, 不是失敗)', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, claimed: 0, sent: 0, failed: 0 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 0, failed: 0 });
  });

  /**
   * 🔴 **第四格 —— 而它是被一個【還活著的突變】逼出來的**(code-reviewer 2026-09-02):
   * 把條件換成 `result.sent === 0 && result.claimed > 0` ⇒ **上面三格全綠, 而整支檔 72 格也全綠**
   * (我實跑複驗過)。成因:34 個 mock 裡**沒有任何一格**是 `claimed>0 && sent===0 && failed===0`。
   * ⇒ 而那個突變是錯的:一輪【全部被跳過】(不合格 / 箱作廢)不是失敗
   *   —— `sweep-email-outbox.ts` 明說 skippedIneligible / skippedShipmentVoided **不是失敗**。
   * 📌 **⇒ 三格證得出「條件在這三個世界對」, 證不出「它沒有把別的世界一起抓進來」。**
   */
  it('🟢 對照④:一輪【全部被跳過】(claimed>0 而 sent=0、failed=0)→ 仍 200(跳過不是失敗)', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, claimed: 3, sent: 0, failed: 0, skippedIneligible: 3 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, claimed: 3, sent: 0, skippedIneligible: 3 });
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

describe('GET email-sweep — 🔴 額度用盡要翻紅(2026-08-29 線D;主視窗批准「乙」)', () => {
  // 🔴 **這一組的兩格必須【並排讀】** —— 單看正對照,一個「`failed > 0` 就翻紅」的實作(甲)也會全綠。
  //    **負對照才是選「乙」的全部理由**:單封偶發失敗天天有,拿它翻紅 = 告警天天叫 = 等於沒有告警。
  // 🔴 **在這一組之前發生的事(量到的)**:額度爆 ⇒ `failed` 一直爬而 `errors` 恆 0
  //    ⇒ route 回 200 `ok:true` ⇒ 心跳前進 ⇒ 外部死人開關維持 up
  //    ⇒ **一封信都沒寄出去,而所有監控都說一切正常。**
  // ⚠️ **本組只守第一格**:額度持續爆仍會每天燒 `attempts`、**第 5 天永久死信**,
  //    而目前無死信重送工具(`IEmailOutbox.ts` 逐字、backlog `#286`)⇒ 那是 `Q-死信怎麼辦`,不在本片。

  it('[正對照] quotaFailed > 0 ⇒ 503,而且心跳【不得】前進', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, claimed: 3, failed: 3, quotaFailed: 3 });
    const res = await GET(makeReq(bearer()));
    // 🔴 怎麼會紅:把 route 那行 `result.quotaFailed > 0 ||` 拿掉 ⇒ 這裡 503 變 200。
    expect(res.status, '額度爆掉而 route 回 200 ⇒ 監控會說一切正常').toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, quotaFailed: 3 });
    // 🔴 這一格是本片的目的:心跳前進 = 外部死人開關維持 up = 沒有人會知道。
    expect(hbOkSpy, '心跳前進了 ⇒ 死人開關維持 up').toHaveBeenCalledTimes(0);
    expect(hbFailSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('🔴 [負對照] 單封偶發失敗(failed>0 而 quotaFailed=0)⇒ 照樣 200,心跳照常前進', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, claimed: 5, sent: 4, failed: 1, quotaFailed: 0 });
    const res = await GET(makeReq(bearer()));
    // 🔴 怎麼會紅:改成拿 `result.failed > 0` 翻紅(＝「甲」)⇒ 這裡 200 變 503。
    //    📌 沒有這一格,「乙」與「甲」在所有其他測試上長得一模一樣。
    expect(res.status, '單封偶發失敗就翻紅 ⇒ 告警天天叫 ⇒ 等於沒有告警').toBe(200);
    expect(hbOkSpy).toHaveBeenCalledTimes(1);
    expect(hbFailSpy).toHaveBeenCalledTimes(0);
  });
});

describe('GET email-sweep — 🔴 counts allowlist(不 blind spread ...result、PII 物理擋)', () => {
  // codex 關卡2 must-fix:若 use-case 日後誤增 recipient_email 等診斷/PII 欄,route 顯式挑欄 → 不會洩進回應/log。
  // ⚠️ 欄數會長(2026-08-30 從 8 → 10 counts),所以標題與註解不寫死數字 —— 期望值那張清單才是權威。
  it('sweep result 混入 PII sentinel 欄 → 200 回應**不含**該欄(只 counts allowlist)', async () => {
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
        'claimed', 'deferred', 'eligibilityUnknown', 'enqueueStatus', 'errors', 'failed',
        'ok', 'quotaFailed', 'reclaimed', 'sent', 'skippedIneligible', 'staleMarks',
        // 🔴 片3b 多出來的兩欄:sweep 那一份的作廢計數 + 出貨線 enqueue 的四態旗標。
        //    (env 沒設 ⇒ `shippedEnqueueStatus: 'skipped_no_cutoff'`、其餘 `shp*` 欄不出現。)
        'skippedShipmentVoided', 'shippedEnqueueStatus',
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

  // 🔴 **`toHaveBeenCalledWith` 的物件比對是【全等】,不是子集** ——
  //    所以這一格同時是一道「options 有沒有多長出東西」的守門:
  //    片3b 加了 `allowOrderShipped`,這一格當場紅了,而**它紅得對**。
  //    ⇒ 保持全等寫法(不要改成 `toMatchObject`)—— 那會讓下一個新欄安靜地溜進來。
  it('sweepEmailOutbox 收 route 端常數 options(claimLimit 50 / maxRunSeconds 60 / leaseSeconds 3600 + 出貨線旗標 + 本輪碼表)', async () => {
    const before = Date.now();
    await GET(makeReq(bearer()));
    const after = Date.now();
    expect(sweepSpy).toHaveBeenCalledWith(expect.anything(), {
      claimLimit: 50,
      // ⟦b4-SWEEPBUDGET1⟧:route 進來那一刻的毫秒 epoch(值本身會變,形狀不變)。
      runStartedAtMs: expect.any(Number),
      maxRunSeconds: 60,
      leaseSeconds: 3600,
      // 🔴 env 沒設(本檔 beforeEach 清掉)⇒ 出貨線沒上膛 ⇒ false。
      allowOrderShipped: false,
      // 🔴🔴 **這一格是本測試【設計上要抓的東西, 抓到了我】**(2026-09-03)。
      //    我在 `route.ts` 加了 `siteUrl` 而**沒有跑本檔** ⇒ 它當場紅, 而我對主視窗報的是「全綠」。
      //    ⇒ 📌 **我餵給 vitest 的是 2 條 use-cases 路徑, 而爆炸半徑是 5 支檔跨 2 個 package。**
      //      抓到它的是 codex, 不是我的三綠 —— 三綠不跑測試, 而我挑的測試檔沒有涵蓋 route。
      //    ✅ 而本格上面那句「保持全等寫法, 不要改成 toMatchObject」**正是它會叫的原因** ——
      //      **一道正確的閘, 在它抓到的那一刻看起來像是擋路。**
      // ⚠️ 值是 `http://localhost:3000`:本檔 `beforeEach` 清掉 env、`NODE_ENV !== 'production'`
      //    ⇒ `resolveSiteUrl()` 回那個預設(**不是 `undefined`** —— `lib/site-url.ts:27`)。
      //    🛑 **而它到不了客人** —— `paidEmailOrderUrl` 那道 hostname 閘會擋掉整段連結。
      //      ⇒ 這一格證的是「route 傳了什麼」,擋在哪裡是那支函式自己的測試在證。
      siteUrl: 'http://localhost:3000',
    });
    // 🔴 `expect.any(Number)` **只證得出它是個數字** —— 傳 `0`、傳去年的時刻、
    //    傳 `Date.now() + 一小時`,三種都會過。⇒ 再夾一次區間,這一格才有判別力:
    //    它必須落在【這一次呼叫的前後】之間。
    const passed = (sweepSpy.mock.calls[0]![1] as { runStartedAtMs: number }).runStartedAtMs;
    expect(passed).toBeGreaterThanOrEqual(before);
    expect(passed).toBeLessThanOrEqual(after);
  });

  // 🔴 codex R2 nit:原本只驗 outbox + sender ⇒ **`ineligibleScanner` 沒進來也會綠**。
  //    而那道閘是「不該寄的別寄」——它沒接上時,這一層是**全綠**的
  //    (use-case 被 mock ⇒ 型別的必填在這一層不會叫)。⇒ 三個都要驗。
  it('deps = getSweepEmailOutboxDeps()(outbox + sender + ineligibleScanner)', async () => {
    await GET(makeReq(bearer()));
    expect(getDepsSpy).toHaveBeenCalledTimes(1);
    const depsArg = sweepSpy.mock.calls[0]![0];
    expect(depsArg).toMatchObject({
      outbox: expect.anything(),
      sender: expect.anything(),
      ineligibleScanner: expect.anything(),
    });
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

// ══ 心跳三態（b4-CRON6 爇1，R1 I2 補）══
// 🔴 本檔本次 diff 之前【零】心跳斷言 ⇒ 把那行心跳刪掉，這支檔照樣全綠。
//    那正是在 settle-sweep 上量到的形狀（139 全綠 ⇒ 刪掉一行 ⇒ 還是 139 全綠）。
describe('GET email-sweep — 心跳三態', () => {
  it('🟢 200 + ok:true ⇒ 寫成功心跳、不寫失敗', async () => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(hbOkSpy).toHaveBeenCalledWith('pcm-email-sweep');
    expect(hbFailSpy).not.toHaveBeenCalled();
  });

  it('🔴 errors>0 ⇒ 503 ⇒ 寫失敗心跳、不寫成功', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, errors: 2 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalledWith('pcm-email-sweep');
    expect(hbOkSpy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 401 ⇒ 一格都不寫', async () => {
    const res = await GET(makeReq(bearer('b'.repeat(48))));
    expect(res.status).toBe(401);
    expect(hbOkSpy).not.toHaveBeenCalled();
    expect(hbFailSpy).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 檔頭的跨檔引用 — 錨在字面、不在行號
//
// **複製自 `anomaly-alert/route.test.ts`,不是新發明。**
// 2026-08-28 量到:全 repo 五支 cron route 裡,**只有 anomaly-alert 有這道守門** ——
// 而**沒有守門的那三支,兩支各帶 2 個違規**(本支即其一),
// `capture-recheck` 在裝上它的當下更是一次抓到 **8** 個。
// 📌 **不是巧合:沒有守門的那一支,就是會累積違規的那一支。**
//    ⇒ 而推論比它本身重:**你不能用「那支檔看起來還好」決定要不要裝守門** ——
//      **它看起來還好,正是因為沒有東西在看它。**
// ⚠️ pattern 逐字抄那一支(它換過三版才收斂:不列舉副檔名,判準是【token 裡有沒有一個點】)。
// ══════════════════════════════════════════════════════════════════════════
const ROUTE_SOURCE_FOR_ANCHOR_GUARD = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

describe('route.ts 檔頭的跨檔引用 — 錨在字面、不在行號', () => {
  it('全檔零「檔案:行號」引用 —— 行號會漂,而漂掉時沒有訊號', () => {
    const hits = ROUTE_SOURCE_FOR_ANCHOR_GUARD.match(/[\w./-]*\.[\w-]+:L?\d+/g) ?? [];
    expect(hits).toEqual([]);
  });

  it('全檔零反引號裸行號(`:123` / `:123-125`)—— 同一個病,換一種寫法', () => {
    const hits = ROUTE_SOURCE_FOR_ANCHOR_GUARD.match(/`:L?\d+(?:-\d+)?`/g) ?? [];
    expect(hits).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 M-4b E4 片3b:出貨通知信的 enqueue 接線
// ══════════════════════════════════════════════════════════════════════════
//
// 🔴 **這一組要證的是【它現在還不會寄】,而不是【它能寄】** ——
//    交件時我要對 Sean 說「這一顆 merge 進去不會寄出任何一封信」,
//    而**「我沒有設那顆 env」不是證明,那是宣稱**。真正的證明是下面第一格那支 spy。
describe('GET email-sweep — 🔴 出貨通知信 enqueue 接線(片3b)', () => {
  /** 一個**合法而且晚於下界**的起始線(下界 = 拍板那天台北零時 2026-08-30)。 */
  const SHP_CUTOFF = '2026-09-01T21:30:00+08:00';
  /** ⇒ 交給 use-case 的是**正規化後的 UTC 時刻**,不是使用者打的那串字。 */
  const SHP_CUTOFF_NORMALIZED = '2026-09-01T13:30:00.000Z';

  const SHP_CLEAN = {
    scanned: 0, truncated: false, enqueued: 0,
    skippedNoRealEmail: 0, duplicate: 0, noRecipient: 0, errors: 0,
  };

  beforeEach(() => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT });
    getEnqueueDepsSpy.mockReturnValue({ outbox: {}, scanner: {} });
  });

  afterEach(() => {
    delete process.env.SHIPPED_EMAIL_CUTOFF;
    delete process.env.B4_DEPLOY_CUTOFF;
  });

  it('🔴🔴 env 沒設 ⇒ **整段不跑、一封都不會寄**,回 200 + skipped_no_cutoff', async () => {
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    // ⬇️ 這兩行就是「這一顆 merge 進去不會寄信」的真正證據 —— 不是 counts,是那兩支 spy。
    expect(shippedEnqueueSpy).not.toHaveBeenCalled();
    expect(getShippedDepsSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(body.shippedEnqueueStatus).toBe('skipped_no_cutoff');
  });

  it('🔴🔴 **兩條線的 env 不共用**:只設 B4_DEPLOY_CUTOFF 不會把出貨線一起打開', async () => {
    // 🔴 這一格擋的是一個很自然的「順手共用」重構:兩段長得幾乎一樣,
    //    共用一顆 env 之後,**訂單成立線上線的那一刻會把出貨線一起上膛**,
    //    而 Sean 那一板逐字是「從你設定的那一刻起」—— 兩條線不是同一刻。
    process.env.B4_DEPLOY_CUTOFF = '2026-08-19T03:14:00.000Z';
    enqueueSpy.mockResolvedValue({
      scanned: 0, scannedPages: 1, truncated: false,
      enqueued: 0, skippedNoRealEmail: 0, duplicate: 0, noRecipient: 0, errors: 0,
    });
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(body.enqueueStatus).toBe('completed'); // 訂單線開了
    expect(body.shippedEnqueueStatus).toBe('skipped_no_cutoff'); // 而出貨線沒有
    expect(shippedEnqueueSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-09-01', '裸日期:沒有時刻也沒有偏移 ⇒ 會被當 UTC ⇒ 台北當天 08:00 前的箱子永遠不寄'],
    ['2026-09-01T21:30:00', '有時刻而沒有偏移 —— 同一個病,而它看起來更像對的'],
    ['2026-09-01T21:30:00+0800', '偏移少了冒號'],
    ['', '設了而值是空字串 ⇒ 必須是 bad_cutoff,不是 no_cutoff(貼錯而整件事安靜地沒發生)'],
  ])('🔴 格式不合 %s ⇒ 不跑、**回 503**、狀態 skipped_bad_cutoff', async (bad) => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SHIPPED_EMAIL_CUTOFF = bad;
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(shippedEnqueueSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(body.shippedEnqueueStatus).toBe('skipped_bad_cutoff');
    errSpy.mockRestore();
  });

  /**
   * 🔴 **log 不印使用者填的那個值** —— 而這一格用一個【不可能與我方固定字串相撞】的哨兵值。
   * ⚠️ 這不是潔癖:第一版拿 `2026-09-01` 當哨兵而它**紅了** ——
   *    因為那支純函式回的 `why` 裡舉的例子就是 `2026-09-01T21:30:00+08:00`。
   *    ⇒ 📌 **一個「log 有沒有洩漏」的斷言,拿一個【我們自己也會印】的字當哨兵 ⇒ 它量的是別的東西。**
   *    ⇒ 哨兵值必須是這個 repo 裡不會出現的字面,否則假紅(這次)或假綠(下次)。
   */
  it('🔴 log **不印**使用者填的那個值(哨兵值不與我方固定字串相撞)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SHIPPED_EMAIL_CUTOFF = 'ZZQQ-SENTINEL-NOT-A-TIME';
    const res = await GET(makeReq(bearer()));

    expect(res.status).toBe(503);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('ZZQQ-SENTINEL-NOT-A-TIME');
    // 🔵 正對照:它**確實印了**我方那段固定說明 ⇒ 上面那個 `not.toContain` 不是因為根本沒 log 才過的。
    expect(JSON.stringify(errSpy.mock.calls)).toContain('SHIPPED_EMAIL_CUTOFF');
    errSpy.mockRestore();
  });

  it('🔴🔴 起始線早於下界(打錯年份)⇒ 擋下、503 —— 這一格擋的是「一次寄出全部歷史箱子」', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SHIPPED_EMAIL_CUTOFF = '1970-01-01T00:00:00Z';
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(shippedEnqueueSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(body.shippedEnqueueStatus).toBe('skipped_bad_cutoff');
    errSpy.mockRestore();
  });

  it('🔴 合法 cutoff ⇒ 真的跑、被 await、結果進 body、狀態 completed', async () => {
    // 🔴 負對照:上面三組全被擋掉,這一組必須過 —— 不然「擋得很嚴」與「全部擋掉」長得一樣。
    // 🔴 而 `toHaveBeenCalledWith` 那一行同時釘住**傳下去的是正規化後的 UTC 時刻**:
    //    交給 PG 的必須是一個沒有歧義的瞬間,不是使用者打的那串帶偏移的字。
    process.env.SHIPPED_EMAIL_CUTOFF = SHP_CUTOFF;
    shippedEnqueueSpy.mockResolvedValue({ ...SHP_CLEAN, scanned: 3, enqueued: 2, duplicate: 1 });
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(shippedEnqueueSpy).toHaveBeenCalledWith(expect.anything(), {
      cutoff: SHP_CUTOFF_NORMALIZED,
      limit: 50,
    });
    expect(res.status).toBe(200);
    expect(body.shippedEnqueueStatus).toBe('completed');
    expect(body.shpScanned).toBe(3);
    expect(body.shpEnqueued).toBe(2);
    expect(body.shpDuplicate).toBe(1);
  });

  it('🔴 整段 throw ⇒ 狀態 failed(**不是** skipped)、回 503,而 **sweeper 照樣跑完**', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SHIPPED_EMAIL_CUTOFF = SHP_CUTOFF;
    shippedEnqueueSpy.mockRejectedValue(new Error('scan boom'));
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.shippedEnqueueStatus).toBe('failed');
    // 🔴 這一行是重點:**排信壞掉不得阻止已經排好的信被寄出去。**
    expect(sweepSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('🔴 單筆 errors ⇒ 一樣 503(不吞成 200);狀態仍是 completed —— 兩件事分開講', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SHIPPED_EMAIL_CUTOFF = SHP_CUTOFF;
    shippedEnqueueSpy.mockResolvedValue({ ...SHP_CLEAN, scanned: 2, enqueued: 1, errors: 1 });
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.shippedEnqueueStatus).toBe('completed');
    expect(body.shpErrors).toBe(1);
    errSpy.mockRestore();
  });

  it('🔴 出貨 enqueue result 混入 PII sentinel 欄 ⇒ 回應與 log 皆不含(allowlist 真的跑過)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SHIPPED_EMAIL_CUTOFF = SHP_CUTOFF;
    shippedEnqueueSpy.mockResolvedValue({ ...SHP_CLEAN, recipient_email: 'leak@example.com' });
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).not.toHaveProperty('recipient_email');
    expect(JSON.stringify(body)).not.toContain('leak@example.com');
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('leak@example.com');
    errSpy.mockRestore();
  });

  it('🔴 sweep 的 skippedShipmentVoided 進得了 body,而它**不會**讓 route 回 503', async () => {
    // 箱被作廢是正常業務動作 —— 併進 503 的話,員工按一次「作廢重開」就有人半夜被叫起來。
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT, skippedShipmentVoided: 2 });
    const res = await GET(makeReq(bearer()));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skippedShipmentVoided).toBe(2);
  });
});

// 🔴🔴 codex 2026-08-30 R1 must-fix 1/2 的證人(**route 這一側**)。
//
// ⚠️ **本檔 mock 掉 sweepEmailOutbox ⇒ 這裡量不到「它真的沒寄」** ——
//    那一半在 `packages/use-cases/src/sweep-email-outbox.test.ts` 的
//    `allowOrderShipped=false ⇒ 一封都不寄` 那一節(真路徑、只換 port 替身)。
// ✅ **這裡量的是【接線】**:route 有沒有把 cutoff 的裁決交給 sweeper。
//    ⇒ 把 `allowOrderShipped: shippedCutoff.kind === 'ok'` 改成寫死 `true`,下面第一格必紅。
describe('GET email-sweep — 🔴 cutoff 同時控【排信】與【寄信】(不是只擋排信)', () => {
  beforeEach(() => {
    sweepSpy.mockResolvedValue({ ...CLEAN_RESULT });
    getEnqueueDepsSpy.mockReturnValue({ outbox: {}, scanner: {} });
  });
  afterEach(() => {
    delete process.env.SHIPPED_EMAIL_CUTOFF;
  });

  it('🔴🔴 env 沒設 ⇒ 傳給 sweeper 的 `allowOrderShipped` 必須是 **false**', async () => {
    // 🔴 這一格擋的世界:設過 env ⇒ 信排進 outbox ⇒ 看到不對把 env 拿掉
    //    ⇒ 而在這一行之前,**那個動作不會讓寄信停下來**(已排好的列照樣每五分鐘寄一批)。
    await GET(makeReq(bearer()));
    expect(sweepSpy.mock.calls[0]![1]).toMatchObject({ allowOrderShipped: false });
  });

  it('🔴 env 格式錯 ⇒ 一樣是 false(不得「反正它會 503」就放行寄信)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SHIPPED_EMAIL_CUTOFF = 'ZZQQ-SENTINEL-NOT-A-TIME';
    await GET(makeReq(bearer()));
    expect(sweepSpy.mock.calls[0]![1]).toMatchObject({ allowOrderShipped: false });
    errSpy.mockRestore();
  });

  it('🔵 正對照:env 合法 ⇒ **true**(證上面兩格不是恆 false)', async () => {
    process.env.SHIPPED_EMAIL_CUTOFF = '2026-09-01T21:30:00+08:00';
    shippedEnqueueSpy.mockResolvedValue({
      scanned: 0, truncated: false, enqueued: 0,
      skippedNoRealEmail: 0, duplicate: 0, noRecipient: 0, errors: 0,
    });
    await GET(makeReq(bearer()));
    expect(sweepSpy.mock.calls[0]![1]).toMatchObject({ allowOrderShipped: true });
  });

  it('🔴 source-contract:那個旗標必須【引用已解析的 cutoff】,不得另外讀一次 env', () => {
    // 兩半各自讀一次 env ⇒ 它們可以分岔(讀取之間有人改了設定、或有人只改了其中一處)。
    expect(ROUTE_SOURCE).toMatch(/allowOrderShipped:\s*shippedCutoff\.kind === 'ok'/);
  });

  // ══ 🔵🔵「還沒上膛」要出聲(2026-08-30 夜)══
  //   量到的:env 沒設 ⇒ skipped_no_cutoff ⇒ 不進 503 判斷 ⇒ 回 200,而成功路徑一行 log 都沒有
  //   ⇒ 「設好了」與「沒設好」在 Vercel 那一側印同一個 200、同一片空 log。
  // 🔴 這三格【必須成組】:只有正對照 ⇒ 一個【無條件印】的 console.info 也會全過
  //   (CLAUDE.md「輸出的標籤要由結果決定,不能無條件印」正是這個形狀)。
  describe('🔵 skipped_no_cutoff 要在 log 上看得見(而仍然是 200)', () => {
    // 本 describe 自己的已上膛值(外層那個 CUTOFF 不在這個 scope 裡)。
    const ARMED = '2026-08-19T03:14:00.000Z';

    // 🔴 **code-reviewer 2026-08-31 F6**:外層 afterEach 只清 `SHIPPED_EMAIL_CUTOFF`,
    //   而 `:409` / `:675` 兩個姊妹 describe 的 afterEach **都有**清 `B4_DEPLOY_CUTOFF` ——
    //   只有本 describe 沒有。**今天無害**(它是全檔最後一個, 最後一格剛好 delete),
    //   而**無害的理由是【位置】, 不是【設計】** ⇒ 有人在後面追加一個 describe、
    //   或開 `sequence.shuffle` ⇒ 它會安靜地綠。⇒ 補上, 不靠位置。
    afterEach(() => {
      delete process.env.B4_DEPLOY_CUTOFF;
      delete process.env.SHIPPED_EMAIL_CUTOFF;
    });
    it('🔴 正對照:兩顆 cutoff 都沒設 ⇒ console.info 印出兩顆的名字,而回應仍是 200', async () => {
      delete process.env.B4_DEPLOY_CUTOFF;
      delete process.env.SHIPPED_EMAIL_CUTOFF;
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const res = await GET(makeReq(bearer()));
      const logged = JSON.stringify(infoSpy.mock.calls);

      expect(res.status).toBe(200); // 🔴 沒上膛不是失敗 —— 這一格釘住「不改回應碼」
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(logged).toContain('B4_DEPLOY_CUTOFF');
      expect(logged).toContain('SHIPPED_EMAIL_CUTOFF');
      infoSpy.mockRestore();
    });

    it('🔴🔴 負對照:兩顆都設好了 ⇒ 那行 console.info 【一次都不印】', async () => {
      process.env.B4_DEPLOY_CUTOFF = ARMED;
      process.env.SHIPPED_EMAIL_CUTOFF = ARMED;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(makeReq(bearer()));

      // 🛑 這一格【不釘回應碼】:兩顆都上膛 ⇒ enqueue 真的跑 ⇒ 狀態由外層 describe 的 mock 決定
      //    (實測是 503)。那與本片無關 —— 本片只加一行 log, 改不動任何回應碼;
      //    「不改回應碼」由上面【正對照】那一格釘住(沒上膛 ⇒ 仍 200)。
      expect(infoSpy).not.toHaveBeenCalled(); // 🔴 殺掉「無條件印」那個突變
      errSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it('🔴 只有一顆沒設 ⇒ 也要印,而【印出來的是沒設的那一顆】', async () => {
      process.env.B4_DEPLOY_CUTOFF = ARMED;
      delete process.env.SHIPPED_EMAIL_CUTOFF;
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const res = await GET(makeReq(bearer()));
      const logged = JSON.stringify(infoSpy.mock.calls);

      expect(res.status).toBe(200);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(logged).toContain('SHIPPED_EMAIL_CUTOFF 未設或空');
      // 🔴 已上膛的那一顆【不得】被寫成「未設或空」—— 否則兩顆狀態會被印成同一句
      expect(logged).not.toContain('B4_DEPLOY_CUTOFF 未設或空');
      // 🔴🔴 **code-reviewer 2026-08-31 F2(它用推的, 我實跑證實)**:把兩個 key 的
      //   【值】對調 ⇒ **69 格全綠**。成因:五格用 `JSON.stringify(mock.calls)` 比對
      //   ⇒ **key↔value 的綁定被攤平**;而白名單那格只比 key 的【集合】與 value 的【集合】,
      //   兩個集合對調之後**完全一樣**。
      //   ⇒ 📌 **一個「釘住完整形狀」的白名單, 仍然可以不釘【哪個值配哪個 key】。**
      //   ⇒ 失敗情境:凌晨看 log 的人讀到「B-5 沒設」, 而實際沒設的是出貨那顆。
      //   ✅ 修法 = 直接斷言【映射】, 不經過字串攤平。
      const payloadA = (infoSpy.mock.calls[0] as [string, Record<string, unknown>])[1];
      expect(payloadA['shippedCutoff']).toBe('SHIPPED_EMAIL_CUTOFF 未設或空');
      expect(payloadA['b5DeployCutoff']).not.toBe('SHIPPED_EMAIL_CUTOFF 未設或空');
      // 🔴🔴 **codex R2 must-fix**:B-5 那顆的【值】也不得出現。
      //   為什麼釘在這一格 —— 這是唯一同時滿足兩件事的世界:**B-5 是上膛的(所以它的值存在)**
      //   **而那一行確實會印(因為出貨沒上膛)**。零 PII 那兩格都少了其中一半:
      //   「兩顆都上膛」⇒ 根本不印;「B-5 沒上膛」⇒ 它的值是 undefined、沒有東西可洩。
      expect(logged).not.toContain(ARMED);
      infoSpy.mockRestore();
    });

    // 🔴🔴 **這一格是突變測試逼出來的, 不是我想到的**:
    //   上面那格(B4 上膛 / 出貨沒設)**殺不掉**「把 shippedCutoff 寫死成『未設或空』」那個突變 ——
    //   因為在那一格裡出貨【本來就沒設】⇒ 寫死與正確輸出**長得一樣**。
    //   ⇒ 📌 **要殺它, 必須讓【出貨那顆是上膛的】** —— 也就是**反方向**那一格。
    //   ⇒ 一組看起來對稱的測試, 可能只覆蓋了一個方向, 而它印的是全綠。
    it('🔴🔴 反方向:出貨上膛而 B-5 沒設 ⇒ 出貨那顆【不得】被寫成「未設或空」', async () => {
      delete process.env.B4_DEPLOY_CUTOFF;
      process.env.SHIPPED_EMAIL_CUTOFF = ARMED;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(makeReq(bearer()));
      const logged = JSON.stringify(infoSpy.mock.calls);

      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(logged).toContain('B4_DEPLOY_CUTOFF 未設或空');
      expect(logged).not.toContain('SHIPPED_EMAIL_CUTOFF 未設或空'); // 🔴 殺掉「寫死」那個突變
      errSpy.mockRestore();
      infoSpy.mockRestore();
    });

    // 🔴🔴 **這一格被 codex 打回一次(2026-08-30 夜, must-fix)**:
    //   我原本只斷言「不含 ARMED」⇒ 一個**多印 `CRON_SECRET`** 的突變**照樣全綠**。
    //   ⇒ 📌 **測試名字叫「零 PII」, 而它量的只有【其中一個值】** —— 尺比它宣稱的窄。
    //   ⇒ 修法:每一種**不該出現的值**各給一個**獨立可辨識的 sentinel**, 逐個斷言。
    // 🔴🔴🔴 **這一格是「別再補 sentinel 了」的那一格**(2026-08-30 夜)
    //   codex R1 與 R2 各給一個 must-fix, 而**兩條是同一個形狀**:
    //     R1「你沒擋 CRON_SECRET」→ 我補一個 sentinel
    //     R2「你沒擋 B-5 的值」  → 我又補一個 sentinel
    //   ⇒ 📌 **每一輪都在補【下一個我想得到的洩漏】, 而審查者永遠比我多想到一個。**
    //   ⇒ ⇒ 那是打地鼠, 不是守門 —— 因為 `not.toContain(X)` 的分母是【我列得出來的 X】。
    // ✅ **改成【白名單】**:釘住那一行 log 的**完整形狀** —— 有哪幾個 key、每個 key 的值是不是
    //   我們自己寫死的那幾句其中之一。⇒ **任何多印的東西, 不論它是什麼, 都會讓這一格紅。**
    //   🔴 而它殺得掉一個**我沒想到、也沒人想得到**的洩漏 —— 那正是前面那些格做不到的事。
    it('🛑🛑🛑 白名單:那一行 log 的形狀被釘死 ⇒ 多印【任何】東西都會紅(不靠列舉洩漏物)', async () => {
      const ALLOWED_KEYS = ['b5DeployCutoff', 'shippedCutoff'];
      const ALLOWED_VALUES = [
        'B4_DEPLOY_CUTOFF 未設或空',
        'SHIPPED_EMAIL_CUTOFF 未設或空',
        // 🔴 **F8**:~~`'skipped_no_cutoff'`~~ **已移除** —— 它在 payload 裡【不可達】
        //   (三元運算已經把那個狀態換成 env 名那句)⇒ 收著它只會讓這道閘寬一格。
        //   📌 **一個白名單多收一個到不了的值, 不會紅, 而它讓閘變寬。**
        'skipped_bad_cutoff',
        'completed',
        'failed',
      ];
      process.env.CRON_SECRET = 'ZZQQ-SECRET-SENTINEL-DO-NOT-LOG-0123456789';
      process.env.B4_DEPLOY_CUTOFF = ARMED; // 上膛 ⇒ 它的值存在、可被洩
      delete process.env.SHIPPED_EMAIL_CUTOFF; // 沒上膛 ⇒ 那一行確實會印
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(makeReq(bearer('ZZQQ-SECRET-SENTINEL-DO-NOT-LOG-0123456789')));

      expect(infoSpy).toHaveBeenCalledTimes(1); // 🔴 先證明這個世界【有印】,否則下面全是空集合
      const [msg, payload] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];
      expect(typeof msg).toBe('string'); // 第一個參數是我們寫死的訊息
      expect(Object.keys(payload).sort()).toEqual([...ALLOWED_KEYS].sort()); // 🔴 多一個 key 就紅
      for (const v of Object.values(payload)) {
        expect(ALLOWED_VALUES).toContain(v); // 🔴 值不在白名單就紅(env 的值一定不在)
      }
      errSpy.mockRestore();
      infoSpy.mockRestore();
    });

    it('🛑 零 PII:那一行不得印出 env 的【值】—— cutoff 值、secret、出貨值三者都不得出現', async () => {
      const B5_SENTINEL = '2026-08-19T03:14:00.000Z'; // B-5 已上膛的值
      // 🔴 **必須 >=32 字元** —— 短的會被路由的 secret 長度閘擋掉 ⇒ 提早 return ⇒ 那一行 log 根本不會跑,
      //    而 `not.toContain` 在【空 log】底下照樣全過。(我第一版寫 31 字元, 被下面那格 `toHaveBeenCalledTimes(1)` 抓到。)
      const SECRET_SENTINEL = 'ZZQQ-SECRET-SENTINEL-DO-NOT-LOG-0123456789';
      const SHIPPED_SENTINEL = '2026-08-20T09:00:00.000Z'; // 出貨已上膛的值(反方向)
      process.env.CRON_SECRET = SECRET_SENTINEL;
      process.env.B4_DEPLOY_CUTOFF = B5_SENTINEL;
      process.env.SHIPPED_EMAIL_CUTOFF = SHIPPED_SENTINEL;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(makeReq(bearer(SECRET_SENTINEL)));
      const logged = JSON.stringify(infoSpy.mock.calls);

      expect(logged).not.toContain(SECRET_SENTINEL); // 🔴 codex 指的那一格
      expect(logged).not.toContain(B5_SENTINEL);
      expect(logged).not.toContain(SHIPPED_SENTINEL); // 🔴 反方向也要
      errSpy.mockRestore();
      infoSpy.mockRestore();
    });

    // 🔴 上面那格兩顆都上膛 ⇒ 那一行**根本不會印** ⇒ 空 log 也會讓三個 not.toContain 全過。
    //   ⇒ 📌 **一個「什麼都沒印」的世界, 與「印了而沒洩」的世界, 在那三條斷言底下同色。**
    //   ⇒ 所以再補一格:**確實有印**的世界裡, 那三個值一樣不得出現。
    it('🛑🛑 零 PII(有印的那個世界):一顆沒上膛 ⇒ 確實印了, 而三個 sentinel 仍全不出現', async () => {
      // 🔴 **必須 >=32 字元** —— 短的會被路由的 secret 長度閘擋掉 ⇒ 提早 return ⇒ 那一行 log 根本不會跑,
      //    而 `not.toContain` 在【空 log】底下照樣全過。(我第一版寫 31 字元, 被下面那格 `toHaveBeenCalledTimes(1)` 抓到。)
      const SECRET_SENTINEL = 'ZZQQ-SECRET-SENTINEL-DO-NOT-LOG-0123456789';
      const SHIPPED_SENTINEL = '2026-08-20T09:00:00.000Z';
      process.env.CRON_SECRET = SECRET_SENTINEL;
      delete process.env.B4_DEPLOY_CUTOFF; // 這顆沒上膛 ⇒ 一定會印
      process.env.SHIPPED_EMAIL_CUTOFF = SHIPPED_SENTINEL;
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(makeReq(bearer(SECRET_SENTINEL)));
      const logged = JSON.stringify(infoSpy.mock.calls);

      expect(infoSpy).toHaveBeenCalledTimes(1); // 🔴 先證明這個世界【有印】
      expect(logged).not.toContain(SECRET_SENTINEL);
      expect(logged).not.toContain(SHIPPED_SENTINEL);
      errSpy.mockRestore();
      infoSpy.mockRestore();
    });
  });
});
