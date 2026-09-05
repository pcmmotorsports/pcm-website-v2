// @vitest-environment node
// route.test.ts — /api/cron/anomaly-alert GET handler 測試(M-3 #250)
//
// node env(route 用 node:crypto timingSafeEqual + Buffer + 全域 Request/Response)。
// mock:server-only / @pcm/use-cases(checkAnomalyAlerts)/ @/lib/payment/composition(getAnomalyAlertDeps)。
// 驗:① GET-only 契約 + runtime/maxDuration/dynamic ② 認證(CRON_SECRET 未設/弱→500、Bearer 缺/錯→401)
//     ③ ANOMALY_ALERT_ENABLED gate(預設/false/TRUE/whitespace→200 no-op 不建 deps、嚴格 'true'→跑)
//     ④ enabled+errors=0→200 計數、errors>0→503 不偽 200、deps/factory throw→503 ⑤ options 注入
//     (refundingStuckSeconds=86400)⑥ 零 PII(log counts only)。

import { readFileSync } from 'node:fs';
import type { CheckAnomalyAlertsResult } from '@pcm/use-cases';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { checkSpy, getDepsSpy , hbOkSpy, hbFailSpy } = vi.hoisted(() => ({
  hbOkSpy: vi.fn(),
  hbFailSpy: vi.fn(),
  checkSpy: vi.fn(),
  getDepsSpy: vi.fn(),
}));

/**
 * 🔴🔴 **只換掉 `checkAnomalyAlerts`,其餘【用真的】**(2026-08-31,線出貨 `-1e`)。
 *
 * ⛔ ~~舊寫法 `vi.mock('@pcm/use-cases', () => ({ checkAnomalyAlerts: checkSpy }))`~~
 *   —— 那是把**整個模組**換掉:模組裡其他任何 export 在這支測試裡都是 `undefined`。
 * 🔴 而它壞掉的方式**不是紅一格**:route 新增一個 `resolveShippedEmailCutoff(...)` 呼叫
 *   ⇒ 執行期 `undefined is not a function` ⇒ 被 route 最外層的 try/catch 接住
 *   ⇒ **18 格一起變成 `deps_or_unexpected_throw` 的 503**,而錯誤訊息講的是「deps/env 缺」。
 *   ⇒ 📌 **一個 mock 的射程比它的名字寬,而寬出來的那一段沒有人宣告過。**
 * ✅ 改成 `importOriginal` 展開後只覆蓋那一支:`resolveShippedEmailCutoff` 是**純函式、零 IO**,
 *   mock 掉它等於把「這個 route 怎麼裁決那顆 env」這件事從測試裡拿掉 —— 而那正是本片要測的。
 */
vi.mock('@pcm/use-cases', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkAnomalyAlerts: checkSpy,
}));
vi.mock('@/lib/payment/composition', () => ({ getAnomalyAlertDeps: getDepsSpy }));

// b4-CRON6 片1:心跳寫入端。mock 掉的是 IO,不是判斷 —— 判斷(哪一條路寫)在 route 裡。
vi.mock('@/lib/cron/heartbeat', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  recordHeartbeatSuccess: hbOkSpy,
  recordHeartbeatFailure: hbFailSpy,
}));

import * as route from './route';
import { CRON_RATE_MAX_HITS, resetCronRateLimit } from '@/lib/cron/rate-limit';
import { ANOMALY_QUIET_HEARTBEAT_SUBJECT } from '@pcm/use-cases';

const { GET } = route;

const SECRET = 'a'.repeat(48); // ≥32

/**
 * 乾淨結果(alerted=false、errors=0;Phase I 無流量常態)。
 *
 * 🔴🔴 **標型別是刻意的**(adversarial-reviewer R3 F3 + 結構建議①, 2026-09-05)。
 *   ⛔ ~~原本是【裸物件】~~ ⇒ `CheckAnomalyAlertsResult` 新增欄位時這裡**不會紅**
 *     ⇒ 那些欄位在測試裡是 `undefined` ⇒ falsy ⇒ **新加的 route 分支永遠不執行。**
 *   🔬 而這一支檔 `:66-92` 已經為同一個病寫過**三次**警告 —— 而它仍然發生了第四次。
 *   ⇒ 🎯 **⇒ 警告寫在正確的位置, 而它擋不住「沒想到要來看」的人。**
 *   ✅ **標了型別之後**:result 一加必填欄, 這個 fixture **當場 typecheck 紅**
 *     ⇒ 「加了 `*Unknown` / `*Failed` 而 route 沒接」變成**必須有人動這裡**,
 *       而動這裡的人才寫得出對應那兩格測試。
 *   🛑 **天花板**:它只封閉「新欄位有沒有進 fixture」, **不保證有人為它寫分支測試** ——
 *     那一跳由本檔末的 `*Unknown`/`*Failed` 對帳 describe 接(見 `anomaly-alert-key-contract.test.ts`)。
 */
const CLEAN_RESULT: CheckAnomalyAlertsResult = {
  alerted: false,
  openCount: 0,
  refundingCount: 0,
  refundingStuckCount: 0,
  attemptManualReviewCount: 0,
  releasedStuckCount: 0,
  pendingDoubleChargeCandidateCount: 0,
  // 🔴 F-004:這三欄**必須明寫**,不能靠「fixture 沒有它 ⇒ undefined ⇒ falsy ⇒ 剛好走 200」。
  //    那種過關是**假的**:route 讀的是 `result.orderRefundsStuckUnknown`,
  //    而一個缺欄位的 fixture 與「查得到而且沒事」在這裡印同一個結果 ——
  //    ⇒ 下面那兩格(unknown ⇒ 503 / 非 unknown ⇒ 200)就是為了讓這兩個世界分得開。
  orderRefundsStuckCount: 0,
  orderRefundsStuckOvernightCount: 0,
  orderRefundsManualFailedCount: 0,
  orderRefundsStuckUnknown: false,
  /**
   * 🔴 **訊號 4 那三欄同樣明寫**(codex 2026-08-31 R1 must-fix)——
   * 理由與上面 F-004 那一段【逐字相同】:route 現在讀 `result.orderCreatedGapUnknown`,
   * 而一個缺欄位的 fixture(`undefined` ⇒ falsy)與「查得到而且沒事」在這裡印同一個 200。
   *
   * 🔴🔴 **而寫這一格時發現:`shippedGapUnknown` 到今天為止【也不在這個 fixture 裡】** ——
   *   那一片就是靠 `undefined ⇒ falsy` 過的, **而 F-004 那段警告就寫在它正上方八行。**
   *   ⇒ 📌 **一段寫在檔案裡的警告, 擋不住同一支檔後來新增的那一族。**
   *   ✅ 一併補上, 讓那三族的 fixture 形狀一致。
   */
  shippedNeverEnqueuedCount: 0,
  shippedUnsendableCount: 0,
  shipmentsTotalCount: 0,
  shippedGapUnknown: false,
  orderCreatedPaidNoEmailCount: 0,
  orderCreatedNoRecipientCount: 0,
  orderCreatedGapUnknown: false,
  // 🔵 未付款取消信線那三格(⟦b4-NORECIPIENTWINDOW⟧, 2026-09-03)。
  // 🔴 **codex 抓到的正是【漏了這三欄】** —— 少了它們, route 那道新的 503 判斷
  //    在測試裡讀到 `undefined` ⇒ falsy ⇒ **永遠不會觸發** ⇒ 測試照綠而保護不存在。
  unpaidCancelledPendingCount: 0,
  unpaidCancelledNoRecipientCount: 0,
  unpaidCancelledGapUnknown: false,
  // 🔴🔴 **第四條線(2026-09-04)。而【它不在 fixture 裡】正是本檔 :79 記過的那個病, 第三次。**
  //    少了這一行 ⇒ 它是 `undefined` ⇒ falsy ⇒ **route 那道新分支從來不會被跑到**
  //    ⇒ 79 格全綠, 而我什麼都沒證明。
  trackingCorrectedGapUnknown: false,
  trackingCorrectedPendingCount: 0,
  trackingCorrectedNoRecipientCount: 0,
  // 🔵 心跳(片3):基準是【讀得到而六支健康】。
  //    🛑 寫 `Unknown: true` 會讓每一格都走 503 那條路 ⇒ 這份 CLEAN 就不 clean 了。
  cronHeartbeatAbnormalCount: 0,
  cronHeartbeatAbnormalJobs: [],
  cronHeartbeatUnknown: false,
  bypassRlsRevoked: false,
  bypassRlsUnknown: false,
  // ⟦b9-ACLDRIFT5⟧ 片二(2026-09-05):健康世界 = 沒漂移、讀得到。
  aclDriftDetected: false,
  aclDriftUnknown: false,
  aclDriftFamilies: null,
  aclDriftTakenAt: null,
  // ⟦b4-RETRYGAVEUPNOWATCHER⟧(2026-09-05):健康世界 = 零張放棄、讀得到。
  settleRetryGaveUpCount: 0,
  settleRetryGaveUpUnknown: false,
  settleRetryGaveUpOldest: null,
  settleRetryGaveUpSampleIds: [],
  settleRetryGaveUpTracked: 0,
  bypassRlsPrivilegedCount: 6,
  bypassRlsTotalRoleCount: 35,
  oldestOpenAgeSeconds: null,
  notifiersTotal: 0,
  notifiersFailed: 0,
  errors: 0,
  // 🔴🔴 **⛔ ~~`quietHeartbeatEligible: true`~~ 整格移除**(2026-09-05, 標型別當場逼出來的)。
  //    🔬 那個欄位**已經從 `CheckAnomalyAlertsResult` 拿掉了** ——
  //      `check-anomaly-alerts.ts:455` 逐字:「我原本加了一個 `quietHeartbeatEligible` …
  //      而它現在完全等於 `!alerted`, 而複製一份狀態本身就有代價」。
  //    🔬 而 route 現在**零處讀它**(`grep -c` ⇒ 0)。
  //    ⇒ 🎯 **⇒ 這個 fixture 欄位與它上面那三行【替它辯護的註解】, 都在講一個不存在的東西。**
  //      而它們活了兩天, 因為**這個物件沒有型別** —— 那正是本次標型別要防的事。
  //      ⇒ 📌 **一個裸物件不只讓【少的】溜過去, 也讓【多的】留下來。**
  // 🔴 以下 23 格是【標型別當場逼出來的】—— 它們在裸物件時是 `undefined`,
  //    而 route 讀它們的那些分支因此【從來沒有執行過】(R3 F3)。
  manualCustomerSearchCount: null,
  manualCustomerSearchActors: null,
  searchLogUnknown: false,
  searchLogFailed: false,
  searchLogTableExists: null,
  searchLogLastRowAt: null,
  searchLogStale: false,
  syncStaleOpen: 0,
  syncStaleSuppliers: [],
  syncOpenRecent: 0,
  syncSuppliersSeen: 0,
  syncStaleHours: 6,
  syncStaleUnknown: true,
  syncStaleFailed: false,
  stuckBankCount: 0,
  stuckBankOldestCreated: null,
  // 🔵 ⟦b4-PAIDTHENOVERPAID⟧ 第二個世界(2026-09-05)——
  //    🎯 **這兩欄是被 `CLEAN_RESULT` 的型別逼出來的**, 那正是 R3 F3 那道機制的用途:
  //      我在 use-case 加了兩個必填欄位, 而 typecheck 當場把每一個 fixture 點名。
  stuckBankOverpaidCount: 0,
  stuckBankOverpaidOldest: null,
  stuckBankUnknown: false,
  stuckBankFailed: false,
  searchLogAnonExecuteRevoked: null,
  manualCustomerSearchUnknown: false,
  manualCustomerSearchFailed: false,
  orderCreatedStuckCount: null,
  orderCreatedStuckOldestMinutes: null,
  orderCreatedStuckUnknown: false,
  emailOutboxUnknown: false,
  emailOverdueCount: null,
  emailDeadLetterCount: null,
  emailStuckSendingCount: null,
  emailQuotaConfirmedCount: null,
  emailQuotaSuspectedCount: null,
  pcmIncidentOpenTotal: 0,
  pcmIncidentUnknown: false,
  pcmIncidentOldest: null,
  pcmIncidentByKind: {},
};

