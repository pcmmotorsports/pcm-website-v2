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
  // 🔵 `⟦b4-SIGNUPOPEN1⟧` 前置片新增。**這一行不加的話,元件 import 到的是 undefined**,
  //    而既有 23 格【照樣全過】—— 因為沒有一格會走到重寄那條路。
  //    ⇒ 📌 那正是「mock 少一個 export 而測試不會叫」的形狀。
  resendSignupConfirmationAction: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { signInWithOAuth: signInOAuthSpy },
  }),
}));

import { LoginPage } from './LoginPage';
import { loginAction, resendSignupConfirmationAction } from '@/app/login/actions';
import {
  AUTH_ERR_NEEDS_CONFIRMATION,
  AUTH_RESEND_SENT_NOTICE,
  AUTH_RESEND_FAILED_NOTICE,
} from '@/lib/auth/auth-copy';
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

function renderPage(oauthError?: string, next?: string) {
  render(<CartProvider><LoginPage oauthError={oauthError} next={next} /></CartProvider>);
}

// 🔴 codex 關卡2 N4:helper 原本傳不了 next ⇒ 新增的兩個傳遞【只驗得到 fallback 那一半】。
//    fixture 永遠落在「沒有 next」那一邊 = 兩個公式在那一區相等 ⇒ 守門沒有判別力(同 W11 今天量到的形狀)。
describe('LoginPage · 副標依 next 換句(2026-08-29 Sean 拍「依情況換一句」)', () => {
  // 🔴 三個世界, 而第三個是【刻意不涵蓋】那一格 —— 它釘的是「我不是忘了它」。
  const DEFAULT_SUB = '登入您的 PCM 帳號，查看訂單與收藏。';
  const CHECKOUT_SUB = '結帳前請先登入，購物車會幫您留著。';

  it('①next=/checkout ⇒ 換成結帳那一句(而原句必須不在畫面上)', () => {
    renderPage(undefined, '/checkout');
    expect(screen.getByText(CHECKOUT_SUB)).toBeDefined();
    // 🔴 反面同格:只驗「新句在」的話, 兩句都印出來也會綠。
    expect(screen.queryByText(DEFAULT_SUB)).toBeNull();
  });

  it('②沒有 next ⇒ 維持原句(而結帳那句必須不在畫面上)', () => {
    renderPage();
    expect(screen.getByText(DEFAULT_SUB)).toBeDefined();
    expect(screen.queryByText(CHECKOUT_SUB)).toBeNull();
  });

  it('③🔴 next=/checkout/callback ⇒ 【必須是原句】—— 它是刻意不涵蓋的, 不是漏掉的', () => {
    // 那是【付款完回來】的路(`checkout/callback/page.tsx`), 不是【要去結帳】的路。
    // ⇒ 對一個已經付完錢的人講「購物車會幫您留著」是錯的。
    // 🔴 而這一格會在有人把判斷改成 `startsWith('/checkout')` 時【紅】——
    //    那正是它存在的理由:startsWith 讀起來比較「完整」, 而它是錯的。
    renderPage(undefined, '/checkout/callback?order=00000000-0000-4000-8000-000000000000');
    expect(screen.getByText(DEFAULT_SUB)).toBeDefined();
    expect(screen.queryByText(CHECKOUT_SUB)).toBeNull();
  });

  it('④next 是不安全的值 ⇒ sanitize 後落回 fallback ⇒ 原句', () => {
    // safeNext = sanitizeNextParam(next) ⇒ '//evil.example' 會被擋成 POST_AUTH_REDIRECT('/')
    // 🔴 而這一格順帶釘住:那個值【一個字都不會印到畫面上】。
    renderPage(undefined, '//evil.example/checkout');
    expect(screen.getByText(DEFAULT_SUB)).toBeDefined();
    expect(screen.queryByText(CHECKOUT_SUB)).toBeNull();
    // ⚠️ **這一行是【恆真的】, 而我留著並標明**(2026-08-29 code-reviewer 抓到):
    //    沒有任何路徑會把 `next` render 成【文字】, 而 `queryByText` 看不到屬性
    //    ⇒ 真正的洩漏形狀(值進了 `href`)這一行【量不到】。
    //    ✅ 守 `href` 那一格是既有的那兩發(`getAttribute` + `not.toContain('evil')`), 不是這裡。
    //    🔴 留著它的理由是【讀起來像在守而其實沒有】—— 標出來比刪掉有用。
    expect(screen.queryByText(/evil\.example/)).toBeNull();
  });
});

