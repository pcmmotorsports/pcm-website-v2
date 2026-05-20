// app/products/[slug]/page.tsx — 商品詳細頁 route(M-1-13b)
//
// /products/[slug] 對齊 Q1=B 拍板:SEO 友善 slug 路由(非數字 id);
// findProductBySlug 取 mock product、不存在走 notFound() 預設 404 頁(Q5=C 拍板)。
// 實際版面由 client 元件 ProductPage 負責(useSearchParams hook 必標 'use client'、ADR-0006 白名單情境)。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { findProductBySlug } from '@/data/mock-products';
import { ProductPage } from '@/components/ProductPage';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = findProductBySlug(slug);
  if (!product) {
    return { title: '商品不存在 — PCM Motorsports' };
  }
  return {
    title: `${product.name} — PCM Motorsports`,
    description: `${product.brand} · 適用 ${product.fits}`,
  };
}

export default async function ProductSlugRoute({ params }: Props) {
  const { slug } = await params;
  const product = findProductBySlug(slug);
  if (!product) {
    notFound();
  }
  return <ProductPage product={product} />;
}
