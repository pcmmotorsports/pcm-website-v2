import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { runSpy, depsSpy, siteUrl, okBeat, failBeat } = vi.hoisted(() => ({
  runSpy: vi.fn(),
  depsSpy: vi.fn(),
  okBeat: vi.fn(),
  failBeat: vi.fn(),
  siteUrl: { value: 'https://www.pcmmotorsports.com' as string | undefined },
}));
vi.mock('@pcm/use-cases', () => ({ draftNewProductPosts: runSpy }));
vi.mock('@/lib/new-product-drafts/composition', () => ({ getNewProductDraftDeps: depsSpy }));
vi.mock('@/lib/site-url', () => ({ resolveSiteUrl: () => siteUrl.value }));
vi.mock('@/lib/cron/heartbeat', () => ({
  CRON_JOB_NAME: { newProductDrafts: 'pcm-new-product-drafts' },
  recordHeartbeatSuccess: okBeat,
  recordHeartbeatFailure: failBeat,
}));

import { GET } from './route';
import { resetCronRateLimit } from '@/lib/cron/rate-limit';

const SECRET = 's'.repeat(48);
const req = (authorization?: string) =>
  new Request('http://localhost:3000/api/cron/new-product-drafts', {
    headers: authorization === undefined ? {} : { authorization },
  });

beforeEach(() => {
  vi.clearAllMocks();
  resetCronRateLimit();
  vi.stubEnv('CRON_SECRET', SECRET);
  siteUrl.value = 'https://www.pcmmotorsports.com';
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /api/cron/new-product-drafts', () => {
  it('沒帶 Bearer ⇒ 401, 不建', async () => {
    expect((await GET(req())).status).toBe(401);
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('CRON_SECRET 太短 ⇒ 500', async () => {
    vi.stubEnv('CRON_SECRET', 'short');
    expect((await GET(req('Bearer short'))).status).toBe(500);
  });

  it('🔴 旗標預設關 ⇒ 200 disabled, 不建', async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ enabled: false, skipped: 'disabled' });
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('旗標開但正式網址沒設 ⇒ 503 + 失敗心跳, 不建(設定錯誤要看得到)', async () => {
    vi.stubEnv('NEW_PRODUCT_DRAFTS_ENABLED', 'on');
    siteUrl.value = undefined;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ skipped: 'missing_site_url' });
    expect(runSpy).not.toHaveBeenCalled();
    expect(failBeat).toHaveBeenCalledWith('pcm-new-product-drafts');
  });

  it('旗標開 ⇒ 用正式網址組依賴, 回傳結果', async () => {
    vi.stubEnv('NEW_PRODUCT_DRAFTS_ENABLED', 'on');
    depsSpy.mockReturnValue({ deps: true });
    runSpy.mockResolvedValue({ candidates: 4, created: 2, duplicate: 1, skipped: {} });
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(depsSpy).toHaveBeenCalledWith('https://www.pcmmotorsports.com');
    expect(await res.json()).toMatchObject({ ok: true, created: 2, duplicate: 1 });
  });

  it('整輪失敗 ⇒ 503, 只回錯誤分類', async () => {
    vi.stubEnv('NEW_PRODUCT_DRAFTS_ENABLED', 'on');
    runSpy.mockRejectedValue(Object.assign(new Error('secret detail'), { code: 'PGRST301' }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'PGRST301' });
  });

  it('心跳:跑完記成功、整輪失敗記失敗、旗標關不記', async () => {
    const res1 = await GET(req(`Bearer ${SECRET}`));
    expect(res1.status).toBe(200);
    expect(okBeat).not.toHaveBeenCalled();
    expect(failBeat).not.toHaveBeenCalled();

    vi.stubEnv('NEW_PRODUCT_DRAFTS_ENABLED', 'on');
    runSpy.mockResolvedValueOnce({ candidates: 0, created: 0, duplicate: 0, skipped: {} });
    await GET(req(`Bearer ${SECRET}`));
    expect(okBeat).toHaveBeenCalledWith('pcm-new-product-drafts');

    runSpy.mockRejectedValueOnce(new Error('x'));
    await GET(req(`Bearer ${SECRET}`));
    expect(failBeat).toHaveBeenCalledWith('pcm-new-product-drafts');
  });
});
