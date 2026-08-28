// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
// 🔴 `./composition` mock 的**理由**(R1 N4 更正我寫錯的那一版):
//    ~~「因為 import 它會連帶讀 env」~~ —— **那句是假的**:`requireEnv` 只在 factory 的**函式體內**,
//    barrel 零 module-level env 讀取 ⇒ 光是 import 不會拋。
//    ✅ **真正的理由**:下面那組「建 store 就炸」要注入一個**會拋的** `getHeartbeatStore`,
//    而其餘每一格都自己傳 store 進去、根本不會走到它。
//    📌 **一個寫錯的理由,會讓下一個人以為拿掉這顆 mock 就會爆** —— 而它其實可以拿掉,只是那兩格會失去對象。
const comp = vi.hoisted(() => ({ getHeartbeatStore: vi.fn(() => { throw new Error('BOOM: 建 store 就炸'); }) }));
vi.mock('./composition', () => ({ getHeartbeatStore: comp.getHeartbeatStore }));

import {
  CRON_JOB_NAME,
  HEARTBEAT_DB_MS,
  HEARTBEAT_MAX_MS,
  HEARTBEAT_PING_MS,
  pingExternalHeartbeat,
  pingTarget,
  recordHeartbeatFailure,
  recordHeartbeatSuccess,
} from './heartbeat';

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

// ══ ⟦b4-CRON6⟧ 片3:外部存活訊號(healthchecks.io)══
//
// 🔴 **這一組全部是【正向斷言】** ⇒ 它們落在「假的好消息」那一側,而綠不會有人去查
//    ⇒ 每一格底下都附【怎麼會紅】。
// 🔴 **本組驗不到的**:那五支 check 真的翻成 `'up'` —— 那要真的部署 + 真的打出去。
//    ⇒ 那一格的落點是**上線後那道驗收**(部署完當場量五支 status),寫在 `heartbeat.ts` 那段檔頭。
//    📌 **一個「還沒開始」的監控與一個「壞掉」的監控,只有在第一發訊號之前分不開。**

