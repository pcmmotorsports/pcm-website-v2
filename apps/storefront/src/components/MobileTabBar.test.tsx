// @vitest-environment jsdom
//
// MobileTabBar smoke test — #192 前台 regression 安全網。
// 驗「render 5 tab 不報錯」+「pathname-based active / hidden 行為」+「5 tab 全是真連結」。
// (2026-08-03:原「disabled tab 用 <span>」一條隨找車解除停用改寫;disabled 分支已從元件移除。)
// usePathname 走 per-test vi.mock(每 case 重寫 hoisted pathname)。
// 非 coverage 達標(見 docs/architecture/testing-strategy.md §1 前台 smoke test 慣例)。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const { pathnameRef } = vi.hoisted(() => ({
  pathnameRef: { current: '/' },
}));
vi.mock('next/navigation', () => ({
  usePathname: () => pathnameRef.current,
}));

import { MobileTabBar } from './MobileTabBar';

afterEach(() => {
  cleanup();
  pathnameRef.current = '/';
});

function renderAt(pathname: string) {
  pathnameRef.current = pathname;
  return render(<MobileTabBar />);
}

describe('MobileTabBar', () => {
  it('5 tab 全 render 不報錯', () => {
    renderAt('/');
    expect(screen.getByText('首頁')).toBeTruthy();
    expect(screen.getByText('商品')).toBeTruthy();
    expect(screen.getByText('找車')).toBeTruthy();
    expect(screen.getByText('會員')).toBeTruthy();
    expect(screen.getByText('購物車')).toBeTruthy();
  });

  it('/ → 首頁 tab is-active', () => {
    const { container } = renderAt('/');
    const homeTab = container.querySelector('a[href="/"]');
    expect(homeTab?.className).toContain('is-active');
  });

  it('/products → 商品 tab is-active(catalog tab 走 startsWith)', () => {
    const { container } = renderAt('/products');
    const catalogTab = container.querySelector('a[href="/products"]');
    expect(catalogTab?.className).toContain('is-active');
  });

  it('/products/lightech-1 → tabbar 隱藏(.is-hidden)', () => {
    const { container } = renderAt('/products/lightech-1');
    const nav = container.querySelector('nav.mobile-tabbar');
    expect(nav?.className).toContain('is-hidden');
  });

  it('/products → tabbar 不隱藏(列表頁走 catalog tab、不藏)', () => {
    const { container } = renderAt('/products');
    const nav = container.querySelector('nav.mobile-tabbar');
    expect(nav?.className).not.toContain('is-hidden');
  });

  // 🔶 第2批(全站重設計):整站上線前的 /coming-soon 刻意沒有任何站內導航
  //    —— 那時其他頁都還沒上線,擺連結點了只會 404(設計端 `coming-soon-handoff.md` 驗收 #14)。
  //    這一頁靠「不 import <Header>/<HomeFooter>」就沒有殼,但 TabBar 掛在**根 layout**、
  //    頁面擋不掉 ⇒ 唯一能擋的地方就是這個元件。
  it('🔴 /coming-soon → tabbar 隱藏(整站版刻意零站內導航)', () => {
    const { container } = renderAt('/coming-soon');
    const nav = container.querySelector('nav.mobile-tabbar');
    expect(nav?.className).toContain('is-hidden');
  });

  // 反面:同一個 <ComingSoon> 元件也渲染在 /stores 與 /install 上,但那兩條是**站內頁**,
  // Sean 2026-08-05 逐字要求保留天地(「不然可能會跳到下一個頁面回不去」)⇒ TabBar 要留著。
  // 沒有這兩條的話,把上面那條寫成 `startsWith('/co')` 之類的過寬判定不會有任何東西紅。
  it.each([['/stores'], ['/install']])('%s → tabbar **不**隱藏(站內頁要保留天地)', (path) => {
    const { container } = renderAt(path);
    const nav = container.querySelector('nav.mobile-tabbar');
    expect(nav?.className).not.toContain('is-hidden');
  });

  it('/account → 會員 tab is-active', () => {
    const { container } = renderAt('/account');
    const accountTab = container.querySelector('a[href="/account"]');
    expect(accountTab?.className).toContain('is-active');
  });

  it('找車 tab 連 /products?pick=vehicle(2026-08-03 B 案解除停用、backlog #195 結案)', () => {
    const { container } = renderAt('/');
    const vehicleTab = container.querySelector('a[href="/products?pick=vehicle"]');
    expect(vehicleTab).toBeTruthy();
    expect(vehicleTab?.textContent).toContain('找車');
  });

  it('5 個 tab 全是真連結:零 aria-disabled、零 href="#"', () => {
    // 🔴 一條擋兩種回歸:①有人把某個 tab 改回 disabled stub(整個 disabled 分支已於 08-03 移除)
    //    ②有人用 href='#' 當佔位 —— 點了會跳頁首,看起來像壞掉而不是「還沒開放」。
    const { container } = renderAt('/');
    expect(container.querySelectorAll('[aria-disabled="true"]').length).toBe(0);
    expect(container.querySelectorAll('a[href="#"]').length).toBe(0);
    expect(container.querySelectorAll('nav.mobile-tabbar > a').length).toBe(5);
  });

  it('購物車 tab 為 <Link href="/cart">(#194 resolved、非 disabled span)', () => {
    const { container } = renderAt('/');
    const cartTab = container.querySelector('a[href="/cart"]');
    expect(cartTab).toBeTruthy();
    // 不再是 disabled span
    expect(container.querySelector('span[aria-label="購物車(尚未開放)"]')).toBeNull();
  });

  it('/cart → 購物車 tab is-active', () => {
    const { container } = renderAt('/cart');
    const cartTab = container.querySelector('a[href="/cart"]');
    expect(cartTab?.className).toContain('is-active');
  });
});
