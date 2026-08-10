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

  // 🔴 2026-08-08(Sean 正式站回報「重新申請密碼功能無法使用」):這顆原本是 <a href="#"> 死連結 ——
  //    /login/forgot 早就做完上線了,只有登入頁這個入口沒接。斷言刻意寫成**兩條**:
  //    ①href 必須正好是 /login/forgot(值錯就紅)②不得退回 `#`(把入口改回死連結那個突變要紅)。
  //    只留 ① 也殺得死 `#`,留 ② 是因為它把「本片存在的理由」寫成可執行的字面(同 ForgotPasswordPage.test 的先例)。
  it('🔴「忘記密碼？」連到 /login/forgot,不是死連結 href="#"', () => {
    renderPage();
    const link = screen.getByText('忘記密碼？').closest('a');
    expect(link, '找不到「忘記密碼？」連結 ⇒ 本條前提失效(字面被改過?)').not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/login/forgot');
    expect(link?.getAttribute('href'), '退回 <a href="#"> 死連結 ⇒ 客人按了原地不動').not.toBe('#');
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
      // #190:LINE start URL 帶 next(無 next prop → safeNext='/' → ?next=%2F)。
      expect(window.location.href).toBe('/api/auth/line/start?next=%2F');
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

  // ── 錯誤訊息隨輸入清除(2026-08-08 全站掃測 B 級)────────────────────────────
  it('改 Email → 清該欄的錯,但**不動密碼那欄的錯**(逐欄清、不是全清)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '登入' })); // 空送出 → 兩欄都紅
    expect(screen.getByText('請填寫 Email')).toBeDefined();
    expect(screen.getByText('請填寫密碼')).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'r' } });

    expect(screen.queryByText('請填寫 Email')).toBeNull();
    // 🔴 這一半才是判別力所在:若改成「動任一欄就 setFieldErrors({})」,下面這條會紅。
    expect(screen.getByText('請填寫密碼')).toBeDefined();
  });

  it('改任一欄 → 頂部帳號層級錯(OAuth 失敗字面)也一起清掉', () => {
    // 🔴 code 是 'oauth' 不是 'google'(`LoginPage.tsx:45-49` 的分流:oauth→Google 字面、
    //    line→LINE 字面、其餘→通用)。第一版我照直覺寫 'google',實跑才發現它落到通用字面。
    renderPage('oauth'); // 初始 formError = Google OAuth 失敗
    expect(screen.getByText('Google 登入失敗，請重試')).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'x' } });
    expect(screen.queryByText('Google 登入失敗，請重試')).toBeNull();
  });

  // 🔴「記住我不接清除」要分兩格,因為兩半的前置**互斥**:
  //    R1 nit 指出第一版只守了 fieldErrors 那一半(用 renderPage() ⇒ formError 恆 null,
  //    突變「remember 加 setFormError(null)」照樣綠)。但它建議的「renderPage('oauth') 再斷言
  //    formError 仍在」一行修法**跑起來是紅的** —— 因為要讓 fieldErrors 有值就得先送出一次,
  //    而 submit 自己在 client 驗證失敗那條路就 `setFormError(null)` 了(LoginPage.tsx submit 內)。
  //    ⇒ 想同時看到「fieldErrors 有值」與「formError 有值」在本元件**構造不出來**;拆成兩格。
  it('「記住我」不清 fieldErrors —— 它不是驗證欄,勾了不代表在修正帳密', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    fireEvent.click(screen.getByRole('checkbox'));
    // 判準是「這欄有沒有自己的錯」,不是「它是不是 checkbox」——
    // 對照組 = RegisterPage 的同意條款 checkbox 有 fieldErrors.agree ⇒ 那邊要接。
    expect(screen.getByText('請填寫 Email')).toBeDefined();
    expect(screen.getByText('請填寫密碼')).toBeDefined();
  });

  it('「記住我」也不清頂部 formError(不先送出,才看得到這一半)', () => {
    renderPage('oauth');
    expect(screen.getByText('Google 登入失敗，請重試')).toBeDefined();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByText('Google 登入失敗，請重試')).toBeDefined();
  });
});
