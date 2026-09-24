// @vitest-environment jsdom
// app/register/page.tsx —— 經銷站不開放註冊,改顯示說明頁(B2B 計畫 F 節 Q2 甲,主視窗 2026-09-25 派工)。
// 新註冊的帳號一定是一般會員,在經銷站註冊完會立刻被登出 ⇒ 不給表單,請他到一般站申請。一般站註冊不變。
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => '/register' }));
vi.mock('@/app/register/actions', () => ({ registerAction: vi.fn() }));

import RegisterRoute from './page';
import { CartProvider } from '@/contexts/CartContext';

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((query: string) =>
      ({ matches: false, media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as MediaQueryList);
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

async function renderRoute() {
  const el = await RegisterRoute({ searchParams: Promise.resolve({}) });
  return render(<CartProvider>{el}</CartProvider>);
}

describe('/register 在經銷站', () => {
  it('🔴 經銷站 ⇒ 說明頁,沒有註冊表單;兩顆按鈕:提出經銷商申請(www)、已有經銷帳號？登入', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    await renderRoute();
    expect(screen.getByRole('heading', { name: '經銷帳號需要先提出申請' })).toBeDefined();
    expect(document.querySelector('form')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByRole('link', { name: '提出經銷商申請' }).getAttribute('href')).toBe('https://www.pcmmotorsports.com/dealer-apply');
    expect(screen.getByRole('link', { name: '已有經銷帳號？登入' }).getAttribute('href')).toBe('/login');
  });

  it('經銷站帶 next ⇒ 登入連結把 next 帶著(#190)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    const el = await RegisterRoute({ searchParams: Promise.resolve({ next: '/checkout' }) });
    render(<CartProvider>{el}</CartProvider>);
    expect(screen.getByRole('link', { name: '已有經銷帳號？登入' }).getAttribute('href')).toBe('/login?next=%2Fcheckout');
  });

  it('經銷站帶惡意 next ⇒ 登入連結用白名單過濾後的值(不開放導向)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'b2b');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const el = await RegisterRoute({ searchParams: Promise.resolve({ next: bad }) });
      const { unmount } = render(<CartProvider>{el}</CartProvider>);
      expect(screen.getByRole('link', { name: '已有經銷帳號？登入' }).getAttribute('href'), bad).toBe('/login?next=%2F');
      unmount();
    }
  });

  it('一般站 ⇒ 照常註冊表單(正對照)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_MODE', 'retail'); // 明設,不依賴執行環境的預設值
    await renderRoute();
    expect(document.querySelector('form')).not.toBeNull();
    expect(screen.queryByRole('heading', { name: '經銷帳號需要先提出申請' })).toBeNull();
  });
});
