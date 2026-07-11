// ProductsPage.tsx — 商品列表頁(cascade 版面)
//
// 字面對齊 design-reference/components/ProductsPage.jsx(M-1-12):
// - Sean 拍板版面 filterStyle = cascade:頂部 CascadeFilterTop + 桌機左側
//   FilterSide(hideVehicle:S1 曾解除、Sean 2026-07-03 實測恢復 —— 車輛選擇集中頂部)
//   + 手機 FilterDrawer(vehicle tab 保留 = 手機選車入口)。
// - M-1-12 Codex review 修正:篩選 / 排序純函式拆 products-filter-logic.ts、
//   ActiveChips / Pagination 拆同名檔(鐵則 6:元件檔 >400 行必拆);本檔保留
//   主元件 + PageHeader / SortBar / MobileFab 三個小型版面子元件。
//
// 字面 vs 事實揭示:
// - design 的 tweaks / onNav / window.PCM_DATA / 4-variant filterStyle 開關 /
//   跨頁同步不搬(design harness、見 docs/recon/M-1-12-products-page-recon.md §4)。
// - #220:商品列表改 server props 接真 Supabase 目錄(C4 起撈全目錄、toUIProduct 'general' strip 零經銷價)、
//   UI 版面零動。三側欄清單皆「動態衍生自當下目錄」(接線 plan C1-C4、取代 mock):
//   * 車輛(S1 2026-07-03):buildVehicleTaxonomy(products) ← 真 fitment(取代 MOCK_MOTO_BRANDS)。
//   * 分類(C2/C4a):data.categories ← server fetchCategories(listCategories→buildCategoryTree、選項 A);
//     C4a 解除 hideCategory → 分類樹現身(桌機 childless 大類僅可展開、手機可選「全部 {大類}」)。
//   * 品牌(C3/#220c):buildBrandTaxonomy(products) ← 目錄(只列有真商品品牌、取代寫死 MOCK_BRANDS);
//     C3 解除 hideBrand → 品牌側欄現身;現況真資料單一品牌 RPM CARBON、多品牌上架後自動長出。
// - 篩選皆真過濾(cascade.vehicle/category/brand → products-filter-logic matchesVehicle/matchesCategory/
//   品牌名比對;#152 vehicle+category 已關閉);顏色/新品/特價仍 no-op 隱藏(真資料 silver/無促銷)。
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
import { FilterDrawer } from './FilterDrawer';
import { ProductCard } from './ProductCard';
import { ActiveChips } from './ActiveChips';
import { Pagination } from './Pagination';
import { filterProducts, sortProducts } from './products-filter-logic';
import { makeInitialExtraFilters, type ProductExtraFilters } from './filter-state';
// #6:page/sort/perPage URL round-trip + vehicle URL 解析(拆檔=鐵則 6;詳 products-url-state.tsx 檔頭)
import {
  useBrowseUrlState,
  usePageResetOnFilterChange,
  useBrowseUrlSync,
  useDeepLinkRestore,
} from './products-url-state';
import type { FilterTopData } from './FilterTop';
import type { MockCategory } from '@/data/mock-categories';
import type { MockProduct } from '@/data/mock-products';
import { buildVehicleTaxonomy } from '@/lib/vehicle-taxonomy';
import { buildBrandTaxonomy } from '@/lib/brand-taxonomy';

// 訊息態(載入失敗 / 找不到商品)共用樣式;沿用原空狀態 inline 字面、不新增 CSS 檔。
const MESSAGE_STATE_STYLE: CSSProperties = {
  padding: '64px 0',
  textAlign: 'center',
  color: 'var(--c-text-3)',
  font: '14px/1.6 system-ui, sans-serif',
};

export type ProductsPageProps = {
  /** server-resolved 真目錄商品(toUIProduct 'general' strip、零經銷價;#220 列表遷真) */
  products: MockProduct[];
  /** server fetch 失敗旗標(true → 顯「載入失敗、請稍後再試」、與真 0 結果區分;Q2=A 鏡像 HomeSelect) */
  error: boolean;
  /** server-resolved 真分類樹(C2 接線;buildCategoryTree 選項 A 只留有商品分類、取代 MOCK_CATEGORIES) */
  categories: MockCategory[];
};

// PageHeader — 頁首標題 + 麵包屑(標題依 cascade 已選分類 / 車輛推導)
function PageHeader({ cascade }: { cascade: CascadeFilterState }) {
  const title =
    cascade.category?.sub ??
    cascade.category?.main ??
    (cascade.vehicle ? `${cascade.vehicle.brand} ${cascade.vehicle.model ?? ''}`.trim() : '全部商品');

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
  count: number;
  gridCols: number;
  setGridCols: (n: number) => void;
  sort: string;
  setSort: (value: string) => void;
}) {
  return (
    <div className="pp-sortbar">
      <div className="pp-sortbar-left">
        <span className="pp-count">{count} 件商品</span>
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
        <select className="ft-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="recommend">推薦排序</option>
          <option value="new">最新上架</option>
          <option value="price-asc">價格低到高</option>
          <option value="price-desc">價格高到低</option>
          <option value="sale">折扣優先</option>
        </select>
      </div>
    </div>
  );
}

