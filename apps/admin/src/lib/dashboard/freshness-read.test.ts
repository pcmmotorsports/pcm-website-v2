import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import {
  FITMENT_STALE_DAYS,
  FITMENT_SCHEDULER_DEAD_HOURS,
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

  // ══════════════════════════════════════════════════════════════════════
  // 🆕 2026-09-02 立 · 🔵 2026-09-03 改值 —— 第二個門檻回答的是【另一個問題】
  // ══════════════════════════════════════════════════════════════════════
  it('🔵 前提:排程門檻就是 26 小時 —— 這個數的【來源】是 Sean,不是我們算的(改它這格必紅)', () => {
    // 🔴🔴 這個數 Sean 拍過【兩次】,而兩次都寫「甲」、值不同 —— 兩筆都留著,不要只留新的:
    //    2026-09-02 Q5  ⇒ 甲, 值【2 天】(他自己給的值)
    //    2026-09-03 Q27 ⇒ 甲 =【1 天】「隔天沒跑就變色」(值寫在選項字面上)
    // 🛑 而那【不是他改主意】—— 09-03 那題的內文逐字只提「你 8/29 答過 7 天」,
    //    一個字都沒提 09-02 那個 2 ⇒ 出題的人不知道兩天前問過了。
    // 🔵 而 24 ⇒ 26 的那 2 小時是【主視窗 2026-09-03 批的寬限】, 不是 Sean 給的:
    //    排程台北每日 07:01 ⇒ 24 小時整正好壓在下一班身上 ⇒ 「還沒到時間」與「掛了」分不開。
    //    ⚠️ 所以這一格釘的是「26」, 而它由【兩個來源】組成:他的 1 天 + 主視窗的 2 小時寬限。
    //       要改它 ⇒ 回去看那個常數的說明, 不是自己重算。
    // 🛑 而 7 那個【沒有被推翻】—— 兩格各釘各的。
    expect(FITMENT_SCHEDULER_DEAD_HOURS).toBe(26);
  });

  it('🔴🔴 3 天沒成功 ⇒ 亮燈,而話是【排程可能掛了】不是【資料舊了】', async () => {
    // 🔴 這一格是本次改動的理由本體:排程【每日】跑, 而舊的判準是 7 天
    //    ⇒ 改動前它在這裡是【綠的】—— 一支已經漏了三班的排程, 儀表上一片平靜。
    mocks.from.mockReturnValue(logChain([{ ran_at: daysAgoIso(3), status: 'success' }]));
    const f = await loadFitmentFreshness(NOW);
    expect(f.stale).toBe(true);
    expect(f.abnormal).toBe(true);
    expect(fitmentFreshnessLabel(f)).toBe('車款搜尋同步:已 3 天沒有成功過(排程可能掛了 —— 它本來每天跑)');
    // 🔴 反面釘住:3 天【還沒到】資料算舊那一格 ⇒ 不准講「資料也已經算舊了」
    expect(fitmentFreshnessLabel(f)).not.toContain('資料也已經算舊了');
  });

  // 🔴🔴 **這一格的期望值 2026-09-03 被【反轉】了 —— 而那不是把尺調鬆去配合碼,是規格變了。**
  //    ⛔ 舊期望值逐字:`expect(f.stale).toBe(false)` / `expect(f.abnormal).toBe(false)`
  //       / label = `'車款搜尋同步:已 1 天沒有成功過'`(門檻 48 小時之下,1.5 天還沒到)
  //    🛑 **它守的東西是什麼**:舊註解逐字「排程台北每日 07:01 ⇒ 正常情況這個數字最大約 1 天多
  //       ⇒ 門檻設 1 會把【還沒到時間】判成【掛了】。這一格釘住那個邊界。」
  //    ✅ **而那個顧慮【沒有消失】** —— 它是被 26 小時的那 2 小時寬限吸收掉的,不是被判定為多慮。
  //       ⇒ 📌 **接住它的是下面那一格(24.5 小時 ⇒ 還不算掛)。**
  //       ⇒ ⇒ **沒有下面那一格,把門檻改成 24 也會全綠 ⇒ 這一族就分不出兩個世界了。**
  //    🔵 改動依據:Sean 2026-09-03 Q27 答甲(1 天)+ 主視窗同日批 26 小時。
  it('🔴 1.5 天沒成功 ⇒ 亮燈(舊門檻 48 小時之下這一格是綠的 —— 那正是改它的理由)', async () => {
    mocks.from.mockReturnValue(logChain([{ ran_at: daysAgoIso(1.5), status: 'success' }]));
    const f = await loadFitmentFreshness(NOW);
    expect(f.stale).toBe(true);
    expect(f.abnormal).toBe(true);
    expect(fitmentFreshnessLabel(f)).toBe('車款搜尋同步:已 1 天沒有成功過(排程可能掛了 —— 它本來每天跑)');
    // 🔴 反面釘住:1.5 天【還沒到】資料算舊那一格 ⇒ 不准講「資料也已經算舊了」
    expect(fitmentFreshnessLabel(f)).not.toContain('資料也已經算舊了');
  });

  // 🔴🔴 **承重格 —— 它是唯一【行為性地】釘住 24↔26 那個差的地方。**
  //    把門檻改成 24(= 照 Sean 字面)⇒ 24.5 > 24 ⇒ 亮燈 ⇒ **這一格紅**。
  //    🛑 **而「唯一會紅的地方」那句話是【假的】, 不要那樣寫**(code-reviewer 2026-09-03 抓到,
  //       而我自己的突變讀數就在同一份回報裡打它):實測那個突變會紅 **3 格**, 而三格各自的性質不同 ——
  //         ① 本格            ⇒ **行為性**:它演一個真實情境(跑慢了一點), 這才是這個決定的守門
  //         ② `toBe(26)` 那格 ⇒ **釘值**:任何人改那個常數它都紅, 它不知道改成幾
  //         ③ `daysAgoIso(1)` 那格 ⇒ **偶然命中**:那一格的 `hoursAgo` 恰好是 24.0,
  //            門檻降到 24 之後它就落進 label 的 `>=` 那一支 ⇒ 它紅是副作用, 不是它在守這件事
  //    ⇒ 📌 **三格都紅 ≠ 三格都在守它。** 拿掉本格, 剩下的兩格擋不住一個「照字面改成 24」的改動
  //       —— ② 只會說「有人改了常數」, ③ 會用一個看起來不相干的理由紅, 而沒有人看得出原因。
  //    🛑 **它擋的是真實世界的哪一件事**:`ran_at` 是 commit RPC 那筆交易的 `now()`
  //       ⇒ 今天比昨天慢一點, `hoursAgo` 就會稍微超過 24 ⇒ **那是「跑慢了」不是「掛了」。**
  //       ⚠️ 而**本排程的抖動有多大, 我沒有量到** ⇒ **這 2 小時寬限買的就是那個未知。**
  //          🔴 證據的射程、以及那個「33 次」為什麼不能拿來用, **全文只有一個作者** ——
  //             見 `FITMENT_SCHEDULER_DEAD_HOURS` 的說明。**這裡不重寫一份。**
  //          📌 這一格本身是一次事故的疤:我在那支檔把兩句話收窄了(那 33 次屬於已被取代的
  //             11:30 排程 / 「沒有人量過」是站不住的全稱句), **而這裡這份逐字沒有跟著改** ——
  //             我的負對照 `grep '…沒有人量過'` 印 0, 而**那把尺的分母是一支檔, 結構上到不了這裡。**
  //             ⇒ 🎯 **「我改好了」與「我講過那句話的每個地方都改好了」是兩個宣稱。**
  it('🟢 24.5 小時沒成功 ⇒ 還不算掛(它只是今天比昨天跑得慢一點)', async () => {
    mocks.from.mockReturnValue(logChain([{ ran_at: daysAgoIso(24.5 / 24), status: 'success' }]));
    const f = await loadFitmentFreshness(NOW);
    expect(f.stale).toBe(false);
    expect(f.abnormal).toBe(false);
    expect(fitmentFreshnessLabel(f)).toBe('車款搜尋同步:已 1 天沒有成功過');
    // 🔴 而話裡不准出現任何一種「掛了」的字面 —— 這一格的重點是【它不該叫】。
    expect(fitmentFreshnessLabel(f)).not.toContain('排程可能掛了');
  });

  it('🔴 該紅的那一發:超過門檻 ⇒ stale', async () => {
    mocks.from.mockReturnValue(logChain([{ ran_at: daysAgoIso(FITMENT_STALE_DAYS + 1), status: 'success' }]));
    const f = await loadFitmentFreshness(NOW);
    expect(f.stale).toBe(true);
    expect(f.abnormal).toBe(true);
    // 🔴 2026-09-02:超過 7 天那一段話變了 —— 它現在同時講【排程可能掛了】與【資料也舊了】
    expect(fitmentFreshnessLabel(f)).toBe(
      `車款搜尋同步:已 ${FITMENT_STALE_DAYS + 1} 天沒有成功過(排程可能掛了, 而資料也已經算舊了)`,
    );
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
    expect(fitmentFreshnessLabel(f)).toBe(
      '車款搜尋同步:已 10 天沒有成功過(排程可能掛了, 而資料也已經算舊了)',
    );
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
