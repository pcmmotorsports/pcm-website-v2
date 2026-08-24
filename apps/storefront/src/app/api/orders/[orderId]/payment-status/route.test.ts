// @vitest-environment node
// route.test.ts — /api/orders/[orderId]/payment-status GET handler 測試(M-3 3DS-S2 + S2b)
//
// node env(route 用全域 Request/Response)。mock:server-only / @/lib/supabase/server / @/lib/payment/composition
//   (getPollSettleThrottle + getSettleChargeDeps)/ @pcm/use-cases(settleCharge)。
// 驗:非 UUID→400 不建 client / getUser throw→401 不查 DB / user null→401 / paid→200{paid}(不結算)/
//     unpaid→200{pending} / partiallyPaid·refunded→200{pending}(不偽 paid、不結算)/ 查無→404 / DB error→500 /
//     🔴 own-only .eq('customer_user_id') 被呼叫 / 🔴 401·404·500 null body 零洩漏 / 回應只含 { status } 零金額零 PII。
// 🔴 S2b:unpaid→過 throttle 後呼 settleCharge(spy 證)/ throttle false→不呼 / partiallyPaid·refunded·paid·404→不呼 /
//     settle 後重讀 paid→{paid} / settleCharge throw→{pending} fail-closed(不 500)/ throttle RPC throw→fail-closed skip。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  createClientSpy,
  getUserSpy,
  fromSpy,
  selectSpy,
  eqSpy,
  maybeSingleSpy,
  throttleSpy,
  settleSpy,
  getSettleDepsSpy,
} = vi.hoisted(() => ({
  createClientSpy: vi.fn(),
  getUserSpy: vi.fn(),
  fromSpy: vi.fn(),
  selectSpy: vi.fn(),
  eqSpy: vi.fn(),
  maybeSingleSpy: vi.fn(),
  throttleSpy: vi.fn(),
  settleSpy: vi.fn(),
  getSettleDepsSpy: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: createClientSpy,
}));

vi.mock('@/lib/payment/composition', () => ({
  getPollSettleThrottle: () => ({ claimPollSettle: throttleSpy }),
  getSettleChargeDeps: getSettleDepsSpy,
}));

vi.mock('@pcm/use-cases', () => ({
  settleCharge: settleSpy,
}));

import { GET } from './route';

const ORDER = '11111111-2222-3333-4444-555555555555';
const USER = 'user-aaaa';

type SupaOpts = {
  user?: { id: string } | null;
  getUserThrows?: boolean;
  data?: { payment_status: string } | null; // 第一讀(及第二讀預設)
  data2?: { payment_status: string } | null; // 第二讀(settle 後重讀;省略則同 data)
  error?: unknown;
  dbThrows?: boolean; //  兩讀皆 throw
  dbThrows2?: boolean; // 只第二讀 throw(settle 後重讀 DB 連線錯)
};

function mockSupabase(opts: SupaOpts) {
  let readCount = 0;
  const builder = {
    select: (...a: unknown[]) => {
      selectSpy(...a);
      return builder;
    },
    eq: (...a: unknown[]) => {
      eqSpy(...a);
      return builder;
    },
    maybeSingle: async () => {
      maybeSingleSpy();
      readCount += 1;
      if (opts.dbThrows) throw new Error('conn boom secret-detail');
      if (opts.dbThrows2 && readCount === 2) throw new Error('second read boom secret-detail');
      const data =
        readCount === 1 ? (opts.data ?? null) : (opts.data2 ?? opts.data ?? null);
      return { data, error: opts.error ?? null };
    },
  };
  createClientSpy.mockResolvedValue({
    auth: {
      getUser: async () => {
        getUserSpy();
        if (opts.getUserThrows) throw new Error('auth boom secret-detail');
        return { data: { user: opts.user ?? null } };
      },
    },
    from: (...a: unknown[]) => {
      fromSpy(...a);
      return builder;
    },
  });
}

function req(): Request {
  return new Request(`http://localhost:3000/api/orders/${ORDER}/payment-status`);
}
const ctx = (orderId: string = ORDER) => ({ params: Promise.resolve({ orderId }) });

