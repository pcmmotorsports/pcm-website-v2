// app/brands/page.tsx — 品牌總覽**正式 route**(D3c-3;2026-08-05)
//
// 這條 route 自 D2b 起就被三個地方指著、但一直不存在(= 死連結):品牌頁麵包屑第二段、
// 站台 Header 的「品牌」navItem、頁尾「品牌專區」。本片先把 route 生出來,
// **sitemap 已於 D3c-4 補、三個消費端的收口仍未做**(見檔尾「刻意沒做」)。
//
// 版面全部在 `components/brand/BrandDirectoryRoot.tsx`(組裝點 + `.bd-page` 色票 scope);
// 本檔只負責 metadata、站台殼、以及撈「哪幾家有商品」。與 `app/brands/[slug]/page.tsx` 同型。
//
// 🔴 `<Header currentPage="brands">` —— 對上設計稿 `brand-directory.html:103` 把「品牌」那顆
//    標成 `is-active`。
//    ⚠️ 本檔第一版寫「加第三種 = 動共用元件 props 介面(鐵則 12 ⑥)所以延到下一片」,
//       那個前提是**假的**(關卡2 R1 must-fix 2 實查推翻):`Header.tsx` 的型別是
//       `currentPage?: string`(不是兩個值的 union),而 `navItems` 裡本來就有 `{ id: 'brands' }`
//       ⇒ 傳這個字串是**零介面改動**。而且 `'brands' !== 'home'`,「依車輛搜尋」那條分支
//       (只判 `=== 'home'`)不受影響。
//    ⚠️ 仍留給下一片的是**那顆的 href**:目前指 `/products`(Q4-S5 當年為了避開 404 改的),
//       改指 `/brands` 會動到全站每一頁的導覽目的地 + `Header.test.tsx` 的對照表
//       ⇒ 與麵包屑、頁尾一起收比較安全。
//
// 🔴 頁尾標語 = 設計稿 `:143` 這一頁自己那句(「標語每頁不同」是 Sean 2026-08-02 的拍板,
//    設計稿 `:142` 逐字記著)⇒ 不用 `HomeFooter` 的預設。

import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { HomeFooter } from '@/components/HomeFooter';
import { BrandDirectoryRoot } from '@/components/brand/BrandDirectoryRoot';
import { fetchBrandsWithProducts } from '@/lib/brand-products';
import { resolveSiteUrl } from '@/lib/site-url';

// 標題與描述 = 設計稿 `brand-directory.html:6-7` 逐字(全形直豎線、非半形 |;同 `[slug]` 那支)。
const TITLE = 'PCM MOTOR PARTS LTD.｜品牌總覽';
const DESCRIPTION = '依品牌找部品，直接查看 PCM MOTOR PARTS LTD. 各品牌商品。';

export async function generateMetadata(): Promise<Metadata> {
  const base = resolveSiteUrl();
  const canonicalUrl = base ? `${base}/brands` : undefined;
  return {
    title: TITLE,
    description: DESCRIPTION,
    ...(canonicalUrl ? { alternates: { canonical: canonicalUrl } } : {}),
    openGraph: {
      type: 'website',
      title: TITLE,
      description: DESCRIPTION,
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
    },
  };
}

export default async function BrandDirectoryPage() {
  // 🔴 撈取失敗 → 空集合(fail-closed)⇒ 20 家全部泛白。反過來(失敗全放行)會在 DB 一抖時
  //    把空入口全放出去,那正是這條線在修的東西。
  //    ⚠️ **保證住在哪要寫準**(關卡2 R1 nit 更正:本檔第一版寫「`brand-products.ts` 那支
  //    自己保證」是不準的):`fetchBrandsWithProducts` 本身**沒有** try/catch,
  //    fail-safe 在它下游的 `fetchCatalogBrandTaxonomy`(`lib/products.ts`,catch 回 `[]`)。
  //    ⇒ 那一層哪天改成往上 throw,本頁會整頁 500 而不是全泛白。
  const availableSlugs = await fetchBrandsWithProducts();

  return (
    <div data-screen-label="品牌總覽">
      <Header currentPage="brands" />
      <BrandDirectoryRoot availableSlugs={availableSlugs} />
      <HomeFooter tagline={<>為每一趟騎乘，<br />找到對的部品。</>} />
    </div>
  );
}

// **仍未做的三件事**(全部有主;不是漏掉。⚠️ 這張清單每次有人動到相關檔案就要回頭改 ——
//  D3c-4 的關卡2 R1 就是抓到它整段過期)
// 🔴 ① **三個消費端仍指著舊目的地**:`BrandPageHeader.tsx` 的麵包屑、站台 `Header` 的「品牌」
//      navItem(仍指 `/products`)、`HomeFooter` 的「品牌專區」(仍指 `/products`)。
//      ⇒ **現況是 `/brands` 進了 sitemap、站內卻幾乎沒有入口**(D3c-4 R1 點名)。屬 D3c-5;
//      拆出去的理由是 Header 那顆改 href 會動到**全站每一頁**的導覽目的地 + `Header.test.tsx`
//      的對照表,值得自己一片自己驗。本片已做的只有 `currentPage="brands"` 的 highlight。
// 🔴 ② `#314` 的 client redirect(`/products?pbrand=X#brand-about` → `/brands/<slug>`)仍未做。
// ✅ ③ ~~`/brands` 與 `/brands/<slug>` 不在 `sitemap.xml`~~ **D3c-4 已補**(總覽進
//      `STATIC_SITEMAP_PATHS`、20 個介紹頁由 `buildSitemapEntries` 的 `brandSlugs` 產生)。
// ⚠️ ④ 設計稿 hero 那面 logo 牆在**視窗很矮**時會被 `.bd-hero-inner` 的內容擠出可視範圍嗎 ——
//      設計稿沒有處理,本片照搬、未加保護;真瀏覽器實測記在收工信。
