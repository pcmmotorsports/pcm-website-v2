// @vitest-environment jsdom
//
// ForgotPasswordPage smoke test(忘記密碼接線片)— 前台 regression 安全網。
// 驗 design 字面 render 不報錯 + 逐欄驗證(空/合法)+ 送出後切到已寄出狀態 + 60 秒冷卻倒數
// (disabled + 剩餘秒數文字 + 歸零回復原字面)+「換一個 Email」是 <button> 不是 <a>(見 plan §2-3、
// LoginPage.tsx:144 死連結修復同一個坑)。
// mock '@/app/login/forgot/actions'(避免載 server action)。
// mock next/navigation:Header useRouter;wrap CartProvider:Header useCart;matchMedia polyfill:Header useEffect。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/login/forgot/actions', () => ({
  requestPasswordResetAction: vi.fn(),
}));

import { ForgotPasswordPage } from './ForgotPasswordPage';
import { requestPasswordResetAction } from '@/app/login/forgot/actions';
import { CartProvider } from '@/contexts/CartContext';

const mockAction = vi.mocked(requestPasswordResetAction);

// 對齊元件內部同名常數(未 export,測試端獨立宣告一份 — 兩處字面若不同步,倒數測試會自己紅)。
const RESEND_COOLDOWN_SECONDS = 60;

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
  mockAction.mockReset();
  mockAction.mockResolvedValue({});
});
afterEach(cleanup);

function renderPage() {
  render(<CartProvider><ForgotPasswordPage /></CartProvider>);
}

describe('ForgotPasswordPage · 狀態 A(填 Email)', () => {
  it('renders design 字面 without crashing', () => {
    renderPage();
    expect(screen.getByText('忘記密碼')).toBeDefined();
    expect(screen.getByText('N°01 · Reset password')).toBeDefined();
    expect(screen.getByRole('button', { name: '寄出重設連結' })).toBeDefined();
  });

  it('「回登入」連到 /login', () => {
    renderPage();
    expect(screen.getByText('回登入').closest('a')?.getAttribute('href')).toBe('/login');
  });

  it('空送出 → 逐欄「請填寫 Email」、不呼叫 action', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '寄出重設連結' }));
    expect(screen.getByText('請填寫 Email')).toBeDefined();
    expect(mockAction).not.toHaveBeenCalled();
  });

  it('格式錯 → 逐欄「Email 格式不正確」、不呼叫 action', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: '寄出重設連結' }));
    expect(screen.getByText('Email 格式不正確')).toBeDefined();
    expect(mockAction).not.toHaveBeenCalled();
  });
});