describe('外部存活訊號', () => {
  const NAME = CRON_JOB_NAME.settleSweep;
  const ENV = 'HEALTHCHECKS_PING_URL_PCM_SETTLE_SWEEP';

  // 🔴 `unstubAllEnvs` 在 `afterEach`,不在每格末行(R1 nit 9):寫在末行的話,
  //    任一格斷言先炸就把 env 漏給後面幾格 ⇒ 失敗串成一片,而**真正的第一因認不出來**。
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('[p1] 五支各自的 env 名是【字面】,而第六支明文沒有', () => {
    // 🔴 怎麼會紅:把 switch 裡任何一支的字面打錯 ⇒ 這裡對不上。
    // ⚠️ 而【漏掉一支】不需要這一格來抓 —— `CronJobName` 是 union，
    //    switch 少一個 case 會【編不過】。這一格抓的是「寫錯」，不是「漏寫」。
    //    📌 兩種缺陷分給兩道不同的閘：漏 ⇒ typecheck；錯 ⇒ 本格。
    // 🔴 **分母是 5/5,不是抽兩支**(codex 2026-08-28 must-fix):上一版只驗 settle 與 order
    //    ⇒ anomaly / capture / email 任何一支的 mapping 接錯,**全組仍綠而那支 check 永遠停在 new**。
    //    📌 一個抽樣的守門,對【沒被抽到的那幾支】等於不存在。
    expect(
      Object.values(CRON_JOB_NAME)
        .filter((n) => n !== CRON_JOB_NAME.expireUnpaidOrders)
        .map((n) => pingTarget(n).envName),
    ).toEqual([
      'HEALTHCHECKS_PING_URL_PCM_ANOMALY_ALERT',
      'HEALTHCHECKS_PING_URL_PCM_CAPTURE_RECHECK',
      'HEALTHCHECKS_PING_URL_PCM_EMAIL_SWEEP',
      'HEALTHCHECKS_PING_URL_PCM_ORDER_INELIGIBLE_GATE',
      'HEALTHCHECKS_PING_URL_PCM_SETTLE_SWEEP',
    ]);
    expect(pingTarget(NAME).envName).toBe(ENV);
    // 🔴 第六支是純 SQL ⇒ 它【不該】有 env，而且不該被當成「忘了設」。
    const sixth = pingTarget(CRON_JOB_NAME.expireUnpaidOrders);
    expect(sixth.url).toBeUndefined();
    // 🔴 也要釘 envName 字面(R1 nit 10):只釘 url === undefined 的話,
    //    把「(不適用:純 SQL job)」改成一個【真的 env 名】不會紅 ⇒ 那會讓人以為它只是忘了設。
    expect(sixth.envName).toBe('(不適用:純 SQL job)');
    expect(sixth.notApplicable).toBe(true);
  });

  it('[p2] env 有設 ⇒ 真的送出去,而且打的就是那個 URL', async () => {
    vi.stubEnv(ENV, 'https://hc-ping.com/aaaa-bbbb');
    const calls: string[] = [];
    const fake = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    await pingExternalHeartbeat(NAME, Date.now() + 2000, fake);
    // 🔴 怎麼會紅:把那一發 fetch 拿掉 ⇒ calls 是空的。
    expect(calls).toEqual(['https://hc-ping.com/aaaa-bbbb']);
  });

  it('[p3] env 沒設 ⇒ 不送、不拋,而且【說得出是哪個變數沒設】', async () => {
    vi.stubEnv(ENV, '');
    const calls: string[] = [];
    const fake = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });

    await expect(pingExternalHeartbeat(NAME, Date.now() + 2000, fake)).resolves.toBeUndefined();
    expect(calls).toEqual([]);

    // 🔴🔴 **這一格為什麼要斷言【訊息內容】而不是只斷言「沒送、沒拋」**(2026-08-28 一發突變逼出來的):
    //    第一版只斷言那兩件事 ⇒ 把 `if (!url) return` 整個拿掉之後 **這一格照樣綠** ——
    //    因為 `undefined.startsWith(...)` 會拋,而那個拋被最外層的 catch 吃掉
    //    ⇒ **一樣沒送、一樣沒拋** ⇒ 兩個世界印同一個結果。
    //    📌 **一道守門被拿掉之後,另一道守門把症狀蓋住了** —— 而那一格的綠不再屬於它自己。
    //    ⇒ 改成釘【它說了什麼】:少了那道早退,訊息會是一個 TypeError,不會提到變數名與「未設」。
    expect(logs.some((l) => l.includes(ENV) && l.includes('未設'))).toBe(true);
    spy.mockRestore();
  });

  it('[p4] 🔴 env 被改成別的網址 ⇒ 拒送出(env 是可以被改的東西)', async () => {
    vi.stubEnv(ENV, 'https://evil.example.com/steal');
    const calls: string[] = [];
    const fake = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    await pingExternalHeartbeat(NAME, Date.now() + 2000, fake);
    // 🔴 怎麼會紅:拿掉那道前綴檢查 ⇒ 我方伺服器會去打任意網址 ⇒ calls 長度變 1。
    expect(calls).toEqual([]);
  });

  it('[p5] fetch 拋 ⇒ 吃掉,不拋給呼叫端(監控不得把被監控的弄死)', async () => {
    vi.stubEnv(ENV, 'https://hc-ping.com/aaaa-bbbb');
    const fake = (async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    // 🔴 怎麼會紅:拿掉那個 catch ⇒ 這裡變成 rejects。
    await expect(pingExternalHeartbeat(NAME, Date.now() + 2000, fake)).resolves.toBeUndefined();
  });

  it('[p6] 預算已用完 ⇒ 這一輪不送(不吃掉 route 的剩餘時間)', async () => {
    vi.stubEnv(ENV, 'https://hc-ping.com/aaaa-bbbb');
    const calls: string[] = [];
    const fake = (async (u: string | URL | Request) => {
      calls.push(String(u));
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    // deadline 已經過去
    await pingExternalHeartbeat(NAME, Date.now() - 1, fake);
    // 🔴 怎麼會紅:拿掉 `if (ms === 0) return` ⇒ 它會用一個 0ms 的 timeout 去打 ⇒ calls 變 1。
    expect(calls).toEqual([]);
  });

  it('[p7] 🔴 接線:成功心跳【一定】會呼叫 ping,而且 DB 寫失敗也照送', async () => {
    const seen: string[] = [];
    const spy = (async (jobName: string) => {
      seen.push(jobName);
    }) as unknown as typeof pingExternalHeartbeat;

    const okStore = fakeStore();
    await recordHeartbeatSuccess(NAME, okStore.store, spy);

    const badStore = fakeStore({ writeError: { message: 'boom' } });
    await recordHeartbeatSuccess(CRON_JOB_NAME.emailSweep, badStore.store, spy);

    // 🔴 怎麼會紅:把 `await pingImpl(...)` 那一行從 recordHeartbeatSuccess 拿掉 ⇒ seen 是空的。
    //    這一格是【接線】守門 —— 沒有它，上面 p1-p6 全綠而那一行根本沒被呼叫過。
    expect(seen).toEqual([NAME, CRON_JOB_NAME.emailSweep]);
  });
});

// ══ 🔴 R1 MF1/MF3 補的兩格:【DB 掛掉】那個世界 ══
//
// 為什麼要單獨補:上一版 p7 的標題寫「DB 寫失敗也照送」,而它只餵了 `{error}` 那一種
// (write **立刻** resolve)⇒ **「逾時」那一種一格都沒有**,而那正是唯一會讓那句話為假的世界。
// 📌 **註解、測試標題、測試內容三份拷貝,全部繞開了同一個世界** —— 而讀的人只會讀前兩份。

describe('外部存活訊號 · DB 掛掉那個世界', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('[p8] 🔴 DB 寫入【永不 resolve】⇒ 外部訊號【照樣送出去】', async () => {
    const seen: Array<{ job: string; budgetMs: number }> = [];
    const spy = (async (jobName: string, deadlineAt: number) => {
      seen.push({ job: jobName, budgetMs: deadlineAt - Date.now() });
    }) as unknown as typeof pingExternalHeartbeat;
    const store = {
      readFailureCount: async () => 0,
      write: () => new Promise<{ error: unknown }>(() => {}), // 永遠不 resolve
    };

    await recordHeartbeatSuccess(CRON_JOB_NAME.settleSweep, store, spy);

    // 🔴 怎麼會紅:把 ping 的預算改回沿用 DB 那個 deadlineAt ⇒ DB 逾時後 ms=0 ⇒ 整發被跳過
    //    ⇒ seen 是空的。**而那正是這一片唯一真正要工作的那個世界。**
    expect(seen).toHaveLength(1);
    expect(seen[0]!.job).toBe(CRON_JOB_NAME.settleSweep);
    // 預算是【重新起算】的 ⇒ 拿到的必須接近 HEARTBEAT_PING_MS，而不是 0 或負數
    expect(seen[0]!.budgetMs).toBeGreaterThan(0);
    expect(seen[0]!.budgetMs).toBeLessThanOrEqual(HEARTBEAT_PING_MS);
  });

  it('[p9] 兩發預算加起來不超過 HEARTBEAT_MAX_MS(不是各給一份)', () => {
    // 🔴 怎麼會紅:把 HEARTBEAT_PING_MS 改成一個獨立常數（例如也給 2000）⇒ 這裡紅。
    //    ⚠️ 這一格守的是【總預算沒有變成兩倍】—— 那是當初共用 deadline 的收益，切開之後要靠它守。
    expect(HEARTBEAT_DB_MS + HEARTBEAT_PING_MS).toBe(HEARTBEAT_MAX_MS);
    expect(HEARTBEAT_PING_MS).toBeGreaterThan(0);
  });
});

