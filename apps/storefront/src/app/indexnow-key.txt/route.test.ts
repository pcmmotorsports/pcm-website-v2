// IndexNow 金鑰檔(2026-09-29 計畫 ~/pcm-mailbox/計畫-IndexNow-20260929.md, Fable R2 PASS)。
import { afterEach, describe, expect, it, vi } from 'vitest';

const KEY = '0123456789abcdef0123456789abcdef';
const load = async () => (await import('./route')).GET();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('/indexnow-key.txt', () => {
  it('設了 INDEXNOW_KEY ⇒ 200, 內容就是金鑰本身(text/plain、不快取)', async () => {
    vi.stubEnv('INDEXNOW_KEY', KEY);
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', '');
    const r = await load();
    expect(r.status).toBe(200);
    expect(await r.text()).toBe(KEY);
    expect(r.headers.get('content-type')).toContain('text/plain');
    expect(r.headers.get('cache-control')).toContain('no-store');
  });

  it('🔵 沒設 ⇒ 404(不是空白的 200)', async () => {
    vi.stubEnv('INDEXNOW_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', '');
    expect((await load()).status).toBe(404);
  });

  it('🔵 格式不合 IndexNow 規範(8–128 字元、英數與連字號)⇒ 404, 不把壞金鑰公開出去', async () => {
    vi.stubEnv('INDEXNOW_KEY', 'short');
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', '');
    expect((await load()).status).toBe(404);
  });

  it('🔵 經銷站 ⇒ 404(經銷站不收錄)', async () => {
    vi.stubEnv('INDEXNOW_KEY', KEY);
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    expect((await load()).status).toBe(404);
  });
});
