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

const { recheckSpy, getDepsSpy, hbOkSpy, hbFailSpy, alertDepsSpy, cronHbSpy, notifySpy } =
  vi.hoisted(() => ({
    recheckSpy: vi.fn(),
    getDepsSpy: vi.fn(),
    hbOkSpy: vi.fn(),
    hbFailSpy: vi.fn(),
    alertDepsSpy: vi.fn(),
    cronHbSpy: vi.fn(),
    notifySpy: vi.fn(),
  }));
vi.mock('@pcm/use-cases', () => ({ recheckCaptureState: recheckSpy }));
vi.mock('@/lib/payment/composition', () => ({
  getSettleChargeDeps: getDepsSpy,
  getAnomalyAlertDeps: alertDepsSpy,
}));
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
  // 🔵 預設:兩支金流排程都健康(abnormalCount 0)⇒ 不叫。
  cronHbSpy.mockResolvedValue({ abnormalCount: 0, abnormalJobs: [] });
  notifySpy.mockResolvedValue(undefined);
  alertDepsSpy.mockReturnValue({
    reader: { getCronHeartbeatStaleCounts: cronHbSpy },
    notifiers: [{ notify: notifySpy }],
  });
});
afterEach(() => {
  delete process.env.CRON_SECRET;
  delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
});

