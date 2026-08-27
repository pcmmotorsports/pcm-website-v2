// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// 🔴 `./composition` mock 的**理由**(R1 N4 更正我寫錯的那一版):
//    ~~「因為 import 它會連帶讀 env」~~ —— **那句是假的**:`requireEnv` 只在 factory 的**函式體內**,
//    barrel 零 module-level env 讀取 ⇒ 光是 import 不會拋。
//    ✅ **真正的理由**:下面那組「建 store 就炸」要注入一個**會拋的** `getHeartbeatStore`,
//    而其餘每一格都自己傳 store 進去、根本不會走到它。
//    📌 **一個寫錯的理由,會讓下一個人以為拿掉這顆 mock 就會爆** —— 而它其實可以拿掉,只是那兩格會失去對象。
const comp = vi.hoisted(() => ({ getHeartbeatStore: vi.fn(() => { throw new Error('BOOM: 建 store 就炸'); }) }));
vi.mock('./composition', () => ({ getHeartbeatStore: comp.getHeartbeatStore }));

import { CRON_JOB_NAME, HEARTBEAT_MAX_MS, recordHeartbeatFailure, recordHeartbeatSuccess } from './heartbeat';

// heartbeat.test.ts — ⟦b4-CRON6⟧ 片1 寫入端的守門。
//
// 🔴 **這支存在的直接理由是一發突變**:接完五支 route 之後我先跑既有的 cron route 測試
//    ⇒ **139 全綠**;然後把 `settle-sweep` 成功那一發心跳**整行刪掉**再跑 ⇒ **還是 139 全綠**。
//    ⇒ **那 139 格對本片的接線【零判別力】** —— 因為寫入端全程 catch,壞掉也不會冒出來。
//    📌 **一個「不會把呼叫端弄壞」的設計,同時也讓呼叫端的測試看不見它。** 兩件事同一個根。
//
// 🔴 **本檔零 adapter mock** —— `heartbeat.ts` 吃注入的窄通道(`HeartbeatStore`),
//    所以這裡餵的是一個十行的假物件,不是一條 supabase 鏈式替身。
//    ⚠️ **代價要講**:因此本檔**完全不證** SQL 那一側 —— 表名、欄名、`onConflict`、權限
//    全部在 `composition.ts`,由 `composition.test.ts` 守。**兩支合起來才是一片。**

