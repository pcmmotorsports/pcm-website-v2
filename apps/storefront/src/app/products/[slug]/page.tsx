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
//
// M-1-16c-4c:SEO / AI 友善 —
//   - generateMetadata 強化:description ← 真 subtitle、Open Graph(type=website〔Q2=A、Next 型別不支援
//     'product'、商品語意交 JSON-LD〕/ title / desc / url / image〔絕對URL〕)、canonical(絕對 URL)。
//   - default export 注入 schema.org/Product JSON-LD <script>(server render 進 HTML、給 Google 商品結果 / AI 讀)。
//   🔴 鐵則 12 經銷防護:JSON-LD/OG 價只 general(serializeProductJsonLd 逐欄白名單、見 lib/product-jsonld.ts)。
//
// ISR 註記(審查 CONSIDER 6):本片維持 **dynamic**(fetchProductByHandle 每請求查 + ProductPage useSearchParams),
//   **不設 revalidate**;未來若引入 ISR / 靜態快取,須評估 JSON-LD/OG price 與 Google Merchant 即時一致性
//   (快取舊價 vs 後台改價)、並重跑經銷洩漏驗證(backlog 追)。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchProductByHandle } from '@/lib/products';
import { serializeProductJsonLd } from '@/lib/product-jsonld';
import { resolveSiteUrl, isAbsoluteHttpUrl } from '@/lib/site-url';
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

  const title = `${product.name} — PCM Motorsports`;
  // description ← 真 subtitle(M-1-16c-4a plumb);空則 fallback 既有風格字面。
  const description = product.subtitle?.trim() || `${product.brand} · 適用 ${product.fits}`;

  // canonical / OG url ← 絕對 URL(prod 未設 NEXT_PUBLIC_SITE_URL 則 undefined、省略、見 site-url.ts)。
  const base = resolveSiteUrl();
  const canonicalUrl = base ? `${base}/products/${slug}` : undefined;
  // OG image 須絕對 URL(相對 placeholder 過濾;對齊 JSON-LD image guard)。
  const ogImage = (product.images ?? []).find(isAbsoluteHttpUrl);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: 'PCM Motorsports',
      type: 'website', // Next 型別 union 不含 'product'(Q2=A);商品語意交 JSON-LD @type:Product
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    ...(canonicalUrl ? { alternates: { canonical: canonicalUrl } } : {}),
  };
}

export default async function ProductSlugRoute({ params }: Props) {
  const { slug } = await params;
  const product = await fetchProductByHandle(slug);
  if (!product) {
    notFound();
  }

  // M-1-16c-4c:schema.org/Product JSON-LD。base 未解析出時(prod 未設環境變數)省略 url 欄。
  const base = resolveSiteUrl();
  const url = base ? `${base}/products/${slug}` : undefined;
  const jsonLd = serializeProductJsonLd(product, url ? { url } : undefined);

  // M-1-16c-3:tier 釘 'general'(詳情頁 Phase-1 公開價、見檔頭 🔴 註解)。
  return (
    <>
      <script
        type="application/ld+json"
        // 對齊 Next 官方 json-ld guide:escape(< → 跳脫序列 U+003C)已在 serializeProductJsonLd、防 </script> breakout。
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <ProductPage product={product} tier="general" />
    </>
  );
}
