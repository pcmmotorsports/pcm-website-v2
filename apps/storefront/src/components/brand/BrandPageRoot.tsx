// BrandPageRoot.tsx — 品牌介紹頁的組裝點 + `.bp-page` 色票 scope(D3a;2026-08-04)
//
// 🔴 **為什麼是一支元件、而不是在 route 裡寫 `<main className="bp-page">`**:backlog #314 的
//    「`.bp-page` scope 上機制、不靠人記」那條前置(`docs/phase-1-backlog.md:8403`)逐字建議的
//    就是「抽一個 `BrandPageRoot` wrapper 讓 scope 跟元件走」。
//    整頁色票(熔橘 `--c-red` / `--cat-*` / 全套灰階 / `--f-serif` / `--ease`)都掛在 `.bp-page` 上
//    —— 那是刻意的,因為 `--c-red` 在正式站 `tokens.css` 已存在且值不同,改 `:root` 會讓現有
//    每一頁的按鈕與價格當場變色(理由逐字寫在 `styles/brand-page.css` 檔頭)。
//    但原本那個 class 由**呼叫端手寫**:漏掛時只有 `--c-graphite` 與 chip 的 `--c-border-control`
//    兩處有 fallback,其餘整組沉默降級 —— 三綠、CSS 守門、八支元件測試**全部不會紅**。
//    把 class 與 `brand-page.css` 的 import 綁進同一支元件 ⇒ **拿得到樣式就一定有 scope**,
//    「漏掛」從「要記得」變成「做不到」。八支 `bp-*` 元件各自的 CSS import 一併收斂到這裡。
//    🔴 但收斂本身也造出一個新的單點:**這支的 import 被刪掉時,整頁裸奔而全套測試照樣綠**
//    (關卡2 R1 must-fix 1 實測:刪掉下面那行 CSS import → 11 檔 180 測全過。不寫行號 ——
//     自我指涉的行號每次編輯就過期,同 `BrandPageHeader.tsx` 檔頭記過的教訓)。
//    ⇒ `BrandPageRoot.test.tsx` 另有一條**讀原始碼**的守門,兩個方向都釘:「本檔必須有」
//      與「其餘 `src/**` 必須沒有」;兩個方向各自用突變驗過會紅。
//    ⚠️ **它擋不住什麼**(關卡2 R2 must-fix 1 的教訓:第一版把路徑釘在 `@/styles/` 別名上,
//      改用相對路徑就整條失效 —— 而相對路徑正是本 repo 的主流寫法):現行版本認的是
//      「路徑以 `brand-page.css` 結尾」的 side-effect import(.ts/.tsx)與 `@import`(.css),
//      掃描面 = `apps/storefront/src/**`。**`packages/ui` 與動態 import 不在掃描面內。**
//
// 🔴 **這裡同時是整頁標題大綱唯一的組裝點。** `BrandPageHeader.test.tsx` 檔尾原本記載
//    「正式路由要到 D3 才有,測試裡自己排一次會與真實頁面各自漂移 ⇒ 拆成七支局部不變式」——
//    D3a 之後那個前提消失了:`BrandPageRoot.test.tsx` 直接 render 本元件驗大綱。
//    ⚠️ **它的能力有邊界**(關卡2 R1 nit 7 更正:我原本寫成「新增第 8 支不必補不變式」):
//    現行大綱是 `h1 → {h2,h3}*`,新區塊若以 `<h2>` 開頭,**大綱仍合法、測試仍綠** ——
//    真正被它攔下的是「以 `<h3>` 起頭」那一類(例如在 About/Media 裡插 `<h3>`,h1 直接接 h3)。
//    七支局部不變式因此保留:它們定位更精準,兩層是刻意冗餘、不是重複。
//
// route 殼(`app/brands/[slug]/page.tsx`)只負責 `<Header>` / metadata / 404;
// 站台 Header 與 Footer 不進本元件 —— 設計稿 `brand-page.html:1327` / `:1506` 是站台層的東西,
// 而 dev-preview 那支裸頁也還要能單獨掛本元件。
//
// 🔴 `<main>` 不是 `<div>`:設計稿 `brand-page.html:1354` 的 `<main>` 恰好包住麵包屑(`:1356`)
//    到磚牆(`:1504`)這一段 —— 與本元件的範圍逐節點對齊(鐵則 1 直接搬)。站台其他頁
//    (`ProductPage.tsx:160`、`ProductsPage.tsx`、`CartView.tsx` …)也都有 `main` landmark。

import '@/styles/brand-page.css';
import type { BrandContent } from '@/data/brand-content-types';
import type { MockProduct } from '@/data/mock-products';
import { BrandPageHeader } from '@/components/brand/BrandPageHeader';
import { BrandPageAbout } from '@/components/brand/BrandPageAbout';
import { BrandPageWhy } from '@/components/brand/BrandPageWhy';
import { BrandPageCraft } from '@/components/brand/BrandPageCraft';
import { BrandPageTimeline } from '@/components/brand/BrandPageTimeline';
import { BrandPageCategories } from '@/components/brand/BrandPageCategories';
import { BrandPageProducts } from '@/components/brand/BrandPageProducts';
import { BrandPageBrandWall } from '@/components/brand/BrandPageBrandWall';

/**
 * `products` 由**呼叫端撈好傳進來**(`lib/brand-products.fetchBrandTopProducts`),本元件保持同步。
 * 🔴 理由不是風格:async server component 進不了 @testing-library 的 `render`,
 *    而本元件是整頁大綱與 `.bp-page` scope 兩道守門唯一的渲染入口 —— 讓它變 async
 *    等於把那兩道守門一起弄不能跑。撈資料本來也是 route 的責任(Next.js 慣例分工)。
 * 空陣列 = 該品牌目前零商品(20 家裡實測 5 家)⇒ `BrandPageProducts` 自己整區不渲染。
 */
export function BrandPageRoot({
  brand,
  products,
  availableSlugs,
}: {
  brand: BrandContent;
  products: MockProduct[];
  /** 目錄裡真的有商品的品牌 slug —— 磚牆用它決定哪幾磚泛白不可點(Sean 08-04 拍板)。 */
  availableSlugs: ReadonlySet<string>;
}) {
  return (
    <main className="bp-page">
      <BrandPageHeader brand={brand} />
      <BrandPageAbout brand={brand} />
      <BrandPageWhy brand={brand} />
      <BrandPageCraft brand={brand} />
      {/* timeline 只有 2 家有(akrapovic / gb-racing)⇒ 條件渲染,同 About 的影片右欄 */}
      {brand.timeline && <BrandPageTimeline timeline={brand.timeline} />}
      <BrandPageCategories brand={brand} />
      {/* 商品區位置 = 設計稿骨架 `:1470-1489`(分類與磚牆之間)。0 筆時本元件回 null。 */}
      <BrandPageProducts brand={brand} products={products} />
      <BrandPageBrandWall currentSlug={brand.slug} availableSlugs={availableSlugs} />
    </main>
  );
}
