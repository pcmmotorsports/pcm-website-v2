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
// 3 button(cart / account / search)onClick stub 留候選刀 3 router.push;
// onNavLocal / handleNav wrapper / MouseEvent type import 保留(button 還用)

'use client';

import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import type { MouseEvent } from 'react';

export type HeaderProps = {
  cartCount?: number;
  onMenuClick?: () => void;
  isMobile?: boolean;
  currentPage?: string;
  onNav?: (target: string, ctx?: object) => void;
};

export function Header({
  cartCount = 4,
  isMobile: isMobileProp,
  currentPage = 'products',
  onNav,
}: HeaderProps) {
  const [searchQuery] = useState('');
  const onNavLocal = useCallback((target: string, ctx?: object) => {
    if (onNav) {
      onNav(target, ctx);
      return;
    }
    // nav a 已 Header mini-slice 改 <Link href>(本檔 navItems href + 2 logo)、
    // button onClick stub 仍消費 handleNav wrapper(cart / account / search)、候選刀 3 router.push 接
    console.log('[onNav]', target, ctx);
  }, [onNav]);

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
  const handleNav = (e: MouseEvent, id: string) => { e.preventDefault(); onNavLocal(id); };

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
                {cartCount > 0 && <span className="pcm-cart-dot">{cartCount}</span>}
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
                {cartCount > 0 && <span className="pcm-cart-dot">{cartCount}</span>}
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
