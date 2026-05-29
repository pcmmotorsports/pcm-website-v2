// @vitest-environment jsdom
//
// AccountView smoke test(g-1a 建、g-2 擴):會員中心殼 regression 安全網 + g-2 新增
// stats / featured prop forward + LINE 合成 email 過濾(server-side 完成、本檔驗收 client 渲染)。
//
// 驗:
// - design 字面 render 不報錯
// - acc-head:avatar 首字 / Hi name / displayEmail(空時 acc-email 不 render)
// - 7-tab nav 在場
// - 預設 overview render(g-1a stub 退場、g-2 真 OverviewTab + 三 stats / 訂單空 / 推薦空)
// - tab 切換純 client setState
// - 登出 button 在 form 內
// - g-2:LINE 合成 email 用戶(displayEmail = '')→ acc-email 整段不顯、displayName/avatar 不洩 raw
//
// mock '@/app/account/actions'(server action)+ next/navigation(useRouter)+ matchMedia polyfill。

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/app/account/actions', () => ({
  logoutAction: vi.fn(),
}));
// g-4b:ProfileTab(AccountView 子元件)改 import updateProfileAction server action、
// transitively 拉 server-only(supabase/server)在 jsdom 會爆;mock 掉避免載真 server action
// (同 RegisterPage.test 處置;AccountView 預設 render overview、profile tab 不觸發、mock 不影響斷言)。
vi.mock('@/app/account/profile/actions', () => ({
  updateProfileAction: vi.fn(),
}));

import { AccountView, type AccountViewProps } from './AccountView';
import { CartProvider } from '@/contexts/CartContext';
import type { FeaturedResult } from '@/lib/products';

beforeAll(() => {
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

const EMPTY_FEATURED: FeaturedResult = { products: [], error: false };

function renderView(overrides: Partial<AccountViewProps> = {}) {
  const props: AccountViewProps = {
    user: { name: '王小明', displayEmail: 'wang@example.com' },
    stats: { tier: 'general', walletBalance: 0, orderCount: 0 },
    featured: EMPTY_FEATURED,
    // g-4a:profile prop 必填、預設與 user.name 同值(對齊 page.tsx Q4=A SoT、customers.name 為主)
    profile: { name: '王小明', phone: '', birthday: '' },
    // g-5a:addresses prop 必填、預設空陣列(AddressTab 唯讀列表;切到 address tab 才渲染)
    addresses: [],
    ...overrides,
  };
  return render(
    <CartProvider>
      <AccountView {...props} />
    </CartProvider>,
  );
}

describe('AccountView(會員中心殼 g-1a + g-2 真資料)', () => {
  it('render acc-head:avatar 首字 + Hi name + displayEmail', () => {
    renderView();
    expect(screen.getByText('王')).toBeTruthy();
    expect(screen.getByText('Hi, 王小明')).toBeTruthy();
    expect(screen.getByText('wang@example.com')).toBeTruthy();
  });

  it('7-tab nav 全在場(對齊 design 字面)', () => {
    renderView();
    for (const label of ['總覽', '訂單記錄', '儲值金', '收藏清單', '我的愛車', '收件地址', '個人資料']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeTruthy();
    }
  });

  it('預設顯示 overview(g-2 真 OverviewTab 退場 g-1a stub、見 acc-stats Member tier)', () => {
    const { container } = renderView();
    // g-2:overview 渲染 acc-stats 三卡(Member tier / Stored value / Total orders)
    expect(container.querySelector('[data-tab="overview"]')).toBeTruthy();
    expect(container.querySelector('.acc-stats')).toBeTruthy();
    expect(screen.getByText('Member tier')).toBeTruthy();
    // 確認 g-1a stub 字面退場
    expect(container.querySelector('.acc-stub[data-tab="overview"]')).toBeNull();
  });

  it('點「訂單記錄」→ 切到 orders tab、overview 退場(純 client setState)', () => {
    const { container } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /訂單記錄/ }));
    expect(container.querySelector('[data-tab="orders"]')).toBeTruthy();
    expect(container.querySelector('[data-tab="overview"]')).toBeNull();
    expect(screen.getByText('目前尚無訂單紀錄')).toBeTruthy();
  });

  it('登出 button 在 form 內(server action 觸發、非 client signOut)', () => {
    renderView();
    const logoutBtn = screen.getByRole('button', { name: '登出' });
    expect(logoutBtn).toBeTruthy();
    expect(logoutBtn.closest('form')).toBeTruthy();
  });

  it('profile.name 空時退化:avatar 走 displayEmail 首字、Hi 顯 email、acc-email 仍 render(g-4a Q4=A:displayName 用 profile.name 為主)', () => {
    renderView({
      user: { name: '', displayEmail: 'wang@example.com' },
      profile: { name: '', phone: '', birthday: '' },
    });
    expect(screen.getByText('W')).toBeTruthy();
    expect(screen.getByText('Hi, wang@example.com')).toBeTruthy();
    expect(screen.getByText('wang@example.com')).toBeTruthy();
  });

  it('profile.name + displayEmail 皆空 → avatar=P / Hi=PCM 會員 / acc-email 不 render', () => {
    const { container } = renderView({
      user: { name: '', displayEmail: '' },
      profile: { name: '', phone: '', birthday: '' },
    });
    expect(screen.getByText('P')).toBeTruthy();
    expect(screen.getByText('Hi, PCM 會員')).toBeTruthy();
    expect(container.querySelector('.acc-email')).toBeNull();
  });

  it('LINE 合成 email 用戶(displayEmail=空、profile.name 有):displayName 用 profile.name、acc-email 不顯', () => {
    // 真實情境:LINE 用戶 page.tsx 過濾後 displayEmail=''、profile.name = customers.name(trigger 已從
    // user_metadata.name 同步寫入 LINE 顯示名;g-4a Q4=A SoT)
    const { container } = renderView({
      user: { name: 'LINE 太郎', displayEmail: '' },
      profile: { name: 'LINE 太郎', phone: '', birthday: '' },
    });
    expect(screen.getByText('L')).toBeTruthy();
    expect(screen.getByText('Hi, LINE 太郎')).toBeTruthy();
    expect(container.querySelector('.acc-email')).toBeNull();
    // 確認 raw LINE 合成 email 不出現在任何地方(防 codex round2 M-r2-2:name 空時 raw email 洩)
    expect(container.textContent).not.toContain('line.pcmmotorsports.local');
  });

  it('stats forward to OverviewTab:tier=premiumStore 顯 PREMIUM STORE badge + 餘額', () => {
    renderView({ stats: { tier: 'premiumStore', walletBalance: 12500, orderCount: 0 } });
    expect(screen.getByText('PREMIUM STORE')).toBeTruthy();
    expect(screen.getByText('NT$ 12,500')).toBeTruthy();
  });

  it('featured forward to OverviewTab:0 商品 → 推薦空狀態「即將上架」', () => {
    renderView({ featured: { products: [], error: false } });
    expect(screen.getByText('推薦商品即將上架')).toBeTruthy();
  });

  it('featured error → 推薦載入失敗字面', () => {
    renderView({ featured: { products: [], error: true } });
    expect(screen.getByText('推薦商品載入失敗、請稍後再試')).toBeTruthy();
  });
});