/** 十行的假通道。`writes` 收到什麼就記什麼。 */
function fakeStore(opts: { failureCount?: number | null; writeError?: unknown; throwOnWrite?: boolean } = {}) {
  const writes: Record<string, unknown>[] = [];
  return {
    writes,
    store: {
      readFailureCount: async () => opts.failureCount ?? null,
      write: async (row: Record<string, unknown>) => {
        writes.push(row);
        if (opts.throwOnWrite) throw new Error('ECONNRESET');
        return { error: opts.writeError ?? null };
      },
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe('CRON_JOB_NAME', () => {
  it('🔴 六個字面 —— 對不上線上 cron.job.jobname 的後果不是報錯,是永遠報「沒心跳」(假陽性)', () => {
    // 2026-08-28 對正式庫撈過、兩個窗各一次、逐格相同。這一格釘住的是【打字】,不是 DB。
    expect(Object.values(CRON_JOB_NAME)).toEqual([
      'pcm-anomaly-alert',
      'pcm-capture-recheck',
      'pcm-email-sweep',
      'pcm-order-ineligible-gate',
      'pcm-settle-sweep',
      'pcm-expire-unpaid-orders',
    ]);
  });
});

describe('recordHeartbeatSuccess', () => {
  it('寫 last_success_at、失敗計數歸零、而【不碰 last_failure_at】', async () => {
    const { store, writes } = fakeStore();
    await recordHeartbeatSuccess(CRON_JOB_NAME.settleSweep, store);

    expect(writes).toHaveLength(1);
    expect(writes[0]!.job_name).toBe('pcm-settle-sweep');
    expect(typeof writes[0]!.last_success_at).toBe('string');
    expect(writes[0]!.consecutive_failures).toBe(0);
    // 🔴 碰了會把上一次真的失敗抹掉。
    expect(writes[0]).not.toHaveProperty('last_failure_at');
  });

  it('🔴 write 回 error ⇒ 留痕但【不往上拋】(監控不得把被監控的弄死)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store } = fakeStore({ writeError: { message: 'boom' } });
    await expect(recordHeartbeatSuccess(CRON_JOB_NAME.emailSweep, store)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('🔴 write 直接拋(網路斷)⇒ 也不往上拋', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store } = fakeStore({ throwOnWrite: true });
    await expect(recordHeartbeatSuccess(CRON_JOB_NAME.anomalyAlert, store)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ══ 🔴🔴 這一組守的是【我自己寫壞過一次】的那個形狀 ═════════════════════════════
//    第一版把 store 寫成**預設參數**(`store: HeartbeatStore = getHeartbeatStore()`)——
//    預設參數在**函式本體之前**求值 ⇒ 它拋的時候 `catch` **接不到** ⇒ 例外冒到 route
//    ⇒ route 的 catch 把它變成 **503** ⇒ **一輪明明做完了的 sweeper,被心跳弄成失敗。**
//    當場證據:既有 route 測試 **57 格轉紅**(`deps_or_unexpected_throw`)。
//    📌 而正式站的形狀一樣:env 掉了 ⇒ **監控把被監控的弄死**。
describe('🔴 建 store 就炸 ⇒ 也不得往上拋(把它搬回預設參數,這兩格會紅)', () => {
  it('成功那一支', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordHeartbeatSuccess(CRON_JOB_NAME.settleSweep)).resolves.toBeUndefined();
    expect(comp.getHeartbeatStore).toHaveBeenCalled(); // 證明真的走到那條路,不是被跳過
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('失敗那一支', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(recordHeartbeatFailure(CRON_JOB_NAME.settleSweep)).resolves.toBeUndefined();
    expect(comp.getHeartbeatStore).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ══ 🔴 I1:硬上界 —— 平台 kill 不可 catch,而心跳排在最後一步 ═══════════════════
describe('🔴 寫入卡住 ⇒ 逾時放手,不把 route 的預算吃光', () => {
  it('成功那一支:store.write 永遠不 resolve ⇒ 仍然在上界內回來、留痕、不拋', async () => {
    vi.useFakeTimers();
    const store = {
      readFailureCount: async () => null,
      write: () => new Promise<{ error: unknown }>(() => {}), // 永遠不 resolve
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = recordHeartbeatSuccess(CRON_JOB_NAME.settleSweep, store);
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MAX_MS + 1);
    await expect(p).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('🔴🔴 失敗那一支【讀 + 寫兩發共用同一個上界】—— 不是各給一份(codex R1 finding 3)', async () => {
    // 兩發各給 HEARTBEAT_MAX_MS ⇒ 最壞 2 倍,而 route 可能已逼近平台 60s 上限。
    // 這一格的判準是【時間】不是【有沒有回來】:推進剛好一個上界之後,它必須【已經結束】。
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const store = {
      readFailureCount: () => new Promise<number | null>(() => {}), // 卡住
      write: () => new Promise<{ error: unknown }>(() => {}), // 也卡住
    };
    let done = false;
    const p = recordHeartbeatFailure(CRON_JOB_NAME.settleSweep, store).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(HEARTBEAT_MAX_MS + 10);
    // 🔴 共用 deadline ⇒ 第二發的剩餘時間是 0 ⇒ 這時已經結束;各給一份 ⇒ 這時還在等第二發。
    expect(done).toBe(true);
    await p;
    spy.mockRestore();
    vi.useRealTimers();
  });

  it('🔴 上界【之內】完成的不得被誤判成逾時(正向對照,否則上面那格可以恆綠)', async () => {
    const { store, writes } = fakeStore();
    await expect(recordHeartbeatSuccess(CRON_JOB_NAME.settleSweep, store)).resolves.toBeUndefined();
    expect(writes).toHaveLength(1);
  });
});

describe('recordHeartbeatFailure', () => {
  it('讀到 2 ⇒ 寫 3、帶 last_failure_at、而【不碰 last_success_at】', async () => {
    const { store, writes } = fakeStore({ failureCount: 2 });
    await recordHeartbeatFailure(CRON_JOB_NAME.orderIneligibleGate, store);

    expect(writes[0]!.job_name).toBe('pcm-order-ineligible-gate');
    expect(writes[0]!.consecutive_failures).toBe(3);
    expect(typeof writes[0]!.last_failure_at).toBe('string');
    // 🔴 碰了就是把「上次成功是什麼時候」洗掉,而那正是告警的主判準。
    expect(writes[0]).not.toHaveProperty('last_success_at');
  });

  it('讀不到(null)⇒ 從 0 起算寫 1,不得算出 NaN', async () => {
    const { store, writes } = fakeStore({ failureCount: null });
    await recordHeartbeatFailure(CRON_JOB_NAME.captureRecheck, store);
    const v = writes[0]!.consecutive_failures;
    expect(v).toBe(1);
    // NaN 進 DB 那一欄有 CHECK (>= 0) ⇒ 寫入會被擋掉 ⇒ 心跳靜默不前進。
    expect(Number.isNaN(v as number)).toBe(false);
  });
});
