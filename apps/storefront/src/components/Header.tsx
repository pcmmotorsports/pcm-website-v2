// Header.tsx — Light theme, sticky, multi-variant, nav-aware
//
// 字面從 design-reference/components/Header.jsx @ 25d3a2a 直接搬:
// - jsx → tsx + props type 推斷
// - React.useState / useEffect → import { useState, useEffect }
// - window.Header UMD 註冊移除(改 ES export)
// - className 字面完全不動
//
// M-1-04 Header mini-slice:Header 維持 client(useState searchQuery/autoMobile + useEffect + dispatchEvent)、
// 9 a 標籤(2 logo + 7 navItems)改 <Link href>(對齊刀 1 全範圍 + Q-Header A3 拍板);
// M-1-04 刀 3-b:3 nav button(mobile cart / desktop cart / desktop account)舊 useCallback stub 整段移除 → handleNav 改寫 router.push(NAV_ROUTE_MAP)+ props.onNav fallback;
// mobile search(dispatchEvent)/ desktop search div / input(非 nav)字面不動;handleNav wrapper + MouseEvent type 保留(props.onNav fallback 維持)
//
// M-1-13e-b-2:cartCount prop 整段移除(Sean Q-13e-b-2-prop=A 拍板「單一資料源、不留 manual override」);
// Header badge 改讀 useCart().totalQty、totalQty=0 走既有 `cartCount > 0` 守門自動隱(SSR / hydrate 前
// totalQty=0、不顯 dot、hydrate 後 useEffect 從 localStorage 載入才浮出真實數字、無 mismatch)

'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { MouseEvent } from 'react';
import { useCart } from '@/contexts/CartContext';

const NAV_ROUTE_MAP: Record<string, string> = {
  cart: '/cart',
  // M-1-14e-f1-a(D-f=A):會員圖示 →/login(/account 整頁 stage g 才建、現導 /login 避免孤兒頁)。
  // stopgap、不分登入態;stage g 補「已登入→/account、未登入→/login」會員態判斷(backlog #179)。
  account: '/login',
};

export type HeaderProps = {
  onMenuClick?: () => void;
  isMobile?: boolean;
  currentPage?: string;
  onNav?: (target: string, ctx?: object) => void;
};

export function Header({
  isMobile: isMobileProp,
  currentPage = 'products',
  onNav,
}: HeaderProps) {
  const router = useRouter();
  const { totalQty } = useCart();
  const [searchQuery] = useState('');

  const openSearch = (q: string = '') => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('pcm-open-search', { detail: { query: q } }));
  };

  const [autoMobile, setAutoMobile] = useState<boolean>(false);
  useEffect(() => {
    const check = () => {
      const dm = document.querySelector('[data-mobile="true"]');
      setAutoMobile(!!dm || window.innerWidth < 1080);
    };
    check();
    const mq = window.matchMedia('(max-width: 1079px)');
    mq.addEventListener('change', check);
    // Poll for tweaks change (data-mobile attr flips)
    const id = setInterval(check, 500);
    return () => { mq.removeEventListener('change', check); clearInterval(id); };
  }, []);
  const isMobile = isMobileProp !== undefined ? isMobileProp : autoMobile;

  const navItems = [
    { id: 'catalog', label: '商品目錄', href: '/products' },
    { id: 'vehicle', label: '依車輛搜尋', href: '/#vehicle-finder' },
    { id: 'brands', label: '品牌', href: '/brands' },
    { id: 'new', label: '新品', href: '/products?filter=new' },
    { id: 'sale', label: '特價', href: '/products?filter=sale', sale: true },
    { id: 'install', label: '安裝預約', href: '/install' },
    { id: 'stores', label: '合作店家', href: '/stores' },
  ];
  const handleNav = (e: MouseEvent, id: string) => {
    e.preventDefault();
    if (onNav) {
      onNav(id);
      return;
    }
    router.push(NAV_ROUTE_MAP[id] ?? `/${id}`);
  };

  return (
    <header className="pcm-header">
      <div className="pcm-header-inner">
        {isMobile ? (
          <>
            <button className="pcm-icon-btn" aria-label="search" onClick={() => openSearch()}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
              </svg>
            </button>
            <Link href="/" className="pcm-logo">PCM</Link>
            <div className="pcm-header-right">
              <button className="pcm-icon-btn pcm-cart" aria-label="cart" onClick={(e) => handleNav(e, 'cart')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                {totalQty > 0 && <span className="pcm-cart-dot">{totalQty}</span>}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pcm-header-left">
              <Link href="/" className="pcm-logo">PCM MOTORSPORTS</Link>
              <nav className="pcm-nav">
                {navItems.map(item => (
                  <Link key={item.id}
                        href={item.href}
                        className={`pcm-nav-item ${currentPage === item.id ? 'is-active' : ''} ${item.sale ? 'pcm-nav-sale' : ''}`}>
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="pcm-header-right">
              <div className={`pcm-search ${searchQuery ? 'is-focus' : ''}`}
                   onClick={() => openSearch(searchQuery)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
                </svg>
                <input
                  placeholder="搜尋商品 / 車款 / 品牌..."
                  value={searchQuery}
                  readOnly
                  onFocus={(e) => { e.target.blur(); openSearch(searchQuery); }}
                  onClick={(e) => { e.stopPropagation(); openSearch(searchQuery); }}
                />
              </div>
              <button className="pcm-icon-btn" aria-label="account" onClick={(e) => handleNav(e, 'account')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </button>
              <button className="pcm-icon-btn pcm-cart" aria-label="cart" onClick={(e) => handleNav(e, 'cart')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
                {totalQty > 0 && <span className="pcm-cart-dot">{totalQty}</span>}
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
