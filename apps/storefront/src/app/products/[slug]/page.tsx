// app/products/[slug]/page.tsx — 商品詳細頁 route(M-1-13b)
//
// /products/[slug] 對齊 Q1=B 拍板:SEO 友善 slug 路由(非數字 id);
// findProductBySlug 取 mock product、不存在走 notFound() 預設 404 頁(Q5=C 拍板)。
// 實際版面由 client 元件 ProductPage 負責(useSearchParams hook 必標 'use client'、ADR-0006 白名單情境)。

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { findProductBySlug } from '@/data/mock-products';
import { ProductPage } from '@/components/ProductPage';
import { resolveTierFromRequest } from '@/lib/tier';

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

  // tier 解析(M-1-13e-pre-1、Sean Q1=B 業務拍板:金額頁面必須區分會員)。
  // 短期(Q5=A 拍板):mock-products 只含 general retail、商品頁顯一般零售價;
  // M-1-16 改 Supabase fetcher findBySlug + toUIProduct(p, tier) 後真區分會員價。
  // M-1-13e-a:tier prop 傳 ProductPage、ProductInfo pd-price-block 顯示 tier-aware price
  // (短期 store / premiumStore 顯「經銷價」tag 但 product.price 仍 retail、字面 vs 事實
  // 偏離、commit body 揭示;Mobile sticky bar Q-13e-a-scope=C 簡化、不分 tier)。
  const cookieStore = await cookies();
  const tier = await resolveTierFromRequest({}, cookieStore);

  return <ProductPage product={product} tier={tier} />;
}
