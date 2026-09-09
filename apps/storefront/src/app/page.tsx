// app/page.tsx — 首頁(8 sections compose)
//
// 對齊 design-reference/components/HomePage.jsx @ 25d3a2a 字面(M-1-04-mini-slice 修:25d3a2a HomePage.jsx 加 tier prop、storefront 走 server-side cookie + designTierToSchema + tierLabel 預算 conceptually 更佳、不重做):
//   <Header /> + <HomeHero>(內含 <VehicleFinder /> 入口板;H5 起 dock 化)</HomeHero> + <FeatureEditorial />
//   + <CategoryGrid /> + <HomeSelect /> + <HomeStatement /> + <BrandIndex /> + <HomeFooter />
//
// page.tsx 本身為 server component(無 'use client'、不傳 callback prop);8 sections + Header + ProductCard
// 各自 'use client'(因 design 字面全含 onClick callback、Next.js server component 不可傳 function)。
// 此偏離 d1 指令 Step 4.2 字面「HomeHero / FeatureEditorial / HomeStatement / HomeFooter Server Component」
// 是 design 字面 vs Next.js 16 server-client boundary 衝突的 trade-off、commit body 揭示。
//
// d2 揭示(2026-05-09):N°02 最新商品區真資料 server-side fetch、HomeSelect 接 props.featured(FeaturedResult
// = MockProduct[] + error flag)、priceByTier server-side strip 在 lib/products.ts toUIProduct 落實。
// 真實狀態:Supabase products 表 0 row(M-1-16 種子前)、HomeSelect 必走 Q-empty=b 分支。

import type { Metadata } from 'next';
import { resolveSiteUrl } from '@/lib/site-url';
import { Header } from '@/components/Header';
import { HomeHero } from '@/components/HomeHero';
import { VehicleFinder } from '@/components/VehicleFinder';
import { FeatureEditorial } from '@/components/FeatureEditorial';
import { CategoryGrid } from '@/components/CategoryGrid';
import { HomeSelect } from '@/components/HomeSelect';
import { HomeStatement } from '@/components/HomeStatement';
import { BrandIndex } from '@/components/BrandIndex';
import { HomeFooter } from '@/components/HomeFooter';
import { HomeReveal } from '@/components/HomeReveal';
import {
  CATEGORY_TAXONOMY_UNAVAILABLE,
  TaxonomyNotice,
} from '@/components/products-message-state';
import { fetchFeaturedProducts, tryVehicleTaxonomy, tryCategories } from '@/lib/products';
import { fetchBrandsWithProducts } from '@/lib/brand-products';
import { BRAND_CONTENT } from '@/data/brand-content';
import { BRAND_FOCUS } from '@/data/brand-focus';
import { resolveBrandFocus } from '@/lib/brand-focus';
import { resolveTierFromRequest } from '@/lib/tier';
import { getVerifiedUser } from '@/lib/auth/verified-user';
import { getVehicleRepo } from '@/lib/auth/composition';

// d2 build 揭示:本頁 server-side fetch Supabase、build 階段預生成 SSG 會撞 env 未注入
// (build worker 不讀 monorepo root .env.local、`createSupabaseAnonClient` requireEnv throw)。
// 改 force-dynamic = SSR 每次 render 重撈、對齊 Phase 1 dev project 階段「真資料動態」精神。
// Production Vercel deploy 時 env 從 dashboard 注入、build/runtime 都 OK。
// 未來考慮 ISR(`export const revalidate = N`)平衡 latency vs 即時性、待 M-1-XX trigger。
export const dynamic = 'force-dynamic';

