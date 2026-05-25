// @vitest-environment jsdom
//
// RegisterPage smoke test(M-1-14e-f1-b)— 前台 regression 安全網。
// 驗 design 字面 render 不報錯 + 無社交鈕(D-e、鐵則 1:design L256-308 確無)+ 手機必填 affordance(D-g=A)
//   + 「登入」連 /login + client presence 檢查(空必填顯示 design 字面)。
// mock '@/app/register/actions':避免載 server action(transitively import server-only / @pcm/adapters/server)。
// mock next/navigation:Header useRouter;wrap CartProvider:Header useCart;matchMedia polyfill:Header useEffect。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke 慣例)。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/register/actions', () => ({
  registerAction: vi.fn(),
}));

import { RegisterPage } from './RegisterPage';
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

afterEach(cleanup);

describe('RegisterPage', () => {
  it('renders design 字面 without crashing', () => {
    render(<CartProvider><RegisterPage /></CartProvider>);
    expect(screen.getByText('加入 PCM')).toBeDefined();
    expect(screen.getByText('建立帳號，享會員價與專屬優惠。')).toBeDefined();
    expect(screen.getByText('N°02 · Sign up')).toBeDefined();
    expect(screen.getByRole('button', { name: '建立帳號' })).toBeDefined();
  });

  it('無社交鈕(D-e、鐵則 1:design L256-308 確無 Google/LINE)', () => {
    render(<CartProvider><RegisterPage /></CartProvider>);
    expect(screen.queryByText('使用 Google 登入')).toBeNull();
    expect(screen.queryByText('使用 LINE 登入')).toBeNull();
  });

  it('手機必填顯式 affordance(D-g=A 鐵則 1 override)', () => {
    render(<CartProvider><RegisterPage /></CartProvider>);
    expect(screen.getByText('手機（必填）')).toBeDefined();
  });

  it('「登入」連到 /login', () => {
    render(<CartProvider><RegisterPage /></CartProvider>);
    const link = screen.getByRole('link', { name: '登入' });
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('client presence:空必填顯示 design 字面「請填寫必要欄位」', () => {
    render(<CartProvider><RegisterPage /></CartProvider>);
    fireEvent.click(screen.getByRole('button', { name: '建立帳號' }));
    expect(screen.getByText('請填寫必要欄位')).toBeDefined();
  });
});
