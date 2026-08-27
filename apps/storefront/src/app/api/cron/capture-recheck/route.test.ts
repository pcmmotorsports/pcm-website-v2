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

  it("🔴🔴 cutoff 沒設(no-op 200 + enabled:false)⇒ **兩支心跳都不得被呼叫**", async () => {
    // 這一格是本檔存在的主要理由:它與 settle-sweep 的 no-op 是**兩個不同機制**、印一樣的形狀。
    // 寫成成功 ⇒ 沒設 cutoff 的期間心跳恆綠;寫成失敗 ⇒ 告警天天叫。兩個都不對。
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
