// lib/supabase/browser.ts —— 瀏覽器端 client 不自己兌換網址上的登入 code(B2B 計畫第四版 C 節 L2c)。
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createSpy } = vi.hoisted(() => ({ createSpy: vi.fn(() => ({})) }));
vi.mock('@supabase/ssr', () => ({ createBrowserClient: createSpy }));

import { createBrowserSupabaseClient } from './browser';

afterEach(() => vi.unstubAllEnvs());

describe('createBrowserSupabaseClient', () => {
  // 🔴 開著的話,帶 ?code= 的網址會在瀏覽器端直接登入,跳過伺服器的站別檢查(Codex R3 必修 2)。
  it('關掉 detectSessionInUrl', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    createBrowserSupabaseClient();
    expect(createSpy).toHaveBeenCalledWith('https://abc.supabase.co', 'anon', { auth: { detectSessionInUrl: false } });
  });
});
