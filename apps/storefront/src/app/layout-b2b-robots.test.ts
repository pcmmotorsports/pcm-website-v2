// app/layout.tsx metadata · 經銷站加 noindex(B2B 計畫 §2.3、片 6)。
// mock 理由同 layout.test.tsx:本檔只讀 metadata。
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: async () => {
    throw new Error('本檔只讀 metadata');
  },
}));
vi.mock('next/font/google', () => {
  const font = () => ({ className: '', variable: '', style: { fontFamily: '' } });
  return { Inter: font, JetBrains_Mono: font, Antonio: font, Cormorant_Garamond: font, Noto_Sans_TC: font };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('RootLayout metadata · robots', () => {
  it('經銷模式 ⇒ index: false, follow: false', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    const { metadata } = await import('./layout');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
  it('一般模式 ⇒ 不設 robots(沿用預設的可收錄)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail');
    const { metadata } = await import('./layout');
    expect(metadata.robots).toBeUndefined();
  });
});
