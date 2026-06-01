// app/products/[slug]/page.tsx — 商品詳細頁 route(M-1-13b;M-1-16c-3 由 mock 換真資料)
//
// /products/[slug] 對齊 Q1=B 拍板:SEO 友善 slug 路由(slug = handle);
// M-1-16c-3:findProductBySlug(mock)→ fetchProductByHandle(slug)(SupabaseProductAdapter
// findByHandle + embed 真變體);不存在 → notFound() 預設 404 頁(Q5=C 拍板)。
//
// 🔴 tier 釘 general(M-1-16c-3、codex 關卡1 must-fix 2):詳情頁 Phase-1 顯 general 公開價。
// public view 排除 price_store、store/premiumStore 走 dummy 0;若傳真 tier 會顯「NT$ 0」。
// 變體 UI 價亦取 general(見 lib/products toUIProduct strip)。tier-aware 詳情價待 M-2-08
// server-side pricing endpoint(同 featured g-2 'general' 釘法);故移除 M-1-13H-7 的
// resolveTierFromRequest tier-override 對詳情價的用途(tier override 對詳情價失效、屬刻意 Phase-1)。
//
// 實際版面由 client 元件 ProductPage 負責(breadcrumb / vehicle pill 等用 useSearchParams、client 端讀)。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchProductByHandle } from '@/lib/products';
import { ProductPage } from '@/components/ProductPage';

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await fetchProductByHandle(slug);
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
  const product = await fetchProductByHandle(slug);
  if (!product) {
    notFound();
  }

  // M-1-16c-3:tier 釘 'general'(詳情頁 Phase-1 公開價、見檔頭 🔴 註解)。
  return <ProductPage product={product} tier="general" />;
}