// 🔵 notifier 要是**可觀察**的 —— 舊的 `[{}]` 只是佔位, 收不到「有沒有寄」。
const okNotify = vi.fn(async () => undefined);
const DEPS = { reader: {}, notifiers: [{ notify: okNotify }] };

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
  /**
   * 🔴 **codex 2026-08-31 R1 nit**:`SHIPPED_EMAIL_CUTOFF` 原本只在各案例尾端手動 `delete`
   * ⇒ 案例在那一行【之前】就紅掉時,那顆 env **留給下一個案例**
   * ⇒ 後面那些「未設起始線」的案例會連鎖誤紅,而**它們的紅講的是別人的錯**。
   * 📌 **一個只在成功路徑上執行的清理,等於沒有清理。**
   */
  delete process.env.SHIPPED_EMAIL_CUTOFF;
  // 🔴 訊號 4 那顆也要清(codex 2026-08-31 R1 nit)—— 同上一行的理由:
  //    一個只在成功路徑上執行的清理等於沒有清理, 而殘值會讓後面的案例讀到別人的世界。
  delete process.env.B4_DEPLOY_CUTOFF;
  /**
   * 🔴🔴 **adversarial-reviewer R4 must-fix ③** —— 這顆原本只在**各案例尾端**還原,
   *    而那三行寫在 `expect` 【之後】⇒ 案例紅掉時那一行不會跑 ⇒ flag 留成 `'true'` 給下一個案例。
   * 🎯 **而它與 must-fix ② 成鏈**:我量突變紅幾格時, 第一格紅掉會汙染後面的世界
   *    ⇒ 📌 **「我記錯了數字」最合理的機制, 就是這顆沒清的 env。**
   *    🔬 而本檔 §afterEach 上面兩段逐字寫過同一句話兩次
   *      (`SHIPPED_EMAIL_CUTOFF` / `B4_DEPLOY_CUTOFF`)⇒ **我讀過它, 然後寫了第三個實例。**
   */
  delete process.env.BANK_TRANSFER_CHECKOUT_ENABLED;
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
      // 🔵 出貨那兩個(2026-08-31;Sean `2 甲`)。本檔沒設 env ⇒ 起始線是 null = 那一段不查。
      //   🛑 這裡用【完整物件比對】不是 toMatchObject —— 多一個沒有人拍板的 option 會紅。
      shippedCutoffIso: null,
      shippedGraceSeconds: 900,
      /**
       * 🔵 訊號 4 的起始線(2026-08-31;Sean 拍 5️⃣ 甲)。本檔沒設 `B4_DEPLOY_CUTOFF` ⇒ null。
       * ✅ **而這一格是被上面那道【完整物件比對】逼出來的** —— 我加 option 的時候它紅了,
       *   而那正是它存在的理由(檔內逐字:「多一個沒有人拍板的 option 會紅」)。
       *   ⇒ 📌 **這個紅不是壞事,是那道守門在做它的工作。**
       */
      orderCreatedCutoffIso: null,
      /**
       * 🔵 ⟦b9-ENUMWATCH⟧ 片 2(2026-09-01):客戶搜尋計數的回看窗口 = 24 小時。
       * ✅ **而這一格【又一次】是被上面那道完整物件比對逼出來的** —— 我加 option 的時候它紅了。
       *    ⇒ 檔內 `:276` 逐字「多一個沒有人拍板的 option 會紅」⇒ **它今天第二次做到了。**
       * 🛑 **它不是門檻** —— 本片刻意不設門檻(板 `⟦b4-ENUM3⟧` 逐字「門檻不要用猜的」),
       *    這個數字不進 `shouldAlert`。
       */
      manualCustomerSearchWindowSeconds: 86400,
      orderCreatedStuckMinutes: null,
    });
  });

  /**
   * 🔴🔴 **這三處的值從 `2026-08-20` 改成 `2026-08-31`,而那不是換個好看的日期。**
   *
   * 本檔改前用 `'2026-08-20T00:00:00.000Z'` 當「有設起始線」的世界,而**那個值在正式環境
   * 一定不會生效**:`shipped-email-cutoff.ts:74` 有下界 `EARLIEST_SANE = 2026-08-30T00:00:00+08:00`
   * (= UTC `2026-08-29T16:00:00Z`)⇒ 08-20 落在它之前 ⇒ **寄信端判 bad-format、一封都不排。**
   * ⇒ 📌 **改前這幾格測的是一個【在正式庫上永遠不成立的設定】,而它們全綠。**
   * 🛑 而它們之所以能綠,是因為**本 route 改前不用那支 resolver**(自己 `trim()` 就當合法)——
   *   ⇒ **測試與被測物共用同一個錯誤前提,所以它們互相印證。**
   * ✅ 選 `2026-08-31T00:00:00.000Z` 的理由:它在下界之後,**而且正規化後與原字串逐字相同**
   *   (resolver 會回 `new Date(t).toISOString()`)⇒ 下面那條 `shippedCutoffIso` 的斷言仍可寫字面。
   */
  it('🔵 SHIPPED_EMAIL_CUTOFF 有設 ⇒ 起始線【真的傳下去】,而且沒有那一行 log', async () => {
    // 🔴 沒有這一格,一個「在 route 裡寫死 null」的實作會讓上面那格全綠 ——
    //   而那正好等於【出貨缺口那一段永遠不查】。
    process.env.SHIPPED_EMAIL_CUTOFF = '2026-08-31T00:00:00.000Z';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await GET(makeReq(bearer()));

    expect(checkSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shippedCutoffIso: '2026-08-31T00:00:00.000Z',
        shippedGraceSeconds: 900,
        // 🔵 訊號 4 的起始線:本案例沒設 B4 ⇒ 必須是 null(而不是被漏傳成 undefined)
        orderCreatedCutoffIso: null,
        orderCreatedStuckMinutes: null,
      }),
    );
    /**
     * 🔴 上膛了就【不該】再印那一行 —— 否則它是一個無條件的標籤,不是一個訊號。
     * 🔴 錨用 `env` 不用散文:訊號 4 那一行也寫「還沒上膛」(它的 env 是 `B4_DEPLOY_CUTOFF`)
     *   ⇒ 用散文當錨會把別人的訊號讀成自己的。
     */
    const infoJson2 = JSON.stringify(infoSpy.mock.calls);
    expect(infoJson2).not.toContain('SHIPPED_EMAIL_CUTOFF');
    // 🔵 正對照:B4 那一行在(本案例沒設它)⇒ 上面那個 not 不是因為 spy 是空的
    expect(infoJson2).toContain('B4_DEPLOY_CUTOFF');
    infoSpy.mockRestore();
    delete process.env.SHIPPED_EMAIL_CUTOFF;
  });

  it('[訊號4] 🔵 B4_DEPLOY_CUTOFF 有設 ⇒ 起始線【真的傳下去】,而且沒有那一行 info', async () => {
    // 🔴 沒有這一格, 一個「在 route 裡把 orderCreatedCutoffIso 寫死 null」的實作會全綠 ——
    //   而那等於【訊號4 永遠不查】。(codex 2026-08-31 R1 must-fix:原本一個案例都沒設過 B4。)
    process.env.B4_DEPLOY_CUTOFF = '2026-08-22T00:00:00.000Z';
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await GET(makeReq(bearer()));
    expect(checkSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderCreatedCutoffIso: '2026-08-22T00:00:00.000Z' }),
    );
    // 🔴 上膛了就不該再印那一行;錨用 env 不用散文(出貨那一行也寫「還沒上膛」)。
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain('B4_DEPLOY_CUTOFF');
    infoSpy.mockRestore();
    delete process.env.B4_DEPLOY_CUTOFF;
  });

  it('[訊號4] 🔴 負對照:B4 設成空字串 ⇒ 判 invalid ⇒ 不傳下去、印 error、而【不 503】', async () => {
    /**
     * 🛑 空字串是 `invalid` 不是 `unset` —— `readDeployCutoff` 只認 `raw === undefined` 為沒設。
     *   ⇒ 那是 codex 關卡2 R5 修掉的舊 bug:設了而貼成空值, 會被讀成「還沒上膛」而安靜跳過。
     * 🔴 而它**不得 503** —— 一顆訊號4 的 env 不該把同輪的付款/退款告警帶走
     *   (codex 今天 R1 已經打過我一次同型)。
     */
    process.env.B4_DEPLOY_CUTOFF = '';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(checkSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orderCreatedCutoffIso: null }),
    );
    expect(JSON.stringify(errSpy.mock.calls)).toContain('bad_cutoff_format');
    /**
     * 🔴 它不是「還沒上膛」—— 這一條擋的是把 invalid 與 unset 併成一條的實作。
     * 🔴🔴 **而錨【第二次】被迫換掉**(第一次是散文「還沒上膛」):
     *   兩個訊號連 `reason` 都一樣是 `skipped_no_cutoff`
     *   ⇒ 本案例的 SHIPPED 那顆沒設 ⇒ 它會印 `skipped_no_cutoff` ⇒ 用它當錨照樣撞。
     * 📌 **⇒ 兩個訊號共用【散文】與【reason 代碼】兩層,唯一分得開的是 `env`。**
     *   而那對讀 log 的人一樣成立:他看到 `skipped_no_cutoff` 也不知道是哪一顆 env。
     * ✅ 所以這裡問的是:**B4 那顆有沒有出現在 info 裡**(invalid 該走 error,不該走 info)。
     */
    const infoJson = JSON.stringify(infoSpy.mock.calls);
    expect(infoJson).not.toContain('B4_DEPLOY_CUTOFF');
    // 🔵 正對照:SHIPPED 那一行【在】info 裡 ⇒ 上面那個 not 不是因為 spy 是空的
    expect(infoJson).toContain('SHIPPED_EMAIL_CUTOFF');
    // 🛑 零 PII:那顆 env 的值(這裡是空字串, 換成別的值同理)不得進 log。
    errSpy.mockRestore();
    infoSpy.mockRestore();
    delete process.env.B4_DEPLOY_CUTOFF;
  });

  it('[訊號4] 🔴🔴 起始線有設而 RPC 讀不到 ⇒ 503(不得安靜回 200)', async () => {
    /**
     * 🔴 **這一格是 codex 2026-08-31 R1 must-fix** —— 我第一版**完全沒消費**
     *   `orderCreatedGapUnknown` ⇒ adapter 已經降級成「查不到」, 而 route 照樣記成功心跳回 200
     *   ⇒ 📌 **監控會把「查不到」讀成健康** —— 那正是本片要治的病本身。
     * 🛑 而它與「沒上膛」是兩個世界:沒設起始線 ⇒ 正常 ⇒ 不得 503(下一格演那個)。
     */
    process.env.B4_DEPLOY_CUTOFF = '2026-08-22T00:00:00.000Z';
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, orderCreatedGapUnknown: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).toContain('get_order_created_gap_counts');
    errSpy.mockRestore();
    delete process.env.B4_DEPLOY_CUTOFF;
  });

  it('[被吞掉的失敗] 🔴🔴 pcmIncidentUnknown ⇒ 503 + 記失敗心跳(不得安靜回 200)', async () => {
    /**
     * ⟦b4-PENDINGREFUNDSILENT⟧ —— codex 2026-09-05 must-fix ⑤:
     * 我把 `pcmIncidentUnknown` 接進 adapter / summary / route, **而只在 fixture 裡寫了 false**
     * ⇒ 📌 **把 route 那個新分支整段刪掉, 這支測試照樣全綠。**
     * 🛑 回 200 等於宣稱「今天沒有被吞掉的失敗」—— 而那張表上的每一列都代表
     *    「有人匯了錢而退款單沒開成」。**「查不到」與「沒有」在這裡是兩件事。**
     */
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, pcmIncidentUnknown: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status, '讀不到而回 200 ⇒ 監控把「查不到」讀成健康').toBe(503);
    expect(hbFailSpy, '503 而沒記失敗心跳 ⇒ 心跳那條線會以為它今天跑成功了').toHaveBeenCalled();
    // 🔴 斷言 log 裡有函式名 —— 那是「兩個世界」(還沒 apply / 真的壞了)唯一分得開的東西。
    expect(JSON.stringify(errSpy.mock.calls)).toContain('get_pcm_incident_health');
    errSpy.mockRestore();
  });

  it('[被吞掉的失敗] 🔵 而 Unknown=false 時不得 503 —— 證明上一格不是恆紅', async () => {
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, pcmIncidentUnknown: false });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });

  it('[取消信收件人] 🔴🔴 起始線有設而新 RPC 讀不到 ⇒ 503(不得安靜回 200)', async () => {
    /**
     * 🔴 **codex 2026-09-03 must-fix** —— 我把三格接進 summary / shouldAlert / 訊息 / result,
     *   **而漏了 route 這一層** ⇒ cutoff 有設、RPC 還沒 apply ⇒ 回 200 + 一片綠。
     * 🎯 而「安靜」與「這道告警根本沒裝上」印同一個畫面 —— 那正是我自己寫進 plan 的驗收條件。
     */
    process.env.B4_DEPLOY_CUTOFF = '2026-08-22T00:00:00.000Z';
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, unpaidCancelledGapUnknown: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).toContain('get_order_unpaid_cancelled_gap_counts');
    errSpy.mockRestore();
    delete process.env.B4_DEPLOY_CUTOFF;
  });

  it('[更正單號信收件人] 🟢🟢 負對照:這條線【沒上膛】而 unknown=true ⇒ 200(不得 503)', async () => {
    // 🔴🔴 **這一格是 pre-push 的部署時序閘翻出來的**(主視窗 2026-09-05 批補):
    //    程式先上、migration 後貼的那個窗口裡, `trackingCorrectedGapUnknown` **保證為真**
    //    ⇒ 少了 `shippedCutoffIso !== null` 這個前提, 這支 cron **每一發都 503 + 寫失敗心跳**。
    // 🎯 **不要為一條還沒上膛的線, 抱怨它的儀器不見了** —— 而「還沒上膛」的定義就是那顆 env 沒設。
    delete process.env.SHIPPED_EMAIL_CUTOFF;
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, trackingCorrectedGapUnknown: true });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(hbFailSpy).not.toHaveBeenCalled();
  });

  it('[更正單號信收件人] 🔴 unknown=true ⇒ 503 + 心跳失敗 + log 說得出是哪一支', async () => {
    // 🎯 與姊妹那格同一個病:RPC 還沒 apply ⇒ 三格 null ⇒ 告警恆不叫, 而 route 照回 200
    //   ⇒ 「安靜」與「這道告警根本沒裝上」印同一個畫面。
    // 🔴 **本格要先讓這條線【上膛】** —— 2026-09-05 補了 `shippedCutoffIso !== null` 前提之後,
    //   沒設那顆 env 就不該吵(上面那格負對照守它)。⇒ 這裡設它, 才走得到 503 那條路。
    delete process.env.B4_DEPLOY_CUTOFF;
    process.env.SHIPPED_EMAIL_CUTOFF = '2026-09-01T21:30:00+08:00';
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, trackingCorrectedGapUnknown: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).toContain('get_tracking_corrected_gap_counts');
    errSpy.mockRestore();
  });

  it('[更正單號信收件人] 🟢 負對照:unknown=false ⇒ 200(證明上一格不是恆 503)', async () => {
    delete process.env.B4_DEPLOY_CUTOFF;
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, trackingCorrectedGapUnknown: false });
    expect((await GET(makeReq(bearer()))).status).toBe(200);
  });

  it('[取消信收件人] 🔵 負對照:起始線【沒設】而 unknown=true ⇒ 200(不得 503)', async () => {
    // 🛑 少了這一格, 一個「凡 unknown 就 503」的實作會讓上一格全綠 ——
    //   而那會讓一個【還沒上膛】的功能每天把整支 cron 弄紅一次。
    delete process.env.B4_DEPLOY_CUTOFF;
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, unpaidCancelledGapUnknown: true });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });

  it('[訊號4] 🔵 負對照:起始線【沒設】而 unknown=true ⇒ 200(不得 503)', async () => {
    // 🛑 少了這一格, 一個「凡 unknown 就 503」的實作會讓上一格全綠 ——
    //   而那會讓一個【還沒上膛】的功能每天把整支 cron 弄紅一次。
    delete process.env.B4_DEPLOY_CUTOFF;
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, orderCreatedGapUnknown: true });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });

  it('🔴🔴 起始線【設了而形狀不合】⇒ 503,而且【不是】走「還沒上膛」那條路', async () => {
    /**
     * 🔴 **這一格分的是兩個【很容易被併成一條】的世界**:
     *   沒設   = 功能還沒開 = 正常 ⇒ `info`「還沒上膛」、200、`checkAnomalyAlerts` 照跑。
     *   設錯   = **寄信端此刻一封都不寄, 而設的人以為他開好了** ⇒ 503, 且**不該跑**下去。
     * 🛑 併成一條的話, 一個打錯的 env 會安靜地長得像「還沒開」—— 那正是本片要治的病。
     * ⚠️ 用 `2026-08-11`(**形狀合法、而在下界 `EARLIEST_SANE` 之前**)當輸入,
     *   因為它是**最像對的那一種錯**:貼進 Vercel 不會有任何東西提醒你。
     */
    process.env.SHIPPED_EMAIL_CUTOFF = '2026-08-11T00:00:00.000Z';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));

    expect(res.status).toBe(503);
    /**
     * 🔴🔴 **這一條原本是反過來寫的,而 codex 2026-08-31 R1 判它 must-fix。原句留著**:
     *   ⛔ ~~`expect(checkSpy).not.toHaveBeenCalled();`~~
     *   codex 逐字:「bad-format 測試強制斷言 `checkAnomalyAlerts` 不得執行
     *   ⇒ 修成『出貨段停用但其他告警照送』時測試反而變紅,**將上述缺陷鎖成契約**。」
     * 📌 **⇒ 一條寫錯方向的斷言,不只是漏測 —— 它會在有人來修的時候變紅,把錯的行為變成規格。**
     * ✅ 正確的宣稱:出貨那一段不查(`shippedCutoffIso` 為 null),而**別類告警照跑**。
     */
    expect(checkSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shippedCutoffIso: null }),
    );
    /**
     * 🔴 它不是「還沒上膛」。這一條擋的是【把兩個世界併成一條】的實作。
     * 🔴🔴 **而斷言的【錨】從散文換成了結構化欄位**(2026-08-31,訊號 4 接線時撞到):
     *   訊號 4 也印一行「還沒上膛」(它的 env 是 `B4_DEPLOY_CUTOFF`,本案例沒設 ⇒ 它會印)
     *   ⇒ **兩行不同的訊號共用同一句散文** ⇒ 用散文當錨的斷言**分不出是哪一行**。
     * 📌 **⇒ 而那不只是測試的問題:一個人在 log 裡看到「還沒上膛」也分不出是哪一顆 env。**
     *   ✅ 兩行各自在結構化 payload 裡帶了自己的 `env` ⇒ **錨改用那個,不用散文。**
     */
    const infoJson = JSON.stringify(infoSpy.mock.calls);
    expect(infoJson).not.toContain('SHIPPED_EMAIL_CUTOFF');
    // 🔵 正對照:訊號 4 那一行【應該】在(本案例沒設 B4)⇒ 證明上面那個 not 不是因為 spy 是空的
    expect(infoJson).toContain('B4_DEPLOY_CUTOFF');
    expect(JSON.stringify(errSpy.mock.calls)).toContain('bad_cutoff_format');
    // 🛑 零 PII:使用者填的那個值本身不得進 log(`why` 是我們自己寫死的字串)。
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('2026-08-11');
    errSpy.mockRestore();
    infoSpy.mockRestore();
    delete process.env.SHIPPED_EMAIL_CUTOFF;
  });

  it('🔴 負對照:env 設成空白 ⇒ 仍然是 null(不得把空字串當成一個起始線)', async () => {
    process.env.SHIPPED_EMAIL_CUTOFF = '   ';
    await GET(makeReq(bearer()));
    expect(checkSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ shippedCutoffIso: null }),
    );
    delete process.env.SHIPPED_EMAIL_CUTOFF;
  });

  it('🔴🔴 起始線【有設】而那支 RPC 讀不到 ⇒ 回 503(不得安靜回 200)', async () => {
    // 🔴 codex R1 must-fix 1:片1 給那支 RPC 裝了 fail-closed,
    //   而若這裡不看 shippedGapUnknown, 那道 fail-closed 在下游就被拆掉了。
    process.env.SHIPPED_EMAIL_CUTOFF = '2026-08-31T00:00:00.000Z';
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, shippedGapUnknown: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
    errSpy.mockRestore();
    delete process.env.SHIPPED_EMAIL_CUTOFF;
  });

  it('🔴🔴 負對照:起始線【沒設】而同樣 unknown ⇒ 仍然 200(還沒上膛不是失敗)', async () => {
    // 🛑 這一格是上一格唯一會出錯的地方:少了它, 一個「一律 503」的實作會讓上一格全綠,
    //   而那會讓一個【還沒設定】的功能每天把整支 cron 弄紅一次。
    delete process.env.SHIPPED_EMAIL_CUTOFF;
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, shippedGapUnknown: true });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });

  it('🔴 沒設 ⇒ 那一行 log【要印】,而訊息含那顆 env 的名字', async () => {
    delete process.env.SHIPPED_EMAIL_CUTOFF;
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await GET(makeReq(bearer()));
    expect(JSON.stringify(infoSpy.mock.calls)).toContain('SHIPPED_EMAIL_CUTOFF');
    infoSpy.mockRestore();
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

describe('catch 的 errorName — 讓「程式錯誤 ≠ 設定錯誤」抵達觀察者(J-003 MF-1)', () => {
  // 🔴 J-003 MF-1:composition-alert-failclosed.test.ts 斷言那個分辨【分得開】,
  //    而在裸的 catch{} + 只記固定碼之下,它在 route 這一層就消失了 ⇒ 那格守門沒有消費者。
  //    下面兩格就是它的消費者:兩個世界必須印不同的字。
  //    ⚠️ 射程:只證明分辨抵達 console.error。**沒有人驗過那行在 Vercel log 出得來**(J-003 MF-3)。
  // ✅ 兩發突變都表演過該紅的那一發(2026-08-21 實跑,shasum 比對還原):
  //    D 把 `errorName` 從 payload 拿掉(= J 報的那個世界)⇒ 3 failed
  //    E `err.name` 改成 `err.message`(= 把洩漏面打開)  ⇒ 2 failed
  const CONFIG_MSG = 'ANOMALY_ALERT_ENABLED=true 但未設定任何告警管道(LINE/Email)';
  const BUG_MSG = 'someFn is not a function';

  // 🔴 codex F:手動 `errSpy.mockRestore()` 寫在斷言【之後】⇒ 任一前置斷言失敗就跳過清理,
  //    而全域 afterEach 只 clear、不還原 console 實作 ⇒ 一發紅會讓後面的測試吃到被 mock 掉的 console。
  //    ⇒ 清理放這裡,不放 happy path 上。
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['設定錯誤(env 缺 / 零管道)', new Error(CONFIG_MSG), 'Error', CONFIG_MSG],
    ['程式錯誤(有人把 code 改壞)', new TypeError(BUG_MSG), 'TypeError', BUG_MSG],
  ])('%s ⇒ errorName=%s,而 message 不進 log', async (_label, thrown, expectedName, secretMsg) => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDepsSpy.mockImplementation(() => {
      throw thrown;
    });
    expect((await GET(makeReq(bearer()))).status).toBe(503);
    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).toContain(`"errorName":"${expectedName}"`);
    expect(logged).toContain('deps_or_unexpected_throw'); // 固定碼沒有被換掉
    expect(logged).not.toContain(secretMsg); // 🔴 補的是類別名,不是 message
    errSpy.mockRestore();
  });

  it.each([
    ['實例自帶 name', () => Object.assign(new Error('boom'), { name: SECRET })],
    ['自訂子類的 name', () => { class E extends Error { override name = SECRET; } return new E('boom'); }],
    // 🔴 codex R2:這兩格的 Proxy trap **要自己帶著 SECRET** —— 前一版 trap 丟的是 'proxy trap',
    //    那底下的 `not.toContain(SECRET)` 在那一列是【恆綠】的(密鑰根本沒進過那條路)。
    //    ⇒ 恆綠的斷言不是保護,是裝飾。讓它帶著密鑰,那格才有牙齒。
    ['讀 name 就爆的 Proxy', () => new Proxy(new Error('boom'), { get(t, k, r) {
      if (k === 'name') throw new Error(`trap ${SECRET}`); return Reflect.get(t, k, r); } })],
    // 🔴🔴 codex R2 要我補「`instanceof` 就爆的 Proxy」(getPrototypeOf trap,與讀 `.name` 是不同的 trap)。
    //    **我構造不出來,而這一格寫的是【構造不出來】,不是【驗過了】。**
    //    量到的:
    //      · 純 node 裡它成立 —— `throw p` 之後 `e === p` 為 true、`e instanceof Error` 丟 TRAP-FIRED。
    //      · 但**穿過 `vi.fn()` 的 mock 之後就不成立**:route 的 catch 收到的是一個【普通 Error】。
    //        探針(暫時塞進 safeErrorName、跑完已還原)實印:
    //          typeof=object / Object.prototype.toString=[object Error] / (err instanceof Error)="true"
    //        ⇒ trap 在抵達 catch **之前**就被觸發過一次,而它丟出的那個普通 Error 取代了 Proxy。
    //    ⇒ 所以下面這一列斷言的是**真的會發生的那件事**,不是我希望發生的那件事:
    //      trap 丟出的 Error 抵達 catch ⇒ errorName='Error'、**而 trap 訊息裡的 SECRET 不得進 log**
    //      (那一格有牙齒:實作若改成記 err.message,這一列就會紅)。
    //    🔴 未覆蓋:「`instanceof` 在 safeErrorName 裡面爆」那個世界,**從 route 邊界構造不出來**
    //      ⇒ 實作那邊的 try 仍然包著它(便宜且正確),而**它沒有回歸守門**。這是缺口,不是已驗。
    [
      'getPrototypeOf trap(而 trap 的 Error 會先取代它)',
      () => new Proxy(new Error('boom'), { getPrototypeOf() { throw new Error(`trap ${SECRET}`); } }),
      'Error',
    ],
    ['根本不是 Error', () => SECRET],
  ])(
    '🔴 %s ⇒ 密鑰進不了 log、而且照樣 503(codex A-1/A-2/G-2)',
    async (_label, make, expectedName = 'other') => {
      // 🔴 這四格是 codex 對抗審查逼出來的,而第一格他【當場表演給我看】:
      //    `name` 是可寫欄位 ⇒ 我原本「類別名是封閉集合、永遠不含密鑰」那句話是假的。
      //    修法不是相信它,是**由 safeErrorName 自己造出那個封閉集合**。
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      getDepsSpy.mockImplementation(() => {
        throw make();
      });
      // 🔴 Proxy 那格同時釘住:catch 自己不得 throw —— 它 throw ⇒ 變 500 且零 log,比修之前更糟。
      expect((await GET(makeReq(bearer()))).status).toBe(503);
      const logged = JSON.stringify(errSpy.mock.calls);
      expect(logged).toContain(`"errorName":"${expectedName}"`);
      expect(logged).not.toContain(SECRET);
      expect(logged).toContain('deps_or_unexpected_throw');
    },
  );

  it('🔴 兩個世界【真的印不同的字】—— 不然上面兩格可以同時綠而分辨仍然是死的', async () => {
    const names: string[] = [];
    for (const thrown of [new Error(CONFIG_MSG), new TypeError(BUG_MSG)]) {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      getDepsSpy.mockImplementation(() => {
        throw thrown;
      });
      await GET(makeReq(bearer()));
      names.push(JSON.stringify(errSpy.mock.calls));
      errSpy.mockRestore();
    }
    expect(names[0]).not.toEqual(names[1]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// J-001 MF-1/MF-2 修法的守門(2026-08-21,告警信線)
//
// 🔴 J-001 量到的形狀:route.ts 檔頭裡【被本片改到的檔】的 檔案:行號 引用 4/4 全壞,
//    【沒被改到的】1/1 全對。⇒ 病不是「數字寫錯」,是【拿行號當錨】。
//    而修法若只是更新數字,下一輪折完它會再壞一次,**而壞掉時沒有任何東西會紅**。
// ⇒ 所以錨改成【字面】(那行 code 本身),並由下面兩格讓「錨斷掉」變成一發紅。
//
// 🔴 本守門的射程(不要讀成「所有失效引用都擋得住」):
//    擋得住 ① 檔案:行號 形式的新引用 ② 反引號包住的裸行號 `:123`
//           ③ 註解宣稱的四個錨,任何一個從目標檔消失
//    擋不住 ① 裸寫的「與 :234」這種形式(J-001 自己的 regex 也漏掉它,方向是少報)
//           ② 🔴 **把目標檔那行 code【註解掉】** —— 字面還在,五格照樣綠(codex B-2)。
//              ⇒ 這道守門管的是【引用指得到東西】,**不管行為還在不在**。行為由目標檔自己的
//                測試守(`LineAlertNotifierAdapter.test.ts` / `EmailAlertNotifierAdapter.test.ts`
//                斷言非 2xx 會 throw)。兩件事分開,不要把這裡讀成「行為有人守」。
//           ③ 反過來的誤報:反引號包住的**連接埠**(例如 `:3000`)會被第二格判成行號(codex C-2)。
//              現況全檔零命中;哪天真要寫,那一發是**大聲的紅**、不是安靜的漏 ⇒ 不為它加聰明。
//    ⇒ 這三格靠人,不靠這支測試。寫在這裡是為了讓下一個人知道分母到哪為止。
//
// ✅ 三發突變都表演過【該紅的那一發】(2026-08-21 實跑,改完 shasum 比對還原):
//    A 在 route.ts 補一行 `composition.ts:999`            ⇒ 1 failed
//    B composition.ts 的 `to: requireEnv('LINE_ALERT_TO'),` 改名 ⇒ 1 failed
//    C LineAlertNotifierAdapter 的 `if (!res.ok) {` 改寫法 ⇒ 1 failed
//    D(意外的一發)反引號裸行號那格,在我自己寫說明時就當場紅了一次。
//    🔴 而 B 的第一版【沒紅】—— 錨當時只寫 `requireEnv('LINE_ALERT_TO')`,
//       它在 composition.ts 的**註解裡**也命中 ⇒ 突變改到註解、code 沒動,守門照樣綠。
//       ⇒ 錨要落在【只有 code 會長成的形狀】上,這就是為什麼上面帶著 `to:` 前綴。
// ─────────────────────────────────────────────────────────────────────────────
const ROUTE_SOURCE = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
const REPO_ROOT = new URL('../../../../../../../', import.meta.url); // → repo 根(路徑錯會 ENOENT 大聲死,不會安靜過)

/** route.ts 註解宣稱的跨檔錨:[目標檔, 那段 code 的字面]。字面同時要在 route.ts 與目標檔裡。 */
const CROSS_FILE_ANCHORS: ReadonlyArray<readonly [string, string, string]> = [
  // [目標檔, 目標檔裡那行 code 的字面, route.ts 裡指向它的【那一格獨有】的字串]
  // 🔴 第三欄是 codex B-1 逼出來的:LINE 與 Email 的 code 錨【是同一個字串】
  //    ⇒ route.ts 那半只用 code 錨的話,刪掉 Email 那句引用、留著 LINE 的,Email 那格照樣綠。
  //    ⇒ 兩格共用一個字面 = 那兩格其實只有一格。
  [
    'packages/adapters/src/payment/LineAlertNotifierAdapter.ts',
    'if (!res.ok) {',
    'LineAlertNotifierAdapter.ts',
  ],
  [
    'packages/adapters/src/payment/EmailAlertNotifierAdapter.ts',
    'if (!res.ok) {',
    'EmailAlertNotifierAdapter.ts',
  ],
  // 🔴 錨帶著 `to:` 前綴 —— 光是 `requireEnv('LINE_ALERT_TO')` 在 composition.ts 的【註解裡】也命中
  //    (實測:突變只改註解那處,守門照樣綠)⇒ 錨必須落在【只有 code 會長成的形狀】上。
  [
    'apps/storefront/src/lib/payment/composition.ts',
    "to: requireEnv('LINE_ALERT_TO'),",
    "to: requireEnv('LINE_ALERT_TO'),",
  ],
  [
    'apps/storefront/src/lib/payment/composition.ts',
    "to: requireEnv('ALERT_EMAIL_TO'),",
    "to: requireEnv('ALERT_EMAIL_TO'),",
  ],
  [
    'supabase/migrations/20260723120000_m3_s2_settle_sweep_pgcron.sql',
    "cron.schedule('pcm-anomaly-alert', '0 1 * * *'",
    "cron.schedule('pcm-anomaly-alert', '0 1 * * *'",
  ],
];

describe('route.ts 檔頭的跨檔引用 — 錨在字面、不在行號(J-001 MF-1/MF-2)', () => {
  it('全檔零「檔案:行號」引用 —— 行號會漂,而漂掉時沒有訊號', () => {
    // 🔴 這個 pattern 換過三次,而**前兩次都是同一個錯法:我在猜副檔名的字集。**
    //    v1 `ts|tsx|json|sql|md`         ⇒ codex C-1:js / mjs / css / sh / yaml / 大寫全漏
    //    v2 `[A-Za-z][A-Za-z0-9]{0,4}`   ⇒ codex R2:`.svelte` / `.prisma` / `.graphql` 仍漏
    //    ⇒ **相同錯法第二次 = 換路,不是再猜一次。**(`00-work-rules` R4)
    //    v3 不列舉副檔名了 —— 判準改成【那個 token 裡有沒有一個點】,
    //       因為「檔名.任何副檔名」共同的形狀是**點**,而點不會過期。
    //    ⚠️ 已知誤報:帶埠號的網域(`admin.example.com:3000`)會中。現況全檔零命中;
    //       真要寫的那天它是**大聲的紅**,不是安靜的漏 ⇒ 方向是對的,不為它加聰明。
    const hits = ROUTE_SOURCE.match(/[\w./-]*\.[\w-]+:L?\d+/g) ?? [];
    expect(hits).toEqual([]);
  });

  it('全檔零反引號裸行號(`:123` / `:123-125`)—— 同一個病,換一種寫法', () => {
    // 🔴 只認【反引號包住】的形式 —— 我試過把裸寫的「與 :234」也一起抓,
    //    而那個 pattern 與時刻(`21:20`)、JSON(`"errors":0`)反覆互撞,三版都沒收斂。
    //    ⇒ 停手:裸寫那一種**明寫在上面的射程裡、交給人**,不硬做一個會誤報的量具。
    //      (誤報會把人趕出守門的視野,而那個代價比這一格漏掉更貴。)
    const hits = ROUTE_SOURCE.match(/`:L?\d+(?:-\d+)?`/g) ?? [];
    expect(hits).toEqual([]);
  });

  it.each(CROSS_FILE_ANCHORS)(
    '錨「%s / %s」在 route.ts 與目標檔裡都還在',
    (file, anchor, routeMention) => {
      // 兩邊都要:目標檔沒了 ⇒ 引用死掉;route.ts 沒了 ⇒ 這格守門失去消費者。
      expect(readFileSync(new URL(file, REPO_ROOT), 'utf8')).toContain(anchor);
      expect(ROUTE_SOURCE).toContain(routeMention);
    },
  );
});

/**
 * F-004:退款計數那支 RPC 還沒 apply 的**部署窗口**。
 *
 * 🔴 為什麼走 route 503 而不是寄信(codex 關卡1 R2):
 *    進 `shouldAlert` ⇒ DB 一直沒 apply 就**每天寄一封「尚未啟用」給老闆** ⇒ 久了變例行雜訊
 *    ⇒ 那是**把沉默換成無限重寄**,同一個病的另一面。
 *    ⇒ 「DB 函式沒 apply」是**部署問題**,該吵的對象是看 cron 的人。
 *
 * ⚠️ 而 503 **不代表信沒寄** —— 上面那封信(若本來就要寄)照常送出,只是多帶一行「今天查不到」。
 *    兩件事不要讀成同一件。
 */
describe('GET anomaly-alert — F-004 退款 RPC 尚未 apply', () => {
  it('🔴 orderRefundsStuckUnknown=true → 503(不是 200,也不是靠寄信告訴老闆)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkSpy.mockResolvedValue({
      ...CLEAN_RESULT,
      orderRefundsStuckCount: null,
      orderRefundsStuckOvernightCount: null,
      orderRefundsStuckUnknown: true,
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, orderRefundsStuckUnknown: true });
    // 訊息要講得出是哪一支函式 —— 值班的人照著這行去查。
    expect(errSpy.mock.calls.flat().join(' ')).toContain('get_order_refunds_stuck_summary');
    errSpy.mockRestore();
  });

  it('🔴 對照:unknown=false 且其餘乾淨 → 200(證明上一格是這個欄位造成的,不是別的)', async () => {
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, orderRefundsStuckUnknown: false });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });

  it('🔴 計數 0 與 unknown 是兩個世界:0 筆照樣 200', async () => {
    checkSpy.mockResolvedValue({
      ...CLEAN_RESULT,
      orderRefundsStuckCount: 0,
      orderRefundsStuckOvernightCount: 0,
      orderRefundsStuckUnknown: false,
    });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });
});

