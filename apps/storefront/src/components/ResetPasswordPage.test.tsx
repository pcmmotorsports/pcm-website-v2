// @vitest-environment jsdom
//
// ResetPasswordPage smoke test(忘記密碼接線片)— 前台 regression 安全網。
// 驗 design 字面 render 不報錯 + 顯示帳號 email + 逐欄驗證 + 眼睛切換鈕 aria 狀態 + 強度三段格
// 門檻(<8=太短、>=12 且種類>=3=夠強、其餘=可以用)+ 不放社交登入鈕(plan §2-4 決定 1)+
// 送出成功切到狀態 C(完成)+ AuthError → formError 頂部通道。
// mock '@/app/login/reset/actions'(避免載 server action)。
// mock next/navigation:Header useRouter;wrap CartProvider:Header useCart;matchMedia polyfill:Header useEffect。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/login/reset/actions', () => ({
  resetPasswordAction: vi.fn(),
}));

import { ResetPasswordPage } from './ResetPasswordPage';
import { resetPasswordAction } from '@/app/login/reset/actions';
import { CartProvider } from '@/contexts/CartContext';

const mockAction = vi.mocked(resetPasswordAction);

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

function renderPage(email = 'rider@pcm.com') {
  render(<CartProvider><ResetPasswordPage email={email} /></CartProvider>);
}

describe('ResetPasswordPage · 狀態 A(設新密碼)', () => {
  it('renders design 字面 without crashing + 顯示帳號 email', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: '設定新密碼' })).toBeDefined();
    expect(screen.getByText('N°03 · New password')).toBeDefined();
    expect(screen.getByText('rider@pcm.com')).toBeDefined();
  });

  it('🔴 不放社交登入鈕(plan §2-4 決定 1:社群帳號沒有 PCM 密碼可重設)', () => {
    renderPage();
    expect(screen.queryByText('使用 Google 登入', { exact: false })).toBeNull();
    expect(screen.queryByText('使用 LINE 登入', { exact: false })).toBeNull();
  });

  it('空送出 → 逐欄「請填寫密碼」「請再輸入一次密碼」、不呼叫 action', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '設定新密碼' }));
    expect(screen.getByText('請填寫密碼')).toBeDefined();
    expect(screen.getByText('請再輸入一次密碼')).toBeDefined();
    expect(mockAction).not.toHaveBeenCalled();
  });

  it('兩次密碼不一樣 → 逐欄「兩次輸入的密碼不一樣」、不呼叫 action', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
    fireEvent.change(screen.getByPlaceholderText('再打一次上面那組'), { target: { value: 'different1' } });
    fireEvent.click(screen.getByRole('button', { name: '設定新密碼' }));
    expect(screen.getByText('兩次輸入的密碼不一樣')).toBeDefined();
    expect(mockAction).not.toHaveBeenCalled();
  });

  it('🔴 眼睛鈕:預設 type=password / aria-pressed=false,點擊後 type=text / aria-pressed=true、label 切換', () => {
    renderPage();
    const input = screen.getByPlaceholderText('至少 8 碼') as HTMLInputElement;
    const eye = screen.getByLabelText('顯示密碼');
    expect(input.type).toBe('password');
    expect(eye.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(eye);
    expect(input.type).toBe('text');
    expect(screen.getByLabelText('隱藏密碼').getAttribute('aria-pressed')).toBe('true');
  });

  it('🔴 強度格:<8 碼 → 「太短」(level=1)', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'short1' } });
    expect(screen.getByText('太短')).toBeDefined();
  });

  it('🔴 強度格:8-11 碼或種類不足 → 「可以用」(level=2)', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
    expect(screen.getByText('可以用')).toBeDefined();
  });

  it('🔴 強度格:>=12 碼且種類>=3 → 「夠強」(level=3)', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'Hunter2Hunter!' } });
    expect(screen.getByText('夠強')).toBeDefined();
  });

  it('合法輸入 → action 收乾淨密碼(不含 confirm)、成功切到狀態 C', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
    fireEvent.change(screen.getByPlaceholderText('再打一次上面那組'), { target: { value: 'hunter2hunter' } });
    fireEvent.click(screen.getByRole('button', { name: '設定新密碼' }));
    expect(await screen.findByText('密碼改好了')).toBeDefined();
    expect(mockAction).toHaveBeenCalledWith({ password: 'hunter2hunter' });
  });

  it('server 回 formError → 頂部帳號層級通道顯示、不切到狀態 C', async () => {
    mockAction.mockResolvedValue({ formError: '操作太頻繁，請稍後再試' });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
    fireEvent.change(screen.getByPlaceholderText('再打一次上面那組'), { target: { value: 'hunter2hunter' } });
    fireEvent.click(screen.getByRole('button', { name: '設定新密碼' }));
    expect(await screen.findByText('操作太頻繁，請稍後再試')).toBeDefined();
    expect(screen.queryByText('密碼改好了')).toBeNull();
  });
  // ── 錯誤訊息隨輸入清除(2026-08-08 全站掃測 B 級)────────────────────────────
  it('🔴 改上面那欄 → 連「兩次不一樣」也清掉(本頁刻意兩欄一起清)', () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
    fireEvent.change(screen.getByPlaceholderText('再打一次上面那組'), { target: { value: 'different1' } });
    fireEvent.click(screen.getByRole('button', { name: '設定新密碼' }));
    expect(screen.getByText('兩次輸入的密碼不一樣')).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'different1' } });

    // 「不一樣」是**兩欄之間的關係**、不是 confirm 自己的毛病:客人改上面那欄就可能已經修好了。
    // 只清被動那一欄的話,這條已經不成立的紅字會留在畫面上 ⇒ 本頁刻意兩欄一起清。
    expect(screen.queryByText('兩次輸入的密碼不一樣')).toBeNull();
  });
});

describe('ResetPasswordPage · 狀態 C(完成)', () => {
  it('「前往登入」是真的導頁 <a>,連到 /login', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
    fireEvent.change(screen.getByPlaceholderText('再打一次上面那組'), { target: { value: 'hunter2hunter' } });
    fireEvent.click(screen.getByRole('button', { name: '設定新密碼' }));
    const link = await screen.findByText('前往登入');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/login');
  });
});