beforeEach(() => {
  createClientSpy.mockReset();
  getUserSpy.mockReset();
  fromSpy.mockReset();
  selectSpy.mockReset();
  eqSpy.mockReset();
  maybeSingleSpy.mockReset();
  throttleSpy.mockReset();
  settleSpy.mockReset();
  getSettleDepsSpy.mockReset();
  // default:throttle 不放行(現有非-S2b 測試不觸發 settle);getSettleChargeDeps 回 sentinel deps。
  throttleSpy.mockResolvedValue(false);
  settleSpy.mockResolvedValue({ kind: 'pending' });
  getSettleDepsSpy.mockReturnValue({ __deps: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/orders/[orderId]/payment-status — 零信任形狀', () => {
  it('非 UUID orderId → 400 null body、不建 supabase client、不查 DB、不結算', async () => {
    const res = await GET(req(), ctx('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(''); // 統一零 body 政策(零洩漏面)
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
    expect(throttleSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('空 orderId → 400', async () => {
    const res = await GET(req(), ctx(''));
    expect(res.status).toBe(400);
    expect(createClientSpy).not.toHaveBeenCalled();
  });
});

describe('GET payment-status — 認證(getUser)', () => {
  it('getUser throw → 401、不查 DB、null body 零洩漏', async () => {
    mockSupabase({ getUserThrows: true });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
    expect(fromSpy).not.toHaveBeenCalled();
    expect(throttleSpy).not.toHaveBeenCalled();
    expect(await res.text()).toBe('');
  });

  it('user 為 null(未登入)→ 401、不查 DB', async () => {
    mockSupabase({ user: null });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('GET payment-status — own-only 讀 + 狀態映射', () => {
  it('本人單 paid → 200 { status: "paid" }、回應只含 status(零金額零 PII)、不結算', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'paid' } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'paid' });
    expect(Object.keys(json)).toEqual(['status']); // 零金額/零 displayId/零經銷價
    expect(res.headers.get('Cache-Control')).toBe('no-store'); // 動態狀態不快取
    expect(throttleSpy).not.toHaveBeenCalled(); // paid 短路、不打 Record
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('本人單 unpaid → 200 { status: "pending" }(不偽 paid)', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('partiallyPaid → 200 pending(非 paid 一律 pending、fail-closed、不結算)', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'partiallyPaid' } });
    const res = await GET(req(), ctx());
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(throttleSpy).not.toHaveBeenCalled(); // settle 閘 = raw 'unpaid';非 unpaid 不觸發
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('refunded → 200 pending(不偽 paid、不結算)', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'refunded' } });
    const res = await GET(req(), ctx());
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(throttleSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('🔴 own-only 縱深:.eq("customer_user_id", userId) 確被呼叫', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'paid' } });
    await GET(req(), ctx());
    expect(eqSpy).toHaveBeenCalledWith('id', ORDER);
    expect(eqSpy).toHaveBeenCalledWith('customer_user_id', USER);
    expect(selectSpy).toHaveBeenCalledWith('payment_status'); // 只取單欄
  });
});

describe('GET payment-status — fail-closed', () => {
  it('createServerSupabaseClient throw → 500 null body(env/cookie factory 失敗 fail-closed)', async () => {
    createClientSpy.mockRejectedValue(new Error('env missing secret-detail'));
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('');
    expect(text).not.toContain('secret-detail');
  });

  it('查無 / 非本人(data null)→ 404、null body、不結算(不揭他人單存在性)', async () => {
    mockSupabase({ user: { id: USER }, data: null });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
    expect(throttleSpy).not.toHaveBeenCalled(); // own-only 閘在 settle 前、偽造他人單不結算
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('DB error → 500、null body(不含 raw error.message)', async () => {
    mockSupabase({ user: { id: USER }, error: { message: 'pg secret-detail leak' } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('');
    expect(text).not.toContain('secret-detail');
  });

  it('maybeSingle throw → 500、null body(不洩 raw message)', async () => {
    mockSupabase({ user: { id: USER }, dbThrows: true });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('');
    expect(text).not.toContain('secret-detail');
  });
});

describe('🔴 GET payment-status — S2b 主動結算 + throttle', () => {
  it('unpaid + throttle 放行 → 呼 settleCharge(deps + {orderId});throttle 帶 (orderId, 10)', async () => {
    throttleSpy.mockResolvedValue(true);
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    await GET(req(), ctx());
    expect(throttleSpy).toHaveBeenCalledWith(ORDER, 10);
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(settleSpy).toHaveBeenCalledWith({ __deps: true }, { orderId: ORDER });
  });

  it('🔴 unpaid + throttle skip(窗內已放行)→ settleCharge 不被呼(防 Record 放大)', async () => {
    throttleSpy.mockResolvedValue(false);
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    const res = await GET(req(), ctx());
    expect(throttleSpy).toHaveBeenCalledWith(ORDER, 10);
    expect(settleSpy).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('settle 成立後重讀 paid → 200 { status: "paid" }(同輪即跳成功;outcome 不入回應)', async () => {
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockResolvedValue({ kind: 'paid', idempotent: false, displayId: 'PCM-LEAK-NO' });
    mockSupabase({
      user: { id: USER },
      data: { payment_status: 'unpaid' }, // 第一讀
      data2: { payment_status: 'paid' }, // settle 後重讀
    });
    const res = await GET(req(), ctx());
    const json = await res.json();
    expect(json).toEqual({ status: 'paid' });
    expect(Object.keys(json)).toEqual(['status']); // displayId 'PCM-LEAK-NO' 絕不入回應
  });

  it('settleCharge throw → fail-closed { status: "pending" }(不 500、不偽 paid)', async () => {
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockRejectedValue(new Error('settle boom secret-detail'));
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('throttle RPC throw(正式暫無此 RPC)→ fail-closed skip settle、回 { status: "pending" }(退回讀狀態)', async () => {
    throttleSpy.mockRejectedValue(new Error('rpc missing'));
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(settleSpy).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('settle 後第二讀查無(notfound)→ fail-closed { status: "pending" }(settle 後不 500、不偽 paid)', async () => {
    throttleSpy.mockResolvedValue(true);
    // 第一讀 ok unpaid(過閘進 settle)、第二讀回 null(notfound)→ second.kind!=='ok' → pending。
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' }, data2: null });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('settle 後第二讀 DB throw → fail-closed { status: "pending" }(settle 後不 500、不偽 paid)', async () => {
    throttleSpy.mockResolvedValue(true);
    // 第一讀 ok unpaid、第二讀 throw → readOwnPaymentStatus catch → kind:'error' → pending(不在 settle 後 500)。
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' }, dbThrows2: true });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
  });
});

// ── 🔴🔴 `#900`(2026-08-24):訊號 ────────────────────────────────────────────
// 上面那些格證的是【行為對】(fail-closed skip、不 500、不偽 paid)。而在此之前
// **兩個世界的行為是一樣的、而且都不留痕**:
// ```
// 世界①「throttle 好好地擋著」(預期,客人多分頁/狂重整時每天都會發生)
// 世界②「settleCharge 一直在拋錯」(不預期)
// ⇒ 兩者都 skip、都回 pending、都沉默 ⇒ 在我們這端是同一個畫面(什麼都沒有)
// ⇒ 「它從來沒出過問題」與「它一直在失敗」分不出來
// ```
// 🔴 所以這一段要的**不是「有 log」,是「兩個世界印【不同】的東西」** —— 印同一句話的兩個訊號,判別力是零。
//
// 📌 **本段是【後來補的】,而補它的理由值得留著**:同一道守門在
//    `apps/storefront/src/app/checkout/charge-actions.test.ts` 已經有(那條路是同一個 throttle 的另一個 caller),
//    而這一支沒有 ⇒ **那是不對稱,不是取捨**。訊號的價值全押在「兩句話不一樣」上,
//    而那正是下一次重構最容易被抹平的東西 —— 有人把兩句統一成一句,**不會有任何測試紅**。
describe('🔴 `#900` 訊號:被 throttle 擋下 vs settle 拋錯必須印【不同】的東西', () => {
  it('兩個世界各自印,而且訊息集合【不得相交】', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    // 🔴 `unpaid` 是走進 settle 那一段的**唯一**入口(route:`first.paymentStatus === 'unpaid'`)——
    //    餵 `paid` 的話會在第 4 步就 return,兩個世界都印不出東西**而測試照樣綠**。
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    throttleSpy.mockResolvedValue(false); // 世界①:擋下
    expect((await GET(req(), ctx())).status).toBe(200);
    const world1 = info.mock.calls.map((c) => String(c[0]));
    expect(world1.some((m) => m.includes('throttle 擋下'))).toBe(true);
    expect(error).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();

    info.mockClear();
    error.mockClear();

    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    throttleSpy.mockResolvedValue(true); // 世界②:放行而 settle 拋錯
    settleSpy.mockRejectedValue(new Error('settle boom secret-detail'));
    expect((await GET(req(), ctx())).status).toBe(200); // 行為不變:fail-closed skip、不 500
    const world2 = error.mock.calls.map((c) => String(c[0]));
    expect(world2.some((m) => m.includes('拋錯'))).toBe(true);

    // 🔴 **這一行才是本段存在的理由**:兩個世界的訊息集合不得相交。
    //    少了它,兩邊各印一句「[payment-status] 處理中」也會全綠 —— 而那等於沒有訊號。
    expect(world1.filter((m) => world2.includes(m))).toEqual([]);

    info.mockRestore();
    error.mockRestore();
  });

  it('順利放行(throttle 過 + settle 沒拋)⇒ 兩種訊號都不該出現', async () => {
    // 負對照:少了這一格,「無條件每次都印那兩句」也會讓上面那格綠。
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockResolvedValue({ kind: 'pending' });
    expect((await GET(req(), ctx())).status).toBe(200);
    expect(info.mock.calls.map((c) => String(c[0])).some((m) => m.includes('throttle 擋下'))).toBe(
      false,
    );
    expect(error).not.toHaveBeenCalled();
    info.mockRestore();
    error.mockRestore();
  });

  // ── 🔴 R1 findings 1/3/5/6 的守門(codex 關卡2, must-fix)──────────────────────
  // 📌 上面那格已經在餵 `new Error('settle boom secret-detail')` —— **想到了那個字, 而沒有斷言它不出現**
  //    ⇒ 那個 `'secret-detail'` 當時的作用是【看起來驗過了】。這三格把它變成真的驗過。

  it('🔴 finding 3/6:第三方 error 的內容【不得】出現在 log 的任何一個參數裡', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockRejectedValue(new Error('settle boom secret-detail'));

    expect((await GET(req(), ctx())).status).toBe(200);

    // 🔴 掃**全部參數**不只第一個 —— 上一格只看 `c[0]`, 而刻意放進去的祕密在 `c[1]`。
    //    這是本格與上一格的唯一差別, 也是 finding 6 逐字指出的那個洞。
    const everything = JSON.stringify(error.mock.calls);
    expect(everything).not.toContain('secret-detail');
    expect(everything).not.toContain('settle boom');
    // 正向:它仍然要印得出「哪一段壞了」與「哪一類例外」, 否則本格用「什麼都不印」也能綠。
    expect(everything).toContain('settle');
    expect(everything).toContain('Error');
    error.mockRestore();
  });

  it('🔴 finding 5:throttle 自己拋錯時, 不得印成「settleCharge 拋錯」(歸因)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    // 世界③:throttle RPC 自己拋 ⇒ settleCharge **根本沒被呼叫**
    throttleSpy.mockRejectedValue(new Error('throttle rpc down'));

    expect((await GET(req(), ctx())).status).toBe(200); // 行為不變:fail-closed skip
    expect(settleSpy).not.toHaveBeenCalled();

    const msgs = error.mock.calls.map((c) => String(c[0]));
    // 🔴 承重的是這一條**否定**:值班的人 grep 「settleCharge」不該撈到這一發,
    //    否則他會去查一個沒有被呼叫的東西。
    expect(msgs.some((m) => m.includes('settleCharge'))).toBe(false);
    expect(msgs.some((m) => m.includes('throttle RPC'))).toBe(true);
    expect(JSON.stringify(error.mock.calls)).toContain('throttle');
    error.mockRestore();
  });

  it('🔴 finding 1:`console.error` 自己拋錯時, 行為必須【逐字不變】(仍 200、不變成未捕捉例外)', async () => {
    // 🔴 這一格是 finding 1 的整個理由:原本那行 `console.error` 就寫在 catch 區塊裡,
    //    而 **catch 區塊裡的語句在那個 catch 的保護範圍外面** ⇒ 它拋就逃出去 ⇒ 200 變成例外。
    //    ⚠️ 它也是 `safeLog` 的突變靶:把 `safeLog` 改回裸 `console.error` ⇒ 本格必紅。
    const error = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('console is broken');
    });
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockRejectedValue(new Error('settle boom'));

    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
    error.mockRestore();
  });

  it('負對照:`console.info` 自己拋錯(throttle 擋下那條路)也不得改變行為', async () => {
    // 🔴 兩支都要有這一格。少了它, `safeLog` 只被證明在 error 那條路上有接。
    const info = vi.spyOn(console, 'info').mockImplementation(() => {
      throw new Error('console is broken');
    });
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    throttleSpy.mockResolvedValue(false);

    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
    info.mockRestore();
  });
});
