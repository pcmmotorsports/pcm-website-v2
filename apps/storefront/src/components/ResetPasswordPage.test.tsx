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
// 🔴 **真的**那支(沒有被 mock)—— server action 開頭跑的就是它。
//    用它直接檢查 client 送出的 payload,補上「mock 證不了 server 收不收得下」那個缺口。
import { validateResetPassword } from '@/lib/auth/field-validation';
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

  // 🔴🔴 2026-08-11 正式站客面壞(Sean 親測):`/login/reset` 送出**永遠**回「請再輸入一次密碼」。
  //    根因 = client 只送 `{ password }`,而 `resetPasswordAction` 開頭跑
  //    `validateResetPassword(input)`(`app/login/reset/actions.ts`),那支對空 `confirm` 直接開
  //    「請再輸入一次密碼」(`lib/auth/field-validation.ts:199-200`)⇒ happy path 100% 不可達。
  //
  //    ⚠️⚠️ **這一格原本把 bug 當規格釘住了** —— 舊名字逐字是「action 收乾淨密碼(**不含 confirm**)」、
  //    斷言 `toHaveBeenCalledWith({ password: 'hunter2hunter' })`。它一路全綠,因為 action 被 mock 掉、
  //    真正的 `validateResetPassword` 從來沒在測試裡跑過 ⇒ **測試只驗了 client 送什麼,
  //    沒有驗 server 收得下**。這不是「漏了一格測試」,是「有一格測試在保護這個 bug」。
  //    ⇒ 本格改成釘住相反的事實,並在下面加一格直接對真驗證餵同一份 payload。
  it('🔴 合法輸入 → action 收到的 payload **必含 confirm**、成功切到狀態 C', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
    fireEvent.change(screen.getByPlaceholderText('再打一次上面那組'), { target: { value: 'hunter2hunter' } });
    fireEvent.click(screen.getByRole('button', { name: '設定新密碼' }));
    expect(await screen.findByText('密碼改好了')).toBeDefined();
    expect(mockAction).toHaveBeenCalledWith({ password: 'hunter2hunter', confirm: 'hunter2hunter' });
  });

  // 🔴 上面那格用的是 mock,證不了「server 那支驗證真的收得下」——正是舊寫法全綠的原因。
  //    這一格把**真的** `validateResetPassword` 拉進來,餵 client 實際送出的那份 payload。
  //    突變:把 `ResetPasswordPage.tsx` 的 `confirm` 拿掉 ⇒ 兩格一起紅(一格驗形狀、一格驗收得下)。
  it('🔴 client 實際送出的那份 payload 餵給真的 validateResetPassword → 必須 ok(不是 mock 說了算)', async () => {
    renderPage();
    fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
    fireEvent.change(screen.getByPlaceholderText('再打一次上面那組'), { target: { value: 'hunter2hunter' } });
    fireEvent.click(screen.getByRole('button', { name: '設定新密碼' }));
    await screen.findByText('密碼改好了');

    const sent = mockAction.mock.calls[0]![0];
    const v = validateResetPassword(sent);
    expect(v.fieldErrors).toEqual({});
    expect(v.ok, 'server 端第一道就會擋下 client 送的 payload ⇒ 密碼永遠改不成').toBe(true);
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
