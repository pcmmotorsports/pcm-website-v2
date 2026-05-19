// ProductsPage.tsx — 商品列表頁(cascade 版面)
//
// 字面對齊 design-reference/components/ProductsPage.jsx(M-1-12):
// - Sean 拍板版面 filterStyle = cascade:頂部 CascadeFilterTop + 桌機左側
//   FilterSide(hideVehicle)+ 手機 FilterDrawer。
// - M-1-12b 骨架:Header / PageHeader / SortBar / 商品 grid + 掛 4 篩選元件。
// - M-1-12c-1:filterProducts / sortProducts 接線 + ActiveChips 已選條件標籤列。
// - M-1-12c-2:Pagination 分頁 + MobileFab 手機浮動篩選鈕(M-1-12 收尾)。
//
// 字面 vs 事實揭示:
// - design ProductsPage 的 tweaks / onNav / window.PCM_DATA / 4-variant filterStyle
//   開關 / 跨頁 localStorage·postMessage 同步不搬(屬 design harness、見
//   docs/recon/M-1-12-products-page-recon.md §4);data 改 storefront mock import。
// - design PageHeader 麵包屑用 onNav harness 導覽;本實作首頁 / 商品目錄改 Next
//   <Link>,大分類 / 細項為純 span。
// - filterProducts 對齊 design L85-116;design 同樣「不」依 category / vehicle 過濾。
// - design 的 demo 資料 tiling(複製商品至 142 筆)為 demo hack、不搬;M-1-16 真
//   資料(200 SKU)落地後分頁自然有多頁。現況 20 筆 mock / 每頁 25 → 單頁。
// - design MobileFab 用 ReactDOM.createPortal 進手機模擬器 bezel slot(harness);
//   正式頁無此 slot → 直接 inline 渲染,CSS .pp-mobile-fab @media 控桌機隱藏。
// - design perPage 寫 localStorage('pcm-per-page')持久化 → 屬跨次造訪記憶、與
//   backlog #151 同類、本 slice 不搬,perPage 以元件 state 自管(預設 25)。
// - 篩選 state 提升至本元件(Sean 拍板方案 1):本元件持 cascadeFilterReducer +
//   ProductExtraFilters + sort,傳入 4 個 controlled 篩選元件。

'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import Link from 'next/link';
import {
  cascadeFilterReducer,
  makeInitialCascadeState,
  clearVehicle,
  clearCategory,
  toggleBrand,
  clearAll,
  type CascadeFilterState,
} from '@pcm/ui';
import { Header } from './Header';
import { HomeFooter } from './HomeFooter';
import { CascadeFilterTop } from './CascadeFilterTop';
import { FilterSide } from './FilterSide';
import { FilterDrawer } from './FilterDrawer';
import { ProductCard } from './ProductCard';
import {
  makeInitialExtraFilters,
  type ProductExtraFilters,
  type CascadeControlledProps,
  type ExtrasControlledProps,
} from './filter-state';
import type { FilterTopData } from './FilterTop';
import { MOCK_MOTO_BRANDS } from '@/data/mock-moto-brands';
import { MOCK_CATEGORIES } from '@/data/mock-categories';
import { MOCK_BRANDS } from '@/data/mock-brands';
import { MOCK_PRODUCTS, type MockProduct } from '@/data/mock-products';

const data: FilterTopData = {
  motoBrands: MOCK_MOTO_BRANDS,
  categories: MOCK_CATEGORIES,
  brands: MOCK_BRANDS,
};

// 價格區間字串標籤 → [低, 高](對齊 design ProductsPage.jsx L100-106)
const PRICE_RANGE_TABLE: Record<string, [number, number]> = {
  'NT$ 0 – 3,000': [0, 3000],
  'NT$ 3,000 – 10,000': [3000, 10000],
  'NT$ 10,000 – 30,000': [10000, 30000],
  'NT$ 30,000 – 100,000': [30000, 100000],
  'NT$ 100,000 以上': [100000, Infinity],
};

// 商品篩選 — 對齊 design filterProducts(L85-116);依 brands / 旗標 / colors /
// price / priceRange 過濾,不依 category / vehicle(同 design)。
function filterProducts(
  products: MockProduct[],
  cascade: CascadeFilterState,
  extras: ProductExtraFilters,
): MockProduct[] {
  return products.filter((p) => {
    if (
      cascade.brands.length &&
      !cascade.brands.some((b) =>
        p.brand.toLowerCase().includes(b.replace(/-/g, '').substring(0, 4).toLowerCase()),
      )
    ) {
      return false;
    }
    if (extras.inStock && !p.inStock) return false;
    if (extras.isNew && !p.isNew) return false;
    if (extras.isSale && !p.isSale) return false;
    if (extras.colors.length && !extras.colors.includes(p.color)) return false;
    if (extras.price) {
      const [lo, hi] = PRICE_RANGE_TABLE[extras.price] ?? [0, Infinity];
      if (p.price < lo || p.price > hi) return false;
    }
    if (extras.priceRange) {
      const [lo, hi] = extras.priceRange;
      if (p.price < lo || p.price > hi) return false;
    }
    return true;
  });
}

