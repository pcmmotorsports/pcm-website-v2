// @vitest-environment node
// route.test.ts — capture-recheck 的**第一支**測試(⟦b4-CRON6⟧ 片1,R1 I2)。
//
// 🔴 **為什麼是「第一支」**:板子有一列逐字寫著「`capture-recheck` 是唯一 route 級零測試的那支」
//    (分母:`find apps/storefront/src/app/api -name 'route.ts'` ⇒ 10、`route.test.ts` ⇒ 9,差的恰好是它)。
//    ⇒ 本檔**不是**那一列的解答 —— 它只補心跳這一片需要的那幾格。**那一列仍然開著。**
//
// 🔴 **為什麼這一支特別要補**:五支 route 裡,**只有它的 no-op 走的是不同機制** ——
//    另外兩支是 `*_ENABLED` 環境旗標,而它是 `CAPTURE_RECHECK_CUTOFF_DAYS` 沒設。
//    兩者印**一樣的形狀**(`{ok:true, enabled:false, skipped:...}` + 200)
//    ⇒ 一個只在 settle-sweep 上驗過的心跳三態,**看不到這支是不是也判對了**。
//    📌 我先前對主視窗說「五支 route 都有 `*_ENABLED` 旗標」——**那句是錯的**,而錯的原因正是
//       我拿一支的形狀外推成五支,**而中間那支剛好印得一樣**。這支檔就是那個外推的解藥。

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { recheckSpy, getDepsSpy, hbOkSpy, hbFailSpy } = vi.hoisted(() => ({
  recheckSpy: vi.fn(),
  getDepsSpy: vi.fn(),
  hbOkSpy: vi.fn(),
  hbFailSpy: vi.fn(),
}));
vi.mock('@pcm/use-cases', () => ({ recheckCaptureState: recheckSpy }));
vi.mock('@/lib/payment/composition', () => ({ getSettleChargeDeps: getDepsSpy }));
// 🔴 心跳 mock 的是 **IO**,不是判斷 —— 判斷(哪一條路寫、哪一條不寫)在 route 裡。
vi.mock('@/lib/cron/heartbeat', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  recordHeartbeatSuccess: hbOkSpy,
  recordHeartbeatFailure: hbFailSpy,
}));

import { GET } from './route';
import { resetCronRateLimit } from '@/lib/cron/rate-limit';

/**
 * 乾淨的一輪。**逐欄照 `packages/use-cases/src/recheck-capture-state.ts:55-78` 抄**,不自己編。
 * 🔴 我第一版少了 `recordFailures` / `writeFailures` 兩欄 ⇒ 它們是 `undefined`
 *    ⇒ 心跳判準 `=== 0` 為假 ⇒ **測試把乾淨的一輪判成失敗**。
 *    📌 一個少了兩欄的假資料,會讓守門在【錯的那一邊】紅 —— 而紅得很像真的。
 */
const CLEAN = {
  scanned: 0,
  recordCalls: 0,
  recordFailures: 0,
  captured: 0,
  stillAuthorized: 0,
  writeFailures: 0,
  leadingFailures: 0,
};

const SECRET = 'c'.repeat(48);
const bearer = () => `Bearer ${SECRET}`;
const req = (authorization?: string) =>
  new Request('http://localhost:3000/api/cron/capture-recheck', {
    method: 'GET',
    headers: authorization === undefined ? {} : { authorization },
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetCronRateLimit();
  process.env.CRON_SECRET = SECRET;
  process.env.CAPTURE_RECHECK_CUTOFF_DAYS = '3';
  recheckSpy.mockResolvedValue({ ...CLEAN });
  getDepsSpy.mockReturnValue({});
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
});