// ══ 🔴 codex 2026-08-28 補的兩格 ══

describe('外部存活訊號 · codex 補的兩格', () => {
  const ENV = 'HEALTHCHECKS_PING_URL_PCM_SETTLE_SWEEP';
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('[p10] 🔴 fetch 掛著不回 ⇒ 靠 signal 收掉,函式【會結束】', async () => {
    vi.stubEnv(ENV, 'https://hc-ping.com/aaaa-bbbb');
    // 這支假 fetch **只有在 signal 中止時才 reject** ——
    // 🔴 拿掉 `signal` 的話它會【永遠 pending】⇒ 本格逾時變紅。
    //    上一版 p5 餵的是「立刻 reject」⇒ 有沒有 signal 都一樣綠 ⇒ 那一格對 signal 零判別力。
    //    📌 一個「會拋」的替身，證不出「會被取消」。
    const fake = ((_u: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(new Error('AbortError')));
      })) as unknown as typeof fetch;

    const t0 = Date.now();
    await expect(
      pingExternalHeartbeat(CRON_JOB_NAME.settleSweep, Date.now() + 120, fake),
    ).resolves.toBeUndefined();
    // 🔴 上界綁【傳進去的那個預算】,不是 HEARTBEAT_MAX_MS(codex R2 nit):
    //    綁 2000 的話,把 signal 改成 1900ms 也照樣綠 ⇒ 那個斷言對「有沒有及時收掉」幾乎沒有判別力。
    expect(Date.now() - t0).toBeLessThan(120 + 300); // 預算 120ms + jsdom/timer 餘裕
  });

  it('[p11] 🔴 healthchecks 回非 2xx ⇒ 要出聲,而且訊息【不含 URL】', async () => {
    vi.stubEnv(ENV, 'https://hc-ping.com/aaaa-bbbb');
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      logs.push(a.map(String).join(' '));
    });
    const fake = (async () => ({ ok: false, status: 404 }) as Response) as unknown as typeof fetch;

    await pingExternalHeartbeat(CRON_JOB_NAME.settleSweep, Date.now() + 2000, fake);

    // 🔴 怎麼會紅:把 `if (!res.ok) console.error(...)` 拿掉 ⇒ 404 變成【沉默的失聯】。
    expect(logs.some((l) => l.includes('404'))).toBe(true);
    // 🔴 而同一格順便釘【不得印出 URL】—— 那是那支 check 的寫入憑證。
    expect(logs.some((l) => l.includes('hc-ping.com') || l.includes('aaaa-bbbb'))).toBe(false);
  });
});

