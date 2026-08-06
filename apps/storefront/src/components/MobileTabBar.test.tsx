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

  // 🔶 第5批(Sean 2026-08-06 拍板 Q5=A):結帳流程不給全站導覽。
  //    🔴🔴 **拍板前提有誤、等重新裁定(STOP Q6)**:我原本寫「設計稿 checkout-page.html
  //    整頁沒有 TabBar 的 markup」—— 那是大小寫敏感 grep 造成的假字面。實際上
  //    `checkout-page.html:123-128` 有完整五顆 tab、購物車那顆 `is-active`,
  //    且與 `:87` 的 buybar **同時存在**。這幾條測試先照現行拍板釘著,若 Sean 改判要一起翻。
  //    保留 A 的獨立理由(仍成立):真站 ≤900px 的 `.co-mobile-buybar`(z-index 100)
  //    壓在 TabBar(z-index 40)上面。
  //    🔴 `/checkout/callback` 也要藏:它渲染 `CheckoutSuccess`、同樣掛 `.co-page`,
  //    而 checkout.css 那條讓位 padding 歸零規則是以 `.co-page` 為條件 ——
  //    兩邊涵蓋的路徑集合不一致的話,會出現「TabBar 在、底部 padding 卻沒了」
  //    (最後一條 tab 被自己蓋住)。
  it.each([['/checkout'], ['/checkout/callback']])('🔴 %s → tabbar 隱藏(Q5=A)', (path) => {
    const { container } = renderAt(path);
    const nav = container.querySelector('nav.mobile-tabbar');
    expect(nav?.className).toContain('is-hidden');
  });

  // 反面:購物車**不是**結帳流程,天地要留著。沒有這條的話,把上面寫成 `startsWith('/c')`
  // 之類的過寬判定不會有任何東西紅(/cart /coming-soon 全被吃掉)。
  it('/cart → tabbar **不**隱藏(購物車不在結帳流程內)', () => {
    const { container } = renderAt('/cart');
    const nav = container.querySelector('nav.mobile-tabbar');
    expect(nav?.className).not.toContain('is-hidden');
  });

  // ⚠️ 上面所有 hidden 斷言守的都只是「class 有沒有掛上」。**class 有掛 ≠ CSS 認帳** ——
  //    R2 抓到 `.is-hidden` 在真手機 UA 上曾經是 no-op,而這裡全綠。
  //    合約的另一半(CSS 那半)在 `styles/mobile-tabbar.test.ts`,兩邊合起來才完整。

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
