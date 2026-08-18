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

  // 🔴 prod 硬閘(權限鐵則 12②)。兩個世界缺一不可:
  //   拿掉 tier.ts 的 `NODE_ENV !== 'production' &&` 那道閘 ⇒ 【①③兩格】必須翻紅(負測;V 窗 2026-08-18 獨立重跑實測 2 failed|6 passed)。
  //   ③(cookie fallback 那格)也依賴這道閘:閘沒了 ⇒ override 活著 ⇒ 蓋掉 cookie ⇒ 回 store 而非 premiumStore。
  //   ⚠️ 別數成「多紅一格」—— 加了 ③ 之後,「拆掉會紅幾格」就從 1 變 2 了。
  it('🔴 prod 硬閘:NODE_ENV=production + flag=1 + ?tier=store → override 失效、回 general', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '1');
    const tier = await resolveTierFromRequest({ tier: 'store' }, makeMockCookies());
    expect(tier).toBe('general');
  });

  it('🔴 硬閘不誤傷 dev:NODE_ENV=development + flag=1 + ?tier=store → override 仍生效、回 store', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '1');
    const tier = await resolveTierFromRequest({ tier: 'store' }, makeMockCookies());
    expect(tier).toBe('store');
  });

  // 🔴 硬閘與 #215 cookie 釘樁獨立(codex nit):prod 關掉的只是 `?tier=` override 這條路,
  //   不是把 tier 一律壓成 general。override 死了要【落到 cookie】、不是短路回 general。
  it('🔴 prod 硬閘只殺 override、不吞 cookie fallback:production + flag=1 + ?tier=store + cookie=premium_store → premiumStore', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PCM_DEV_TIER_OVERRIDE', '1');
    const tier = await resolveTierFromRequest({ tier: 'store' }, makeMockCookies('premium_store'));
    expect(tier).toBe('premiumStore');
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