// ══ 🔴 補一格:突變「把原始 err 印回去」殺不掉,所以那道守門【當時沒有對象】══
//
// codex MF-b 要求「不得把原始 `err` 交給 console.error」(它可能夾帶完整 URL)。
// 我照做了,而**當我拿那一格去跑突變時,它沒有紅** ——
// 成因:上面 p5 餵的假 fetch 拋的是 `new Error('ETIMEDOUT')`,**訊息裡本來就沒有 URL**
// ⇒ 印原始 err 也漏不出東西 ⇒ **那道守門在測試世界裡沒有可洩漏的東西可以守。**
// 📌 **一道守門的綠,可能只是因為測試世界裡沒有它要擋的那個東西。**
//    ⇒ 要證明它在守,得先讓那個東西【真的出現在錯誤裡】—— 而真的 `fetch` 就是這樣拋的。

describe('外部存活訊號 · 憑證不得進 log', () => {
  const ENV = 'HEALTHCHECKS_PING_URL_PCM_SETTLE_SWEEP';
  const URL_WITH_SECRET = 'https://hc-ping.com/secret-uuid-must-not-leak';
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('[p12] 🔴 fetch 拋的錯【訊息裡帶著 URL】⇒ log 不得含它', async () => {
    vi.stubEnv(ENV, URL_WITH_SECRET);
    const logs: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
      // 與正式環境同形狀:整顆物件交給平台序列化
      logs.push(a.map((x) => (x instanceof Error ? `${x.name}: ${x.message}` : String(x))).join(' '));
    });
    // ⚠️ **這是【防禦性的最壞情境】,不是 Node 22 真 fetch 的典型形狀**(codex R2 nit 實測:
    //    真 fetch 失敗拿到的是 `TypeError: fetch failed`,message / cause / stack **都沒有 URL**)。
    //    ⇒ 那為什麼還留:錯誤形狀**不是我們控制的**(換 runtime / 換 undici 版 / 加 log 攔截器都會變),
    //      而這一格問的是「**萬一它帶了,我們會不會漏出去**」。
    //    📌 **一個今天不會發生的洩漏,與一個永遠不會發生的洩漏,在今天的探針上長一樣。**
    const fake = (async () => {
      throw new TypeError(`fetch failed: request to ${URL_WITH_SECRET} failed`);
    }) as unknown as typeof fetch;

    await pingExternalHeartbeat(CRON_JOB_NAME.settleSweep, Date.now() + 2000, fake);

    // 🔴 怎麼會紅:把 `console.error(msg)` 改回 `console.error(msg, err)` ⇒ 憑證進 log。
    expect(logs.some((l) => l.includes('secret-uuid-must-not-leak'))).toBe(false);
    // 而它仍然要出聲(只是不帶憑證)—— 否則「不洩漏」用「什麼都不印」也能達成。
    expect(logs.some((l) => l.includes('TypeError'))).toBe(true);
  });
});

