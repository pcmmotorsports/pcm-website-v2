// ProductsPage.tsx — 商品列表頁(cascade 版面)
//
// 字面對齊 design-reference/components/ProductsPage.jsx(M-1-12):
// - Sean 拍板版面 filterStyle = cascade:頂部 CascadeFilterTop + 桌機左側
//   FilterSide(hideVehicle)+ 手機 FilterDrawer。
// - M-1-12 Codex review 修正:篩選 / 排序純函式拆 products-filter-logic.ts、
//   ActiveChips / Pagination 拆同名檔(鐵則 6:元件檔 >400 行必拆);本檔保留
//   主元件 + PageHeader / SortBar / MobileFab 三個小型版面子元件。
//
// 字面 vs 事實揭示:
// - design 的 tweaks / onNav / window.PCM_DATA / 4-variant filterStyle 開關 /
//   跨頁同步不搬(design harness、見 docs/recon/M-1-12-products-page-recon.md §4);
//   data 改 storefront mock import。
// - 篩選不依 cascade.vehicle / cascade.category(對齊 design filterProducts;
//   mock 資料未對映)→ 已開 backlog #152、本檔不過濾。
// - design 的 demo 資料 tiling 不搬;0 筆結果顯示空狀態文字 + 隱藏分頁
//   (Codex finding 2)。M-1-16 真資料(200 SKU)後分頁自然有多頁。
// - design PageHeader 麵包屑用 onNav harness 導覽;本實作首頁 / 商品目錄改 Next
//   <Link>,大分類 / 細項為純 span。
// - 篩選 state 提升至本元件(Sean 拍板方案 1):本元件持 cascadeFilterReducer +
//   ProductExtraFilters + sort,傳入 4 個 controlled 篩選元件。

'use client';

import { useEffect, useReducer, useState } from 'react';
import { useSearchParams, type ReadonlyURLSearchParams } from 'next/navigation';
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
import type { FilterTopData } from './FilterTop';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { MOCK_CATEGORIES } from '@/data/mock-categories';
import { MOCK_BRANDS } from '@/data/mock-brands';
import { MOCK_PRODUCTS } from '@/data/mock-products';

const data: FilterTopData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

// 解析 URL vehicle 參數 → VehicleSelection(name-based、對齊 reducer 介面)
// Q1=C 雙格式:短版 ?vehicle=brandId:modelId:year 優先、長版 ?brand=&model=&year= fallback
// 短版優先因 ProductCard href 用短版(內部生成主路徑);
// 長版 fallback 吸收 VehicleFinder 目前仍 push 3 param 的歷史相容(未解決偏離)、
// 未來 milestone 統一 VehicleFinder 改短版時刪 else 分支即可。
function parseVehicleFromUrl(
  searchParams: URLSearchParams | ReadonlyURLSearchParams,
): { brand: string; model?: string; year?: number } | null {
  const v = searchParams.get('vehicle');
  let brandId: string | null = null;
  let modelId: string | null = null;
  let yearStr: string | null = null;
  if (v) {
    const parts = v.split(':');
    brandId = parts[0] || null;
    modelId = parts[1] || null;
    yearStr = parts[2] || null;
  } else {
    brandId = searchParams.get('brand');
    modelId = searchParams.get('model');
    yearStr = searchParams.get('year');
  }
  if (!brandId) return null;
  const brandObj = MOCK_MOTO_BRANDS.find((b) => b.id === brandId);
  if (!brandObj) return null;
  const modelObj = modelId
    ? brandObj.models?.find((m) => m.id === modelId)
    : null;
  const year = yearStr ? Number.parseInt(yearStr, 10) : undefined;
  return {
    brand: brandObj.name,
    model: modelObj?.name,
    year: year != null && Number.isFinite(year) ? year : undefined,
  };
}

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

export function ProductsPage() {
  const [cascade, dispatch] = useReducer(cascadeFilterReducer, undefined, makeInitialCascadeState);
  const [extras, setExtras] = useState<ProductExtraFilters>(makeInitialExtraFilters);
  const [sort, setSort] = useState('recommend');
  const [gridCols, setGridCols] = useState(5);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const searchParams = useSearchParams();

  // M-1-13I Bug 1 修:mount 時讀 URL vehicle 參數 → dispatch reducer(Q1=C 雙格式)
  // strict mode dev 環境 useEffect mount 跑兩次、會 dispatch 兩次;
  // cascadeFilterReducer 對同 brand 連選冪等(第二次重設同樣狀態)、實務上無 bug、
  // dev console 看 state 日誌會多一輪、屬正常。
  useEffect(() => {
    const v = parseVehicleFromUrl(searchParams);
    if (!v) return;
    dispatch(selectVehicleBrand(v.brand));
    if (v.model) dispatch(selectVehicleModel(v.model));
    if (v.year !== undefined) dispatch(selectVehicleYear(v.year));
    // 僅 mount 時讀一次、避免 dispatch 改 URL 觸發 loop
    // strict mode dev 跑兩次、cascadeFilterReducer 對同 brand 連選冪等可吸收
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = filterProducts(MOCK_PRODUCTS, cascade, extras, data.brands);
  const sorted = sortProducts(filtered, sort);
  const resultCount = sorted.length;

  // 篩選 / 排序 / 每頁數變動 → 回到第 1 頁(對齊 design ProductsPage.jsx L226)
  useEffect(() => {
    setPage(1);
  }, [cascade, extras, sort, perPage]);

  const totalPages = Math.max(1, Math.ceil(resultCount / perPage));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * perPage;
  const displayed = sorted.slice(startIdx, startIdx + perPage);

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
        <FilterSide
          data={data}
          hideVehicle
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
          {displayed.length > 0 ? (
            <div className="pp-grid" style={{
              gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
              gap: gridCols <= 2 ? 20 : 14,
            }}>
              {displayed.map((p) => {
                const categoryMain = p.category.split('·')[0]?.trim() || '';
                // M-1-13d-fix-1:構建商品連結 URL params + 補帶 vehicle param(13a 漏)
                // cascade.vehicle 存 name(MOCK_MOTO_BRANDS .name 大寫)、ProductPage 解析端
                // 期望 id 格式 `brandId:modelId:year`、此處反查 MOCK_MOTO_BRANDS 拿 id 後串接。
                const params = new URLSearchParams({ from: 'catalog' });
                if (categoryMain) params.set('category', categoryMain);
                if (cascade.vehicle) {
                  const v = cascade.vehicle;
                  const brandObj = MOCK_MOTO_BRANDS.find((b) => b.name === v.brand);
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
            <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--c-text-3)', font: '14px/1.6 system-ui, sans-serif' }}>
              找不到符合條件的商品
            </div>
          )}
          {resultCount > 0 && (
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
        cascade={cascade}
        dispatch={dispatch}
        extras={extras}
        setExtras={setExtras}
      />

      <HomeFooter />
    </>
  );
}
