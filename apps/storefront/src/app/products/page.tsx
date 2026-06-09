// app/products/page.tsx — 商品列表頁 route(M-1-12b)
//
// /products 對齊 Header navItem「商品目錄」(href: /products)+ HomeFooter 連結。
// 實際版面 / 篩選 / 商品 grid 由 client 元件 ProductsPage 負責。

import type { Metadata } from 'next';
import { ProductsPage } from '@/components/ProductsPage';
import { fetchCatalogProducts } from '@/lib/products';

// useSearchParams 在 client component 需 route 端標 dynamic、否則 production build 報
// Static Generation 錯;對齊首頁 page.tsx L31-34 既有慣例(Phase 1 dev 真資料動態)。
// #220:本 route server 端撈真目錄 → 傳 client ProductsPage(對齊詳情頁/首頁 server-fetch→client)。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '商品目錄 — PCM Motorsports',
  description: '高端機車零件選品 · 依車款 / 分類 / 品牌篩選',
};

export default async function ProductsRoute() {
  // 🔴 fetchCatalogProducts 內部釘 'general'(經銷價零外洩、store/premium 不顯 NT$0;見 lib/products)。
  const { products, error } = await fetchCatalogProducts();
  return <ProductsPage products={products} error={error} />;
}
