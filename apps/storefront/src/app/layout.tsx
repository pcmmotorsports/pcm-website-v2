// app/layout.tsx — root layout(全域 CSS import)
//
// CSS load order 對齊 design-reference/index.html @ 25d3a2a:
//   tokens → header → product-card → pricing → filter-top → filter-side → home
//   (filter-side.css 由 M-1-09 加入、filter-top.css 由 M-1-10 加入;design 完整序
//    filter-drawer / products-page 環繞 filter-side、M-1-11 / 12 trigger 才補)
// 其他 CSS(product-page / pages / vehicle-drawer / account / search-overlay / tweaks)
// 後續 slice trigger 才加(首頁不需要)
//
// fonts 對齊 design index.html(Inter / Noto Sans TC / Noto Serif TC / Cormorant Garamond / JetBrains Mono)
// 走 <link> 預連 + stylesheet(對齊 design 字面、避免 next/font 隱式包裝偏離 design)

import type { ReactNode } from 'react';
import '../styles/tokens.css';
import '../styles/header.css';
import '../styles/product-card.css';
import '../styles/pricing.css';
import '../styles/filter-top.css';
import '../styles/filter-side.css';
import '../styles/home.css';

export const metadata = {
  title: 'PCM Motorsports — Made for those who ride differently.',
  description: '高端機車零件編輯選品 · 原廠授權 · 合作店家安裝',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;600;700&family=Noto+Serif+TC:ital,wght@0,400;0,500;1,400&family=Cormorant+Garamond:ital,wght@0,500;1,400;1,500&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