// ══ 🔴 codex R2 補的兩格:DB【直接 reject】那條路,與【總預算】那個宣稱 ══
//
// R1 我補的 p8 餵的是「永不 resolve」⇒ 只蓋到【逾時】那條路。
// 🔴 而 `store.write()` 還有第二種死法:**立刻 reject**(DNS / 連線中斷)——
//    上一版兩件事在同一個 try 裡 ⇒ reject 讓 `await` 往外拋 ⇒ **跳過 ping** ⇒ 兩個訊號一起沉默。
// 📌 **我上一版只修好了逾時那條,因為我補的測試只餵了不 resolve 的那一種** ——
//    **一個修法的射程,等於當初逼出它的那個測試世界的射程。**

describe('外部存活訊號 · DB 兩種死法都要照送', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('[p13] 🔴 DB 寫入【立刻 reject】⇒ 外部訊號照樣送出去', async () => {
    const seen: string[] = [];
    const spy = (async (jobName: string) => {
      seen.push(jobName);
    }) as unknown as typeof pingExternalHeartbeat;
    const store = {
      readFailureCount: async () => 0,
      write: async () => {
        throw new Error('ECONNREFUSED');
      },
    };

    await recordHeartbeatSuccess(CRON_JOB_NAME.emailSweep, store, spy);

    // 🔴 怎麼會紅:把 ping 那段搬回 DB 的同一個 try 裡 ⇒ reject 讓它被跳過 ⇒ seen 是空的。
    expect(seen, 'DB reject 讓外部訊號一起沉默了').toEqual([CRON_JOB_NAME.emailSweep]);
  });

  it('[p14] 🔴 DB 那段【超時跑掉】⇒ ping 的截止仍不得越過總預算', async () => {
    // 🔴🔴 **這一格是被一發【殺不掉的突變】逼著重寫的**:
    //    第一版斷言 `budgets[0] <= t0 + 2000 + 50`，而 DB 剛好吃滿 1200 時
    //    `Date.now() + 800` = t0+2000 ⇒ **兩種實作在那個世界【算出同一個數】** ⇒ 突變全綠。
    //    📌 **兩個實作只在【某些世界】不同 —— 而我第一版挑的那個世界，剛好是它們相同的那個。**
    //    ⇒ 要挑一個【它們一定不同】的世界:讓 DB 那段的 wall-clock **超過**它的預算
    //      (真實成因:event loop 被塞住、timer 晚觸發)。這裡用假時鐘造出來。
    const budgets: number[] = [];
    const spy = (async (_j: string, deadlineAt: number) => {
      budgets.push(deadlineAt);
    }) as unknown as typeof pingExternalHeartbeat;
    const store = {
      readFailureCount: async () => 0,
      write: () => new Promise<{ error: unknown }>(() => {}),
    };

    const real = Date.now;
    const t0 = real();
    let calls = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      calls += 1;
      // 第 1 次 = startedAt；之後一律回「已經過了 5 秒」（模擬 DB 那段整個跑掉）
      return calls === 1 ? t0 : t0 + 5_000;
    });

    await recordHeartbeatSuccess(CRON_JOB_NAME.settleSweep, store, spy);
    vi.mocked(Date.now).mockRestore();

    expect(budgets).toHaveLength(1);
    // 🔴 怎麼會紅:把截止寫回 `Date.now() + HEARTBEAT_PING_MS`
    //    ⇒ t0 + 5000 + 800 = t0 + 5800 ⇒ 遠遠越過總預算 ⇒ 這裡紅。
    //    而正確版 `min(startedAt + 2000, now + 800)` ⇒ 夾在 t0 + 2000。
    expect(budgets[0]!).toBe(t0 + HEARTBEAT_MAX_MS);
  });
});
