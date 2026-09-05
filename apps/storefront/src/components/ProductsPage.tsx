// ProductsPage.tsx — 商品列表頁(cascade 版面)
//
// 字面對齊 design-reference/components/ProductsPage.jsx(M-1-12):
// - Sean 拍板版面 filterStyle = cascade:頂部 CascadeFilterTop + 桌機左側
//   FilterSide(hideVehicle:S1 曾解除、Sean 2026-07-03 實測恢復 —— 車輛選擇集中頂部)
//   + 手機 ProductsMobileControls(ADR-0007 2026-07-30 起:車輛列 + 分類/篩選/排序三入口;
//     取代原「單顆篩選 FAB → FilterDrawer 六 tab 混一起」+ 手機被壓縮的桌機三欄選車列)。
// - M-1-12 Codex review 修正:篩選 / 排序純函式拆 products-filter-logic.ts、
//   ActiveChips / Pagination 拆同名檔(鐵則 6:元件檔 >400 行必拆);本檔保留
//   主元件 + PageHeader / SortBar / MobileFab 三個小型版面子元件。
// - #341-C(2026-09-04)再拆:~~PageHeader / SortBar~~ 已搬出為 `ProductsPageHeader.tsx` /
//   `ProductsSortBar.tsx`,訊息態樣式與 `hasCatalogFilterParam` 搬去 `products-message-state.tsx`。
//   🔴 **上一行的舊字面留著** —— 搜 `PageHeader` 想在本檔找到它的人,要在同一發撞到這裡。
//
// 字面 vs 事實揭示:
// - design 的 tweaks / onNav / window.PCM_DATA / 4-variant filterStyle 開關 /
//   跨頁同步不搬(design harness、見 docs/recon/M-1-12-products-page-recon.md §4)。
// - #220:商品列表改 server props 接真 Supabase 目錄(C4 起撈全目錄、toUIProduct 'general' strip 零經銷價)、
//   UI 版面零動。三側欄清單來源(接線 plan C1-C4、取代 mock):
//   * 車輛(S1 變體補足 2026-07-12):motoBrands ← server prop(fetchVehicleTaxonomy 全目錄快取版;
//     不再 buildVehicleTaxonomy(products) —— 選車後 products 是過濾子集、由它衍生下拉會塌縮)。
//   * 分類(C2/C4a):data.categories ← server fetchCategories(listCategories→buildCategoryTree、選項 A);
//     C4a 解除 hideCategory → 分類樹現身(桌機 childless 大類僅可展開、手機可選「全部 {大類}」)。
//   * 品牌(C3/#220c):buildBrandTaxonomy(products) ← 目錄(只列有真商品品牌、取代寫死 MOCK_BRANDS);
//     選車後隨相容子集收斂(facet 語意、刻意)。
// - 篩選:vehicle 下推 DB(S1:page.tsx 依 ?vehicle= 走 RPC、products prop 即相容子集;client
//   matchesVehicle 已移除=F4、useVehicleUrlSync 負責 cascade.vehicle→URL→server 重查);
//   category/brand/price 仍 client 過濾(products-filter-logic matchesCategory/品牌名比對);
//   顏色/新品/特價仍 no-op 隱藏(真資料 silver/無促銷)。
// - design 的 demo 資料 tiling 不搬;0 筆結果顯示空狀態文字 + 隱藏分頁(Codex finding 2)。
//   #220 真資料(碳纖維部品 ~1406 件)分頁自然多頁;server fetch 失敗顯「載入失敗、請稍後再試」
//   (Q2=A、鏡像 HomeSelect error 分支、與真 0 結果區分)。
// - design PageHeader 麵包屑用 onNav harness 導覽;本實作首頁 / 商品目錄改 Next
//   <Link>,大分類 / 細項為純 span。
// - 篩選 state 提升至本元件(Sean 拍板方案 1):本元件持 cascadeFilterReducer +
//   ProductExtraFilters + sort,傳入 4 個 controlled 篩選元件。
// - #6(2026-07-03):page/sort/perPage 進 URL query(page/sort/per、非預設才寫)+ mount lazy init
//   讀回 → 商品頁按上一頁回列表不再重置(Sean 實測回報);gridCols/其餘篩選不進 URL(範圍=回報三項)。

'use client';

import { useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { vehicleLabel } from '@/lib/vehicle-match';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  cascadeFilterReducer,
  clearAll,
  makeInitialCascadeState,
  type CascadeFilterState,
} from '@pcm/ui';
import { Header } from './Header';
import { HomeFooter } from './HomeFooter';
import { CascadeFilterTop } from './CascadeFilterTop';
import { FilterSide } from './FilterSide';
import { ProductsMobileControls } from './ProductsMobileControls';
import { useFacetCountResolver } from '@/lib/vehicle-facet-display';
import { useServerMobile } from '@/contexts/MobileContext';
import { ProductCard } from './ProductCard';
import { ActiveChips } from './ActiveChips';
// #341-C(鐵則 6 拆檔片, 2026-09-04):以下三支是從本檔**原樣搬出**的 ——
// 函式本體與註解一個字沒改, 每一刀的理由寫在那三支自己的檔頭。
import { MESSAGE_STATE_STYLE, hasCatalogFilterParam } from './products-message-state';
import { ProductsPageHeader } from './ProductsPageHeader';
import { ProductsSortBar } from './ProductsSortBar';
import { SearchKeywordChip } from './SearchKeywordChip';
import { Pagination } from './Pagination';
import { makeInitialExtraFilters, type ProductExtraFilters } from './filter-state';
import { SORT_OPTIONS } from '@/lib/sort-options';
// #6:page/sort/perPage URL round-trip + vehicle URL 解析(拆檔=鐵則 6;詳 products-url-state.tsx 檔頭)
import {
  useBrowseUrlState,
  usePageResetOnFilterChange,
  useBrowseUrlSync,
  useCatalogFilterUrlSync,
  useDeepLinkRestore,
  useVehicleUrlSync,
} from './products-url-state';
import { useFilterScrollTop } from './products-scroll-top';
import type { FilterTopData } from './FilterTop';
import type { MockCategory } from '@/data/mock-categories';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { CatalogCardProduct } from '@/lib/catalog-page';
import type { MockBrand } from '@/data/mock-brands';
import { buildBrandTaxonomy } from '@/lib/brand-taxonomy';
import type { GarageChipItem } from './GarageChips';


export type ProductsPageProps = {
  /** server-resolved 真目錄商品(toUIProduct 'general' strip、零經銷價;#220 列表遷真;
   *  S1 起選了車=server 已按車過濾的子集、非恆全目錄) */
  products: CatalogCardProduct[];
  /** P4 server query 的完整結果數；products 僅為當頁 card DTO。 */
  total?: number;
  /** server fetch 失敗旗標(true → 顯「載入失敗、請稍後再試」、與真 0 結果區分;Q2=A 鏡像 HomeSelect) */
  error: boolean;
  /** server-resolved 真分類樹(C2 接線;buildCategoryTree 選項 A 只留有商品分類、取代 MOCK_CATEGORIES) */
  categories: MockCategory[];
  /** P4 independent global brand counts; never derive from current page. */
  brands?: MockBrand[];
  /** server-resolved 全目錄車輛清單(S1:products 可能是按車過濾子集、下拉不可再由它衍生;
   *  fetchVehicleTaxonomy 快取版、與 URL slug 解析同源=id 空間一致) */
  motoBrands: MockMotoBrand[];
  /** V-1e:登入會員愛車(RLS own、序列化收窄;未登入/讀取失敗=[]、「我的愛車」鈕不顯示) */
  garage?: GarageChipItem[];
  /**
   * `?search=` 那個關鍵字(⟦搜尋-落點換 /products⟧ 2026-09-03)。有值 = **本頁的商品
   * 是關鍵字撈的、不是 RPC 撈的** ⇒ 左側 facet / 排序**沒有生效**。
   *
   * 🔴 **它必須被畫出來**(`SearchKeywordChip`)—— 不畫的話,客人看到的是一個
   *    「篩選條件都在、但點了沒反應」的目錄頁,而**那是安靜的錯**。
   */
  searchKeyword?: string;
  /**
   * ⟦search-CAPSULEPARSE⟧:解析器**認不得、因此沒有拿去過濾**的那些字。
   * 🔴 它**不是**篩選條件 —— 它是一句「這幾個字我們沒有用到」的告白。
   *    ⇒ 📌 而它必須被畫出來:一個「懂了一半」的系統, 比完全沒懂的更難用,
   *      因為客人不知道要重打哪一段。
   */
  unmatchedWords?: string;
};



