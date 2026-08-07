// @vitest-environment jsdom
//
// page.test.tsx — /login/reset server component 測試(忘記密碼接線片、🔴 安全重點 plan §3-3)。
//
// 驗:①無 recovery session(getUser 回 user=null)→ 渲染狀態 B(連結失效)、且**不渲染密碼輸入框**
//     (稿逐字「不能讓人填完兩次新密碼才說過期」——渲染前就要擋掉,不是 client 端事後才判)
//    ②有 session → 渲染 ResetPasswordPage、顯示帳號 email
// server component 是普通 async 函式、直接呼叫拿到已 resolve 的 element 再丟進 RTL render
// (子元件含 Header/HomeFooter 用到 client hooks,故走 jsdom + CartProvider,同 LoginPage.test.tsx 慣例)。
// mock '@/lib/supabase/server'(避免載 server-only)+ next/navigation useRouter(Header 用)。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { getUserSpy } = vi.hoisted(() => ({ getUserSpy: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: () => Promise.resolve({ auth: { getUser: getUserSpy } }),
}));
// ResetPasswordPage(有 user 分支渲染)內部 import 本檔 actions.ts → composition.ts(server-only);
// mock 掉避免整條 chain 在 jsdom 載入(同 LoginPage.test.tsx mock '@/app/login/actions' 的慣例)。
vi.mock('@/app/login/reset/actions', () => ({
  resetPasswordAction: vi.fn(),
}));

import ResetPasswordRoute from './page';
import { CartProvider } from '@/contexts/CartContext';

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  } as MediaQueryList));
});

beforeEach(() => {
  getUserSpy.mockReset();
});
afterEach(cleanup);

describe('/login/reset server component(plan §3-3 渲染前驗 session)', () => {
  it('🔴 無 user → 渲染狀態 B(連結失效)、且不渲染密碼輸入框', async () => {
    getUserSpy.mockResolvedValue({ data: { user: null } });
    const el = await ResetPasswordRoute();
    render(<CartProvider>{el}</CartProvider>);
    expect(screen.getByText('這個連結不能用了')).toBeDefined();
    expect(screen.queryByPlaceholderText('至少 8 碼')).toBeNull();
    expect(screen.getByText('重新要一封信').closest('a')?.getAttribute('href')).toBe('/login/forgot');
  });

  it('有 user → 渲染 ResetPasswordPage、顯示帳號 email', async () => {
    getUserSpy.mockResolvedValue({ data: { user: { email: 'rider@pcm.com' } } });
    const el = await ResetPasswordRoute();
    render(<CartProvider>{el}</CartProvider>);
    expect(screen.getByRole('heading', { name: '設定新密碼' })).toBeDefined();
    expect(screen.getByText('rider@pcm.com')).toBeDefined();
    expect(screen.getByPlaceholderText('至少 8 碼')).toBeDefined();
  });

  it('有 user 但 email 為 null → fallback 空字串、不 crash', async () => {
    getUserSpy.mockResolvedValue({ data: { user: { email: null } } });
    const el = await ResetPasswordRoute();
    expect(() => render(<CartProvider>{el}</CartProvider>)).not.toThrow();
  });
});
