// @vitest-environment jsdom
//
// AccountView smoke test(g-1a)— 會員中心殼 regression 安全網。
// 驗:design 字面 render 不報錯 + acc-head(avatar 首字 / Hi name / email)+ 7-tab nav 在場
//   + 預設 overview stub + tab 切換純 client setState(點訂單記錄 → orders stub、overview 退場)
//   + 登出 button 在 form 內(server action 觸發)。
// mock '@/app/account/actions'(避免載 server action)+ next/navigation(Header useRouter);
// wrap CartProvider(Header useCart);matchMedia polyfill(Header autoMobile useEffect)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke 慣例)。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/account/actions', () => ({
  logoutAction: vi.fn(),
}));

import { AccountView } from './AccountView';
import { CartProvider } from '@/contexts/CartContext';

beforeAll(() => {
  // Header autoMobile useEffect 用 matchMedia;jsdom 無、補 polyfill。
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(cleanup);

function renderView(user = { name: '王小明', email: 'wang@example.com' }) {
  return render(
    <CartProvider>
      <AccountView user={user} />
    </CartProvider>,
  );
}

describe('AccountView(會員中心殼 g-1a)', () => {
  it('render acc-head:avatar 首字 + Hi name + email', () => {
    renderView();
    expect(screen.getByText('王')).toBeTruthy(); // avatar 首字大寫
    expect(screen.getByText('Hi, 王小明')).toBeTruthy();
    expect(screen.getByText('wang@example.com')).toBeTruthy();
  });

  it('7-tab nav 全在場(對齊 design 字面)', () => {
    renderView();
    for (const label of ['總覽', '訂單記錄', '儲值金', '收藏清單', '我的愛車', '收件地址', '個人資料']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('預設顯示 overview stub', () => {
    const { container } = renderView();
    expect(container.querySelector('.acc-stub[data-tab="overview"]')).toBeTruthy();
    expect(container.querySelector('.acc-stub[data-tab="orders"]')).toBeNull();
  });

  it('點「訂單記錄」→ 切到 orders stub、overview 退場(純 client setState)', () => {
    const { container } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /訂單記錄/ }));
    expect(container.querySelector('.acc-stub[data-tab="orders"]')).toBeTruthy();
    expect(container.querySelector('.acc-stub[data-tab="overview"]')).toBeNull();
  });

  it('登出 button 在 form 內(server action 觸發、非 client signOut)', () => {
    const { container } = renderView();
    const logoutBtn = screen.getByRole('button', { name: '登出' });
    expect(logoutBtn).toBeTruthy();
    expect(logoutBtn.closest('form')).toBeTruthy();
  });

  it('name 空時退化 avatar P + Hi 退化(OAuth 空 metadata)', () => {
    renderView({ name: '', email: '' });
    expect(screen.getByText('P')).toBeTruthy();
    expect(screen.getByText('Hi, PCM 會員')).toBeTruthy();
  });
});
