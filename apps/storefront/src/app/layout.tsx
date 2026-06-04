// app/layout.tsx — root layout(全域 CSS import)
//
// CSS load order 對齊 design-reference/index.html @ 25d3a2a:
//   tokens → header → product-card → pricing → filter-top → filter-side → filter-drawer
//   → products-page → home
//   (filter-side.css 由 M-1-09、filter-top.css 由 M-1-10、filter-drawer.css 由 M-1-11、
//    products-page.css 由 M-1-12b 加入)
// 其他 CSS(product-page / pages / vehicle-drawer / account / search-overlay / tweaks)
// 後續 slice trigger 才加(首頁不需要)
// auth.css 由 M-1-14e-f1-a 加入(/login + /register 頁、含 .ap-page/.ap-mono base + auth-*)
//
// fonts 對齊 design index.html(Inter / Noto Sans TC / Noto Serif TC / Cormorant Garamond / JetBrains Mono)
// 走 <link> 預連 + stylesheet(對齊 design 字面、避免 next/font 隱式包裝偏離 design)
// OD-1:加 Antonio(義體 display 字、ital 0/1 × wght 500/700)— RPM 商品頁 OD 模板 N° 章節數字 / 卡片序號用;
//   字面從 OD product-detail-rpm-template.html <head> Google Fonts link 直接搬(--f-display token 對應)。
//
// [#192 A2] 全站 RWD 啟動 + 底部 MobileTabBar(2026-05-28):
// - import headers + RootLayout 改 async(Next 16 dynamic API、必 async + await)
// - SSR 讀 user-agent 簡單 regex 判 mobile、設 <html data-mobile={...}>(非完整 UA parser、iPad
//   等請求桌面 UA 由 CSS @media 兜底)
// - 帶來 RootLayout 進 dynamic rendering path、無 ISR / static cache;對齊既有 server component
//   route(/account / api/auth 等本就 dynamic)、首頁實際走 server fetch、無回歸
// - <html data-mobile="true"> 同步 Header.tsx L57-58 既有 querySelector 邏輯(向後相容)
// - <MobileTabBar /> 在 CartProvider 內、children 後、</body> 前;CSS via mobile-tabbar.css

import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { CartProvider } from '@/contexts/CartContext';
import { MobileProvider } from '@/contexts/MobileContext';
import { MobileTabBar } from '@/components/MobileTabBar';
import '../styles/tokens.css';
import '../styles/header.css';
import '../styles/product-card.css';
import '../styles/pricing.css';
import '../styles/filter-top.css';
import '../styles/filter-side.css';
import '../styles/filter-drawer.css';
import '../styles/products-page.css';
import '../styles/home.css';
import '../styles/auth.css';
import '../styles/account.css';
import '../styles/tier.css';
import '../styles/mobile-tabbar.css';

export const metadata = {
  title: 'PCM Motorsports — Made for those who ride differently.',
  description: '高端機車零件編輯選品 · 原廠授權 · 合作店家安裝',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const hdrs = await headers();
  const ua = hdrs.get('user-agent') || '';
  // 簡單 regex(非完整 UA parser):iPhone / Android / Mobile 涵蓋主流手機 UA;
  // iPad「請求桌面網站」、iPod、舊 IEMobile / Opera Mini 等邊緣 case 由 CSS @media 兜底。
  const isMobile = /iPhone|Android|Mobile/i.test(ua);

  return (
    <html lang="zh-Hant" data-mobile={isMobile ? 'true' : 'false'}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Antonio:ital,wght@0,500;0,700;1,500;1,700&family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&family=Noto+Serif+TC:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital,wght@0,500;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <MobileProvider value={isMobile}>
          <CartProvider>
            {children}
            <MobileTabBar />
          </CartProvider>
        </MobileProvider>
      </body>
    </html>
  );
}
