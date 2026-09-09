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
// **D3a 當時刻意沒做的三件事,到 D3c-5 已全部補完**(保留條目是為了讓沿革查得到):
//
// ✅ ① ~~`/brands` 總覽頁~~ **D3c-3 已落地**(`app/brands/page.tsx`)—— 麵包屑第二段與磚牆
//      指的就是它。D3a 落地時先活的是 `/brands/<slug>` 這一半。
// ✅ ② ~~`#314` 的 redirect 沒做~~ **D3c-5 已補**:`components/brand/BrandAboutRedirect.tsx`
//      掛在 `app/products/page.tsx`。當初延後的理由(hash 永遠不送到 server ⇒ 只能 client 側)
//      仍然成立、寫在那支的檔頭;信箱 C-25-Q Q1 → C-26-A 核可的是「延到 D3c 做」,不是不做。
// ✅ ③ ~~`/brands/<slug>` 不在 `sitemap.xml` 裡~~ **D3c-4 已補**:`lib/seo.ts` 的
//      `buildSitemapEntries` 多一個必填的 `brandSlugs`,20 頁全部進地圖(含目錄零商品那 5 家 ——
//      泛白的是入口、不是頁面本身)。`/brands` 總覽也一併進了 `STATIC_SITEMAP_PATHS`。

import type { Metadata } from 'next';
import { DEFAULT_OG_IMAGE_PATH, SITE_NAME, OG_LOCALE } from '@/lib/site-config';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { BrandRichText } from '@/components/BrandRichText';
import { BrandPageRoot } from '@/components/brand/BrandPageRoot';
import { BRAND_BY_SLUG, BRAND_CONTENT } from '@/data/brand-content';
import { brandRichTextToPlain } from '@/lib/brand-rich-text';
import { brandAsset } from '@/lib/brand-asset';
import { fetchBrandTopProducts, fetchBrandsWithProducts } from '@/lib/brand-products';
import { resolveSiteUrl } from '@/lib/site-url';
import { resolveAuthenticatedTierStrict } from '@/lib/tier';

type Props = { params: Promise<{ slug: string }> };

// ══ ⟦front-CATALOGPRICEGENERALONLY⟧ 2026-09-08 加:這一頁從此看得到會員身分 ══
//
// 經銷會員在這一頁看到的是**經銷價** ⇒ 一份跨使用者共用的靜態產物會把它發給每一個人。
//
// 🛑🛑 **這一行是【保險】, 不是在修一個已證實的洞 —— 兩件事不要混**:
//   `force-dynamic` 之前, 這一頁**也沒有**靜態產物(`prerender-manifest.json` 查無任何 `/brands` 條目,
//   那是**沒有**這一行時量的)。合理的解釋是 root layout 的 `await headers()` 讓它 bail 成 dynamic。
//   ⇒ 📌 **所以下面那個 21 是【build 期嘗試 render 的次數】, 不是【產生了 21 份靜態檔】。**
//
// 🔬 **兩個世界都量了 —— 而【我量到的到底是什麼】要講準**(codex R3 nit):
//   量到的字面 = build log 裡**堆疊行** `at p (src/app/brands/[slug]/page.tsx` 的**出現次數**。
//   · 沒有這一行 ⇒ **21 次** · 有這一行 ⇒ **0 次**。兩發路由表都印 `ƒ /brands/[slug]`、rc 皆 0。
//   ⛔ ~~「= 建置時真的去 render 了這一頁 21 次」~~ 🔴 **那是【推的】, 多跨了一層**:
//     堆疊行是**拋錯**印出來的, 一次 render 拋兩次錯就是兩行。
//     ✅ 能講的是:**沒有這一行時, 建置期會走進這支 route 的程式碼;有它就完全不走。**
//   🔵 **21 這個數字【對得上一個已知的分母】**:`BRAND_CONTENT` 實查 **21 個 slug**
//     (`npx tsx` 印 `BRAND_CONTENT len = 21`)。
//     ⛔ ~~「21 次 = 21 個 slug 各一發」~~ 🔴 **那句是推的, 不是量的**(codex 抓到):
//       **我沒有記錄每一發是哪一個 slug** ⇒ 「同一個 slug 重試兩次而另一個完全沒跑」
//       也會印 21。⇒ 📌 **對得上一個分母, 不等於一對一。**
//       要證到一對一, 得把那 21 行的 slug 抽出來去重再數 —— 我沒做。
//   🔴🔴 **而這把尺【只在沒有 env 的樹上】有判別力**:`at p (…` 是**堆疊行** ——
//     它出現的前提是那 21 發 render **全部拋錯**(`NEXT_PUBLIC_SUPABASE_URL not set`)。
//     ⇒ 🛑 **換到有 `.env.local` 的本機或 Vercel, render 會成功 ⇒ 兩個世界都印 0** ⇒ **這把尺在那裡是壞的。**
//     ⛔ ~~「換一把尺:數 `prerender-manifest.json` 的 `/brands` 條目」~~ 🔴 **那把尺也不行**(R3 nit):
//       上面自己已經記著「**沒有** force-dynamic 時 manifest 裡也沒有 `/brands` 條目」
//       ⇒ 📌 **兩個世界在那把尺上印同一個 0。** 我今天**沒有**一把在有 env 的環境成立的尺。
//
// 🛑 **不要改成靠 `cookies()` 自動判定** —— 本頁的 `cookies()` 埋在
//   `resolveAuthenticatedTierStrict()` → `getVerifiedUser()` → `lib/supabase/server.ts:33` 底下,
//   而 `lib/tier.ts` 最外層是一個 **catch-all `try/catch`**(它逐字寫著為什麼刻意不往上拋)
//   ⇒ 🔴 **`cookies()` 丟出來的東西會被那個 catch 吞掉** ⇒ 那條路不是保證, 是巧合。
export const dynamic = 'force-dynamic';