// ══ 心跳三態（b4-CRON6 爇1，R1 I2 補）══
// 🔴 本檔本次 diff 之前【零】心跳斷言 ⇒ 把那行心跳刪掉，這支檔照樣全綠。
//    那正是在 settle-sweep 上量到的形狀（139 全綠 ⇒ 刪掉一行 ⇒ 還是 139 全綠）。
describe('GET anomaly-alert — 心跳三態', () => {
  it('🟢 200 + enabled:true ⇒ 寫成功心跳、不寫失敗', async () => {
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(hbOkSpy).toHaveBeenCalledWith('pcm-anomaly-alert');
    expect(hbFailSpy).not.toHaveBeenCalled();
  });

  it('🔴 errors>0 ⇒ 503 ⇒ 寫失敗心跳、不寫成功', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, errors: 1 });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalledWith('pcm-anomaly-alert');
    expect(hbOkSpy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴🔴 旗標關著(200 + enabled:false)⇒ 兩支心跳都不得被呼叫', async () => {
    delete process.env.ANOMALY_ALERT_ENABLED;
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false });
    expect(hbOkSpy).not.toHaveBeenCalled();
    expect(hbFailSpy).not.toHaveBeenCalled();
  });

  it('🔴 401 ⇒ 一格都不寫(未認證的人也走得到那條路)', async () => {
    const res = await GET(makeReq(bearer('b'.repeat(48))));
    expect(res.status).toBe(401);
    expect(hbOkSpy).not.toHaveBeenCalled();
    expect(hbFailSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
// 🔴 M-4a:寄信那支 RPC 沒 apply ⇒ 必須有人知道
//
// **這一格是本片最重要的一格,而它差點不存在。**
// 五格刻意不進 `shouldAlert`（不進的理由：DB 沒 apply 就每天寄一封「尚未啟用」＝把沉默換成無限重寄）
// 🔴 **而「不進告警」只有在【另一條路存在】時才成立** ——
//    我第一版沒有把旗標從 use-case 帶出來 ⇒ route 讀不到
//    ⇒ RPC 一直沒 apply ⇒ **這片完全沉默,而那正是它要治的病。**
// 📌 **「我把它排除在告警之外」與「我把它交給了另一條路」是兩件事,
//    而只有後者需要那條路真的存在。**
describe('🔴 寄信計數讀不到 ⇒ route 回 503(部署管道)', () => {
  it('[U1] emailOutboxUnknown=true ⇒ 503,而且心跳記失敗', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, emailOutboxUnknown: true });
    const res = await GET(makeReq(bearer()));
    // 🔴 怎麼會紅:把 route 那段第四種 503 拿掉 ⇒ 這裡 503 變 200
    //    ⇒ 而 200 的意思是「今天一切正常」,那是假的。
    expect(res.status, 'RPC 沒 apply 而 route 回 200 ⇒ 這片完全沉默').toBe(503);
    expect(hbFailSpy).toHaveBeenCalledTimes(1);
    expect(hbOkSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('[U2] 🔴 負對照:讀得到而且是 0 ⇒ 200(它不是恆 503)', async () => {
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, emailOutboxUnknown: false });
    const res = await GET(makeReq(bearer()));
    // 🔴 沒有這一格,一個「永遠 503」的實作也會讓 U1 全綠。
    //    📌 而「讀得到而且是 0」與「讀不到」正是這一片存在的全部理由。
    expect(res.status).toBe(200);
  });
});

/**
 * 🔴 **心跳 unknown 的兩個世界(codex 2026-08-31 片3 R1 #7)。**
 * codex 逐字:「測試只釘 `unknown ⇒ 不寄信`,沒有 route 測試證明 unknown 仍產生可靠失敗訊號」
 * ⇒ 而它是對的:少了這一組, 一個「印一行 log 然後回 200」的實作會全綠,
 *   而那正是「**量具壞了被記成健康**」那個病。
 */
describe('[心跳] unknown ⇒ 要有可靠的失敗訊號', () => {
  /**
   * ⟦b4-NEEDSHUMANNOWATCHER⟧ 三格(adversarial-reviewer R3 F3, 2026-09-05)。
   * 🔴 **在此之前 route 那三條新分支【零格】** —— 整段刪掉全綠。
   *
   * 🔬 **突變實測(2026-09-05 真的跑過, 不是推的;每發從備份還原並比 sha256)**:
   * ```
   *                          補 S3 斷言【前】   補【後】
   * 🔵 正對照 不突變              紅 0            紅 0    ← 尺在該綠時是綠的
   *    只刪 S1(flag 開+Unknown)   紅 1            紅 1
   *    只刪 S2(Failed ⇒ 503)      紅 1            紅 1
   * 🔴 只刪 S3(flag 關 ⇒ warn)    紅 0            紅 1    ← 補的就是這一格
   *    三段一起刪                  紅 2            紅 3
   * ```
   * 🛑 **兩欄都留著, 而【左欄才是這段話的證據】** —— 只留右欄的話,
   *    「S3 原本沒有守門」這件事就沒有任何痕跡, 而下一個人會以為它一直都有。
   * ⚠️ **而我寫完左欄那一版之後, 補了 S3 斷言 ⇒ 那張表當場過期** ——
   *    📌 **一個量測會被【我為了回應它而做的修改】變成假的, 而它不會出聲。**
   * ⛔ ~~舊字面「三段一起刪 ⇒ 只紅 1 / 只刪中間 ⇒ 紅 2」~~ **作廢 —— 那兩個數字是我寫的, 不是量的,
   *    而它們與實測【方向相反】**(adversarial-reviewer R4 must-fix ②:它讀碼逐格推演,
   *    推出 2 和 1, 與我寫的相反 ⇒ 我去真的跑, 它對)。
   * 🎯 📌 **一個被寫進 repo 的量測, 只要沒有人重跑, 它就永遠是那份紀錄。**
   *    而它讀起來完全合理 —— 我還為它寫了一段成因分析。**成因分析會讓錯的數字更難被懷疑。**
   * 🛑 **補之前, 三段一起刪只紅 2(不是 3)** ⇒ 下面那格「flag 關著 ⇒ 200」的負對照,
   *    在【整段功能被拿掉】的世界裡照樣印綠 ⇒ **突變的粒度會改變判別力, 要逐段刪。**
   *    🔵 補了 reason 斷言之後它變成 3 ⇒ **那個「粒度陷阱」在這一格已經消失**,
   *      而**留著這段話**是因為它會在下一個「只有狀態碼斷言」的分支重演。
   *
   * 🔴🔴 **S3 逐段刪 ⇒ 紅 0 = 那一段【沒有守門】**(R4 逐格推演先抓到, 實測證實)。
   *    它是板列 ⟦b4-STUCKBANKBLINDWINDOW⟧ 在碼裡的唯一痕跡, 刪掉或改詞零訊號。
   *    ⇒ ✅ 已補:下面那格「⇒ 200」加上 `console.warn` 的 reason 字面斷言。
   */
  it('🔴 stuckBankFailed=true ⇒ 503, **而且 flag 關著也一樣**(讀壞了 ≠ 沒貼)', async () => {
    const prev = process.env.BANK_TRANSFER_CHECKOUT_ENABLED;
    delete process.env.BANK_TRANSFER_CHECKOUT_ENABLED; // ← flag 關著
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, stuckBankUnknown: true, stuckBankFailed: true });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status, 'flag 關著而【讀壞了】⇒ 仍要 503').toBe(503);
    expect(hbFailSpy).toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).toContain('get_stuck_bank_orders_health');
    errSpy.mockRestore();
    if (prev !== undefined) process.env.BANK_TRANSFER_CHECKOUT_ENABLED = prev;
  });

  it('🔴 flag 開著 + stuckBankUnknown(只是沒貼)⇒ 503', async () => {
    const prev = process.env.BANK_TRANSFER_CHECKOUT_ENABLED;
    process.env.BANK_TRANSFER_CHECKOUT_ENABLED = 'true';
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, stuckBankUnknown: true, stuckBankFailed: false });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    errSpy.mockRestore();
    if (prev === undefined) delete process.env.BANK_TRANSFER_CHECKOUT_ENABLED;
    else process.env.BANK_TRANSFER_CHECKOUT_ENABLED = prev;
  });

  /**
   * 🟢 **負對照** —— 少了這一格,「凡是 Unknown 都 503」的實作會讓上兩格全綠,
   *    而那正是主視窗 2026-09-05 裁掉的那個選項(乙:一律 503)。
   *    🔬 他的理由逐字:「窗口幾天、每天一封假警報會被關掉, 而**關掉的閘比安靜的漏更難回來**。」
   */
  it('🟢 flag 關著 + 只是沒貼(Failed=false)⇒ **200 而且要留下那一行 warn**', async () => {
    delete process.env.BANK_TRANSFER_CHECKOUT_ENABLED;
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, stuckBankUnknown: true, stuckBankFailed: false });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status, '部署窗口不吵').toBe(200);
    /**
     * 🔴 **這一行斷言是 R4 補的** —— 在它之前, 把整段 S3 刪掉是 **紅 0 格**(實測)。
     * 🎯 因為「⇒ 200」在【S3 存在】與【S3 整段消失】兩個世界裡是**同一個值**
     *    ⇒ 📌 **一個負對照, 對「這段碼在不在」零判別力。**
     * ✅ 而 reason 字面只有 S3 產得出來 ⇒ 它區分得了那兩個世界。
     */
    expect(
      JSON.stringify(warnSpy.mock.calls),
      'flag 關著仍要留一行 —— 讓翻開 flag 的人回頭看 cron log 時知道這件事在翻開前就查不到',
    ).toContain('stuck_bank_health_unknown_flag_off');
    warnSpy.mockRestore();
  });

  it('🔴 cronHeartbeatUnknown=true ⇒ 503 + 記失敗心跳(不得回 200)', async () => {
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, cronHeartbeatUnknown: true, cronHeartbeatAbnormalCount: null, cronHeartbeatAbnormalJobs: null });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).toContain('get_cron_heartbeat_stale_counts');
    errSpy.mockRestore();
  });

  /**
   * 🟢 **負對照** —— 少了這一格,「凡是跑到這裡都 503」的實作會讓上一格全綠。
   * 🛑 而這一格與訊號4 那組**不一樣**:那邊的負對照是「起始線沒設」(有 env 可以關),
   *   **心跳沒有那種 env** ⇒ 它的負對照只能是「讀得到」。
   *   ⇒ 📌 也就是說:心跳這條線**沒有「還沒上膛」那個狀態** —— 它要嘛讀得到, 要嘛就是壞了。
   */
  it('🟢 讀得到(unknown=false)⇒ 200, 證明上一格不是恆 503', async () => {
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });
});

