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
