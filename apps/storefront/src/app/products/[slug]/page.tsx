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
import { fetchProductByHandle, fetchVehicleTaxonomy } from '@/lib/products';
import { fetchRecommendedProducts } from '@/lib/recommendations/fetch-recommendations';
import type { VehicleSelection } from '@/lib/recommendations';
import { parseVehicleFromUrl, vehicleUrlParam } from '@/lib/vehicle-url';
import { serializeProductJsonLd } from '@/lib/product-jsonld';
import { resolveSiteUrl, isAbsoluteHttpUrl } from '@/lib/site-url';
import { ProductPage } from '@/components/ProductPage';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

export default async function ProductSlugRoute({ params, searchParams }: Props) {
  const { slug } = await params;
  const product = await fetchProductByHandle(slug);
  if (!product) {
    notFound();
  }

  // R3/N°03 推薦引擎接線(取代 C5 fetchRelatedProducts 同分類版、對齊 plan §5 資料流):
  //   ① 讀 ?vehicle → 用 cached vehicle taxonomy 把 slug 解回原始車廠/車型名(codex #2 linchpin:
  //      URL 存 taxonomy 去重後 slug id〔含碰撞序號〕、product_fitments 存原始名、禁裸 slugify 現算;
  //      複用 /products 列表端同一 parseVehicleFromUrl + 同一 buildVehicleTaxonomy 衍生源=id 空間一致)。
  //      taxonomy 由 fetchVehicleTaxonomy(unstable_cache 900s)供給 → 詳情頁免每請求重建(plan §5 決策點解)。
  //   ② 有車且解出車型 → Case A 反查選定車相容池;否則 Case B 同品牌。引擎輸出經銷價已 strip、失敗降級空。
  const sp = await searchParams;
  const spGet = (name: string): string | null => {
    const v = sp[name];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v[0] ?? null; // 對齊 URLSearchParams.get():重複參數取首值
    return null;
  };
  // 一般 PDP(無車輛參數)不撈 taxonomy(免多餘查詢);短版 ?vehicle 或長版 ?brand=&model=(書籤舊連結、
  //   parseVehicleFromUrl fallback 分支)才解析(codex R3 F3:勿只認短版而丟長版;?brand= 單獨=商品品牌
  //   filter 語意、需 model 同在才當車輛長版、不誤觸)。
  const hasVehicleParam =
    spGet('vehicle') != null || (spGet('brand') != null && spGet('model') != null);
  const taxonomy = hasVehicleParam ? await fetchVehicleTaxonomy() : [];
  const parsedVehicle = hasVehicleParam ? parseVehicleFromUrl({ get: spGet }, taxonomy) : null;
  // Case A 反查需 motoBrand + modelCode 都有;只選了品牌沒選車型 → 當作沒車(Case B 同品牌)。
  const vehicle: VehicleSelection | undefined =
    parsedVehicle && parsedVehicle.model
      ? { motoBrand: parsedVehicle.brand, modelCode: parsedVehicle.model, year: parsedVehicle.year }
      : undefined;

  const { items: related, hasMore: relatedHasMore } = await fetchRecommendedProducts(
    product.slug,
    vehicle,
  );

  // 「查看全部」連結(hasMore 才顯):🔴 Case A(有車)一律連車輛 filter——短版 ?vehicle 或由長版
  //   ?brand=&model= 合成短版 slug(codex R3 r2:長版書籤 Case A 不可退成商品品牌 filter=文案「相容」
  //   卻連品牌 filter 誤導);Case B(無車)連商品品牌 filter;皆無 → /products(fail-safe)。
  const vehicleParamForHref = vehicle ? vehicleUrlParam({ get: spGet }) : null;
  const relatedMoreHref = vehicleParamForHref
    ? `/products?vehicle=${encodeURIComponent(vehicleParamForHref)}`
    : !vehicle && product.brandSlug
      ? `/products?brand=${encodeURIComponent(product.brandSlug)}`
      : '/products';

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
      <ProductPage
        product={product}
        tier="general"
        related={related}
        relatedHasMore={relatedHasMore}
        relatedMoreHref={relatedMoreHref}
        relatedHasVehicle={vehicle != null}
      />
    </>
  );
}