// ⟦b9-ENUMWATCH⟧ 片 2:R2(換模型)must-fix F6 —— codex R1 那條 must-fix 的【修法本身沒有量具】。
// 🔴 我補的那個 `console.warn` 在 route.ts,而這支檔對 `manualCustomerSearchUnknown` 的命中數是 **0**
//    ⇒ **把那整個 `if` 刪掉,全套測試照樣綠。**
// 📌 ⇒ 一條 must-fix 的修法, 與它的量具, 是兩件事 —— 而只有後者會在它被拿掉時說話。
describe('⟦b9-ENUMWATCH⟧ 片 2:Unknown 那一行 warn', () => {
  it('🔴 Unknown=true ⇒ 印一行 warn(突變:刪掉 route 那個 if ⇒ 這一格必須紅)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, manualCustomerSearchUnknown: true });
    const res = await GET(makeReq(bearer()));
    // 🛑 而它**刻意不改 200 / 不記 heartbeat failure** —— 那個 Unknown 有一種完全預期的成因
    //    (那支 RPC 還沒 apply)⇒ 升成 503 會讓一個【還沒上膛】的觀測把整支 cron 看起來弄壞。
    expect(res.status).toBe(200);
    expect(
      warnSpy.mock.calls.some((c) => String(c[1] && (c[1] as { reason?: string }).reason) === 'manual_customer_search_unknown'),
      '查不到時要留一行, 否則 RPC 長期缺席沒有人會發現',
    ).toBe(true);
    warnSpy.mockRestore();
  });

  it('🟢 正對照:Unknown=false ⇒ **不印**那一行(否則它每輪都吵)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, manualCustomerSearchUnknown: false });
    await GET(makeReq(bearer()));
    expect(
      warnSpy.mock.calls.some((c) => String(c[1] && (c[1] as { reason?: string }).reason) === 'manual_customer_search_unknown'),
    ).toBe(false);
    warnSpy.mockRestore();
  });
});

