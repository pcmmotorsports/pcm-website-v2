import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@pcm/adapters/server', () => ({
  createSupabaseServiceClient: () => ({ from: mocks.from }),
}));

import { FRESHNESS_STALE_HOURS, freshnessLabel, loadDataFreshness } from './freshness-read';

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
