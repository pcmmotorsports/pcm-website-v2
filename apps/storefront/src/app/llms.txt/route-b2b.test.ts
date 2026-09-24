// /llms.txt · 經銷站回 404(B2B 第四版片 6):經銷站不收錄,也不對 AI 爬蟲提供站台說明。
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/site-url', () => ({ resolveSiteUrl: () => 'https://x.test' }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('GET /llms.txt', () => {
  it('經銷模式 ⇒ 404', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    const { GET } = await import('./route');
    expect(GET().status).toBe(404);
  });
  it('一般模式 ⇒ 200(正對照)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    const { GET } = await import('./route');
    expect(GET().status).toBe(200);
  });
});
