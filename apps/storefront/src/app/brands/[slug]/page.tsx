// app/brands/[slug]/page.tsx — 品牌介紹頁**正式 route**(D3a;2026-08-04)
//
// 接線計畫 §3 的 **A 案**(Sean 08-03 拍 Q3=A 範圍級批准):品牌介紹頁有自己的網址,
// 而不是塞進 `/products` 的 URL 狀態機。選 A 的主要理由就是本檔的 `generateMetadata` ——
// 這頁的 `<title>` / description / OG 是它自己的,B 案(掛在目錄頁上)拿不到。
//
// 版面全部在 `components/brand/BrandPageRoot.tsx`(組裝點 + `.bp-page` 色票 scope,見該檔檔頭);
// 本檔只負責五件事:404、metadata、站台 `<Header>` / `<HomeFooter>` 的殼、頁尾的 per-brand 標語、
// 以及**撈商品區的資料**(D3b;撈完傳進 `BrandPageRoot`,讓它保持同步 —— 理由見該檔那段 doc)。
// 站台殼是設計稿本來就有的(`pcm-home-redesign/brand-page.html:1327` 站台 header /
// `:1506` 站台 footer),不是這裡自己加的。
//
// 🔴 `<Header>` 不帶 `currentPage` ⇒ 吃預設 `'products'` ⇒ 「依車輛搜尋」走 `/products?pick=vehicle`
//    (`Header.tsx:104-107` 逐字:只有 `app/page.tsx` 傳 `currentPage="home"`)。品牌頁不是首頁,
//    這是對的分支;`Header.test.tsx` 那組對照表守的也是這一支。
//
// **本片刻意沒做的三件事**(全部有主;不是漏掉,但也不要當成「已經有了」):
//
// ⚠️ ① **`/brands` 總覽頁** —— 麵包屑第二段(`BrandPageHeader.tsx:46`)與磚牆都指得到它,
//      但那條 route 屬 **D3c**(=計畫 §8.2 的 D4)。D3a 落地後 `/brands/<slug>` 這一半先活。
// 🔴 ② **`#314` 的 redirect 沒做** —— backlog `docs/phase-1-backlog.md:8395-8396` 逐字要求
//      「D3 建 `app/brands/[slug]/page.tsx` 時,**同片**在 `/products` 側加 redirect」。
//      本片建了那個檔卻沒附 redirect,**是刻意延到 D3c**(信箱 C-25-Q Q1 → C-26-A 核可:
//      hash 永遠不送到 server ⇒ 只能做 client 側,與 `/brands` 總覽同片收比較完整)。
//      在 D3c 落地前,`/products?pbrand=X#brand-about` 仍會停在商品目錄頁首、零錯誤訊息。
// ⚠️ ③ **`/brands/<slug>` 不在 `sitemap.xml` 裡** —— `app/sitemap.ts:22-24` 只列靜態路徑 + 商品
//      handle。A 案選它的理由就是 SEO,少了地圖等於少一半 ⇒ 與 `/brands` 同片(D3c)一起補。

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { BrandRichText } from '@/components/BrandRichText';
import { BrandPageRoot } from '@/components/brand/BrandPageRoot';
import { BRAND_BY_SLUG, BRAND_CONTENT } from '@/data/brand-content';
import { brandRichTextToPlain } from '@/lib/brand-rich-text';
import { brandAsset } from '@/lib/brand-asset';
import { fetchBrandTopProducts } from '@/lib/brand-products';
import { resolveSiteUrl } from '@/lib/site-url';

type Props = { params: Promise<{ slug: string }> };

/**
 * ⚠️ **今天這支沒有實際效果**(關卡2 R1 nit 5;不要讀成「20 頁已預先產好」):
 *    `app/layout.tsx` 的 root layout `await headers()`(讀 UA 判手機)⇒ 全 app 走 dynamic,
 *    `next build` 的路由表把本 route 印成 `ƒ /brands/[slug]`(= server-rendered on demand)、
 *    `.next/prerender-manifest.json` 也沒有任何 `/brands` 條目。
 *    留著的理由:①它是這條 route 的參數真相(20 家、與 `BRAND_BY_SLUG` 同一份)
 *    ②`dev-preview/brand-page/[slug]` 既有慣例 ③root layout 哪天不再 `headers()` 就直接生效。
 */
export function generateStaticParams() {
  return BRAND_CONTENT.map((brand) => ({ slug: brand.slug }));
}