// MobileFab — 手機浮動篩選鈕(對齊 design ProductsPage.jsx L362-389;design 的
// createPortal 進 bezel slot 屬 harness、不搬,直接 inline 渲染,CSS @media 控顯示)
function MobileFab({ activeCount, onClick }: { activeCount: number; onClick: () => void }) {
  return (
    <button className="pp-mobile-fab is-cascade" onClick={onClick}>
      <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
          d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
      </svg>
      篩選
      {activeCount > 0 && <span className="pp-fab-badge">{activeCount}</span>}
    </button>
  );
}

export function ProductsPage({ products, error, categories }: ProductsPageProps) {
  // searchParams 先取(#6:page/sort/perPage lazy init 讀 URL;server render 與 client 首繪同源、零 hydration 分歧)
  const searchParams = useSearchParams();
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  const { sort, setSort, page, setPage, perPage, setPerPage } = useBrowseUrlState(searchParams);
  const [gridCols, setGridCols] = useState(0); // 0=自動欄數(卡片固定寬、寬螢幕自動加欄);3/4/5=手動鎖定。顯示偏好、不進 URL(#6)
  const [drawerOpen, setDrawerOpen] = useState(false);
  // #6:URL 還原 vehicle 的 mount dispatch 與「篩選變動重置頁碼」的協調旗標(見 vehicle effect 註解)
  const urlVehicleInitRef = useRef(false);
  const filterResetKeyRef = useRef<string | null>(null);
  // Q4-S5:?brand= 還原只 dispatch 一次(toggleBrand 非冪等、strict mode 雙跑會 toggle 掉)
  const urlBrandInitRef = useRef(false);

  // 車輛篩選清單「動態衍生」自當下目錄商品 fitment(車種鐵律 fitment_parsed 直出、
  // 商品匯入後自動更新、零手動維護);drop-in 取代舊 MOCK_MOTO_BRANDS。
  const motoBrands = useMemo(() => buildVehicleTaxonomy(products), [products]);
  // C3 #220c:品牌側欄「動態衍生」自當下目錄商品(只列有真商品的品牌、count 為真;
  // 商品匯入後自動更新);drop-in 取代舊寫死 MOCK_BRANDS(選 RPM 以外 chip 0 結果病灶)。
  const brands = useMemo(() => buildBrandTaxonomy(products), [products]);
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
    dispatch,
    skipPageResetOnce: urlVehicleInitRef,
    brandAppliedOnce: urlBrandInitRef,
  });

  // memo:1409 件 client 全量過濾/排序、S1 加逐商品 fitments.some 比對 → 避免無關 state
  // (drawerOpen/gridCols/page)變動時整條重算
  const filtered = useMemo(
    () => filterProducts(products, cascade, extras, data.brands),
    [products, cascade, extras, data.brands],
  );
  const sorted = useMemo(() => sortProducts(filtered, sort), [filtered, sort]);
  const resultCount = sorted.length;

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
  const startIdx = (currentPage - 1) * perPage;
  const displayed = sorted.slice(startIdx, startIdx + perPage);

  // #6:page/sort/perPage 同步回 URL(原生 replaceState 零 server 往返;詳 products-url-state.tsx)
  useBrowseUrlSync(currentPage, sort, perPage);

  const changePage = (n: number) => {
    setPage(Math.max(1, Math.min(totalPages, n)));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // 手機 FAB badge:已選篩選條件數(對齊 design activeCount L249-258)
  const activeCount =
    (cascade.vehicle ? 1 : 0) +
    (cascade.category ? 1 : 0) +
    cascade.brands.length +
    (extras.price ? 1 : 0) +
    (extras.inStock ? 1 : 0) +
    (extras.isNew ? 1 : 0) +
    (extras.isSale ? 1 : 0) +
    extras.colors.length;

  return (
    <>
      <Header currentPage="catalog" />

      <CascadeFilterTop
        data={data}
        cascade={cascade}
        dispatch={dispatch}
        onOpenDrawer={() => setDrawerOpen(true)}
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
            count={resultCount}
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

      <MobileFab activeCount={activeCount} onClick={() => setDrawerOpen(true)} />

      {/* C4a:解除 hideCategory → 手機抽屜「零件分類」tab 現身(drill 大類 → 可選「全部 {大類}」/ 子類)。
          C3:解除 hideBrand → 手機抽屜「品牌」tab 現身(吃 buildBrandTaxonomy 動態衍生)。 */}
      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        data={data}
        resultCount={resultCount}
        initialTab="vehicle"
        hideColor
        hidePromoFlags
        cascade={cascade}
        dispatch={dispatch}
        extras={extras}
        setExtras={setExtras}
      />

      <HomeFooter />
    </>
  );
}