describe('LoginPage · #190 next 往下游傳遞', () => {
  it('有 next → 建立帳號 / 忘記密碼兩個連結都帶著它(且經過編碼)', () => {
    renderPage(undefined, '/checkout');
    const enc = encodeURIComponent('/checkout');
    expect(screen.getByText('建立帳號').getAttribute('href')).toBe(`/register?next=${enc}`);
    expect(screen.getByText('忘記密碼？').getAttribute('href')).toBe(`/login/forgot?next=${enc}`);
  });

  it('🔴 惡意 next 被 sanitizeNextParam 收斂成 /,不是原樣塞進連結', () => {
    renderPage(undefined, '//evil.example.com');
    const enc = encodeURIComponent('/');
    expect(screen.getByText('建立帳號').getAttribute('href')).toBe(`/register?next=${enc}`);
    expect(screen.getByText('建立帳號').getAttribute('href')).not.toContain('evil');
  });

  it('無 next → 裸連結,不掛空參數', () => {
    renderPage();
    expect(screen.getByText('建立帳號').getAttribute('href')).toBe('/register');
    expect(screen.getByText('忘記密碼？').getAttribute('href')).toBe('/login/forgot');
  });
});

/** 填妥 Email/密碼,使 client 逐欄驗證通過、會呼叫 loginAction。 */
function fillValid() {
  fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'rider@pcm.com' } });
  fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
}

