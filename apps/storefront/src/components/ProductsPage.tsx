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
// - #220:商品列表改 server props 接真 Supabase 目錄(碳纖維部品、toUIProduct 'general' strip 零經銷價)、
//   UI 版面零動。S1(2026-07-03):車輛篩選清單改 buildVehicleTaxonomy(products) 從真 fitment
//   動態衍生(取代 MOCK_MOTO_BRANDS);分類/品牌側欄仍 mock(品牌側欄真資料化 #220c;
//   真資料單一品牌 RPM CARBON、選其他品牌 chip 會 0 結果、已記 #220c)。
// - S1:篩選依 cascade.vehicle 過真 fitment 過濾(#152 vehicle 部分關閉、見
//   products-filter-logic matchesVehicle);cascade.category 仍不過濾(#152 剩餘、單一分類)。
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

import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
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
  parseVehicleFromUrl,
} from './products-url-state';
import type { FilterTopData } from './FilterTop';
import { MOCK_CATEGORIES } from '@/data/mock-categories';
import { MOCK_BRANDS } from '@/data/mock-brands';
import type { MockProduct } from '@/data/mock-products';
import { buildVehicleTaxonomy } from '@/lib/vehicle-taxonomy';

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
              onClick={() => setGridCols(n)}
              aria-label={`${n} columns`}>
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

export function ProductsPage({ products, error }: ProductsPageProps) {
  // searchParams 先取(#6:page/sort/perPage lazy init 讀 URL;server render 與 client 首繪同源、零 hydration 分歧)
  const searchParams = useSearchParams();
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  const { sort, setSort, page, setPage, perPage, setPerPage } = useBrowseUrlState(searchParams);
  const [gridCols, setGridCols] = useState(5); // 顯示偏好、不進 URL(#6 範圍=Sean 回報三項)
  const [drawerOpen, setDrawerOpen] = useState(false);
  // #6:URL 還原 vehicle 的 mount dispatch 與「篩選變動重置頁碼」的協調旗標(見 vehicle effect 註解)
  const urlVehicleInitRef = useRef(false);
  const filterResetKeyRef = useRef<string | null>(null);

  // 車輛篩選清單「動態衍生」自當下目錄商品 fitment(車種鐵律 fitment_parsed 直出、
  // 商品匯入後自動更新、零手動維護);drop-in 取代舊 MOCK_MOTO_BRANDS。
  const motoBrands = useMemo(() => buildVehicleTaxonomy(products), [products]);
  const data: FilterTopData = useMemo(
    () => ({ motoBrands, categories: MOCK_CATEGORIES, brands: MOCK_BRANDS }),
    [motoBrands],
  );

  // M-1-13I Bug 1 修:mount 時讀 URL vehicle 參數 → dispatch reducer(Q1=C 雙格式)
  // strict mode dev 環境 useEffect mount 跑兩次、會 dispatch 兩次;
  // cascadeFilterReducer 對同 brand 連選冪等(第二次重設同樣狀態)、實務上無 bug、
  // dev console 看 state 日誌會多一輪、屬正常。
  useEffect(() => {
    const v = parseVehicleFromUrl(searchParams, motoBrands);
    if (!v) return;
    // #6:標記「這波 cascade 變更源自 URL 還原、非使用者操作」→ 頁碼重置 effect 跳過一次,
    //   否則 ?vehicle=…&page=3 back 回來會被 mount 後的 vehicle dispatch 誤重置回第 1 頁。
    urlVehicleInitRef.current = true;
    dispatch(selectVehicleBrand(v.brand));
    if (v.model) dispatch(selectVehicleModel(v.model));
    if (v.year !== undefined) dispatch(selectVehicleYear(v.year));
    // 僅 mount 時讀一次、避免 dispatch 改 URL 觸發 loop
    // strict mode dev 跑兩次、cascadeFilterReducer 對同 brand 連選冪等可吸收
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {/* #220-B1:真資料單一分類/單一品牌 RPM CARBON/全 silver/無促銷 → 隱藏假篩選(留價格;
            僅現貨=#161 不在此;視覺細節 Sean 後續 design skill 調)。
            hideVehicle:S1 曾解除、Sean 2026-07-03 實測 feedback 恢復 —— 車輛選擇集中頂部
            CascadeFilterTop(+ 手機 FilterDrawer)、左欄不重複放車輛樹(回歸 M-1-12 cascade 版面拍板)。 */}
        <FilterSide
          data={data}
          hideVehicle
          hideCategory
          hideBrand
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
              gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
              gap: gridCols <= 2 ? 20 : 14,
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

      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        data={data}
        resultCount={resultCount}
        initialTab="vehicle"
        hideCategory
        hideBrand
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
