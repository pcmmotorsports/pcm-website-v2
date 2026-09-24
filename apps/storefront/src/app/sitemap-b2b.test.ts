// app/sitemap.ts · 經銷站不產 sitemap(B2B 計畫 §2.3、片 6)。
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchCatalogHandles = vi.fn(async () => ({ entries: [{ handle: 'x', lastModified: null }] }));
vi.mock('@/lib/products', () => ({ fetchCatalogHandles }));
vi.mock('@/lib/site-url', () => ({ resolveSiteUrl: () => 'https://b2b.test' }));

afterEach(() => {
  vi.unstubAllEnvs();
  fetchCatalogHandles.mockClear();
});

describe('sitemap · 經銷站', () => {
  it('經銷模式 ⇒ 回空陣列,也不去撈商品', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    const { default: sitemap } = await import('./sitemap');
    expect(await sitemap()).toEqual([]);
    expect(fetchCatalogHandles).not.toHaveBeenCalled();
  });
  it('一般模式 ⇒ 照常產生(正對照:這把尺是活的)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    const { default: sitemap } = await import('./sitemap');
    expect((await sitemap()).length).toBeGreaterThan(0);
  });
});
