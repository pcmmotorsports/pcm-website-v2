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
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  cascadeFilterReducer,
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
import type { MockProduct } from '@/data/mock-products';
import type { MockBrand } from '@/data/mock-brands';
import { buildBrandTaxonomy } from '@/lib/brand-taxonomy';
import type { GarageChipItem } from './GarageChips';

// 訊息態(載入失敗 / 找不到商品)共用樣式;沿用原空狀態 inline 字面、不新增 CSS 檔。
const MESSAGE_STATE_STYLE: CSSProperties = {
  padding: '64px 0',
  textAlign: 'center',
  color: 'var(--c-text-3)',
  font: '14px/1.6 system-ui, sans-serif',
};

export type ProductsPageProps = {
  /** server-resolved 真目錄商品(toUIProduct 'general' strip、零經銷價;#220 列表遷真;
   *  S1 起選了車=server 已按車過濾的子集、非恆全目錄) */
  products: MockProduct[];
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
};

// PageHeader — 頁首標題 + 麵包屑(標題依 cascade 已選分類 / 車輛推導)
function PageHeader({ cascade }: { cascade: CascadeFilterState }) {
  const title =
    cascade.category?.sub ??
    cascade.category?.main ??
    (cascade.vehicle
      ? cascade.vehicle.model != null
        ? vehicleLabel(cascade.vehicle.brand, cascade.vehicle.model)
        : cascade.vehicle.brand
      : '全部商品');

  return (
    <div className="pp-head">
      <div className="pp-head-row">
        <h1 className="pp-title">{title}</h1>
        <nav className="pp-breadcrumb" aria-label="麵包屑導航">
          <Link href="/">首頁</Link>
          <span>›</span>
          {cascade.category ? <Link href="/products">商品目錄</Link> : <span>商品目錄</span>}
          {cascade.category?.main && (
            <>
              <span>›</span>
              <span>{cascade.category.main}</span>
            </>
          )}
          {cascade.category?.sub && (
            <>
              <span>›</span>
              <span>{cascade.category.sub}</span>
            </>
          )}
        </nav>
      </div>
    </div>
  );
}

// SortBar — 商品數 + grid 欄數切換 + 排序下拉(cascade 版面無 drawer 篩選鈕)
function SortBar({
  count,
  gridCols,
  setGridCols,
  sort,
  setSort,
}: {
  count: number | null;   // null = 撈不到，不是 0 件（見 displayCount 的註解）
  gridCols: number;
  setGridCols: (n: number) => void;
  sort: string;
  setSort: (value: string) => void;
}) {
  return (
    <div className="pp-sortbar">
      <div className="pp-sortbar-left">
        <span className="pp-count">{count === null ? '件數未能載入' : `${count} 件商品`}</span>
      </div>
      <div className="pp-sortbar-right">
        <div className="pp-grid-toggle">
          {[3, 4, 5].map((n) => (
            <button key={n}
              className={gridCols === n ? 'is-active' : ''}
              onClick={() => setGridCols(gridCols === n ? 0 : n)}
              aria-label={`每排 ${n} 欄`}
              data-tip={`每排 ${n} 欄`}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                {[...Array(n).keys()].map((i) => (
                  <rect key={i} x={i * (16 / n) + 1} y="1" width={16 / n - 2} height="14" />
                ))}
              </svg>
            </button>
          ))}
        </div>
        <div className="ft-divider" />
        {/* 選項來自 lib/sort-options 單一定義點(手機的排序面板吃同一份;value 同時是 ?sort= 契約)。
            手機不顯示本下拉(products-mobile.css 隱藏)= 排序改走上方工具列的獨立入口。 */}
        <select className="ft-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ~~MobileFab~~(手機浮動篩選鈕)已於 ADR-0007 退場:Sean 拍板手機改「分類 / 篩選 / 排序
// 三個獨立入口」,單顆 FAB 開一個六 tab 混合抽屜正是被否決的形狀。
// 現行手機入口 = ProductsMobileControls(含 MobileVehicleSheet 與兩個 scope 的 FilterDrawer)。

export function ProductsPage({ products, total, error, categories, brands: serverBrands, motoBrands, garage = [] }: ProductsPageProps) {
  // searchParams 先取(#6:page/sort/perPage lazy init 讀 URL;server render 與 client 首繪同源、零 hydration 分歧)
  const searchParams = useSearchParams();
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
  const { sort, setSort: setSortRaw, page, setPage, perPage, setPerPage } = useBrowseUrlState(searchParams);
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
  useBrowseUrlSync(currentPage, sort, perPage);

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

      <div className="pp-layout has-side" data-filter-style="cascade">
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
          <PageHeader cascade={cascade} />
          <ActiveChips
            data={data}
            cascade={cascade}
            dispatch={dispatch}
            extras={extras}
            setExtras={setExtras}
          />
          <SortBar
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