// D5e-2(R1 nit):`?focus=<slug>` 讓首頁多出 20 種可被索引的網址變體,內容幾乎相同
// ⇒ 宣告 canonical 指回站台首頁,把權重收斂到同一個入口、避免被當成重複內容。
// 🔴 **未設 `NEXT_PUBLIC_SITE_URL` 的 production 一律不發 canonical**(R2 F3:第一版無條件發,
//    與既有慣例不一致)。理由照 `lib/site-url.ts` 檔頭逐字:prod 未設時 `metadataBase` 缺席,
//    相對 canonical 會落到框架預設基底 ⇒ **可能讓 Google 索引到 localhost**,寧缺勿錯。
//    形狀與 `app/brands/[slug]/page.tsx` 那顆一致(有 base 才發、絕對網址)。
// 🔴 只加 `alternates`、**不碰 `title`/`openGraph`**:`layout.tsx` 檔頭記過
//    「Next metadata 對 `openGraph` 是 shallow merge,頁級自帶會整組取代站台級」
//    ⇒ 這裡多寫一個 `openGraph` 會把站台級那組整包蓋掉。
const siteBase = resolveSiteUrl();
export const metadata: Metadata = {
  ...(siteBase ? { alternates: { canonical: siteBase } } : {}),
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // tier 解析:?tier= override(僅 dev,env flag `PCM_DEV_TIER_OVERRIDE=1`)> **登入身分** > 'general'
  // 邏輯在 @/lib/tier resolveTierFromRequest(M-1-13e-pre-1、Sean Q1=B 業務拍板:
  // 金額頁面必須區分會員、helper 立即抽、不等第 3 處撞 trigger)
  // 🔴 `#215`(2026-08-23):~~cookie `pcm-tier`~~ 那條路已移除 —— 它是 client 可偽造的,
  //    而全 repo 零 production 寫入端。tier 現在只來自 `getUser()` → `customers.tier`。
  const params = await searchParams;
  // ~~⚠️ 已知成本(刻意不修):登入者會跑到兩次 getUser();不合併的理由是安全 ——
  //    合併要把 user 當參數餵進 resolveTierFromRequest, 而那正是本片剛修掉的形狀~~
  // 🔴 **那是一個假二選一(codex R2 nit 抓到,2026-08-23 當天)**:第三條路存在 ——
  //    把「去拿一個**經過驗證**的 user」本身做成 request-scoped 快取
  //    (`@/lib/auth/verified-user` 的 `getVerifiedUser`,`cache()` 來自 react;
  //     本 repo `lib/products.ts` 已在用同一個慣例)。
  //    ⇒ **信任來源沒有變**(仍是 `getUser()` 向 Auth 驗 token),只是同一個 request 內不重問。
  //    📌 留痕不刪:那是「我把自己的限制當成世界的限制」的標本 —— 而找到第三條路的是
  //       一個沒有我脈絡的人。
  // 🔴 **codex R5 nit:不要先 await 它。** 它內含一次 Auth 往返 ⇒ 放在這裡等於把
  //    「認證」與「首頁三段查詢」**串起來**(量化例:Auth 300ms + 資料 400ms ⇒ TTFB ≈ 700ms)。
  //    ⇒ 改成丟進下面那個 `Promise.all` 一起跑。`getVerifiedUser` 是 request-scoped 快取,
  //      所以它與 garage 那一段**共用同一次**已驗證身分,不會變成兩次往返。
  // 🔬 **[2026-09-09 · Sean 拍甲:「先量一次【客人第一次進來、沒有快取的那一發, 六件事各多久】」]**
  //   受詞:`⟦search-TAXONOMYPERREQ⟧` / plan §10.6b —— 要答的是**哪一件是最慢的那一件**,
  //   **不是**「總共多久」。理由:下面那個 `Promise.all` 等的是【最慢的那一件】,
  //   ⇒ 把車款樹移出關鍵路徑(候選 c′)只有在它就是最慢那一件的時候才省得到客人的時間。
  //   🔴 而在本片之前, 首頁**沒有**逐項計時 ⇒ 那一題結構上答不了(`git grep homeRoute` ⇒ 0)。
  // 🛑 **只印毫秒與筆數** —— 不印分類名、不印品牌名、不印任何客人給的字串。
  //   (與 `/products` 的 `[catalogRoute]` 同一條紀律, 見 `products/page.tsx` 檔內那段註解。)
  // ⚠️ **`mark` 這 6 行與 `products/page.tsx` 重複, 是刻意的** —— 抽成共用 util 要動那支
  //   【正在擋上線的查詢路徑上】的檔, 而本片只是加一支儀器。重複 6 行比那個風險便宜。
  const marks: Record<string, number> = {};
  const mark = <T,>(name: string, promise: Promise<T>, started = performance.now()): Promise<T> =>
    promise.then((value) => {
      marks[name] = Math.round(performance.now() - started);
      return value;
    });
  // 🔴 `tier` 的碼在 `Promise.all` 【之前】就把 promise 建好了 ⇒ 從 `Promise.all` 那裡起算會
  //   **低報它**。所以它的起點單獨釘在這裡, 不吃 `mark` 的預設值。
  const tierT0 = performance.now();
  const tierPromise = resolveTierFromRequest(params);

  // 三段互不依賴 → Promise.all 並行(perf/P2:原逐一 await 串行、跨區延遲三段相加是首頁
  // TTFB 主因之一;三函式的 adapter 查詢錯誤各自 catch 回 fallback → Promise.all 收到的是
  // resolved fallback 非 rejection。client 建構(env 缺)在 try 外會 throw——舊串行版同炸、非本片新增語意)。
  // - featured(perf/P3 釘 general、unstable_cache 60s):不再收 tier——public view 的
  //   store/premiumStore 價是 dummy 0、傳真 tier 會顯 NT$0 錯價,且 tier 變體不得進共用快取
  //   (plan §P3 明示語意變更;真 tier 定價待 #215)。tier 仍寫進 data-tier 供 dev DOM inspector debug。
  // - motoBrands(S2/#220b):VehicleFinder 接真 fitment 衍生車輛清單(輕量 fitments-only 查詢、
  //   失敗回 []);與 /products 解析端同一衍生函式 = 首頁選車深連結 id 空間一致、必命中列表過濾
  // - categories(Q4-S5):CategoryGrid 真分類化(修「首頁分類卡點了無過濾」死連結;同 /products
  //   側欄的 fetchCategories→buildCategoryTree,只列有商品分類、深連結 ?category=<真分類名> 必命中過濾)
  // - garage(V-1c):登入會員愛車 chips(RLS vehicles_*_own 守自己 row;未登入/讀取失敗
  //   → [] chips 整排不顯示、頁面不 500;本頁已 force-dynamic=零額外快取語意變更;
  //   ~~🔴 動態性改由 resolveTierFromRequest 內讀 session cookie 帶來,那條路被拿掉就會消失~~
  //   **這句是錯的(codex nit;當天寫、當天被抓)**:本頁檔頭有 `export const dynamic = 'force-dynamic'`
  //   ⇒ **動態性不依賴任何讀 cookie 的路徑**。留痕不刪 —— 它是「順手補一句解釋,而那句沒被驗過」的標本)
  // - brandsWithProducts(D3c-2):目錄零商品的品牌在 BrandIndex 那一排泛白且不可點
  //   ⚠️ 線E 起它裝的是 `{ slugs, loadFailed }` 而不只是那個集合 —— **名字比內容窄了**
  //   (code-reviewer 2026-08-28 Minor)。刻意不改名:那會動到本檔 `Promise.all` 的解構順序
  //   與下面兩處引用, 而本片的範圍是「失敗態說話」⇒ 改名記在這裡, 不夾帶。
  //   (Sean 拍板 `C-31-A`,主視窗 `C-33-A` 裁示首頁比照品牌頁磚牆)。
  //   🔴 撈取失敗回**空集合**=全部當成沒商品(fail-closed,`brand-products.ts` 那支自己保證)
  //   ⇒ 本頁不需要另包 try/catch;反過來(失敗全放行)會在 DB 一抖時把空入口全放出去。
  //   ⚠️ 資料源 `fetchCatalogBrandTaxonomy` 與 `/products` 側欄**共用** `unstable_cache`
  //   鍵(`catalog-brand-taxonomy-v1`,60s + tag `catalog`)⇒ 熱路徑零額外 DB round-trip、
  //   與另四支並行 ⇒ 對本頁 TTFB 幾乎沒有影響。代價是「上架後恢復可點」最長延遲 1 分鐘
  //   (`revalidateTag('catalog')` 尚未接,`lib/products.ts:135`)。
  const [tier, featured, vehicleTax, categoryTax, garage, brandsWithProducts] = await Promise.all([
    mark('tier', tierPromise, tierT0),
    // H6 連動(Sean 2026-08-06 拍板、`D-132-A` 更正):取數提高到 `FEATURED_LIMIT`,
    // 讓 OD 的 5 格橫捲真的捲得動;**會員中心「為你推薦」共用同一個數字、一起變多**。
    mark('featured', fetchFeaturedProducts()),
    // 🔴 2026-09-06(Sean 拍甲 · ⟦search-TAXONOMYTIMEOUT⟧):改走【帶 `failed` 的那扇門】。
    //   `tryVehicleTaxonomy` 一直都在, 而在本片之前它【一個外部消費端都沒有】——
    //   `fetchVehicleTaxonomy` 逐字「刻意丟掉 failed」⇒ 讀不到與真的沒有印同一個空陣列。
    mark('tax', tryVehicleTaxonomy()),
    // 🔴 2026-09-06(⟦search-SILENTDOORS2⟧, plan `docs/plans/2026-09-06-silent-doors-2-plan.md`):
    //   與車款那一扇同一個形狀 —— 走【帶 `failed` 的那扇門】, 讓「讀不到」與「真的沒有」分開。
    mark('cats', tryCategories()),
    mark('garage', (async () => {
      try {
        // `#215`:與上面的 tier 共用同一次【已驗證】身分(request-scoped),不重跑一次 Auth。
        const { user } = await getVerifiedUser();
        if (!user) return [];
        // 序列化面收窄:chips 只需 id/name/year(engine/km/mods 等不進 client props;皆為
        // 本人 own 資料、此為最小面原則非洩漏修補)
        const vehicles = await (await getVehicleRepo()).listByCustomer(user.id);
        // V-1d:dict 欄一併投影(chips 精確 lookup 快路徑;仍為窄投影、不整台 CustomerVehicle 序列化)
        return vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          year: v.year,
          dictBrandName: v.dictBrandName,
          dictModelName: v.dictModelName,
          isPrimary: v.isPrimary,
        }));
      } catch (garageError) {
        console.error('[home] 愛車清單讀取失敗、chips 退化不顯示:', garageError);
        return [];
      }
    })()),
    // ⚠️ 位置就是行為:這一項必須排在上面那個 IIFE **之後**,才對得上解構的第 5 個名字。
    mark('brands', fetchBrandsWithProducts()),
  ]);
  // 🔵 **解構在這裡, 讓下游一個字都不用改** —— 本片要的是【多一個 `failed`】,
  //   不是改寫每一個既有的 `motoBrands` 讀取點。
  const motoBrands = vehicleTax.motoBrands;
  const vehicleTaxonomyFailed = vehicleTax.failed;
  const categories = categoryTax.categories;
  const categoryTaxonomyFailed = categoryTax.failed;

  // 🔬 **[2026-09-09 · 那一發量測]** 六件各多久 + **哪一件是最慢的那一件**。
  // 🔴 `slowest` 直接印出來, 而不是讓讀的人自己比六個數 —— 那正是這一題要答的東西,
  //   而「六個數擺在那裡」與「答案」之間隔著一次人工比較, 那一步會出錯。
  // 🔵 **怎麼分辨這一發是不是 cold**:同一個請求裡 `products.ts` 會另外印一行
  //   `[vehicleTaxonomy] cold n=… ms=…`。⇒ **在 Vercel 依 requestId 把兩行湊起來**;
  //   沒有那一行 = 車款樹命中快取。🛑 **不要拿 `tax=` 大不大去猜**, 那是倒過來用結論。
  // ⚠️ **本行答不出**:六件裡除了 `tax` 之外, 哪幾件自己也有快取、這一發是不是它們的 cold。
  // 🔵 **`featured` 與 `brands` 沒有筆數** —— 它們回的不是陣列(`FeaturedResult` / `BrandAvailability`),
  //   而那是 typecheck 告訴我的, 不是我本來就知道的。**六個 `ms=` 才是這一題要的東西, 筆數只是佐料。**
  const slowest = Object.entries(marks).sort((a, b) => b[1] - a[1])[0];
  console.info(
    `[homeRoute] tier=${marks.tier ?? -1}ms featured=${marks.featured ?? -1}ms ` +
      `tax=${marks.tax ?? -1}ms cats=${marks.cats ?? -1}ms garage=${marks.garage ?? -1}ms ` +
      `brands=${marks.brands ?? -1}ms slowest=${slowest?.[0] ?? 'none'}:${slowest?.[1] ?? -1}ms ` +
      `motoBrandsN=${motoBrands.length} catsN=${categories.length} garageN=${garage.length} ` +
      `taxFailed=${vehicleTaxonomyFailed}`,
  );

  // D5e-1:本月聚焦當期是誰。純資料 + 日期,零 IO ⇒ 不進上面的 Promise.all。
  // 🔴 `new Date()` **只在這裡呼叫一次**,`lib/brand-focus.ts` 內部一律不碰時鐘 ——
  //    量時間的東西最容易寫成測不動的樣子,把時鐘留在最外層、決策函式收 `now` 參數,
  //    測試才有辦法給定日期取得定值答案。
  // 🔴 本頁有 `export const dynamic = 'force-dynamic'`(檔頭那一行)⇒ 每次請求重新求值,
  //    輪播**不會被 build 凍住**。若日後改 ISR(檔頭註解提過的那個未來選項),
  //    `revalidate` 必須 < 一天,否則會卡在某一期。
  //    (不引行號:R1 must-fix —— 第一版寫 `:37`/`:36`,實為 `:40`/`:39`。R2 補正:那兩個數字
  //     在寫下的當下可能是對的,是被本片自己加的 3 行 import 推移掉的 —— 這正是不引行號的理由。)
  // D5e-2:`BRAND_FOCUS_PIN` 已移除(20 家文案齊了,輪播真的轉起來),改用網址預覽
  // `?focus=<slug>`(OD handoff §八逐字建議「用 search param 而不是寫死,方便 Sean 自己驗」)。
  // 🔴 這顆**只是換一家顯示、不寫入任何東西**,而且 slug 打錯時 `resolveBrandFocus` 退回輪播、
  //    不是讓版位消失 ⇒ 對外開著沒有風險面,不必加旗標。
  // ⚠️ 同名參數重複(`?focus=a&focus=b`)時 Next 給的是陣列 ⇒ 只認字串、其餘一律當沒給,
  //    不取 `[0]`(那會讓「餵一個陣列進來」變成一條沒人測過的路徑)。
  const focusOverride = typeof params.focus === 'string' ? params.focus : undefined;
  const focus = resolveBrandFocus({
    brands: BRAND_CONTENT,
    overlays: BRAND_FOCUS,
    now: new Date(),
    override: focusOverride,
  });

  return (
    <div data-screen-label="Home" data-tier={tier} className="ed-page">
      <Header currentPage="home" />
      {/* 🔴 H5(D6):選車器由「hero 之後的獨立 section」改成**巢狀在 hero 內的入口板**
          (OD 骨架 :816-836)。以 children 傳入而不是讓 `HomeHero` 自己 import ——
          `HomeHero` 本片轉成 client component,而選車器要吃 server 端算好的車輛字典與車庫,
          從這裡傳進去,那些資料就仍然在 server 算(**沒有讓任何一塊多轉 client**)。 */}
      <HomeHero>
        <VehicleFinder
          motoBrands={motoBrands}
          garage={garage}
          vehicleTaxonomyFailed={vehicleTaxonomyFailed}
        />
      </HomeHero>
      {/* D5a(2026-08-05):區塊順序改照 OD `README.md`「區塊順序(第 7 步之後)」定案 ——
          N°01 Hero+選車器 / N°02 最新商品 / N°03 部品分類 / N°04 服務宣言(深) /
          N°05 本月聚焦 / N°06 授權代理(淺灰白) / 頁尾(深)。
          節奏 = 白/白/深/白/淺灰白/深,**沒有任何兩塊深色相鄰**(README 第 7 步「深色減重」的結論)。
          實際只動兩個位置:最新商品由第 5 上移、本月聚焦由第 3 下移。
          🔴 編號是**位置標記不是內容 id**(README 逐字)⇒ 聚焦與服務對調後編號跟著位置走。
          守門 = `app/page.test.tsx`(本片新建;在那之前首頁順序**零守門、改了不會紅**)。 */}
      <HomeSelect featured={featured} />
      {/* 🔴 2026-09-06 ⟦search-SILENTDOORS2⟧:分類讀不到 ⇒ 講一句;真的沒有 ⇒ 什麼都不說。
          🔵 **這裡直接渲染, 不像車款那扇多傳一個 prop** —— 車款那句要住在 dock 裡面(選車那一區),
          而分類這一句貼在分類區上方就對了 ⇒ **不必為它改 `CategoryGrid` 的介面**。
          📌 兩處做法不同是有理由的, 不是不一致。 */}
      <TaxonomyNotice failed={categoryTaxonomyFailed} message={CATEGORY_TAXONOMY_UNAVAILABLE} />
      <CategoryGrid categories={categories} />
      <HomeStatement />
      {/* D5e-1:本月聚焦改資料驅動 + 每 3 天輪播。`focus` 為 `null`(可用品牌清單為空)
          時整段不渲染 —— 版位空著比渲染一個沒有內容的殼好。
          🔴 這一面有守門接著:`app/page.test.tsx` 的「八個 section 都在」是**前提斷言**,
             真的變 null 的話那條會紅、不會靜默少一段。 */}
      {focus && <FeatureEditorial focus={focus} />}
      <BrandIndex availableSlugs={brandsWithProducts.slugs} loadFailed={brandsWithProducts.loadFailed} />
      {/* 🔴 D-136 清尾片(2026-08-06):**首頁**頁尾標語走 OD 字面「專業重機零件・改裝精品/一站式服務」。
          OD 頁尾自帶註解逐字說明理由:「這裡原本是『改裝不只是升級配件,是風格與態度的延伸』,
          但那句已經升上 hero 當主標了,同一頁講兩次會稀釋掉它。改放服務範圍。」
          🔴 只改**這一頁**、走 D3a 的 `tagline` prop:OD 另外 13 支頁稿全部逐字保留那句當預設值
             (`products-list-handoff.md` 逐字「首頁=服務範圍句、其他頁=預設句」)⇒
             改 `HomeFooter` 的預設值會一次動到 24 個掛載點、把 15 頁改成反向偏離 OD(R1 MF1 擋下的第一版)。
          守門在 `app/page.test.tsx`(字面 + 不得與 hero 主標重複),不在 `HomeFooter.test.tsx`
          —— 這是**首頁**的不變量,不是那顆共用元件的。 */}
      <HomeFooter tagline={<>專業重機零件・改裝精品<br/>一站式服務</>} />
      {/* D5g:捲動進場控制器。**不 render 任何東西、不包住任何 children**(回 null)——
          **`HomeReveal` 沒有讓任何一塊多轉 client**
          (handoff §6-4 逐字「不要為此把整個資料渲染改成 client」)。
          ⚠️ 措辭更正(R2 must-fix):原本這裡寫「五個區塊全部維持 server component」是**假的**。
          ⚠️ **再更正(2026-08-07 R-1)**:上一版把它改寫成「`HomeSelect.tsx:15` 本來就有 `'use client'`」,
             那句現在也假了 —— R-1 把橫捲機制抽到 `ProductRail.tsx`,`HomeSelect` **不再是 client
             component**(只剩字面與資料、不再 import `ProductCard`),client 邊界下移到 `ProductRail`。
             🔴 同一句被同一個坑打第二次,兩次都是「引別的檔的行號 + 描述那個檔當下的狀態」。
             ⇒ 現行事實:client 的是 `HomeReveal` 與 `ProductRail`,其餘首頁區塊是 server component。
          🔴 位置放最後只是慣例;它靠選擇器找元素,與 DOM 順序無關。 */}
      <HomeReveal />
    </div>
  );
}
