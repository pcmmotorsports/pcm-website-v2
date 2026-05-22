// app/products/page.tsx — 商品列表頁 route(M-1-12b)
//
// /products 對齊 Header navItem「商品目錄」(href: /products)+ HomeFooter 連結。
// 實際版面 / 篩選 / 商品 grid 由 client 元件 ProductsPage 負責。

import type { Metadata } from 'next';
import { ProductsPage } from '@/components/ProductsPage';

// useSearchParams 在 client component 需 route 端標 dynamic、否則 production build 報
// Static Generation 錯;對齊首頁 page.tsx L31-34 既有慣例(Phase 1 dev 真資料動態)
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '商品目錄 — PCM Motorsports',
  description: '高端機車零件選品 · 依車款 / 分類 / 品牌篩選',
};

export default function ProductsRoute() {
  return <ProductsPage />;
}
