// @vitest-environment node
// reconcile-actions.test.ts — reconcileCartSession server action 窮舉狀態矩陣測試(M-3 S1b-1)
//
// mock:server-only / @/lib/supabase/server / @/lib/payment/composition
//   (getSiblingLookup〔async factory〕+ getPollSettleThrottle + getSettleChargeDeps)/ @pcm/use-cases(settleCharge)。
// 🔴 窮舉不變量:none/paid/active × throttle{true,false} × settle{paid,failed,no_attempt,pending} + 各 throw →
//   斷言**無任何 cell 誤回 paid/failed**、throw 全落 pending;未登入/非法 → pending 且 own-only 反查 factory 未被呼;
//   回應只含 { status, displayId? }(零金額/零經銷價/零 PII、settle idempotent 等內部欄不外洩)。

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  createClientSpy,
  getUserSpy,
  getSiblingLookupSpy,
  lookupSpy,
  getThrottleFactorySpy,
  throttleSpy,
  settleSpy,
  getSettleDepsSpy,
} = vi.hoisted(() => ({
  createClientSpy: vi.fn(),
  getUserSpy: vi.fn(),
  getSiblingLookupSpy: vi.fn(),
  lookupSpy: vi.fn(),
  getThrottleFactorySpy: vi.fn(),
  throttleSpy: vi.fn(),
  settleSpy: vi.fn(),
  getSettleDepsSpy: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: createClientSpy,
}));

vi.mock('@/lib/payment/composition', () => ({
  getSiblingLookup: getSiblingLookupSpy, // async factory → { lookup }
  getPollSettleThrottle: getThrottleFactorySpy, // sync factory → { claimPollSettle }(可測 factory throw)
  getSettleChargeDeps: getSettleDepsSpy,
}));

vi.mock('@pcm/use-cases', () => ({
  settleCharge: settleSpy,
}));

import { reconcileCartSession } from './reconcile-actions';

const CART = '11111111-2222-3333-4444-555555555555';
const ORDER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const USER = 'user-aaaa';
const SIBLING_DISPLAY = 'PCM-2026-0042';
const SETTLE_DISPLAY = 'PCM-2026-0099';

type Opts = {
  user?: { id: string } | null;
  getUserThrows?: boolean;
  createThrows?: boolean;
};

function mockAuth(opts: Opts) {
  if (opts.createThrows) {
    createClientSpy.mockRejectedValue(new Error('env missing secret-detail'));
    return;
  }
  createClientSpy.mockResolvedValue({
    auth: {
      getUser: async () => {
        getUserSpy();
        if (opts.getUserThrows) throw new Error('auth boom secret-detail');
        return { data: { user: opts.user ?? null } };
      },
    },
  });
}