describe('ForgotPasswordPage · 送出成功 → 狀態 B(已寄出)', () => {
  async function submitValid() {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'rider@pcm.com' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '寄出重設連結' }));
    });
  }

  it('呼叫 action(email)、切到已寄出狀態、顯示該 email(「如果」句照留)', async () => {
    await submitValid();
    expect(mockAction).toHaveBeenCalledWith({ email: 'rider@pcm.com' });
    expect(screen.getByText('信寄出去了')).toBeDefined();
    expect(screen.getByText('如果', { exact: false })).toBeDefined();
    expect(screen.getByText('rider@pcm.com')).toBeDefined();
  });

  it('🔴 剛送出 → 「再寄一次」鈕 disabled 且顯示 60 秒倒數文字', async () => {
    await submitValid();
    const btn = screen.getByRole('button', { name: /再寄一次/ });
    expect(btn.hasAttribute('disabled')).toBe(true);
    expect(btn.textContent).toContain('60 秒');
  });

  // 倒數是遞迴 setTimeout(每次到期才排下一顆),一次性 advanceTimersByTimeAsync(60000) 在
  // React 的排程下只會吃到第一顆;改成逐秒推進、每推一次都讓 effect 有機會排下一顆 setTimeout。
  async function advanceSeconds(n: number) {
    for (let i = 0; i < n; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
  }

  it('🔴 倒數歸零 → 鈕重新可按、文字回復原字面(不含秒數)', async () => {
    vi.useFakeTimers();
    try {
      await submitValid();
      await advanceSeconds(RESEND_COOLDOWN_SECONDS);
      const btn = screen.getByRole('button', { name: '沒收到？再寄一次' });
      expect(btn.hasAttribute('disabled')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('點「再寄一次」(冷卻期間內不可點)不會多呼叫 action', async () => {
    await submitValid();
    fireEvent.click(screen.getByRole('button', { name: /再寄一次/ }));
    expect(mockAction).toHaveBeenCalledTimes(1);
  });

  it('冷卻結束後點「再寄一次」→ 再呼叫一次 action、顯示已再寄提示', async () => {
    vi.useFakeTimers();
    try {
      await submitValid();
      await advanceSeconds(RESEND_COOLDOWN_SECONDS);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '沒收到？再寄一次' }));
      });
      expect(mockAction).toHaveBeenCalledTimes(2);
      expect(screen.getByText('已經再寄一次了。', { exact: false })).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('🔴「換一個 Email」是 <button>,不是 <a href="#">(本片存在的理由就是修一個 <a href="#">)', async () => {
    await submitValid();
    const el = screen.getByText('換一個 Email');
    expect(el.tagName).toBe('BUTTON');
    expect(el.closest('a')).toBeNull();
  });

  it('點「換一個 Email」→ 回狀態 A、清空欄位', async () => {
    await submitValid();
    fireEvent.click(screen.getByText('換一個 Email'));
    expect(screen.getByText('忘記密碼')).toBeDefined();
    expect((screen.getByPlaceholderText('your@email.com') as HTMLInputElement).value).toBe('');
  });
});

// ── 對抗審查 R1 nit:server action throw 時的頂部錯誤通道 ──────────────────
// 🔴 `requestPasswordResetAction` 會在「站台設定錯誤」時**故意 throw**(forgot/actions.ts 規格明訂:
//    不可偽裝成信已寄出)。第一版沒接住 ⇒ `setPending(false)` 不執行、鈕永久卡 disabled、畫面停在轉圈。
//    這兩條釘住:①鈕要解鎖 ②要看得到頂部錯誤(稿本來就有 `.auth-err`,是第一版漏搬的通道)。
describe('ForgotPasswordPage · action throw(站台設定錯誤)', () => {
  it('🔴 送出時 action throw ⇒ 顯示頂部錯誤、且鈕解鎖(不得永久卡 disabled)', async () => {
    mockAction.mockRejectedValueOnce(new Error('NEXT_PUBLIC_SITE_URL 未設定'));
    renderPage();
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: 'a@b.co' } });
    await act(async () => {
      fireEvent.submit(screen.getByText('寄出重設連結').closest('form') as HTMLFormElement);
    });
    expect(screen.getByRole('alert').textContent).toContain('系統暫時無法寄出重設信');
    const btn = screen.getByText('寄出重設連結') as HTMLButtonElement;
    expect(btn.disabled, '鈕必須解鎖,否則客人卡在轉圈').toBe(false);
    // 🔴 反向:不得因為 throw 就跑到「信寄出去了」——那正是規格要避免的「畫面說謊」。
    expect(screen.queryByText('信寄出去了')).toBeNull();
  });

  it('🔴 「再寄一次」throw ⇒ 同樣顯示頂部錯誤、鈕解鎖,且不得謊稱已再寄一次', async () => {
    vi.useFakeTimers();
    try {
      renderPage();
      fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'a@b.co' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '寄出重設連結' }));
      });
      // 🔴 倒數是遞迴 setTimeout(見本檔 :105-106 既有註解):一次性 advanceTimersByTime(60000)
      //    只吃到第一顆、倒數停在 59 秒。必須逐秒推進,否則下面找不到不含秒數的鈕名。
      //    ⚠️ 別為了讓它過而把鈕名放寬成 /再寄一次/ —— 那會掩蓋「倒數根本沒走完」。
      for (let i = 0; i < RESEND_COOLDOWN_SECONDS; i++) {
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      }

      mockAction.mockRejectedValueOnce(new Error('NEXT_PUBLIC_SITE_URL 未設定'));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '沒收到？再寄一次' })); });

      expect(screen.getByRole('alert').textContent).toContain('系統暫時無法寄出重設信');
      expect(screen.getByRole('button', { name: '沒收到？再寄一次' }).hasAttribute('disabled')).toBe(false);
      // 🔴 這條最重要:寄失敗卻顯示「已經再寄一次了」= 對客人說謊,正是本片一路在防的那件事。
      expect(screen.queryByText('已經再寄一次了。', { exact: false })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