/**
 * ⟦b9-RLSHARDEN⟧ 甲(片B)· route 那一段。
 *
 * 🔴 **codex 2026-09-02 must-fix ⑤ 的落點**:我加了 `bypassRlsUnknown ⇒ 503` 那個 `if`,
 *    而**沒有任何一發測試會因為刪掉它而紅** ⇒ 那一段等於沒有守門。
 * 📌 **一段【寫對了而沒有人驗】的碼, 與【沒寫】在 diff 上長得一樣完整。**
 */
// ══════════════════════════════════════════════════════════════════════════════
// 🔵 安靜日心跳(2026-09-03;Sean 拍甲)—— **這一組是這次修法的唯一證據**
// ══════════════════════════════════════════════════════════════════════════════
//
// 🔴🔴 **為什麼一定要在 route 這一層測**:第一版把心跳做在 use-case 裡, 而
//    `check-anomaly-alerts.test.ts` 那邊**全綠** —— 因為那一層看不到 route 的 503 條件。
//    ⇒ 🎯 那個缺陷是 codex 兩輪打出來的, 而**它在 use-case 的測試裡結構上驗不到**。
//    ⇒ ⇒ 📌 **修法搬了位置, 而證據也必須跟著搬。** 否則那道耦合仍然沒有人在驗。
describe('安靜日心跳 —— 位置就是它的正確性', () => {
  it('🟢 沒踩門檻 + 全部檢查都過 ⇒ 寄一封心跳, 而 route 回 200', async () => {
    const res = await GET(makeReq(bearer(SECRET)));
    expect(res.status).toBe(200);
    expect(okNotify).toHaveBeenCalledTimes(1);
    const msg = (okNotify.mock.calls as unknown as { subject: string; text: string }[][])[0]?.[0];
    expect(msg?.subject).toBe(ANOMALY_QUIET_HEARTBEAT_SUBJECT);
    // 🔴 信裡**不准有任何計數** —— 那是片2 的事(理由:那些數字永遠不為零)。
    expect(msg?.text).not.toMatch(/\d+\s*筆(?!$)/);
  });

  it('🔴 踩了門檻(alerted)⇒ **不寄心跳**(那天寄的是告警信, 不是綠燈)', async () => {
    // 🔵 ⛔ ~~`quietHeartbeatEligible: false`~~ 一併移除(R4 nit:死欄位只清掉一半)。
    //    🔴 typecheck 沒紅的原因:`checkSpy` 是裸 `vi.fn()` ⇒ **標型別只保護 fixture 本身,
    //    保護不到 mock 的【呼叫點】** —— 那是 F3 那個修法的天花板, 寫在這裡免得下一個人以為標了就全包。
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, alerted: true });
    await GET(makeReq(bearer(SECRET)));
    expect(okNotify).not.toHaveBeenCalled();
  });

  // 🔴🔴 **承重格** —— 把心跳往上搬一行, 這一格就紅。
  // ⚠️ **射程要講準**(codex R3 nit):它只餵了 `cronHeartbeatUnknown` 這一種 503。
  //    ✅ 它成立的理由是【位置】:心跳排在所有 503 分支之後 ⇒ 任何一種都到不了它。
  //    🛑 **而未來若有人在心跳【之後】新增一種 503, 這一格仍會全綠** —— 那是它的邊界,
  //       而擋那一天的是碼裡那句「不要把這一段往上搬」與這一格合起來, 不是這一格自己。
  it('🔴🔴 503 條件(以 cronHeartbeatUnknown 為代表)成立 ⇒ **一封心跳都不寄**', async () => {
    // `cronHeartbeatUnknown` 是 route 的 503 分支之一(它自己讀不到排程心跳)。
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, cronHeartbeatUnknown: true });
    const res = await GET(makeReq(bearer(SECRET)));
    expect(res.status).toBe(503);
    // 🎯 這一行是整組的核心:503 那天**收信人不該收到任何綠燈**。
    expect(okNotify).not.toHaveBeenCalled();
  });

  // 🔴🔴 codex R3 must-fix:那一項讀不到而 route 仍回 200 ⇒ 心跳照寄, **而必須說出來**。
  //    🛑 修法刻意【不是】擋掉它 —— `manualCustomerSearchUnknown` 只 warn 不 503,
  //       擋掉的話那一天既沒有信也沒有 503 ⇒ 那正是這一片要消滅的沉默。
  it('🔴🔴 有項目讀不到(而它不會 503)⇒ 照寄, 而信裡要【指名】那一項', async () => {
    checkSpy.mockResolvedValue({ ...CLEAN_RESULT, manualCustomerSearchUnknown: true });
    const res = await GET(makeReq(bearer(SECRET)));
    expect(res.status).toBe(200);
    expect(okNotify).toHaveBeenCalledTimes(1);
    const msg = (okNotify.mock.calls as unknown as { subject: string; text: string }[][])[0]?.[0];
    // 🔴 不准只寫「今天沒事」就結束 —— 那會把一個讀取失敗蓋掉。
    expect(msg?.text).toContain('讀不到');
    expect(msg?.text).toContain('客戶搜尋計數');
  });

  it('🟢 負對照:全部讀得到 ⇒ 信裡【不出現】那一段(它不是恆印)', async () => {
    await GET(makeReq(bearer(SECRET)));
    const msg = (okNotify.mock.calls as unknown as { subject: string; text: string }[][])[0]?.[0];
    expect(msg?.text).not.toContain('讀不到');
  });

  it('🔴 心跳寄不出去 ⇒ 503(一封心跳送不出去 = 告警管道壞了 = 該紅)', async () => {
    okNotify.mockRejectedValueOnce(new Error('channel down'));
    const res = await GET(makeReq(bearer(SECRET)));
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalled();
  });

  it('🔴 零 notifier ⇒ 503(那不是「今天沒事」, 是沒有任何管道能告訴你今天沒事)', async () => {
    getDepsSpy.mockReturnValue({ reader: {}, notifiers: [] });
    const res = await GET(makeReq(bearer(SECRET)));
    expect(res.status).toBe(503);
  });
});

