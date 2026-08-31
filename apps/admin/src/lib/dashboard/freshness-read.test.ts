import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import {
  FITMENT_STALE_DAYS,
  FRESHNESS_STALE_HOURS,
  fitmentFreshnessLabel,
  freshnessLabel,
  loadDataFreshness,
  loadFitmentFreshness,
} from './freshness-read';

// freshness-read.test.ts — 那一行灰字的守門。
//
// 🔴 **這支要證的不是「它會印字」,是【它在兩個世界印不同的字】**:
//    該綠的餵一發必須綠、該紅的餵一發必須紅。
//    一個只在正常時出現的儀表,壞掉的樣子與「頁面還沒載完」長得一樣 ⇒ 那種儀表零判別力。
//
// 🔴 **誠實邊界**:鏈式 mock 只證**本層的形狀與分支**。
//    **不證** PostgREST 真的接受這個查詢、不證 `product_variants.updated_at` 在 DB 上真的存在。
//    ⚠️ 而真資料那一發**是有的、不在本檔**:2026-08-28 對正式庫(`bmpnplmnldofgaohnaok`)
//    唯讀跑過 `max(updated_at)` ⇒ `2026-08-27 09:53:15.627+00`、54,036 列、當下 3.12 小時前;
//    同一發 `EXPLAIN (ANALYZE, BUFFERS)` ⇒ Seq Scan / 23.8ms。**那是量到的,不是這支測試證的。**

/** `.from().select().order().limit()` ⇒ thenable。`reject` 走 transport 層 reject 那條路。 */
function chain(result: { data?: unknown[] | null; error?: unknown; reject?: unknown }) {
  const thenable = {
    then(ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) {
      if ('reject' in result) return Promise.resolve(err?.(result.reject));
      return Promise.resolve(ok({ data: result.data ?? null, error: result.error ?? null }));
    },
  };
  const self: Record<string, unknown> = {};
  self.select = () => self;
  // 🔵 2026-09-01 加:`loadFitmentFreshness` 那條路多一段 `.eq()`。
  //    這裡**只是讓鏈接得下去**(錯誤/reject 那幾格根本走不到過濾)——
  //    真的會照 `.eq` 過濾的假 client 是下面的 `logChain`,而**過濾行為要由它證**。
  self.eq = () => self;
  self.order = () => self;
  self.limit = () => thenable;
  return self;
}