// 商品排序 — 對齊 design sortProducts(L117-126)
function sortProducts(products: MockProduct[], sort: string): MockProduct[] {
  const arr = [...products];
  switch (sort) {
    case 'new':
      return arr.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
    case 'price-asc':
      return arr.sort((a, b) => a.price - b.price);
    case 'price-desc':
      return arr.sort((a, b) => b.price - a.price);
    case 'sale':
      return arr.sort((a, b) => (b.isSale ? 1 : 0) - (a.isSale ? 1 : 0));
    default:
      return arr;
  }
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

// ActiveChips — 已選篩選條件標籤列(對齊 design FilterTop.jsx L413-470)
function ActiveChips({
  data,
  cascade,
  dispatch,
  extras,
  setExtras,
}: {
  data: FilterTopData;
} & CascadeControlledProps & ExtrasControlledProps) {
  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  if (cascade.vehicle) {
    const { brand, model, year } = cascade.vehicle;
    chips.push({
      key: 'vehicle',
      label: [brand, model, year].filter(Boolean).join(' · '),
      onRemove: () => dispatch(clearVehicle()),
    });
  }
  if (cascade.category) {
    chips.push({
      key: 'category',
      label: cascade.category.sub ?? cascade.category.main,
      onRemove: () => dispatch(clearCategory()),
    });
  }
  cascade.brands.forEach((bid) => {
    const b = data.brands.find((x) => x.id === bid);
    chips.push({
      key: `brand-${bid}`,
      label: b?.name ?? bid,
      onRemove: () => dispatch(toggleBrand(bid)),
    });
  });
  if (extras.price) {
    chips.push({
      key: 'price',
      label: extras.price,
      onRemove: () => setExtras((e) => ({ ...e, price: null })),
    });
  }
  if (extras.inStock) {
    chips.push({ key: 'inStock', label: '僅顯示現貨', onRemove: () => setExtras((e) => ({ ...e, inStock: false })) });
  }
  if (extras.isNew) {
    chips.push({ key: 'isNew', label: '新品', onRemove: () => setExtras((e) => ({ ...e, isNew: false })) });
  }
  if (extras.isSale) {
    chips.push({ key: 'isSale', label: '特價中', onRemove: () => setExtras((e) => ({ ...e, isSale: false })) });
  }
  extras.colors.forEach((c) => {
    chips.push({
      key: `color-${c}`,
      label: c,
      onRemove: () => setExtras((e) => ({ ...e, colors: e.colors.filter((x) => x !== c) })),
    });
  });

  if (chips.length === 0) return null;

  return (
    <div className="ac-bar">
      {chips.map((chip) => (
        <button key={chip.key} className="ac-chip" onClick={chip.onRemove}>
          {chip.label}
          <span className="ac-x">×</span>
        </button>
      ))}
      <button
        className="ac-clear-all"
        onClick={() => {
          dispatch(clearAll());
          setExtras(makeInitialExtraFilters());
        }}>
        清除全部
      </button>
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

// Pagination — 分頁(對齊 design ProductsPage.jsx L392-462)
function Pagination({
  page,
  totalPages,
  perPage,
  total,
  onChangePage,
  onChangePerPage,
}: {
  page: number;
  totalPages: number;
  perPage: number;
  total: number;
  onChangePage: (n: number) => void;
  onChangePerPage: (n: number) => void;
}) {
  // 可見頁碼:1 … [page-2..page+2] … totalPages,跳號處插入 '…'
  const pages = useMemo<(number | '…')[]>(() => {
    const out = new Set<number>([1, totalPages]);
    for (let i = page - 2; i <= page + 2; i++) {
      if (i >= 1 && i <= totalPages) out.add(i);
    }
    const arr = [...out].sort((a, b) => a - b);
    const withGaps: (number | '…')[] = [];
    arr.forEach((n, i) => {
      if (i > 0 && n - arr[i - 1]! > 1) withGaps.push('…');
      withGaps.push(n);
    });
    return withGaps;
  }, [page, totalPages]);

  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  return (
    <div className="pp-pagination">
      <div className="pp-pagination-info">
        顯示 <strong>{start}-{end}</strong> / 共 {total} 件
      </div>

      <nav className="pp-pagination-pages" aria-label="分頁">
        <button
          className="pp-page-arrow"
          onClick={() => onChangePage(page - 1)}
          disabled={page === 1}
          aria-label="上一頁">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="pp-page-gap">···</span>
          ) : (
            <button
              key={p}
              className={`pp-page-num ${p === page ? 'is-active' : ''}`}
              onClick={() => onChangePage(p)}
              aria-current={p === page ? 'page' : undefined}>
              {p}
            </button>
          ),
        )}
        <button
          className="pp-page-arrow"
          onClick={() => onChangePage(page + 1)}
          disabled={page === totalPages}
          aria-label="下一頁">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </nav>

      <div className="pp-pagination-perpage">
        <label htmlFor="pp-perpage">每頁</label>
        <select id="pp-perpage" value={perPage} onChange={(e) => onChangePerPage(Number(e.target.value))}>
          <option value={25}>25</option>
          <option value={50}>50</option>
          <option value={75}>75</option>
          <option value={100}>100</option>
        </select>
      </div>
    </div>
  );
}

// MobileFab — 手機浮動篩選鈕(對齊 design ProductsPage.jsx L362-389;
// design 的 createPortal 進 bezel slot 屬 harness、不搬,直接 inline 渲染)
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

  const filtered = filterProducts(MOCK_PRODUCTS, cascade, extras);
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
          <div className="pp-grid" style={{
            gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
            gap: gridCols <= 2 ? 20 : 14,
          }}>
            {displayed.map((p) => (
              <ProductCard key={p.id} p={p} />
            ))}
          </div>
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            perPage={perPage}
            total={resultCount}
            onChangePage={changePage}
            onChangePerPage={(n) => setPerPage(n)}
          />
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