describe('⟦b9-RLSHARDEN⟧ 甲片B:route 的兩個觀眾', () => {
  it('🔴 bypassRlsUnknown=true ⇒ 503 + 記失敗心跳(不得回 200)', async () => {
    checkSpy.mockResolvedValueOnce({
      ...CLEAN_RESULT,
      bypassRlsUnknown: true,
      bypassRlsPrivilegedCount: null,
      bypassRlsTotalRoleCount: null,
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status, '量不到卻回 200 ⇒「這把量具壞了」被記成「一切健康」').toBe(503);
    expect(hbFailSpy).toHaveBeenCalled();
    expect(JSON.stringify(errSpy.mock.calls)).toContain('get_privileged_role_bypassrls_state');
    errSpy.mockRestore();
  });

  it('🟢 正對照:兩個旗標都 false(今天的正常態)⇒ 200,而且沒有那句 log', async () => {
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain('get_privileged_role_bypassrls_state');
    errSpy.mockRestore();
  });

  it('🔴 屬性被收掉(Revoked=true 而量得到)⇒ **200 不是 503** —— 那條路是寄信,不是部署告警', async () => {
    /**
     * 🎯 這一格釘的是**兩個觀眾不要混在一起**:
     *   被收掉 ⇒ use-case 已經寄了信(LINE + Email 給 Sean)⇒ route 這一層沒事,回 200。
     *   若這裡也 503, 那支 cron 會被記成失敗 ⇒ **一個成功送出的告警被記成故障。**
     */
    checkSpy.mockResolvedValueOnce({ ...CLEAN_RESULT, bypassRlsRevoked: true, alerted: true });
    const res = await GET(makeReq(bearer()));
    expect(res.status).toBe(200);
  });
});