const NOW = new Date('2026-08-28T00:00:00Z');
/** `NOW` 往前推 h 小時的 ISO 字串。 */
const agoIso = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadDataFreshness', () => {
  it('🟢 該綠的那一發:3 小時前 ⇒ 數字出來、不算舊', async () => {
    mocks.from.mockReturnValue(chain({ data: [{ updated_at: agoIso(3) }] }));
    const f = await loadDataFreshness(NOW);
    expect(f.hoursAgo).toBeCloseTo(3, 5);
    expect(f.stale).toBe(false);
    expect(f.abnormal).toBe(false);
    expect(f.unreadableReason).toBeNull();
    expect(freshnessLabel(f)).toBe('供應商資料最後更新:3 小時前');
  });

  it('🔴 該紅的那一發:超過門檻 ⇒ stale=true(門檻本身也釘住,改常數這格會紅)', async () => {
    mocks.from.mockReturnValue(chain({ data: [{ updated_at: agoIso(FRESHNESS_STALE_HOURS + 1) }] }));
    const f = await loadDataFreshness(NOW);
    expect(f.stale).toBe(true);
    expect(f.abnormal).toBe(true);
    expect(freshnessLabel(f)).toBe(`供應商資料最後更新:${FRESHNESS_STALE_HOURS + 1} 小時前`);
  });

  it('門檻是嚴格大於:恰好等於門檻 ⇒ 還不算舊(邊界不靠猜)', async () => {
    mocks.from.mockReturnValue(chain({ data: [{ updated_at: agoIso(FRESHNESS_STALE_HOURS) }] }));
    expect((await loadDataFreshness(NOW)).stale).toBe(false);
  });

  // ══ 以下四格是同一個病的四張臉:**讀不到值不得長成一個看起來正常的 0 小時前** ══
  //    `Number(null)` ⇒ 0、`new Date(undefined).getTime()` ⇒ NaN —— 兩者都不會拋、不會紅。

  it('🔴 查詢出錯 ⇒ 量不到,而**不是** 0 小時前', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.from.mockReturnValue(chain({ error: { message: 'boom' } }));
    const f = await loadDataFreshness(NOW);
    expect(f.hoursAgo).toBeNull();
    expect(f.stale).toBe(false);
    // 🔴 `stale=false` 而 `abnormal=true` —— 這兩格分開的理由就在這一列:
    //    「沒有超過門檻」與「這一行該不該亮」不是同一個問題。
    expect(f.abnormal).toBe(true);
    expect(freshnessLabel(f)).toContain('量不到');
    expect(freshnessLabel(f)).toContain('查詢失敗');
    expect(spy).toHaveBeenCalled(); // 靜默吞掉 ⇒ 線上永遠不知道這格壞了
    spy.mockRestore();
  });

  it('🔴 transport 層 reject(網路斷/DNS)⇒ 也是量不到,不往上拋', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.from.mockReturnValue(chain({ reject: new Error('ECONNRESET') }));
    const f = await loadDataFreshness(NOW);
    expect(f.hoursAgo).toBeNull();
    expect(freshnessLabel(f)).toContain('量不到');
    spy.mockRestore();
  });

  it('🔴 一列都沒有 ⇒ 量不到(空表不是「很新」)', async () => {
    mocks.from.mockReturnValue(chain({ data: [] }));
    const f = await loadDataFreshness(NOW);
    expect(f.hoursAgo).toBeNull();
    expect(freshnessLabel(f)).toContain('查無任何商品變體');
  });

  it('🔴 時間戳解不出來 ⇒ 量不到,而不是 NaN 小時前', async () => {
    mocks.from.mockReturnValue(chain({ data: [{ updated_at: '不是時間' }] }));
    const f = await loadDataFreshness(NOW);
    expect(f.hoursAgo).toBeNull();
    expect(freshnessLabel(f)).toContain('解不出來');
    expect(freshnessLabel(f)).not.toContain('NaN');
  });

  it('不到 1 小時 ⇒ 印「不到 1 小時前」,不印 0', async () => {
    mocks.from.mockReturnValue(chain({ data: [{ updated_at: agoIso(0.4) }] }));
    expect(freshnessLabel(await loadDataFreshness(NOW))).toBe('供應商資料最後更新:不到 1 小時前');
  });

  it('未來時間戳照實印、不夾成 0(夾掉會把「有東西寫錯了」藏起來)', async () => {
    mocks.from.mockReturnValue(chain({ data: [{ updated_at: agoIso(-5) }] }));
    const f = await loadDataFreshness(NOW);
    const label = freshnessLabel(f);
    expect(label).toContain('未來');
    expect(label).not.toContain('不到 1 小時前');
    // 🔴🔴 **R1 must-fix 的本體**:未來時間戳**不是** stale,而它一樣要亮。
    //    第一版顏色判準寫成 `stale || hoursAgo === null` ⇒ 這一格會落進平靜的灰字。
    expect(f.stale).toBe(false);
    expect(f.abnormal).toBe(true);
  });

  it('查詢形狀:讀 product_variants、取最新那一列(而不是撈全表回來自己算)', async () => {
    const calls: string[] = [];
    const thenable = {
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve(ok({ data: [{ updated_at: agoIso(1) }], error: null })),
    };
    const self: Record<string, unknown> = {};
    self.select = (c: string) => { calls.push(`select:${c}`); return self; };
    self.order = (c: string, o: { ascending: boolean }) => { calls.push(`order:${c}:${o.ascending}`); return self; };
    self.limit = (n: number) => { calls.push(`limit:${n}`); return thenable; };
    mocks.from.mockReturnValue(self);

    await loadDataFreshness(NOW);

    expect(mocks.from).toHaveBeenCalledWith('product_variants');
    expect(calls).toEqual(['select:updated_at', 'order:updated_at:false', 'limit:1']);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 車款搜尋(fitment)那一半 —— `⟦b4-FIT1⟧`
// ════════════════════════════════════════════════════════════════════════════

/**
 * 會**真的照 `.eq()` 過濾**的假 client。
 *
 * 🔴 **為什麼不是「記下呼叫過 .eq 就好」**:那只證得到「我打了那行字」,
 *    證不到「打了它會改變答案」。而本片唯一要證的就是後者 ——
 *    **拿掉 `.eq('status','success')` 這支測試必須紅。**
 *    ⇒ 所以這個假 client 自己實作過濾,讓兩個世界(有過濾 / 沒過濾)印不同的值。
 */
function logChain(rows: { ran_at: string; status: string }[]) {
  const filters: [string, unknown][] = [];
  const thenable = {
    then(ok: (v: unknown) => unknown) {
      let out = rows;
      for (const [col, val] of filters) out = out.filter((r) => (r as Record<string, unknown>)[col] === val);
      out = [...out].sort((a, b) => (a.ran_at < b.ran_at ? 1 : -1));
      return Promise.resolve(ok({ data: out.slice(0, 1), error: null }));
    },
  };
  const self: Record<string, unknown> = {};
  self.select = () => self;
  self.eq = (col: string, val: unknown) => { filters.push([col, val]); return self; };
  self.order = () => self;
  self.limit = () => thenable;
  return self;
}

/** `NOW` 往前推 d 天的 ISO 字串。 */
const daysAgoIso = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('loadFitmentFreshness', () => {
  it('🟢 該綠的那一發:1 天前成功過 ⇒ 不算舊', async () => {
    mocks.from.mockReturnValue(logChain([{ ran_at: daysAgoIso(1), status: 'success' }]));
    const f = await loadFitmentFreshness(NOW);
    expect(f.hoursAgo).toBeCloseTo(24, 5);
    expect(f.stale).toBe(false);
    expect(f.abnormal).toBe(false);
    expect(fitmentFreshnessLabel(f)).toBe('車款搜尋同步:已 1 天沒有成功過');
  });

  // 🔴🔴 **這一格是 codex 對抗審查(2026-09-01)抓到的,而它的 finding 對、理由只對一半 ——**
  //    它說「輸入與期望值都引用 `FITMENT_STALE_DAYS` ⇒ 把 7 改成 30 仍會全綠」。
  //    **實測(突變 7 ⇒ 30)⇒ 確實會紅,但紅的是【下面那格 abort 的】**(10 天在 30 天門檻下不算舊),
  //    **不是這一格**。⇒ 所以「本檔整體抓得到改常數」成立,而**這一格自己的那句宣稱是假的**。
  //    📌 **一個突變測試可以【給對顏色而理由是錯的】,而顏色是唯一會被看的東西。**
  //    ⇒ 修法不是刪掉相對寫法(它讓「超過門檻」這件事仍然跟著常數走),是**把那個數字本身釘死**:
  it('🔵 前提:門檻就是 7 天 —— 這個數是 Sean 給的,不是我們算的(改它這格必紅)', () => {
    // Sean 2026-08-29 逐字 `A: 7天`。改這個常數 ⇒ 這一格立刻紅 ⇒ 逼人回去看是誰改的、依據是什麼。
    expect(FITMENT_STALE_DAYS).toBe(7);
  });

  it('🔴 該紅的那一發:超過門檻 ⇒ stale', async () => {
    mocks.from.mockReturnValue(logChain([{ ran_at: daysAgoIso(FITMENT_STALE_DAYS + 1), status: 'success' }]));
    const f = await loadFitmentFreshness(NOW);
    expect(f.stale).toBe(true);
    expect(f.abnormal).toBe(true);
    expect(fitmentFreshnessLabel(f)).toBe(`車款搜尋同步:已 ${FITMENT_STALE_DAYS + 1} 天沒有成功過`);
  });

  // ══════════════════════════════════════════════════════════════════════
  // 🔴🔴 本片存在的那一格 —— 沒有它,兩種寫法在【今天的資料】上印同一個數
  // ══════════════════════════════════════════════════════════════════════
  it('🔴🔴 今天 abort + 10 天前 success ⇒ 必須回【10 天】(用 max(ran_at) 寫的話這格會回「不到 1 天」)', async () => {
    mocks.from.mockReturnValue(
      logChain([
        // 這一列比較新, 而它【不是成功】—— 只看 max(ran_at) 就會拿到它
        { ran_at: daysAgoIso(0), status: 'abort' },
        { ran_at: daysAgoIso(10), status: 'success' },
      ]),
    );
    const f = await loadFitmentFreshness(NOW);
    expect(Math.floor((f.hoursAgo ?? NaN) / 24)).toBe(10);
    expect(f.stale).toBe(true);
    expect(fitmentFreshnessLabel(f)).toBe('車款搜尋同步:已 10 天沒有成功過');
    // 🔴 反面也釘住:它【不准】讀成「今天剛更新過」—— 那是這道儀表最該叫卻不叫的那一種。
    expect(fitmentFreshnessLabel(f)).not.toContain('1 天內');
  });

  it('🔴 一列成功都沒有 ⇒ 量不到(空紀錄不是「很新」)', async () => {
    mocks.from.mockReturnValue(logChain([{ ran_at: daysAgoIso(0), status: 'abort' }]));
    const f = await loadFitmentFreshness(NOW);
    expect(f.hoursAgo).toBeNull();
    expect(f.abnormal).toBe(true);
    expect(fitmentFreshnessLabel(f)).toContain('查無任何成功同步紀錄');
  });

  it('🔴 查詢出錯 ⇒ 量不到,而不是 0 天前', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.from.mockReturnValue(chain({ error: { message: 'boom' } }));
    const f = await loadFitmentFreshness(NOW);
    expect(f.hoursAgo).toBeNull();
    expect(f.stale).toBe(false);
    expect(f.abnormal).toBe(true);
    expect(fitmentFreshnessLabel(f)).toContain('量不到');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('未來時間戳照實印、不夾成 0', async () => {
    mocks.from.mockReturnValue(logChain([{ ran_at: daysAgoIso(-3), status: 'success' }]));
    const f = await loadFitmentFreshness(NOW);
    expect(fitmentFreshnessLabel(f)).toContain('未來');
    expect(f.stale).toBe(false);
    expect(f.abnormal).toBe(true);
  });

  it('🔴🔴 查詢永遠不回 ⇒ 5 秒後印「查詢逾時」,而【不是】把首頁吊住(codex R2 must-fix)', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 永遠 pending 的 thenable —— 那正是 allSettled 隔離不了的那一種。
    const never = { then: () => new Promise(() => {}) };
    const self: Record<string, unknown> = {};
    self.select = () => self; self.eq = () => self; self.order = () => self;
    self.limit = () => never;
    mocks.from.mockReturnValue(self);

    // 🔴 `try/finally`:codex R3 nit —— 原本 `mockRestore` / `useRealTimers` 只寫在成功尾端,
    //    這一格若中途斷言失敗,**fake timers 與 console spy 會漏到後面每一格**
    //    ⇒ 後面那些格的錯誤訊息會失真,而失真的方向是「看起來像別的問題」。
    try {
      const p = loadFitmentFreshness(NOW);
      await vi.advanceTimersByTimeAsync(5_000);
      const f = await p;

      expect(f.hoursAgo).toBeNull();
      expect(f.abnormal).toBe(true);
      expect(fitmentFreshnessLabel(f)).toContain('查詢逾時');
      // 🔴 逾時與查詢失敗要印【不同的原因】—— 讀的人靠它決定下一步去查哪裡。
      expect(fitmentFreshnessLabel(f)).not.toContain('查詢失敗');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('查詢形狀:讀 sync_log、只取成功的、取最新那一列', async () => {
    const calls: string[] = [];
    const thenable = {
      then: (ok: (v: unknown) => unknown) =>
        Promise.resolve(ok({ data: [{ ran_at: daysAgoIso(1) }], error: null })),
    };
    const self: Record<string, unknown> = {};
    self.select = (c: string) => { calls.push(`select:${c}`); return self; };
    self.eq = (c: string, v: string) => { calls.push(`eq:${c}:${v}`); return self; };
    self.order = (c: string, o: { ascending: boolean }) => { calls.push(`order:${c}:${o.ascending}`); return self; };
    self.limit = (n: number) => { calls.push(`limit:${n}`); return thenable; };
    mocks.from.mockReturnValue(self);

    await loadFitmentFreshness(NOW);

    expect(mocks.from).toHaveBeenCalledWith('product_fitments_effective_sync_log');
    expect(calls).toEqual(['select:ran_at', 'eq:status:success', 'order:ran_at:false', 'limit:1']);
  });
});