describe('LoginPage', () => {
  it('renders design 字面 without crashing', () => {
    renderPage();
    expect(screen.getByText('歡迎回來')).toBeDefined();
    expect(screen.getByText('登入您的 PCM 帳號，查看訂單與收藏。')).toBeDefined();
    // 🔴 上面那格是【沒有 next】的世界。而副標 2026-08-29 起會依 next 換句
    //    ⇒ 只驗這一個世界的話, 兩個公式在這一區相等 ⇒ 守門沒有判別力。下面補另外兩個世界。
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

// ══════════════════════════════════════════════════════════════════════════
// 重寄驗證信按鈕(`⟦b4-SIGNUPOPEN1⟧` 前置片,2026-09-05)
// ══════════════════════════════════════════════════════════════════════════
describe('LoginPage — 重寄驗證信', () => {
  async function loginWith(formError: string) {
    vi.mocked(loginAction).mockResolvedValue({ formError } as never);
    render(
      <CartProvider>
        <LoginPage />
      </CartProvider>,
    );
    // 🔵 選擇器【照本檔既有那幾格的寫法】(:131-132 用 placeholder)——
    //    我第一版自己發明 getByLabelText + name:/登入/ ⇒ 後者命中多顆(Google/LINE 也含「登入」)
    //    ⇒ 📌 紅的是我的 harness 不是碼。抄既有的形狀,不自己造。
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'pw123456' } });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await screen.findByText(formError);
  }

  it('🔴 錯誤是「請先收信…」⇒ 出現重寄按鈕', async () => {
    await loginWith('請先收信完成 Email 驗證後再登入');
    expect(screen.getByRole('button', { name: '重寄驗證信' })).toBeTruthy();
  });

  // 🛑 這一格是本組最重要的:按鈕若對「密碼錯」也出現, 它就變成
  //    「這個 Email 存在」的訊號 —— 而那正是 server 那半用帳號列舉防護擋掉的東西。
  it('🔵 負對照:錯誤是「Email 或密碼錯誤」⇒ 【不得】出現重寄按鈕', async () => {
    await loginWith('Email 或密碼錯誤');
    expect(screen.queryByRole('button', { name: '重寄驗證信' })).toBeNull();
  });

  it('🔴 按下去 ⇒ 呼叫 action 帶那個 email, 而畫面【逐字】是那句常數', async () => {
    vi.mocked(resendSignupConfirmationAction).mockResolvedValue({} as never);
    await loginWith(AUTH_ERR_NEEDS_CONFIRMATION);
    fireEvent.click(screen.getByRole('button', { name: '重寄驗證信' }));
    // 🔴🔴 **[codex 關卡2 must-fix ⑤]** ⛔ ~~原本用 `/我們已重新寄出驗證信/` 子字串比對~~
    //    ⇒ 把碼突變成「…(成功)」「…(失敗)」兩句不同的話, **這一格仍然全綠**
    //    ⇒ 📌 它守不到「畫面逐字相同」這個宣稱, 而那正是本片要守的東西。
    //    ✅ 改成拿【共用常數】做逐字比對 —— 常數改了兩邊一起改, 而分支會當場紅。
    await screen.findByText(AUTH_RESEND_SENT_NOTICE);
    expect(resendSignupConfirmationAction).toHaveBeenCalledWith({ email: 'a@b.com' });
  });

  it('🔴 provider 那半失敗(action 回 {})⇒ 畫面【逐字】仍是成功那句', async () => {
    // 🛑 這一格守的是帳號列舉防護在 client 這一側:429 / 帳號不存在 action 都回 {},
    //    而畫面必須與成功【逐字相同】—— 在這裡分支的話, server 那道防護會從 client 漏掉。
    vi.mocked(resendSignupConfirmationAction).mockResolvedValue({} as never);
    await loginWith(AUTH_ERR_NEEDS_CONFIRMATION);
    fireEvent.click(screen.getByRole('button', { name: '重寄驗證信' }));
    await screen.findByText(AUTH_RESEND_SENT_NOTICE);
  });

  it('🔴 action 丟例外(系統面)⇒ 畫面是【失敗】那句, 不得謊報已寄出', async () => {
    // 🔴 [codex must-fix ①] 站台設定壞掉時 action 會 throw ——
    //    原版一律報成功 ⇒ 一封都沒寄而畫面說寄了。這一格釘住那個差別。
    vi.mocked(resendSignupConfirmationAction).mockRejectedValue(new Error('boom'));
    await loginWith(AUTH_ERR_NEEDS_CONFIRMATION);
    fireEvent.click(screen.getByRole('button', { name: '重寄驗證信' }));
    await screen.findByText(AUTH_RESEND_FAILED_NOTICE);
    expect(screen.queryByText(AUTH_RESEND_SENT_NOTICE)).toBeNull();
  });

  it('🔴 換帳號 ⇒ 舊的重寄提示要清掉, 按鈕要回來', async () => {
    // 🔴 [codex must-fix ②] A 重寄完 ⇒ 改填 B ⇒ B 看到 A 的成功提示而且沒有按鈕
    //    ⇒ 對一個【沒發生的動作】報成功。
    vi.mocked(resendSignupConfirmationAction).mockResolvedValue({} as never);
    await loginWith(AUTH_ERR_NEEDS_CONFIRMATION);
    fireEvent.click(screen.getByRole('button', { name: '重寄驗證信' }));
    await screen.findByText(AUTH_RESEND_SENT_NOTICE);

    // 🔴🔴 **我第一版這一格是【假綠】的** —— 只改欄位就斷言提示不見了,
    //    而它不見是因為 `clearErr` 清掉 `formError` ⇒ **整個區塊卸載**, 不是因為狀態被清。
    //    ⇒ 實測:把 `clearResend()` 拿掉(codex F2 那個原病)⇒ **這一格照樣全綠。**
    //    ✅ 要走完 codex 描述的那條路:**改帳號 ⇒ 再登入一次 ⇒ B 也未驗證** ——
    //      那時 `formError` 回來、區塊重新掛上, 殘留的舊提示才顯形。
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), {
      target: { value: 'someone-else@b.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: '登入' }));
    await screen.findByText(AUTH_ERR_NEEDS_CONFIRMATION);
    // B 應該看到【按鈕】, 而不是 A 的成功提示
    expect(screen.getByRole('button', { name: '重寄驗證信' })).toBeTruthy();
    expect(screen.queryByText(AUTH_RESEND_SENT_NOTICE)).toBeNull();
  });
});