describe('金流那兩支排程的心跳 —— ⟦b4-SWEEPDEAD1⟧ 續(Sean 2026-09-10 拍甲)', () => {
  it('🔴🔴 CUTOFF_DAYS 未設(這支排程還沒上膛)⇒ 心跳檢查【照樣要跑】', async () => {
    // 🎯 **這一格是這一片最容易假完工的地方**:上膛閘在它之後,而那道閘回 200。
    //    檢查若被擺在閘後面, 這支排程沒上膛時它【一輪都不會跑】—— 而回應仍然是 200
    //    ⇒ 📌 一個「裝好了」的檢查, 在一個沒人注意的 env 沒設的世界裡靜靜地一次都不跑。
    delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
    const res = await GET(req(bearer()));
    expect(res.status).toBe(200);
    expect(cronHbSpy).toHaveBeenCalledTimes(1);
  });

  it('🟢 正對照:CUTOFF_DAYS 有設也照樣跑(證明上面那一格不是恆真)', async () => {
    await GET(req(bearer()));
    expect(cronHbSpy).toHaveBeenCalledTimes(1);
  });

  it('🔴 送進去的名單【恰好兩支】, 而且是金流那兩支', async () => {
    // 🛑 少送一支與那支很健康在回傳值上同形 ⇒ 這一格釘的是「有沒有少送」。
    await GET(req(bearer()));
    const jobs = cronHbSpy.mock.calls[0]![0] as ReadonlyArray<{ jobName: string }>;
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j) => j.jobName).sort()).toEqual(
      ['pcm-expire-unpaid-orders', 'pcm-settle-retry'],
    );
  });

  it('🔴 有排程過期 ⇒ 送出告警, 而訊息裡有那幾支的名字', async () => {
    cronHbSpy.mockResolvedValue({ abnormalCount: 1, abnormalJobs: ['pcm-settle-retry'] });
    await GET(req(bearer()));
    expect(notifySpy).toHaveBeenCalledTimes(1);
    const msg = notifySpy.mock.calls[0]![0] as { subject: string; text: string };
    expect(msg.text).toContain('pcm-settle-retry');
    // 🔴 承重:它講的是【多久沒成功】, 不是【剛剛失敗了一次】——
    //    那兩支是純 SQL 排程, 失敗次數量不到(cron-jobs.ts 的 FAILURE_COUNT_MEANINGLESS)。
    expect(msg.text).toContain('沒有成功');
  });

  it('🟢 正對照:都健康 ⇒ 一則都不叫(證明上面那一格不是恆叫)', async () => {
    await GET(req(bearer()));
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('🔴 心跳查不到(那支 DB 函式還不在)⇒ 不得當成【零異常】而安靜', async () => {
    cronHbSpy.mockResolvedValue(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await GET(req(bearer()));
    expect(notifySpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('🔴🔴 心跳整段壞掉【不可以弄壞本業】—— capture-recheck 照樣跑完、照樣寫心跳', async () => {
    // 📌 這是一個搭便車的觀察者。它壞了要出聲, 而不是把請款重查一起拖下水。
    alertDepsSpy.mockImplementation(() => {
      throw new Error('PAYMENT_CONFIRMER_DB_URL 未設');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req(bearer()));
    expect(res.status).toBe(200);
    expect(recheckSpy).toHaveBeenCalledTimes(1);
    expect(hbOkSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('🔴🔴 本業【先跑完】才輪到這個搭便車的觀察者 —— 順序是承重的', async () => {
    // 🎯 codex 2026-09-10 R1 must-fix ①:三者共用同一個 maxDuration(60s)。
    //    先 await 觀察者 ⇒ 一輪本來 55 秒的請款重查, 加上 9 秒通知就會被平台砍掉
    //    ⇒ 而那時候 catch 保不住回應, 也補不了心跳。
    // 🔵 codex R2 nit:只釘「本業 → 觀察者」的話, 把觀察者搬到【寫心跳之前】仍然會綠。
    //    ⇒ 三格一起釘, 那個縫才關得起來。
    const order: string[] = [];
    recheckSpy.mockImplementation(async () => {
      order.push('本業');
      return { ...CLEAN };
    });
    hbOkSpy.mockImplementation(async () => {
      order.push('本業心跳');
    });
    cronHbSpy.mockImplementation(async () => {
      order.push('觀察者');
      return { abnormalCount: 0, abnormalJobs: [] };
    });
    await GET(req(bearer()));
    expect(order).toEqual(['本業', '本業心跳', '觀察者']);
  });

  it('🔵 本業炸了(503)也照樣跑觀察者 —— 兩件事各自獨立', async () => {
    recheckSpy.mockRejectedValue(new Error('boom'));
    const res = await GET(req(bearer()));
    expect(res.status).toBe(503);
    expect(cronHbSpy).toHaveBeenCalledTimes(1);
  });

  it('🔴🔴 本業把整輪吃光 ⇒ 這一輪不看, 而【要出聲】', async () => {
    // 🎯 codex R2 must-fix ①:預算要從整輪扣, 不是從觀察者自己啟動才算。
    //    ⇒ 沒有預算時不啟動, 而「看過而健康」與「根本沒看」不可以在 log 上長一樣。
    // 🔵 codex R3 nit:斷言失敗就跳過還原 ⇒ fake timers 與 console spy 會漏到後面的測試。
    //    ⇒ 放 finally。**一個會汙染鄰居的測試, 紅起來會紅在別人身上。**
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      recheckSpy.mockImplementation(async () => {
        vi.advanceTimersByTime(59_000); // 本業吃掉 59 秒 ⇒ 只剩 1 秒 < 2 秒餘裕
        return { ...CLEAN };
      });
      await GET(req(bearer()));
      expect(cronHbSpy).not.toHaveBeenCalled();
      expect(errSpy.mock.calls.some((c) => JSON.stringify(c).includes('no_budget'))).toBe(true);
    } finally {
      errSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('🟢 正對照:本業很快 ⇒ 觀察者照跑(證明上面那一格不是恆不跑)', async () => {
    await GET(req(bearer()));
    expect(cronHbSpy).toHaveBeenCalledTimes(1);
  });

  it('🔴 401 那條路【在心跳檢查之前】⇒ 路人不得觸發任何一發查詢', async () => {
    await GET(req('Bearer wrong'));
    expect(cronHbSpy).not.toHaveBeenCalled();
  });
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

  // ══ 🔵🔵「還沒上膛」要在 log 上看得見(2026-08-31;Sean 答 `5 做`;錨 ⟦b9-CAPARM1⟧)══
  //   量到的:本片之前這支檔**整支 `console.*` = 0**(5 支 cron route 裡唯一一支),
  //   而沒上膛那條路回 200 ⇒ 「上膛了」與「沒上膛」在 Vercel log 上印同一片空白。
  // 🔴 這一族【必須成組】:只有正對照 ⇒ 一個【無條件印】的 console.info 也會全過。
  describe('🔵 沒上膛要在 log 上看得見(而仍然是 200、而仍然不寫心跳)', () => {
    afterEach(() => {
      delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
    });

    it('🔴 正對照:env 沒設 ⇒ console.info 印一次、訊息含那顆 env 的名字,而回應仍是 200', async () => {
      delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const res = await GET(req(bearer()));

      expect(res.status).toBe(200); // 🔴 沒上膛不是失敗 —— 這一格釘住「不改回應碼」
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(infoSpy.mock.calls)).toContain('CAPTURE_RECHECK_CUTOFF_DAYS');
      infoSpy.mockRestore();
    });

    it('🔴🔴 負對照:env 設好了 ⇒ 那一行【一次都不印】(殺掉「無條件印」那個突變)', async () => {
      process.env.CAPTURE_RECHECK_CUTOFF_DAYS = '7';
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(req(bearer()));

      expect(infoSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
    });

    it('🔴 負對照二:env 設成非正整數 ⇒ 走的仍是同一條「沒上膛」路,行為與 env 未設【一致】', async () => {
      // readCutoffDays 對「設了而不合法」也回 null(本片不改那條判準)⇒ 它同樣該出聲。
      process.env.CAPTURE_RECHECK_CUTOFF_DAYS = '0';
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const res = await GET(req(bearer()));

      expect(res.status).toBe(200);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      infoSpy.mockRestore();
    });

    it('🔴🔴 心跳那一格不得被這一片改到 —— 沒上膛時【兩支心跳仍然都不得被呼叫】', async () => {
      // 這一格與本檔上面那一格重疊, 而重疊是【刻意的】:
      // 那個「不寫心跳 ⇒ 儀表板 30 分鐘後紅」是這支排程沒上膛的【另一個】訊號,
      // 而本片加的 log 是【第三個】。兩個在不同層, 補一個不得關掉另一個。
      delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(req(bearer()));

      expect(hbOkSpy).not.toHaveBeenCalled();
      expect(hbFailSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
    });

    it('🛑🛑 白名單:那一行 log 的形狀被釘死 ⇒ 多印【任何】東西都會紅,而且【哪個值配哪個 key】也釘住', async () => {
      // 🔴 **為什麼要釘映射**:2026-08-31 `code-reviewer` 在 email-sweep 那片抓到 ——
      //   只比【key 的集合】與【value 的集合】時, 把兩個 key 的值【對調】會全綠
      //   (`JSON.stringify` 把 key↔value 的綁定攤平了)。這一片不要再犯一次。
      delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(req(bearer()));

      expect(infoSpy).toHaveBeenCalledTimes(1); // 🔴 先證明這個世界【有印】
      const [msg, payload] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];
      // 🔴 **codex R1 consider 2**:~~只驗 `typeof msg === 'string'`~~ **不夠** ——
      //   一個空白訊息、一句誤導的訊息、或【把別的 env 或收件人塞進訊息字串】, 都通得過。
      //   ⇒ 📌 **`payload` 被釘死了, 而【第一個參數】是同一行 log 的另一半, 它沒有被釘。**
      //   ⇒ 釘成【逐字相等】:訊息要改就得同時改這裡, 而那正是我們要的那個停頓。
      expect(msg).toBe('[capture-recheck] 🔵 還沒上膛 ⇒ 這一輪整段不跑(不是失敗,回 200)');
      expect(Object.keys(payload).sort()).toEqual(['env', 'reason']); // 多一個 key 就紅
      expect(payload['env']).toBe('CAPTURE_RECHECK_CUTOFF_DAYS'); // 🔴 映射, 不是集合
      expect(payload['reason']).toBe('skipped_no_cutoff');
      infoSpy.mockRestore();
    });

    it('🔴🔴 未認證(401)⇒ 那一行【一次都不印】—— 這一格是 codex 2026-08-31 指出來的缺口', async () => {
      // 🔴 **codex R1 consider 1**:上面六格【全部用有效 Bearer】, 而既有的 401 / 500 兩格
      //   又沒有檢查 console ⇒ **把那段 log 搬到認證之前** 這個突變, 在那六格底下全綠。
      //   ⇒ 📌 **一組「都從正門進來」的測試, 量不到「有人從側門進來時會發生什麼」。**
      // ⚠️ 而它不是美觀問題:log 若在認證之前, **任何路人都能讓我們的 log 長出東西** ——
      //   那是一條免費的噪音管道(而噪音會讓人把整條 log 關掉)。
      delete process.env.CAPTURE_RECHECK_CUTOFF_DAYS;
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const res = await GET(req('Bearer wrong-secret-wrong-secret-wrong'));

      expect(res.status).toBe(401);
      expect(infoSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
    });

    it('🛑 零 PII:那一行不得印出 env 的【值】,也不得印 CRON_SECRET', async () => {
      // 🔴 sentinel 要【>=32 字元】—— 短的會被 secret 長度閘擋掉 ⇒ 提早 return
      //   ⇒ 那一行 log 根本不會跑, 而 `not.toContain` 在【空 log】底下照樣全過。
      const VALUE_SENTINEL = 'ZZQQ-CUTOFF-VALUE-SENTINEL-NOT-A-NUMBER';
      process.env.CAPTURE_RECHECK_CUTOFF_DAYS = VALUE_SENTINEL; // 不合法 ⇒ 仍走沒上膛那條路
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      await GET(req(bearer()));
      const logged = JSON.stringify(infoSpy.mock.calls);

      expect(infoSpy).toHaveBeenCalledTimes(1); // 🔴 先證明【有印】,否則下面是空集合
      expect(logged).not.toContain(VALUE_SENTINEL);
      expect(logged).not.toContain(SECRET);
      infoSpy.mockRestore();
    });
  });
});
