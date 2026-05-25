// @vitest-environment jsdom
//
// RegisterPage smoke test(M-1-14e-f1-b、#181 表單 UX 強化)— 前台 regression 安全網。
// 驗 design 字面 render 不報錯 + 無社交鈕(D-e、鐵則 1:design L256-308 確無)
//   + 四欄必填 label 全形「（必填）」統一(#181 Q1=B)+「登入」連 /login
//   + client 逐欄 inline error(空欄專屬「請填寫…」、Q2=B)+ server 雙通道(fieldErrors / formError 互不取代、釘死 2)。
// mock '@/app/register/actions':避免載 server action(transitively import server-only / @pcm/adapters/server)。
// mock next/navigation:Header useRouter;wrap CartProvider:Header useCart;matchMedia polyfill:Header useEffect。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke 慣例)。

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/register/actions', () => ({
  registerAction: vi.fn(),
}));

import { RegisterPage } from './RegisterPage';
import { registerAction } from '@/app/register/actions';
import { CartProvider } from '@/contexts/CartContext';

const mockRegister = vi.mocked(registerAction);

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

beforeEach(() => mockRegister.mockReset());
afterEach(cleanup);

function renderPage() {
  render(<CartProvider><RegisterPage /></CartProvider>);
}

/** 填妥所有必填欄 + 勾同意,使 client 逐欄驗證通過、會呼叫 registerAction。 */
function fillValid() {
  fireEvent.change(screen.getByPlaceholderText('王小明'), { target: { value: '王小明' } });
  fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'rider@pcm.com' } });
  fireEvent.change(screen.getByPlaceholderText('0912 345 678'), { target: { value: '0912345678' } });
  fireEvent.change(screen.getByPlaceholderText('至少 8 碼'), { target: { value: 'hunter2hunter' } });
  fireEvent.click(screen.getByRole('checkbox'));
}

describe('RegisterPage', () => {
  it('renders design 字面 without crashing', () => {
    renderPage();
    expect(screen.getByText('加入 PCM')).toBeDefined();
    expect(screen.getByText('建立帳號，享會員價與專屬優惠。')).toBeDefined();
    expect(screen.getByText('N°02 · Sign up')).toBeDefined();
    expect(screen.getByRole('button', { name: '建立帳號' })).toBeDefined();
  });

  it('無社交鈕(D-e、鐵則 1:design L256-308 確無 Google/LINE)', () => {
    renderPage();
    expect(screen.queryByText('使用 Google 登入')).toBeNull();
    expect(screen.queryByText('使用 LINE 登入')).toBeNull();
  });

  it('四欄必填 label 全形「（必填）」統一(#181 Q1=B)', () => {
    renderPage();
    expect(screen.getByText('姓名（必填）')).toBeDefined();
    expect(screen.getByText('Email（必填）')).toBeDefined();
    expect(screen.getByText('手機（必填）')).toBeDefined();
    expect(screen.getByText('密碼（必填）')).toBeDefined();
  });

  it('「登入」連到 /login', () => {
    renderPage();
    const link = screen.getByRole('link', { name: '登入' });
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('client 空送出 → 逐欄專屬「請填寫…」+「請同意服務條款」、不呼叫 registerAction(Q2=B)', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(screen.getByText('請填寫姓名')).toBeDefined();
    expect(screen.getByText('請填寫 Email')).toBeDefined();
    expect(screen.getByText('請填寫手機')).toBeDefined();
    expect(screen.getByText('請填寫密碼')).toBeDefined();
    expect(screen.getByText('請同意服務條款')).toBeDefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('server 回 formError(此 Email 已註冊)→ 頂部帳號層級通道(釘死 2、不被逐欄取代)', async () => {
    mockRegister.mockResolvedValue({ formError: '此 Email 已註冊' });
    renderPage();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(await screen.findByText('此 Email 已註冊')).toBeDefined();
    expect(mockRegister).toHaveBeenCalledTimes(1);
  });

  it('server 回 fieldErrors → 對應欄逐欄顯示(Q2=B server 也逐欄)', async () => {
    mockRegister.mockResolvedValue({ fieldErrors: { email: 'Email 格式不正確' } });
    renderPage();
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(await screen.findByText('Email 格式不正確')).toBeDefined();
  });
});
