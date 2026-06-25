import { describe, it, expect, vi } from 'vitest';
import type { SiblingLookupResult, SettleChargeOutcome } from '@pcm/domain';
import {
  preflightReleaseSibling,
  type PreflightReleaseSiblingDeps,
} from './preflight-release-sibling';

const INPUT = { userId: 'user-1', cartSessionId: 'cart-1' };
const ORDER = 'order-existing';
const ATTEMPT = 'attempt-existing';
const DISPLAY = 'PCM-2026-0099';

function activeSibling(): SiblingLookupResult {
  return { kind: 'active', existingOrderId: ORDER, attemptId: ATTEMPT, displayId: DISPLAY };
}

/** 組 deps;各 mock 預設安全值,測試覆寫對應分支。 */
function makeDeps(parts: {
  lookup?: () => Promise<SiblingLookupResult>;
  release?: () => Promise<{ released: boolean }>;
  settle?: PreflightReleaseSiblingDeps['settle'];
}) {
  const lookup = vi.fn(parts.lookup ?? (async (): Promise<SiblingLookupResult> => ({ kind: 'none' })));
  const release = vi.fn(parts.release ?? (async () => ({ released: true })));
  const settle = vi.fn(
    parts.settle ?? (async (): Promise<SettleChargeOutcome> => ({ kind: 'no_attempt' })),
  );
  const deps: PreflightReleaseSiblingDeps = {
    siblingLookup: { lookup },
    releaseSibling: { release },
    settle,
  };
  return { deps, lookup, release, settle };
}

describe('preflightReleaseSibling — siblingLookup 三態', () => {
  it('none → proceed;lookup 以 cartSessionId 呼、不 settle/release', async () => {
    const { deps, lookup, release, settle } = makeDeps({ lookup: async () => ({ kind: 'none' }) });
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'proceed' });
    expect(lookup).toHaveBeenCalledWith(INPUT.cartSessionId);
    expect(settle).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('paid → existing_paid(existingOrderId/displayId);不 settle/release', async () => {
    const { deps, settle, release } = makeDeps({
      lookup: async () => ({ kind: 'paid', existingOrderId: ORDER, displayId: DISPLAY }),
    });
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'existing_paid', existingOrderId: ORDER, displayId: DISPLAY });
    expect(settle).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  it('lookup throw → hold(lookup_unreachable、fail-closed 不建新單)', async () => {
    const { deps, settle } = makeDeps({
      lookup: async () => {
        throw new Error('boom');
      },
    });
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'hold', reason: 'lookup_unreachable' });
    expect(settle).not.toHaveBeenCalled();
  });
});

describe('preflightReleaseSibling — active → settle 裁決', () => {
  it('settle paid → existing_paid(用 settle.displayId);settle 以 existingOrderId 呼', async () => {
    const { deps, settle, release } = makeDeps({
      lookup: async () => activeSibling(),
      settle: async () => ({ kind: 'paid', idempotent: false, displayId: DISPLAY }),
    });
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'existing_paid', existingOrderId: ORDER, displayId: DISPLAY });
    expect(settle).toHaveBeenCalledWith({ orderId: ORDER });
    expect(release).not.toHaveBeenCalled();
  });

  it.each(['failed', 'no_attempt'] as const)(
    'settle %s → proceed(Q2=A:確定未成交);不 release',
    async (kind) => {
      const { deps, release } = makeDeps({
        lookup: async () => activeSibling(),
        settle: async () => ({ kind }) as SettleChargeOutcome,
      });
      const res = await preflightReleaseSibling(deps, INPUT);
      expect(res).toEqual({ kind: 'proceed' });
      expect(release).not.toHaveBeenCalled();
    },
  );

  it.each(['released_failure_observed', 'record_unreachable', 'record_unverified'] as const)(
    'settle pending(%s)→ hold(同 reason);不 release',
    async (reason) => {
      const { deps, release } = makeDeps({
        lookup: async () => activeSibling(),
        settle: async () => ({ kind: 'pending', reason }),
      });
      const res = await preflightReleaseSibling(deps, INPUT);
      expect(res).toEqual({ kind: 'hold', reason });
      expect(release).not.toHaveBeenCalled();
    },
  );

  it('settle throw → hold(settle_unreachable、縱深)', async () => {
    const { deps } = makeDeps({
      lookup: async () => activeSibling(),
      settle: async () => {
        throw new Error('boom');
      },
    });
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'hold', reason: 'settle_unreachable' });
  });
});

describe('preflightReleaseSibling — auth_or_pending(4)→ release CAS', () => {
  it('🔴 release true → proceed;release 參數順序固定 (attemptId, userId, cartSessionId)〔S1〕', async () => {
    const { deps, release } = makeDeps({
      lookup: async () => activeSibling(),
      settle: async () => ({ kind: 'pending', reason: 'auth_or_pending' }),
      release: async () => ({ released: true }),
    });
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'proceed' });
    expect(release).toHaveBeenCalledWith(ATTEMPT, INPUT.userId, INPUT.cartSessionId);
  });

  it('release false → 重 settle paid → existing_paid(settle 被呼兩次)', async () => {
    const settle = vi
      .fn<PreflightReleaseSiblingDeps['settle']>()
      .mockResolvedValueOnce({ kind: 'pending', reason: 'auth_or_pending' })
      .mockResolvedValueOnce({ kind: 'paid', idempotent: true, displayId: DISPLAY });
    const deps: PreflightReleaseSiblingDeps = {
      siblingLookup: { lookup: vi.fn(async () => activeSibling()) },
      releaseSibling: { release: vi.fn(async () => ({ released: false })) },
      settle,
    };
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'existing_paid', existingOrderId: ORDER, displayId: DISPLAY });
    expect(settle).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['pending/unverified', { kind: 'pending', reason: 'record_unverified' } as SettleChargeOutcome],
    ['pending/auth_or_pending', { kind: 'pending', reason: 'auth_or_pending' } as SettleChargeOutcome],
    ['failed', { kind: 'failed' } as SettleChargeOutcome],
    ['no_attempt', { kind: 'no_attempt' } as SettleChargeOutcome],
  ])('release false → 重 settle %s(非 paid)→ hold(release_lost_race、§2.3 不建新單)', async (_l, resettle) => {
    const release = vi.fn(async () => ({ released: false }));
    const settle = vi
      .fn<PreflightReleaseSiblingDeps['settle']>()
      .mockResolvedValueOnce({ kind: 'pending', reason: 'auth_or_pending' })
      .mockResolvedValueOnce(resettle);
    const deps: PreflightReleaseSiblingDeps = {
      siblingLookup: { lookup: vi.fn(async () => activeSibling()) },
      releaseSibling: { release },
      settle,
    };
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'hold', reason: 'release_lost_race' });
    expect(release).toHaveBeenCalledTimes(1); // 🔴 輸 race 後不二次 release(即使重 settle 回 auth_or_pending)
  });

  it('release throw → hold(release_unreachable、fail-closed)', async () => {
    const { deps } = makeDeps({
      lookup: async () => activeSibling(),
      settle: async () => ({ kind: 'pending', reason: 'auth_or_pending' }),
      release: async () => {
        throw new Error('boom');
      },
    });
    const res = await preflightReleaseSibling(deps, INPUT);
    expect(res).toEqual({ kind: 'hold', reason: 'release_unreachable' });
  });
});
