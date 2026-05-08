// Header.tsx — Light theme, sticky, multi-variant, nav-aware
//
// 字面從 design-reference/components/Header.jsx @ d5ea3aa 直接搬:
// - jsx → tsx + props type 推斷
// - React.useState / useEffect → import { useState, useEffect }
// - window.Header UMD 註冊移除(改 ES export)
// - className 字面完全不動
// - onNav d1 階段 stub console.log(M-1-04+ next/navigation router.push 接入)

'use client';

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
    // d1 階段 stub、M-1-04 加 next/navigation router 後改 router.push
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
    { id: 'catalog', label: '商品目錄' },
    { id: 'vehicle', label: '依車輛搜尋' },
    { id: 'brands', label: '品牌' },
    { id: 'new', label: '新品' },
    { id: 'sale', label: '特價', sale: true },
    { id: 'install', label: '安裝預約' },
    { id: 'stores', label: '合作店家' },
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
            <a href="#" onClick={(e) => handleNav(e, 'home')} className="pcm-logo">PCM</a>
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
              <a href="#" onClick={(e) => handleNav(e, 'home')} className="pcm-logo">PCM MOTORSPORTS</a>
              <nav className="pcm-nav">
                {navItems.map(item => (
                  <a key={item.id}
                     href="#"
                     onClick={(e) => handleNav(e, item.id)}
                     className={`pcm-nav-item ${currentPage === item.id ? 'is-active' : ''} ${item.sale ? 'pcm-nav-sale' : ''}`}>
                    {item.label}
                  </a>
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