describe('GET capture-recheck — 心跳三態(⟦b4-CRON6⟧ 片1)', () => {
  it('🟢 真的跑完一輪(200 + enabled:true)⇒ 寫成功心跳、不寫失敗', async () => {
    const res = await GET(req(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, enabled: true });
    expect(hbOkSpy).toHaveBeenCalledWith('pcm-capture-recheck');
    expect(hbFailSpy).not.toHaveBeenCalled();
  });

  // ══ 🔴 codex R1 finding 1:單列失敗【計數不拋】⇒ route 照樣 200 ══════════════
  //    沿用 `ok:true` 當心跳判準 ⇒ 每一輪都在失敗、而儀表恆綠。
  it('🔴 recordFailures > 0(route 仍回 200)⇒ 心跳寫【失敗】,不寫成功', async () => {
    recheckSpy.mockResolvedValue({ ...CLEAN, recordCalls: 3, recordFailures: 2 });
    const res = await GET(req(bearer()));
    expect(res.status).toBe(200); // 回應不變 —— 本片刻意不動這支 route 的契約
    expect(hbFailSpy).toHaveBeenCalledWith('pcm-capture-recheck');
    expect(hbOkSpy).not.toHaveBeenCalled();
  });

  it('🔴 writeFailures > 0 同樣算不乾淨(兩個欄位都要看,不是只看其中一個)', async () => {
    recheckSpy.mockResolvedValue({ ...CLEAN, writeFailures: 1 });
    const res = await GET(req(bearer()));
    expect(res.status).toBe(200);
    expect(hbFailSpy).toHaveBeenCalledWith('pcm-capture-recheck');
    expect(hbOkSpy).not.toHaveBeenCalled();
  });

  it('🔴 use-case 拋 ⇒ 503 ⇒ 寫失敗心跳、不寫成功', async () => {
    recheckSpy.mockRejectedValue(new Error('boom'));
    const res = await GET(req(bearer()));
    expect(res.status).toBe(503);
    expect(hbFailSpy).toHaveBeenCalledWith('pcm-capture-recheck');
    expect(hbOkSpy).not.toHaveBeenCalled();
  });

  it("🔴🔴 cutoff 沒設 ⇒ 兩支心跳都不得被呼叫 —— **這一格是「這支排程還沒上膛」唯一看得見的地方;改我之前, 你要知道你在關掉什麼**", async () => {
    // 這一格是本檔存在的主要理由:它與 settle-sweep 的 no-op 是**兩個不同機制**、印一樣的形狀。
    // 寫成成功 ⇒ 沒設 cutoff 的期間心跳恆綠;寫成失敗 ⇒ 告警天天叫。兩個都不對。
    //
    // 🔴🔴 **[2026-08-31 線【出貨】加註 —— 標題那句話是我加的, 理由在這裡]**
    //   **這一格是「`CAPTURE_RECHECK_CUTOFF_DAYS` 還沒設」在【線上】唯一看得見的訊號的守門。**
    //   機制:跳過那條路**不寫心跳** ⇒ 後台儀表板的 staleness 判準會在門檻之後把它標成過期
    //   ⇒ **⇒ 那就是「這支排程沒上膛」今天唯一的外部訊號**(本檔全檔 `console.*` = **0**,
    //      而它回 200 ⇒ log 上與「一切正常」印同一個畫面)。
    //   🔴 **⇒ 所以一個為了「讓儀表板不要紅」而在跳過路徑補一發心跳的人, 會把那個訊號整個關掉** ——
    //      而那個改動在 diff 上看起來是改善。**這一格就是攔它的地方, 而它會紅。**
    //   ✅ **實證**:2026-08-31 真的跑過那一發突變(在跳過路徑補 `recordHeartbeatSuccess`)
    //      ⇒ **本格當場紅**(1 failed / 8 passed)⇒ 還原後工作樹乾淨。
    //   📌 **⇒ 改這一格之前, 先答一句:那個訊號要換到哪裡去?**
    //      答不出來 ⇒ 你不是在改一格測試, 你是在把一支排程變回靜音。
    //   🔗 脈絡與 plan:板上錨 `⟦b9-CAPARM1⟧` · `~/pcm-mailbox/plan-讓沒上膛的排程出聲-CAPARM1-20260831.md`
    delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
    const res = await GET(req(bearer()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, skipped: 'skipped_no_cutoff' });
    expect(hbOkSpy).not.toHaveBeenCalled();
    expect(hbFailSpy).not.toHaveBeenCalled();
    // 順帶:那道閘在 deps 之前 —— 沒設 cutoff 時不該建 deps(檔內逐字「零 DB env 依賴」)
    expect(getDepsSpy).not.toHaveBeenCalled();
  });

  it('🔴 401(未通過認證)⇒ 一格都不寫 —— 否則路人可以灌爆失敗計數', async () => {
    const res = await GET(req('Bearer wrong-secret-wrong-secret-wrong'));
    expect(res.status).toBe(401);
    expect(hbOkSpy).not.toHaveBeenCalled();
    expect(hbFailSpy).not.toHaveBeenCalled();
  });

  it('🔴 500(CRON_SECRET 未設)⇒ 一格都不寫 —— 那條路在【認證之前】', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req(bearer()));
    expect(res.status).toBe(500);
    expect(hbOkSpy).not.toHaveBeenCalled();
    expect(hbFailSpy).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 🔴 檔頭的跨檔引用 — 錨在字面、不在行號
//
// **這一組是【複製】來的,不是新發明**:`anomaly-alert/route.test.ts` 與
// `settle-sweep/route.test.ts` 早就有同樣兩格,而**本支一直沒有** ——
// 而 2026-08-28 量到:**唯一違規的正好就是本支**(檔頭引用 `settle-sweep/route.ts:65`,
// 而那句話實際在第 70 行 ⇒ 行號漂了 5 行、內容還在、零訊號)。
// 📌 **一道有效的守門沒有被複製到隔壁,而隔壁正好就違規了。**
//    ⇒ 那不是巧合:**沒有守門的那一支,就是會累積違規的那一支。**
// ⚠️ pattern 逐字抄那兩支(含它們踩過三版才收斂的理由)—— 不自己再猜一次字集。
// ══════════════════════════════════════════════════════════════════════════
const ROUTE_SOURCE = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');

describe('route.ts 檔頭的跨檔引用 — 錨在字面、不在行號', () => {
  it('全檔零「檔案:行號」引用 —— 行號會漂,而漂掉時沒有訊號', () => {
    // pattern 來由(抄 anomaly-alert 那支,它換過三次):不列舉副檔名,
    // 判準是【那個 token 裡有沒有一個點】—— 點不會過期,而副檔名的字集會。
    const hits = ROUTE_SOURCE.match(/[\w./-]*\.[\w-]+:L?\d+/g) ?? [];
    expect(hits).toEqual([]);
  });

  it('全檔零反引號裸行號(`:123` / `:123-125`)—— 同一個病,換一種寫法', () => {
    // 只認【反引號包住】的形式;裸寫那一種明寫在射程外、交給人
    // (那兩支自陳:硬做會與時刻 `21:20`、JSON `"errors":0` 互撞,誤報比漏掉貴)。
    const hits = ROUTE_SOURCE.match(/`:L?\d+(?:-\d+)?`/g) ?? [];
    expect(hits).toEqual([]);
  });
});
