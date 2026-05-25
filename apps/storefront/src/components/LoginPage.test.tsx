// @vitest-environment jsdom
//
// LoginPage smoke test(M-1-14e-f1-a)— 前台 regression 安全網。
// 驗 design 字面 render 不報錯 + Google/LINE 社交鈕在場(惰性 type="button")+ 建立帳號連 /register。
// mock '@/app/login/actions':避免載 server action(transitively import server-only / @pcm/adapters/server)。
// mock next/navigation:Header useRouter;wrap CartProvider:Header useCart;matchMedia polyfill:Header useEffect。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke 慣例)。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/login/actions', () => ({
  loginAction: vi.fn(),
}));

import { LoginPage } from './LoginPage';
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

describe('LoginPage', () => {
  it('renders design 字面 without crashing', () => {
    render(<CartProvider><LoginPage /></CartProvider>);
    expect(screen.getByText('歡迎回來')).toBeDefined();
    expect(screen.getByText('登入你的 PCM 帳號，查看訂單與收藏。')).toBeDefined();
    expect(screen.getByText('N°01 · Sign in')).toBeDefined();
    expect(screen.getByRole('button', { name: '登入' })).toBeDefined();
  });

  it('renders Google + LINE 社交鈕(惰性 type=button、wiring 留 f1-c/f2)', () => {
    render(<CartProvider><LoginPage /></CartProvider>);
    const google = screen.getByText('使用 Google 登入').closest('button');
    const line = screen.getByText('使用 LINE 登入').closest('button');
    expect(google?.getAttribute('type')).toBe('button');
    expect(line?.getAttribute('type')).toBe('button');
  });

  it('「建立帳號」連到 /register', () => {
    render(<CartProvider><LoginPage /></CartProvider>);
    const link = screen.getByText('建立帳號').closest('a');
    expect(link?.getAttribute('href')).toBe('/register');
  });
});
