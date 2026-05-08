// app/layout.tsx — root layout(全域 CSS import)
//
// CSS load order 對齊 design-reference/index.html @ d5ea3aa:
//   tokens → header → product-card → home
// 其他 CSS(filter-* / products-page / product-page / pages / vehicle-drawer / account / search-overlay / tweaks)
// d1 不引(首頁不需要、後續 slice trigger 才加)
//
// fonts 對齊 design index.html(Inter / Noto Sans TC / Noto Serif TC / Cormorant Garamond / JetBrains Mono)
// 走 <link> 預連 + stylesheet(對齊 design 字面、避免 next/font 隱式包裝偏離 design)

import type { ReactNode } from 'react';
import '../styles/tokens.css';
import '../styles/header.css';
import '../styles/product-card.css';
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