/**
 * 🔴 `Object.hasOwn` 不是 `in`、也不是 `BRAND_BY_SLUG[slug]` 的 truthy 檢查:
 *    `BRAND_BY_SLUG` 是 `Object.fromEntries` 產的普通物件 ⇒ `?slug=constructor` / `__proto__`
 *    / `toString` 會取到**原型鏈**上的東西且 truthy,`if (!brand)` 這種守門直接失效
 *    (memory `reference_js-index-lookup-hits-prototype-chain`;本 repo 兩支 result-banner
 *     五個頁面真的中過)。dev-preview 那支已是這個寫法,正式 route 沿用。
 */
function findBrand(slug: string) {
  return Object.hasOwn(BRAND_BY_SLUG, slug) ? BRAND_BY_SLUG[slug]! : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const brand = findBrand(slug);
  if (!brand) return { title: '品牌不存在 — PCM Motorsports' };

  // 標題字面 = 設計稿 `brand-page.html:1615` 的 `document.title` 逐字(全形直豎線、非半形 |)。
  // ⚠️ 站名寫法與既有頁面(`— PCM Motorsports`)不同 —— 那是設計稿自己的字面,
  //    全站統一屬 D5/D7 首頁與頁尾重排的範圍,這裡不擅自翻譯(鐵則 1)。
  const title = `${brand.name} 品牌介紹｜PCM MOTOR PARTS LTD.`;
  // description ← 品牌自己的 lede(真內容、不是編的);lede 是 BrandRichString ⇒ 走 plain 轉換,
  // 否則 `<strong>` 之類的標記會原封進 meta。
  const description = brandRichTextToPlain(brand.lede);

  const base = resolveSiteUrl();
  const canonicalUrl = base ? `${base}/brands/${slug}` : undefined;
  // OG image = 橫幅照(20 家目前全有;沒有照片的品牌版面退回純石墨底 ⇒ 這裡也就沒有圖,不塞替代圖)。
  const ogImage = brand.band && base ? `${base}${brandAsset(brand.band.src)}` : undefined;

  return {
    title,
    description,
    ...(canonicalUrl ? { alternates: { canonical: canonicalUrl } } : {}),
    openGraph: {
      type: 'website',
      title,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const brand = findBrand(slug);
  if (!brand) notFound();
  // 🔴 撈在 `notFound()` **之後**:未知 slug 不該去打一次 RPC(而且 `brand` 為 null 時
  //    也組不出篩選鍵)。0 筆(實測 5 家)⇒ 商品區整區不渲染,不是錯誤。
  const products = await fetchBrandTopProducts(brand.slug);

  return (
    // `data-screen-label` = 設計稿 `:1325` 外層 `.ed-page` 上的字面(全站慣例:`app/page.tsx:93`
    // 的 "Home"、`CartView.tsx:97` 的 "Cart" …;此處用設計稿的中文字面、鐵則 1)。
    // 🔴 設計稿同一個 div 還帶 `class="ed-page layout-unified"`,**兩個 class 都刻意不搬**:
    //    ①storefront 的 `.ed-page` 是**首頁專屬**的 token 作用域(`styles/home.css:5-24`,含
    //      `--ed-gutter` 與 `.ed-page .ed-mono` / `.ed-page em` 兩條後代規則)—— 掛上去會改到
    //      頁尾 `.ed-mono` 與品牌內文 `<em>` 的**現有外觀**,那是沒被批准的視覺改動。
    //      (`home.css:609` 逐字寫過頁尾在 `.ed-page` 之外有 self-contained defaults。)
    //    ②`layout-unified` 在本 repo 實查零命中,是設計稿原型自己的版面變體。
    // 🔴 設計稿 `:1616` 的 JS 還會把它覆寫成 `` `品牌頁 · ${brand.name}` ``(關卡2 R2 nit 8)——
    //    **per-brand 後綴刻意不搬**:那是 OD 原型自己的除錯標示,而正式站這個屬性是靜態的
    //    版面標記(`app/page.tsx:93` 的 "Home" 之類都是固定字面),頁面身分由 `<title>` 表達。
    <div data-screen-label="品牌頁">
      <Header />
      <BrandPageRoot brand={brand} products={products} />
      {/* 頁尾標語 = 這家品牌自己那一句(設計稿 `:1510-1512` 註解 + `:2029` 灌值)。
          `slogan` 是 BrandRichString、實際含 `<br>` ⇒ 走 BrandRichText;不給 `as`
          回 Fragment ⇒ DOM 與設計稿的 `<p class="ed-footer-tagline">…</p>` 逐節點相同。 */}
      <HomeFooter tagline={<BrandRichText>{brand.slogan}</BrandRichText>} />
    </div>
  );
}
