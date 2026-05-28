// @vitest-environment jsdom
//
// MobileTabBar smoke test — #192 前台 regression 安全網。
// 驗「render 5 tab 不報錯」+「pathname-based active / hidden 行為」+「disabled tab 用 <span>」。
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

  it('/account → 會員 tab is-active', () => {
    const { container } = renderAt('/account');
    const accountTab = container.querySelector('a[href="/account"]');
    expect(accountTab?.className).toContain('is-active');
  });

  it('找車 + 購物車 tab disabled(<span aria-disabled="true">、非 <a>)', () => {
    const { container } = renderAt('/');
    // 找車 + 購物車 都該是 <span aria-disabled>、非 <a href>
    const disabledSpans = container.querySelectorAll<HTMLSpanElement>('span[aria-disabled="true"]');
    expect(disabledSpans.length).toBe(2);
    // aria-label 含「尚未開放」
    const labels = Array.from(disabledSpans).map((s) => s.getAttribute('aria-label'));
    expect(labels).toContain('找車(尚未開放)');
    expect(labels).toContain('購物車(尚未開放)');
  });
});
