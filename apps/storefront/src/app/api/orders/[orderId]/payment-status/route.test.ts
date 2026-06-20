// @vitest-environment node
// route.test.ts — /api/orders/[orderId]/payment-status GET handler 測試(M-3 3DS-S2)
//
// node env(route 用全域 Request/Response)。mock:server-only / @/lib/supabase/server(createServerSupabaseClient)。
// 驗:非 UUID→400 不建 client / getUser throw→401 不查 DB / user null→401 / paid→200{paid} / unpaid→200{pending} /
//     partiallyPaid·refunded→200{pending}(不偽 paid)/ 查無→404 / DB error→500 / maybeSingle throw→500 /
//     🔴 own-only .eq('customer_user_id') 被呼叫 / 🔴 401·404·500 null body 零洩漏 / 回應只含 { status } 零金額零 PII。

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createClientSpy, getUserSpy, fromSpy, selectSpy, eqSpy, maybeSingleSpy } = vi.hoisted(() => ({
  createClientSpy: vi.fn(),
  getUserSpy: vi.fn(),
  fromSpy: vi.fn(),
  selectSpy: vi.fn(),
  eqSpy: vi.fn(),
  maybeSingleSpy: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: createClientSpy,
}));

import { GET } from './route';

const ORDER = '11111111-2222-3333-4444-555555555555';
const USER = 'user-aaaa';

type SupaOpts = {
  user?: { id: string } | null;
  getUserThrows?: boolean;
  data?: { payment_status: string } | null;
  error?: unknown;
  dbThrows?: boolean;
};

function mockSupabase(opts: SupaOpts) {
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
      if (opts.dbThrows) throw new Error('conn boom secret-detail');
      return { data: opts.data ?? null, error: opts.error ?? null };
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/orders/[orderId]/payment-status — 零信任形狀', () => {
  it('非 UUID orderId → 400 null body、不建 supabase client、不查 DB', async () => {
    const res = await GET(req(), ctx('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(await res.text()).toBe(''); // 統一零 body 政策(零洩漏面)
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
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
  it('本人單 paid → 200 { status: "paid" }、回應只含 status(零金額零 PII)', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'paid' } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'paid' });
    expect(Object.keys(json)).toEqual(['status']); // 零金額/零 displayId/零經銷價
    expect(res.headers.get('Cache-Control')).toBe('no-store'); // 動態狀態不快取
  });

  it('本人單 unpaid → 200 { status: "pending" }(不偽 paid)', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'unpaid' } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('partiallyPaid → 200 pending(非 paid 一律 pending、fail-closed)', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'partiallyPaid' } });
    const res = await GET(req(), ctx());
    expect(await res.json()).toEqual({ status: 'pending' });
  });

  it('refunded → 200 pending(不偽 paid)', async () => {
    mockSupabase({ user: { id: USER }, data: { payment_status: 'refunded' } });
    const res = await GET(req(), ctx());
    expect(await res.json()).toEqual({ status: 'pending' });
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
  it('createServerSupabaseClient throw → 500 null body(env/cookie factory 失敗 fail-closed、不繞 500 政策)', async () => {
    createClientSpy.mockRejectedValue(new Error('env missing secret-detail'));
    const res = await GET(req(), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toBe('');
    expect(text).not.toContain('secret-detail');
  });

  it('查無 / 非本人(data null)→ 404、null body 零洩漏(不揭他人單存在性)', async () => {
    mockSupabase({ user: { id: USER }, data: null });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
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
