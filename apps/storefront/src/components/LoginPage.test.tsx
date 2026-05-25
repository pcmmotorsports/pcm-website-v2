// @vitest-environment jsdom
//
// LoginPage smoke test(M-1-14e-f1-a/f1-c、#181 表單 UX 強化)— 前台 regression 安全網。
// 驗 design 字面 render 不報錯 + Google/LINE 社交鈕在場 + Google onClick signInWithOAuth(f1-c)
//   + oauthError 顯示(頂部 formError 通道)+ 建立帳號連 /register
//   + Email/密碼 必填 label 全形「（必填）」(#181 Q1=B)+ client 逐欄 inline error(Q2=B)
//   + server 雙通道(fieldErrors / formError 互不取代、釘死 2)。
// mock '@/app/login/actions'(避免載 server action)+ '@/lib/supabase/browser'(Google OAuth 發起、避免真連 Supabase)。
// mock next/navigation:Header useRouter;wrap CartProvider:Header useCart;matchMedia polyfill:Header useEffect。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke 慣例)。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { signInOAuthSpy } = vi.hoisted(() => ({ signInOAuthSpy: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/login/actions', () => ({
  loginAction: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signInWithOAuth: signInOAuthSpy },
  }),
}));

import { LoginPage } from './LoginPage';
import { loginAction } from '@/app/login/actions';
import { CartProvider } from '@/contexts/CartContext';

const mockLogin = vi.mocked(loginAction);

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
  mockLogin.mockReset();
  signInOAuthSpy.mockReset();
});
afterEach(cleanup);

function renderPage(oauthError?: string) {
  render(<CartProvider><LoginPage oauthError={oauthError} /></CartProvider>);
}

/** 填妥 Email/密碼,使 client 逐欄驗證通過、會呼叫 loginAction。 */
function fillValid() {
  fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'rider@pcm.com' } });
  fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
}

describe('LoginPage', () => {
  it('renders design 字面 without crashing', () => {
    renderPage();
    expect(screen.getByText('歡迎回來')).toBeDefined();
    expect(screen.getByText('登入你的 PCM 帳號，查看訂單與收藏。')).toBeDefined();
    expect(screen.getByText('N°01 · Sign in')).toBeDefined();
    expect(screen.getByRole('button', { name: '登入' })).toBeDefined();
  });

  it('renders Google + LINE 社交鈕(type=button、皆已接線)', () => {
    renderPage();
    const google = screen.getByText('使用 Google 登入').closest('button');
    const line = screen.getByText('使用 LINE 登入').closest('button');
    expect(google?.getAttribute('type')).toBe('button');
    expect(line?.getAttribute('type')).toBe('button');
  });

  it('Email/密碼 必填 label 全形「（必填）」(#181 Q1=B)', () => {
    renderPage();
    expect(screen.getByText('Email（必填）')).toBeDefined();
    expect(screen.getByText('密碼（必填）')).toBeDefined();
  });

  it('「建立帳號」連到 /register', () => {
    renderPage();
    const link = screen.getByText('建立帳號').closest('a');
    expect(link?.getAttribute('href')).toBe('/register');
  });

  it('oauthError prop(/auth/callback 失敗導回)→ 頂部顯示「Google 登入失敗，請重試」(f1-c、formError 通道)', () => {
    renderPage('oauth');
    expect(screen.getByText('Google 登入失敗，請重試')).toBeDefined();
  });

  it('點 Google 鈕 → signInWithOAuth(provider=google、redirectTo /auth/callback)(f1-c)', () => {
    signInOAuthSpy.mockResolvedValue({ error: null });
    renderPage();
    fireEvent.click(screen.getByText('使用 Google 登入').closest('button')!);
    expect(signInOAuthSpy).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: expect.stringContaining('/auth/callback') },
    });
  });

  it('點 LINE 鈕 → 導向 /api/auth/line/start(f2-b、純導航)', () => {
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '', pathname: '/login', origin: 'http://localhost:3000', assign: vi.fn() },
    });
    try {
      renderPage();
      fireEvent.click(screen.getByText('使用 LINE 登入').closest('button')!);
      expect(window.location.href).toBe('/api/auth/line/start');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: original });
    }
  });

  it('oauthError=line → 頂部顯示「LINE 登入失敗，請重試」(f2-b、依 error code 分流)', () => {
    renderPage('line');
    expect(screen.getByText('LINE 登入失敗，請重試')).toBeDefined();
  });

  it('client 空送出 → 逐欄專屬「請填寫…」、不呼叫 loginAction(Q2=B)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(screen.getByText('請填寫 Email')).toBeDefined();
    expect(screen.getByText('請填寫密碼')).toBeDefined();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('server 回 formError(Email 或密碼錯誤)→ 頂部帳號層級通道(釘死 2、不被逐欄取代)', async () => {
    mockLogin.mockResolvedValue({ formError: 'Email 或密碼錯誤' });
    renderPage();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(await screen.findByText('Email 或密碼錯誤')).toBeDefined();
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it('server 回 fieldErrors → 對應欄逐欄顯示(Q2=B server 也逐欄)', async () => {
    mockLogin.mockResolvedValue({ fieldErrors: { email: 'Email 格式不正確' } });
    renderPage();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    expect(await screen.findByText('Email 格式不正確')).toBeDefined();
  });
});