// ~~MobileFab~~(手機浮動篩選鈕)已於 ADR-0007 退場:Sean 拍板手機改「分類 / 篩選 / 排序
// 三個獨立入口」,單顆 FAB 開一個六 tab 混合抽屜正是被否決的形狀。
// 現行手機入口 = ProductsMobileControls(含 MobileVehicleSheet 與兩個 scope 的 FilterDrawer)。

export function ProductsPage({ products, total, error, categories, brands: serverBrands, motoBrands, garage = [], searchKeyword, unmatchedWords }: ProductsPageProps) {
  // searchParams 先取(#6:page/sort/perPage lazy init 讀 URL;server render 與 client 首繪同源、零 hydration 分歧)
  const searchParams = useSearchParams();
  const router = useRouter();
  // ⟦b4-DEADENDMSG1⟧③:零結果時才問這一格(有結果時整段不渲染 ⇒ 那顆鈕結構上出不來)。
  const filtered = hasCatalogFilterParam(searchParams);
  // ── A2(2026-08-03):`?pick=vehicle` 落地開燈(Sean 拍 B 案「同落地 + 開燈」)──
  // 入口 = Header「依車輛搜尋」(非首頁時)與 MobileTabBar「找車」。
  // 🔴 `pick` **不是篩選條件**,刻意不進 cascade 狀態機:useDeepLinkRestore 與
  //    useCatalogFilterUrlSync 都不認識它。後者只改寫**它自己那幾軸**、其餘 key 原樣拷貝,
  //    所以 `pick` 會留在網址上 —— 語意 = 「這次進站要開燈」,刻意不再多送一次
  //    router.replace 去換一個沒人在看的乾淨網址。
  //    🔴 **軸的清單不在這裡列第二份**(2026-08-11 #287 實證:這裡原本逐字寫「pbrand/category/
  //    price/pmin/pmax 五軸」,而 #287 把品牌軸換成 `pbrands` 之後這份拷貝就過期了)。
  //    正本 = `use-catalog-filter-url-sync.tsx` 的「安全前提」那段註解,只留單向指標。
  // 🔴 桌機 / 手機必須**分流**,不能兩邊都吃同一個布林:
  //    桌機 = 聚焦 .cft-bar 的廠牌欄;手機 = 自動開 MobileVehicleSheet。
  //    兩棵樹在任何裝置上都會 mount(只是被 CSS 各自藏起來),而選車面板一開就會
  //    `document.body.style.overflow='hidden'` ⇒ 桌機若誤走手機那支,會得到
  //    「看不到面板、整頁卻捲不動」。分流的依據用 layout SSR 的 UA(與 CSS 的
  //    [data-mobile="true"] 同源),Provider 外(單元測試)退化為桌機 = 不開面板。
  // ⚠️ 已知落差(可接受、非缺陷):桌機瀏覽器把視窗縮到 ≤1024px 時,CSS 顯示的是手機控制列,
  //    但 UA 仍是桌機 ⇒ 兩邊的開燈都不會發生(桌機那支的目標欄位此時 display:none、
  //    focus 是 no-op)。結果是「沒開燈」而不是「壞掉」,方向 fail-safe。
  const isMobileUA = useServerMobile() ?? false;
  const pickVehicle = searchParams.get('pick') === 'vehicle';
  const [cascade, rawDispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtrasRaw] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  const { sort, setSort: setSortRaw, page, setPage, perPage, setPerPage } = useBrowseUrlState(searchParams, searchKeyword !== undefined);
  // Sean 2026-07-31:篩選動作確認後一律回頁首,排序同辦(拍板 A;詳 products-scroll-top.tsx;
  // 🔴 只有篩選 UI 吃包裝版,URL 還原走下方 useDeepLinkRestore 的 rawDispatch、不捲頁)
  const { dispatch, setExtras, setSort } = useFilterScrollTop(rawDispatch, setExtrasRaw, extras, setSortRaw);
  const [gridCols, setGridCols] = useState(0); // 0=自動欄數(卡片固定寬、寬螢幕自動加欄);3/4/5=手動鎖定。顯示偏好、不進 URL(#6)
  // #6:URL 還原 vehicle 的 mount dispatch 與「篩選變動重置頁碼」的協調旗標(見 vehicle effect 註解)
  const urlVehicleInitRef = useRef(false);
  const filterResetKeyRef = useRef<string | null>(null);
  // Q4-S5:?brand= 還原只 dispatch 一次(toggleBrand 非冪等、strict mode 雙跑會 toggle 掉)
  const urlBrandInitRef = useRef(false);

  // 車輛篩選清單:S1 起改 server prop(fetchVehicleTaxonomy 全目錄快取版;車種鐵律
  // fitment_parsed 直出不變)。不再 buildVehicleTaxonomy(products):products 選了車後是
  // 過濾子集、由它衍生會讓下拉塌縮成只剩已選車、無法換車。
  // C3 #220c:品牌側欄「動態衍生」自當下目錄商品(只列有真商品的品牌、count 為真;
  // 商品匯入後自動更新);drop-in 取代舊寫死 MOCK_BRANDS(選 RPM 以外 chip 0 結果病灶)。
  // S1 註:選了車後 products=相容子集 → 品牌清單/計數隨之收斂(facet 語意、刻意)。
  const brands = serverBrands ?? buildBrandTaxonomy(products);
  const data: FilterTopData = useMemo(
    () => ({ motoBrands, categories, brands }),
    [motoBrands, categories, brands],
  );

  // mount 時 URL 深連結(vehicle / category / brand)還原成 cascade 篩選(#6 + Q4-S5);
  // 邏輯抽入 products-url-state.useDeepLinkRestore(鐵則 6 檔案上限;含 skipOnce / brand 守一次註解)
  useDeepLinkRestore({
    searchParams,
    motoBrands,
    categories,
    productBrands: brands,
    dispatch: rawDispatch,
    skipPageResetOnce: urlVehicleInitRef,
    brandAppliedOnce: urlBrandInitRef,
    // 🔴 有關鍵字 ⇒ 不把 facet 還原進 cascade(理由全文在該 hook 的 `keywordActive` JSDoc)。
    keywordActive: searchKeyword !== undefined,
  });

  // S1:cascade.vehicle → URL(短版 ?vehicle=)→ server 以 RPC 重查(車款篩選下推 DB、
  // 繼承件也命中);取代舊 client matchesVehicle。詳 products-url-state.useVehicleUrlSync。
  useVehicleUrlSync(cascade.vehicle, motoBrands);
  // V-1a:第三參數=還原窗口守衛對照表(與 useDeepLinkRestore 同源;memo 穩定 identity 免 effect 空轉)
  // Q28① R1 MF-1:多帶 motoBrands = 讓該 hook 用與 useVehicleUrlSync 同一支 resolveVehicleForUrl
  // 判斷「vehicle 這輪會不會被寫進 URL」,鏡入站時讓路一輪、不覆蓋掉那個 replace。
  const restoreSources = useMemo(
    () => ({ categories, productBrands: brands, motoBrands }),
    [categories, brands, motoBrands],
  );
  useCatalogFilterUrlSync(cascade, extras, restoreSources);
  // #306:URL → 件數 → resolver(整條在 lib/vehicle-facet-display 的 useFacetCountResolver;
  //   抽出去的理由 = 鐵則 6,本檔曾一度到 405 行)。輸入只認 URL、不看 cascade:後者要等
  //   hydration 才還原,用它判斷會在深連結進站時先閃一次全站數。
  const countOf = useFacetCountResolver(searchParams);
  // Sean `Q21 = B`:新品頁側欄不顯示件數。resolver 已擋掉逐項件數,
  // 區段標題的總數(品牌 Accordion 的 (16))繞過 resolver ⇒ 要另外關(codex 段二審查 MF-5)。
  const hideSectionCounts = searchParams.get('filter') === 'new';

  // P4:products 已是 server 依 URL 篩選、排序、分頁的當頁資料；禁止再在 client 對當頁二次篩選，
  // 否則會把 total/page 語意拆成兩套而造成漏項。
  const resultCount = total ?? products.length;

  // 🔴 `error === true` 時 `fetchCatalogPage` 回的是 `total: 0`(lib/products.ts:508)——
  //    那個 0 是「我沒撈到」不是「真的沒有商品」,而畫面照樣把它印成「0 件商品」。
  //    實測(拋棄式庫,撤 anon EXECUTE 造錯):同一畫面上面印「0 件商品」、中間印「載入失敗」、
  //    左側欄的分類件數走另一條資料源沒壞、照樣印著 9/9/9/9 ⇒ 三種互相矛盾的說法。
  //    ⇒ 【頂部那三個件數顯示點】一律不給數字(SortBar / FilterTop / FilterDrawer)。
  //    ⚠️ 側欄的 facet 件數走 `useFacetCountResolver`(:268)另一條資料源、本片【沒有】關掉它 ——
  //       所以 error 時側欄仍會印各分類件數。那是刻意留的:它沒壞,而且它證明「商品是存在的」。
  //    這條照 `MobileVehicleSheet.tsx:277-280` 的既有判斷:
  //      那裡刻意不印一個算不出來的 N(註解逐字「本機正式資料實測 19037,而按下去的真實結果是 43」)。
  //    ⚠️ `resultCount` 本身不動 —— 分頁算式要用它,而分頁在 error 時本來就不渲染。
  const displayCount: number | null = error ? null : resultCount;

  // #6:篩選/排序/每頁變動 → 回第 1 頁(對齊 design ProductsPage.jsx L226;值比較+mount-guard
  // +vehicle 還原跳過一次,詳 products-url-state.tsx usePageResetOnFilterChange 檔內註解)
  usePageResetOnFilterChange(
    JSON.stringify([cascade, extras, sort, perPage]),
    urlVehicleInitRef,
    setPage,
    filterResetKeyRef,
  );

  const totalPages = Math.max(1, Math.ceil(resultCount / perPage));
  const currentPage = Math.min(page, totalPages);
  const displayed = products;

  // #6:page/sort/perPage 同步回 URL(原生 replaceState 零 server 往返;詳 products-url-state.tsx)
  useBrowseUrlSync(currentPage, sort, perPage, searchKeyword !== undefined);

  const changePage = (n: number) => {
    setPage(Math.max(1, Math.min(totalPages, n)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <>
      <Header currentPage="catalog" />

      {/* 桌機選車列(≤1024px 由 CSS 整條關閉) */}
      <CascadeFilterTop
        data={data}
        cascade={cascade}
        dispatch={dispatch}
        garage={garage}
        autoFocusBrand={pickVehicle && !isMobileUA}
      />

      {/* 手機控制列(≥1025px 由 CSS 關閉)。刻意**不**放進 .cft-bar 內:
          .cft-bar 在手機是 display:none,放進去會被一起關掉 = 手機沒有任何選車入口。
          守門 = ProductsPage.test.tsx「手機入口不在 .cft-bar 內」。 */}
      <ProductsMobileControls
        countOf={countOf}
        data={data}
        cascade={cascade}
        dispatch={dispatch}
        extras={extras}
        setExtras={setExtras}
        garage={garage}
        resultCount={displayCount}
        sort={sort}
        setSort={setSort}
        openVehicleOnMount={pickVehicle && isMobileUA}
      />

      {/* ⟦supply-BRANDFILTERZERO⟧ **下一次紅的時候, 要分得出是哪一個世界。**
          🔬 已知的事實(2026-09-04 `-front` 開檔量):**client 【不】過濾** —— 本檔 `displayed = products`
             ⇒ 📌 **「server 回 723 而畫面 0」在【同一次渲染】裡不可能發生**;那必然是**兩次不同的載入**。
          🎯 **所以要留的證據不是「client 算錯了嗎」, 是【這一次渲染, server 到底回了什麼】。**
          🔵 **不改任何行為** —— 只是把四個已經在手上的值寫進 DOM:
             `total`(server 說幾件)· `products.length`(這一頁實際拿到幾件)
             · 品牌篩選鍵(舊 `?pbrand=` 與新 `?pbrands=` 都收)· **品牌對照表的大小**
          🔴 **對照表大小那一格是刻意加的**:`fetchCatalogBrandTaxonomy` 中斷時它會是 **0**,
             而那正是「有效品牌卻撈不到」最可能的成因(見 `use-catalog-filter-url-sync` 對空表的註解)。
             ⇒ **沒有它, 下一次紅了還是只能猜。** */}
      <div
        className="pp-layout has-side"
        data-filter-style="cascade"
        data-diag-total={String(total ?? 'undefined')}
        data-diag-rows={String(products.length)}
        data-diag-brandkey={
          searchParams.get('pbrands') ?? searchParams.get('pbrand') ?? ''
        }
        data-diag-brandtable={String(brands.length)}
      >
        {/* #220-B1:真資料單一品牌 RPM CARBON/全 silver/無促銷 → 隱藏假篩選(留價格;
            僅現貨=#161 不在此;視覺細節 Sean 後續 design skill 調)。
            hideVehicle:S1 曾解除、Sean 2026-07-03 實測 feedback 恢復 —— 車輛選擇集中頂部
            CascadeFilterTop(+ 手機 FilterDrawer)、左欄不重複放車輛樹(回歸 M-1-12 cascade 版面拍板)。
            C4a(接線 plan):解除 hideCategory → 零件分類樹現身(吃 C2 已接的真 data.categories、選項 A);
            🔴 現況真分類單層(碳纖維部品、無子類)→ 桌機 CategoryTree 大類列僅可展開、無子類可選(只點大類=展開空);
            手機 FilterDrawer 可選「全部 {大類}」;多品牌 + 子類(#212)後桌機大類亦長出可選子類。
            C3(接線 plan):解除 hideBrand → 品牌側欄現身(吃 buildBrandTaxonomy 動態衍生、只列有真商品品牌;
            現況單一 RPM CARBON、多品牌上架後自動長出)。 */}
        <FilterSide
          countOf={countOf}
          hideSectionCounts={hideSectionCounts}
          data={data}
          hideVehicle
          hideColor
          hidePromoFlags
          cascade={cascade}
          dispatch={dispatch}
          extras={extras}
          setExtras={setExtras}
        />
        <main className="pp-main">
          <ProductsPageHeader cascade={cascade} />
          {/* 🔴 關鍵字膠囊排在 `ActiveChips` **前面** —— 它是這一頁商品的**來源**,
              而 ActiveChips 那些是「本來會生效、現在沒生效」的東西。順序講的是因果。 */}
          <SearchKeywordChip keyword={searchKeyword} unmatchedWords={unmatchedWords} />
          {/* 🔴🔴 **有關鍵字時不畫 facet 膠囊** —— code-reviewer 2026-09-03 must-fix。
            * 直接開 `/products?search=cark9650&vehicle=yamaha:mt-07` 時(不必點任何東西),
            * `ActiveChips` 會從 URL 還原出一顆「Yamaha MT-07 ✕」
            * ⇒ 📌 **那顆膠囊聲稱清單被那台車縮過, 而商品其實是關鍵字撈的、完全沒被縮。**
            * ⇒ 🛑 一句靜態提示擋不住它:提示說「篩選要先移除關鍵字才生效」,
            *   而膠囊就在那句話正下方說「我已經生效了」—— **兩個聲明互相矛盾, 而客人信膠囊。**
            * ⇒ ✅ 關鍵字在的時候, 唯一該出現的膠囊就是關鍵字自己那顆。
            * 🔵 而 facet 控制項(左側 / 頂部)**照樣可點**(Q2=A)—— 點下去會清掉關鍵字
            *   (`use-catalog-filter-url-sync.tsx` 的 `filtersChanged` 那一格),膠囊隨即回來。 */}
          {searchKeyword === undefined && (
            <ActiveChips
              data={data}
              cascade={cascade}
              dispatch={dispatch}
              extras={extras}
              setExtras={setExtras}
            />
          )}
          <ProductsSortBar
            count={displayCount}
            gridCols={gridCols}
            setGridCols={setGridCols}
            sort={sort}
            setSort={setSort}
          />
          {error ? (
            <div style={MESSAGE_STATE_STYLE} role="alert">
              載入失敗、請稍後再試
            </div>
          ) : displayed.length > 0 ? (
            <div className="pp-grid" style={{
              gridTemplateColumns: gridCols === 0
                ? 'repeat(auto-fill, minmax(256px, 1fr))'
                : `repeat(${gridCols}, 1fr)`,
              gap: 14, // 欄數鈕僅 3/4/5 + 自動(0),原 <=2?20:14 的 20 支為死碼、簡化(手機 2 欄 gap 由 CSS !important 12 控)
            }}>
              {displayed.map((p) => {
                const categoryMain = p.category.split('·')[0]?.trim() || '';
                // M-1-13d-fix-1:構建商品連結 URL params + 補帶 vehicle param(13a 漏)
                // cascade.vehicle 存 name(= fitment motoBrand/modelCode 原字串)、ProductPage 解析端
                // 期望 id 格式 `brandId:modelId:year`、此處反查衍生 motoBrands 拿 slug id 後串接
                // (與 parseVehicleFromUrl 同一份衍生清單、本頁 round-trip 一致)。
                // 下游消費者:ProductPage vehiclePill 以商品自身 fitments + slugify 同源反查(S1 同步修);
                // 首頁 VehicleFinder 長版靜態 id 由 S2(#220b)收斂、S1 時點仍為 open drift(manifest 記)。
                const params = new URLSearchParams({ from: 'catalog' });
                if (categoryMain) params.set('category', categoryMain);
                if (cascade.vehicle) {
                  const v = cascade.vehicle;
                  const brandObj = motoBrands.find((b) => b.name === v.brand);
                  if (brandObj) {
                    const parts: string[] = [brandObj.id];
                    if (v.model) {
                      const modelObj = brandObj.models?.find((m) => m.name === v.model);
                      if (modelObj) {
                        parts.push(modelObj.id);
                        if (v.year !== undefined) {
                          parts.push(String(v.year));
                        }
                      }
                    }
                    params.set('vehicle', parts.join(':'));
                  }
                }
                const href = `/products/${p.slug}?${params.toString()}`;
                return <ProductCard key={p.id} p={p} href={href} />;
              })}
            </div>
          ) : (
            <div style={MESSAGE_STATE_STYLE}>
              找不到符合條件的商品
              {filtered && (
                <>
                  <div style={{ marginTop: 8 }}>
                    目前有篩選條件在生效。可能是條件太窄,或這個連結上的某個條件已經失效了。
                  </div>
                  <button
                    className="ac-clear-all"
                    style={{ marginTop: 16 }}
                    onClick={() => {
                      dispatch(clearAll());
                      setExtras(makeInitialExtraFilters());
                      // 🔴 光清 state 不夠:認不得的參數留在 URL 上, 而回寫段的
                      // `else if (parseCategoryFromUrl(...) !== null)` 對它回 null ⇒ **不刪**
                      // ⇒ 只 dispatch 的話, 按完 URL 還是髒的、還是 0 筆。
                      // 🔵 `sort`/`per` 明確帶走 —— 它們是客人刻意選的, 不是篩選。
                      // 🛑 **而這幾行【不是】在修一個量到的缺陷, 要說清楚**:
                      //    R1 審查說「丟掉 sort/per ⇒ state 還在而 URL 沒了 ⇒ 排序選單寫著
                      //    『價格由低到高』而清單沒排」。**我去量了, 那個情境沒有重現** ——
                      //    把這幾行換回裸的 `router.replace('/products')` 跑同一格,
                      //    終態 URL **一樣**是 `?sort=price-asc&per=100`(回寫 effect 補回來)。
                      //    ⇒ 📌 **這幾行買到的不是修復, 是【不依賴另一個 effect 事後補救】。**
                      //    ⇒ 🔴 而下面那格測試在這幾行被拿掉時**照樣綠**(實測), 它守的是
                      //      【終態】不是【這幾行】—— 不要把它讀成這幾行的守門。
                      const kept = new URLSearchParams();
                      const keepSort = searchParams.get('sort');
                      const keepPer = searchParams.get('per');
                      if (keepSort) kept.set('sort', keepSort);
                      if (keepPer) kept.set('per', keepPer);
                      const keptQuery = kept.toString();
                      router.replace(keptQuery ? `/products?${keptQuery}` : '/products');
                    }}>
                    清除所有篩選
                  </button>
                </>
              )}
            </div>
          )}
          {!error && resultCount > 0 && (
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              perPage={perPage}
              total={resultCount}
              onChangePage={changePage}
              onChangePerPage={(n) => setPerPage(n)}
            />
          )}
        </main>
      </div>

      {/* C4a/C3:真分類樹與真品牌清單仍由 FilterDrawer 提供,但改由 ProductsMobileControls
          以 scope='category' / scope='product' 兩個獨立入口掛載(ADR-0007 責任分離)。 */}

      <HomeFooter />
    </>
  );
}
