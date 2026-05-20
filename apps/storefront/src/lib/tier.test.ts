// tier.test.ts — resolveTierFromRequest unit test(M-1-13e-pre-1)
//
// 對齊 docs/architecture/testing-strategy.md §3、vitest node env、顯式 import。
// vi.mock('server-only') 防 vitest 載 tier.ts 時撞 server-only 模組 throw
// (server-only 套件 default condition throw、僅 react-server condition 走 empty.js;
// vitest node 環境無 react-server condition、需 stub)。

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { resolveTierFromRequest } from './tier';

type CookieStoreLike = Awaited<ReturnType<typeof import('next/headers').cookies>>;

function makeMockCookies(value?: string): CookieStoreLike {
  return {
    get: vi.fn().mockReturnValue(value === undefined ? undefined : { value }),
  } as unknown as CookieStoreLike;
}

describe('resolveTierFromRequest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('PCM_DEV_TIER_OVERRIDE=1 + ?tier=store → store', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '1');
    const tier = await resolveTierFromRequest({ tier: 'store' }, makeMockCookies());
    expect(tier).toBe('store');
  });

  it('PCM_DEV_TIER_OVERRIDE 關 + ?tier=store → 不走 override、走 fallback', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    const tier = await resolveTierFromRequest({ tier: 'store' }, makeMockCookies());
    expect(tier).toBe('general');
  });

  it('cookie pcm-tier=premium_store(design 字面 snake_case)→ schema premiumStore', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    const tier = await resolveTierFromRequest({}, makeMockCookies('premium_store'));
    expect(tier).toBe('premiumStore');
  });

  it('無 ?tier=、無 cookie → general fallback', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    const tier = await resolveTierFromRequest({}, makeMockCookies());
    expect(tier).toBe('general');
  });

  it('corrupt cookie 值 "xyz" → designTierToSchema throw 被 catch → general fallback', async () => {
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '');
    const tier = await resolveTierFromRequest({}, makeMockCookies('xyz'));
    expect(tier).toBe('general');
  });
});