/**
 * ⚠️ **`generateStaticParams` 今天沒有實際效果**(關卡2 R1 nit 5;不要讀成「頁面已預先產好」):
 *    `app/layout.tsx` 的 root layout `await headers()`(讀 UA 判手機)⇒ 全 app 走 dynamic,
 *    `next build` 的路由表把本 route 印成 `ƒ /brands/[slug]`(= server-rendered on demand)、
 *    `.next/prerender-manifest.json` 也沒有任何 `/brands` 條目。
 *    ⛔ ~~「20 頁已預先產好」/「20 家」~~ 🔴 **數字是錯的**:`BRAND_CONTENT` 實查 **21** 家
 *      (2026-09-08 `npx tsx` 印 `BRAND_CONTENT len = 21`;repo 自己也記過 ——
 *       `data/brand-focus-data.test.ts:58` 逐字「BRAND_CONTENT 21 家、BRAND_FOCUS 仍是 20 家」)。
 *    留著的理由:①它是這條 route 的參數真相(21 家、與 `BRAND_BY_SLUG` 同一份)
 *    ②`dev-preview/brand-page/[slug]` 既有慣例
 *    ⛔ ~~③root layout 哪天不再 `headers()` 就直接生效~~ —— 🔴 **2026-09-08 起這句不成立**:
 *      上面那行 `force-dynamic` 蓋過它 ⇒ **它從此永遠不會生效**, 而那是刻意的(見上)。
 *      要讓它生效 = 先回答「經銷會員在這一頁看到的價要怎麼辦」。
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
  if (!brand) return { title: '品牌不存在 — PCM重機零件販售' };

  // 標題字面 = 設計稿 `brand-page.html:1615` 的 `document.title` 逐字(全形直豎線、非半形 |)。
  // ⚠️ 站名寫法與既有頁面(`— PCM重機零件販售`)不同 —— 那是設計稿自己的字面,
  //    全站統一**仍未做**:D5/D7 已於 2026-08-05 落地、但兩者都只動版面與配色、沒碰站名寫法
  //    ⇒ 這件事現在歸全站重設計線(`docs/handoff/2026-08-05-site-redesign-line.md`),
  //    這裡照舊不擅自翻譯(鐵則 1)。
  const title = `${brand.name} 品牌介紹｜PCM MOTOR PARTS LTD`;
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
    // 🔴 自帶 `openGraph` ⇒ **layout 那組被整組取代** ⇒ `siteName` / `locale` 要自己帶
    //   (2026-09-09 線上實測:本頁有 `og:image` 而**沒有** `og:site_name` 與 `og:locale`)。
    // 🔵 `images` 走**品牌自己的 hero**;查無品牌圖時退到站台預設,不留一條沒有圖的裸連結。
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      title,
      description,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      images: [ogImage ?? DEFAULT_OG_IMAGE_PATH],
    },
    // 🔴 同一格:`twitter` 也是整組取代 ⇒ 不自己帶的話,X 上會顯示站台 hero 而不是這家品牌的圖。
    twitter: {
      card: 'summary_large_image',
      images: [ogImage ?? DEFAULT_OG_IMAGE_PATH],
    },
  };
}

export default async function BrandPage({ params }: Props) {
  const { slug } = await params;
  const brand = findBrand(slug);
  if (!brand) notFound();
  // 🔴 撈在 `notFound()` **之後**:未知 slug 不該去打一次 RPC(而且 `brand` 為 null 時
  //    也組不出篩選鍵)。0 筆(實測 5 家)⇒ 商品區整區不渲染,不是錯誤。
  // ══ ⟦front-CATALOGPRICEGENERALONLY⟧ 路③ 品牌頁:商品區的價也要用【他看得到的那個價】══
  //
  // 🔴 **這一頁 2026-09-08 之前【沒有】傳身分** ⇒ 經銷會員在品牌頁看到的是牌價,
  //    而目錄頁 `/products` 已經是經銷價 ⇒ 📌 **同一個商品, 兩頁兩個價, 而畫面完全正常。**
  //    成因不是忘記:那時 `fetchCatalogPage` 的 `tier` 是 optional ⇒ **漏掉不會紅。**
  //    ⇒ 本片把它改成必填, 而**這一行就是那個必填抓出來的東西**。
  //
  // 🛑 **快取那一格已經在結構上關掉了, 不靠這一頁記得**:`tier === 'store'`
  //    在 `lib/products.ts` 走的是【繞過 `unstable_cache`】那條分支
  //    (守門 `lib/catalog-dealer-not-cached.test.ts`)⇒ 經銷價不會被存起來餵給下一個一般會員。
  //    ⚠️ 而**本 route 自己的頁面輸出**由檔頭的 `export const dynamic = 'force-dynamic'` 擋
  //    (那一行是本片加的, 量測寫在它旁邊)。
  //    🛑 **不要改成靠 `cookies()` 自動判定** —— 本頁的 `cookies()` 埋在
  //    `resolveAuthenticatedTierStrict()` → `getVerifiedUser()` → `lib/supabase/server.ts:33` 底下,
  //    而 `lib/tier.ts` 最外層是一個 **catch-all `try/catch`**(它逐字寫著為什麼刻意不往上拋)
  //    ⇒ 🔴 **`cookies()` 丟出來的東西會被那個 catch 吞掉** ⇒ 那條路不是保證, 是巧合。
  const tierStrict = await resolveAuthenticatedTierStrict();
  // 🔴 身分解析失敗 ⇒ 退 `general` 且**不往上拋**(`lib/tier.ts` 刻意的)。
  //    ⇒ 一個 `customers.tier` 讀取逾時的經銷會員, 在這一頁會拿到**牌價**, 而畫面正常。
  //    ✅ 這裡不改 fail-closed(那是替全客群新增單點故障去救今天 0 人的族群, 同 `/products` 的判斷),
  //       只把【代價】印進 log —— 原本的 log 只說「退化 general」, 沒說那會影響價格。
  //    🟢🟢 **[2026-09-08 Sean 拍甲, 這不再是「執行端的判斷」, 是拍板]** 逐字:
  //       「① 身分查不到的時候要給牌價還是錯誤頁    **給牌價**」
  //       (題目 `~/pcm-mailbox/front-003-Q.md`;完整理由與射程在 `app/products/page.tsx` 同一段, 那是正本)。
  //    🛑 **⇒ 不要把這一段順手改成 fail-closed** —— 那會推翻一個拍板, 而且會讓這一頁與 `/products` 分岔。
  if (!tierStrict.ok && tierStrict.reason === 'tier') {
    console.error(
      '[brands] 身分解析失敗、退化 general ⇒ 🔴 這一頁的商品價會用牌價算。'
        + ' 這個人是【已登入】的 ⇒ 他可能是經銷會員, 而畫面上看不出來。',
      { path: `/brands/${slug}` },
    );
  }
  const [topProducts, availability] = await Promise.all([
    fetchBrandTopProducts(brand.slug, tierStrict.tier),
    fetchBrandsWithProducts(),
  ]);

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
      <BrandPageRoot brand={brand} products={topProducts.products}
      productsLoadFailed={topProducts.loadFailed} availableSlugs={availability.slugs} loadFailed={availability.loadFailed} />
      {/* 頁尾標語 = 這家品牌自己那一句(設計稿 `:1510-1512` 註解 + `:2029` 灌值)。
          `slogan` 是 BrandRichString、實際含 `<br>` ⇒ 走 BrandRichText;不給 `as`
          回 Fragment ⇒ DOM 與設計稿的 `<p class="ed-footer-tagline">…</p>` 逐節點相同。 */}
      <HomeFooter tagline={<BrandRichText>{brand.slogan}</BrandRichText>} />
    </div>
  );
}
