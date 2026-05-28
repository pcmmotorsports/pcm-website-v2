// components/MobileTabBar.tsx — 全站底部主導航(僅 mobile 顯示)
//
// 字面從 design-reference/components/App.jsx L166-190 直接搬:
// - 5 tab 字面:首頁 / 商品 / 找車 / 會員 / 購物車
// - SVG icon 字面複製(viewBox/path/strokeWidth 不動)
// - .mobile-tabbar / .mobile-tabbar-btn / .mobile-tabbar-dot className 字面
// - hidden prop 行為(product 頁讓位 sticky buy bar)
//
// 業務 override(鐵則 1 例外類別 2 = 技術實作差異、非視覺偏離):
// - design 用 currentPage prop + onNav callback(in-app state machine)→ storefront 用 Next routing
//   (usePathname() + <Link href>)
// - 「找車」tab href 暫指 '#' + aria-disabled(fold backlog #195、/vehicle-search 路由未建)
// - 「購物車」tab href 暫指 '#' + aria-disabled(fold backlog #194、/cart 路由 0 處、codex k1 FIX-2)
// - hidden 判定:pathname.startsWith('/products/') 且 segments.length >= 2(對應 /products/[slug]、
//   '/products' 列表頁不藏、走 catalog tab 顯示)

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type Tab = {
  id: string;
  label: string;
  href: string;
  matches: (pathname: string) => boolean;
  icon: ReactNode;
  disabled?: boolean;
};

const TABS: Tab[] = [
  {
    id: 'home',
    label: '首頁',
    href: '/',
    matches: (p) => p === '/',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
  },
  {
    id: 'catalog',
    label: '商品',
    href: '/products',
    matches: (p) => p === '/products' || p.startsWith('/products') || p.startsWith('/brands'),
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    id: 'vehicle-search',
    label: '找車',
    href: '#',
    matches: () => false,
    disabled: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="6" cy="17" r="3" />
        <circle cx="18" cy="17" r="3" />
        <path d="M6 17h8l-2-6h-3L6 17Z" />
        <path d="m14 11 1-3h3" />
      </svg>
    ),
  },
  {
    id: 'account',
    label: '會員',
    href: '/account',
    matches: (p) => p.startsWith('/account') || p === '/login' || p === '/register',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="12" cy="8" r="4" />
        <path d="M20 21v-1a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v1" />
      </svg>
    ),
  },
  {
    id: 'cart',
    label: '購物車',
    href: '#',
    matches: () => false,
    disabled: true,
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
    ),
  },
];

export function MobileTabBar() {
  const pathname = usePathname() || '/';
  const segments = pathname.split('/').filter(Boolean);
  const hidden = pathname.startsWith('/products/') && segments.length >= 2;

  return (
    <nav className={`mobile-tabbar ${hidden ? 'is-hidden' : ''}`} aria-label="主導航">
      {TABS.map((t) => {
        const active = t.matches(pathname);
        const cls = `mobile-tabbar-btn ${active ? 'is-active' : ''}`;
        if (t.disabled) {
          return (
            <span
              key={t.id}
              className={cls}
              aria-disabled="true"
              aria-label={`${t.label}(尚未開放)`}
            >
              <span className="mobile-tabbar-dot" />
              {t.icon}
              <span className="lbl">{t.label}</span>
            </span>
          );
        }
        return (
          <Link key={t.id} href={t.href} className={cls}>
            <span className="mobile-tabbar-dot" />
            {t.icon}
            <span className="lbl">{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