beforeEach(() => {
  createClientSpy.mockReset();
  getUserSpy.mockReset();
  getSiblingLookupSpy.mockReset();
  lookupSpy.mockReset();
  getThrottleFactorySpy.mockReset();
  throttleSpy.mockReset();
  settleSpy.mockReset();
  getSettleDepsSpy.mockReset();
  // default happy wiring:登入 + own sibling lookup 回 factory、throttle 放行、settle pending、deps sentinel。
  mockAuth({ user: { id: USER } });
  getSiblingLookupSpy.mockResolvedValue({ lookup: lookupSpy });
  lookupSpy.mockResolvedValue({ kind: 'none' });
  getThrottleFactorySpy.mockReturnValue({ claimPollSettle: throttleSpy });
  throttleSpy.mockResolvedValue(true);
  settleSpy.mockResolvedValue({ kind: 'pending', reason: 'auth_or_pending' });
  getSettleDepsSpy.mockReturnValue({ __deps: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('reconcileCartSession — 零信任形狀', () => {
  it('非 UUID cartSessionId → pending、不建 client、不反查', async () => {
    expect(await reconcileCartSession('not-a-uuid')).toEqual({ status: 'pending' });
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(getSiblingLookupSpy).not.toHaveBeenCalled();
    expect(throttleSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('非 string(number / undefined / 物件)→ pending、不建 client', async () => {
    for (const bad of [123, undefined, null, {}, []] as unknown[]) {
      expect(await reconcileCartSession(bad)).toEqual({ status: 'pending' });
    }
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(getSiblingLookupSpy).not.toHaveBeenCalled();
  });
});

describe('reconcileCartSession — 認證 gate', () => {
  it('未登入(user null)→ pending、own-only 反查 factory 未被呼(privileged 不觸發)', async () => {
    mockAuth({ user: null });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(getSiblingLookupSpy).not.toHaveBeenCalled();
    expect(throttleSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('getUser throw → fail-closed pending、不反查', async () => {
    mockAuth({ getUserThrows: true });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(getSiblingLookupSpy).not.toHaveBeenCalled();
  });

  it('createServerSupabaseClient throw → fail-closed pending', async () => {
    mockAuth({ createThrows: true });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(getSiblingLookupSpy).not.toHaveBeenCalled();
  });
});

describe('reconcileCartSession — 反查(find_active_sibling_own)分岔', () => {
  it('none → pending、不節流、不 settle', async () => {
    lookupSpy.mockResolvedValue({ kind: 'none' });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(lookupSpy).toHaveBeenCalledWith(CART); // own-only:傳 client cartSessionId
    expect(throttleSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('paid → { paid, displayId }(DB 確定成交、不節流、不 settle、不打 Record)', async () => {
    lookupSpy.mockResolvedValue({ kind: 'paid', existingOrderId: ORDER, displayId: SIBLING_DISPLAY });
    const res = await reconcileCartSession(CART);
    expect(res).toEqual({ status: 'paid', displayId: SIBLING_DISPLAY });
    expect(throttleSpy).not.toHaveBeenCalled();
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('lookup throw → fail-closed pending、不節流', async () => {
    lookupSpy.mockRejectedValue(new Error('rpc shape boom secret-detail'));
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(throttleSpy).not.toHaveBeenCalled();
  });
});

describe('reconcileCartSession — active × 節流 × settle 窮舉', () => {
  beforeEach(() => {
    lookupSpy.mockResolvedValue({
      kind: 'active',
      existingOrderId: ORDER,
      attemptId: 'attempt-1',
      displayId: SIBLING_DISPLAY,
    });
  });

  it('throttle false(窗內已放行/manual/ceiling/非unpaid)→ pending、不 settle', async () => {
    throttleSpy.mockResolvedValue(false);
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(throttleSpy).toHaveBeenCalledWith(ORDER, 10);
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('throttle true + settle paid → { paid, displayId(settle 的) };throttle/settle 參數正確', async () => {
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockResolvedValue({ kind: 'paid', idempotent: false, displayId: SETTLE_DISPLAY });
    const res = await reconcileCartSession(CART);
    expect(res).toEqual({ status: 'paid', displayId: SETTLE_DISPLAY });
    expect(throttleSpy).toHaveBeenCalledWith(ORDER, 10);
    expect(settleSpy).toHaveBeenCalledWith({ __deps: true }, { orderId: ORDER });
    expect(Object.keys(res)).toEqual(['status', 'displayId']); // idempotent 等內部欄不外洩
  });

  it('throttle true + settle failed → { failed, displayId(sibling 的) }', async () => {
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockResolvedValue({ kind: 'failed' });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'failed', displayId: SIBLING_DISPLAY });
  });

  it('throttle true + settle no_attempt → pending(fail-closed、不誤報 failed)', async () => {
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockResolvedValue({ kind: 'no_attempt' });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
  });

  it('throttle true + settle pending → pending', async () => {
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockResolvedValue({ kind: 'pending', reason: 'record_unreachable' });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
  });

  it('throttle true + settle throw → fail-closed pending(不偽 paid/failed)', async () => {
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockRejectedValue(new Error('settle boom secret-detail'));
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
  });

  it('throttle RPC throw → fail-closed pending、不 settle', async () => {
    throttleSpy.mockRejectedValue(new Error('throttle rpc missing'));
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(settleSpy).not.toHaveBeenCalled();
  });
});

describe('reconcileCartSession — 零洩漏總驗', () => {
  it('任何 pending 結果只含 { status },零金額/零 displayId/零 PII', async () => {
    lookupSpy.mockResolvedValue({ kind: 'none' });
    const res = await reconcileCartSession(CART);
    expect(Object.keys(res)).toEqual(['status']);
  });

  it('🔴 窮舉:無任何 (lookup × throttle × settle) 組合誤回 paid/failed', async () => {
    // 只有 lookup=paid、或 (active+throttle true+settle paid) 可回 paid;只有 (active+throttle true+settle failed) 可回 failed。
    // 反面窮舉:active 但 throttle false / settle∈{no_attempt,pending,throw} → 一律 pending。
    lookupSpy.mockResolvedValue({
      kind: 'active',
      existingOrderId: ORDER,
      attemptId: 'a',
      displayId: SIBLING_DISPLAY,
    });
    const nonTerminalSettles = [
      { kind: 'no_attempt' as const },
      { kind: 'pending' as const, reason: 'record_unverified' as const },
      { kind: 'pending' as const, reason: 'auth_or_pending' as const },
    ];
    throttleSpy.mockResolvedValue(true);
    for (const s of nonTerminalSettles) {
      settleSpy.mockResolvedValue(s);
      expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    }
    // throttle 擋掉 → 即使 settle 會 paid 也不觸發、回 pending(清掉迴圈累積的呼叫、驗此輪 skip)。
    settleSpy.mockClear();
    throttleSpy.mockResolvedValue(false);
    settleSpy.mockResolvedValue({ kind: 'paid', idempotent: false, displayId: SETTLE_DISPLAY });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(settleSpy).not.toHaveBeenCalled();
  });
});

describe('reconcileCartSession — composition factory throw(fail-closed 補全、codex 關卡2)', () => {
  it('getSiblingLookup() factory reject → pending(不只 lookup() reject)', async () => {
    getSiblingLookupSpy.mockRejectedValue(new Error('sibling factory boom secret-detail'));
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(throttleSpy).not.toHaveBeenCalled();
  });

  it('getPollSettleThrottle() factory throw(active 後)→ pending、不 settle', async () => {
    lookupSpy.mockResolvedValue({
      kind: 'active',
      existingOrderId: ORDER,
      attemptId: 'a',
      displayId: SIBLING_DISPLAY,
    });
    getThrottleFactorySpy.mockImplementation(() => {
      throw new Error('throttle factory env missing secret-detail');
    });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
    expect(settleSpy).not.toHaveBeenCalled();
  });

  it('getSettleChargeDeps() factory throw(throttle 放行後)→ pending', async () => {
    lookupSpy.mockResolvedValue({
      kind: 'active',
      existingOrderId: ORDER,
      attemptId: 'a',
      displayId: SIBLING_DISPLAY,
    });
    throttleSpy.mockResolvedValue(true);
    getSettleDepsSpy.mockImplementation(() => {
      throw new Error('deps factory env missing secret-detail');
    });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'pending' });
  });

  it('settle paid idempotent:true → { paid, displayId }(冪等重入同映射)', async () => {
    lookupSpy.mockResolvedValue({
      kind: 'active',
      existingOrderId: ORDER,
      attemptId: 'a',
      displayId: SIBLING_DISPLAY,
    });
    throttleSpy.mockResolvedValue(true);
    settleSpy.mockResolvedValue({ kind: 'paid', idempotent: true, displayId: SETTLE_DISPLAY });
    expect(await reconcileCartSession(CART)).toEqual({ status: 'paid', displayId: SETTLE_DISPLAY });
  });
});

describe('reconcileCartSession — log 零洩漏(console spy;codex 關卡2 should2)', () => {
  it('🔴 任何路徑的 console 輸出都不含 cartSessionId / raw error / secret marker', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // 未登入(不 log)、settle throw(catch 靜態字串 log)、正常 paid 各跑一次。
      mockAuth({ user: null });
      await reconcileCartSession(CART);
      mockAuth({ user: { id: USER } });
      lookupSpy.mockResolvedValue({
        kind: 'active',
        existingOrderId: ORDER,
        attemptId: 'a',
        displayId: SIBLING_DISPLAY,
      });
      throttleSpy.mockResolvedValue(true);
      settleSpy.mockRejectedValue(new Error('settle boom secret-detail here'));
      await reconcileCartSession(CART);
      lookupSpy.mockResolvedValue({ kind: 'paid', existingOrderId: ORDER, displayId: SIBLING_DISPLAY });
      await reconcileCartSession(CART);

      const allLogged = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .map((a) => String(a))
        .join(' | ');
      expect(allLogged).not.toContain(CART); // 零 cartSessionId 洩漏
      expect(allLogged).not.toContain('secret-detail'); // 零 raw error 洩漏
      expect(allLogged).not.toContain(SIBLING_DISPLAY); // 零 displayId/單號洩漏進 log
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
