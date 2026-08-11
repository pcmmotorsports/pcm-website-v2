// products-url-state.tsx — #6:/products 瀏覽狀態(page/sort/perPage)URL round-trip
//
// 拆自 ProductsPage.tsx(鐵則 6:元件檔 >400 行必拆;本檔=純 parsers + 3 hooks + parseVehicleFromUrl,無 JSX)。
// 🔴 副檔名 .tsx(非 .ts):repo eslint react-hooks plugin glob 僅掛 apps/storefront/**/*.tsx,
//    含 hook 的檔須 .tsx 才受 rules-of-hooks / exhaustive-deps 保護(#6 code-reviewer nit-1)。
//
// 背景(Sean 2026-07-03 實測回報):商品頁按上一頁回列表,頁碼/排序/每頁筆數全重置。
// 根因:三狀態原只存 useState、/products 是 force-dynamic(每次進入全新 mount)。
// 修法:mount lazy init 讀 URL(page/sort/per)→ 變動時原生 history.replaceState 回寫。
// 白名單對齊實際 UI 選項(SortBar options / Pagination per-page options),非法值回預設(fail-safe)。

import { useEffect, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import { useRouter } from 'next/navigation';
import {
  selectVehicleBrand,
  selectVehicleModel,
  selectVehicleYear,
  selectCategoryMain,
  selectCategorySub,
  toggleBrand,
  type CascadeFilterAction,
  type CascadeFilterState,
} from '@pcm/ui';
import type { MockMotoBrand } from '@/data/mock-moto-brands';
import type { ProductExtraFilters } from './filter-state';
import { clearVehicleContext, writeVehicleContext } from '@/lib/vehicle-context';
// 🔴 R3:SearchParamsLike + parseVehicleFromUrl 抽到無 hooks 的 @/lib/vehicle-url(供詳情頁 Server
//   Component 共用、本檔含 hooks 不可被 server import);本檔 re-export parseVehicleFromUrl 保 back-compat。
import {
  parseVehicleFromUrl,
  vehicleFromContext,
  resolveVehicleForUrl,
  type SearchParamsLike,
} from '@/lib/vehicle-url';
import { CATALOG_DEFAULT_PER_PAGE } from '@/lib/catalog-query';
export { parseVehicleFromUrl };

// ── #341-B:解析層已搬到 `products-url-parsers.ts`(純位移、零行為變更)────────────────
// 🔴 本檔**繼續 re-export 它們**:全樹既有 import 一行都不用改,而拆檔的目的(檔案 <400 行、
//    純函式與 hook 分家)照樣達成。要新增解析函式請加在那一支,不要加回這裡。
import {
  CATEGORY_URL_SEPARATOR,
  DEFAULT_PER_PAGE,
  DEFAULT_SORT,
  parseBrandFiltersFromUrl,
  parseCategoryFromUrl,
  parsePageParam,
  parsePerPageParam,
  parseSortParam,
} from './products-url-parsers';
export {
  SORT_VALUES,
  PER_PAGE_VALUES,
  DEFAULT_SORT,
  DEFAULT_PER_PAGE,
  parseCategoryFromUrl,
  parseBrandFiltersFromUrl,
  parseSortParam,
  parsePerPageParam,
  parsePageParam,
} from './products-url-parsers';


/**
 * page/sort/perPage 以 URL 為初值(back / refresh / 分享還原)。
 * server render 與 client 首繪同讀 searchParams、零 hydration 分歧;之後由 useBrowseUrlSync 回寫。
 */
export function useBrowseUrlState(searchParams: SearchParamsLike) {
  const [sort, setSort] = useState(() => parseSortParam(searchParams.get('sort')));
  const [page, setPage] = useState(() => parsePageParam(searchParams.get('page')));
  const [perPage, setPerPage] = useState(() => parsePerPageParam(searchParams.get('per')));
  return { sort, setSort, page, setPage, perPage, setPerPage };
}

/**
 * 篩選 / 排序 / 每頁數變動 → 回到第 1 頁(對齊 design ProductsPage.jsx L226)。
 * #6 改「值比較 + 首輪跳過」:原版 deps 直掛 [cascade, extras, sort, perPage] 會在 mount 首輪
 * 就 setPage(1)、殺掉 URL 還原的 page=N;改為序列化 key 真變動才重置(strict mode 雙跑安全:
 * 第二輪 key 未變、不觸發)。skipOnceRef=true 時跳過一次(URL 還原 vehicle 的 mount dispatch
 * 造成的首波 cascade 變更、非使用者改篩選;由 ProductsPage 的 vehicle 還原 effect 設旗)。
 */
export function usePageResetOnFilterChange(
  filterResetKey: string,
  skipOnceRef: MutableRefObject<boolean>,
  setPage: (n: number) => void,
  keyRef: MutableRefObject<string | null>,
): void {
  useEffect(() => {
    if (keyRef.current === null) {
      keyRef.current = filterResetKey; // mount 首輪:只記基準、不重置(保 URL page)
      return;
    }
    if (keyRef.current !== filterResetKey) {
      keyRef.current = filterResetKey;
      if (skipOnceRef.current) {
        skipOnceRef.current = false; // URL 還原 vehicle 的那一波、非使用者改篩選
        return;
      }
      setPage(1);
    }
    // deps 列全 4 個引用值(exhaustive-deps 完整、無 disable):filterResetKey 是唯一真變動源;
    // keyRef/skipOnceRef 是 useRef stable object、setPage 是 useState stable setter → identity 不變,
    // 列入零行為變化(effect 仍只在 filterResetKey 真變時有效觸發)。ref 以參數傳入(型別
    // MutableRefObject 非 useRef 直出)故 plugin 不自動略過、須顯式列。
    // 本檔 .tsx 而非 .ts:讓 react-hooks plugin(glob 僅 **/*.tsx)覆蓋此 hook(#6 code-reviewer nit-1)。
  }, [filterResetKey, setPage, keyRef, skipOnceRef]);
}

/**
 * page/sort/perPage 同步回 URL(非預設才寫、預設值刪 key 保持網址乾淨;保留外來參數
 * vehicle/brand/model/year/filter/from 等)。用原生 history.replaceState(Next 14.1+ 官方支援):
 * /products 是 force-dynamic,若走 router.replace 每次翻頁都會重打 server 重抓全量型錄;
 * replaceState 純改網址零往返,back/refresh/分享時由 useBrowseUrlState mount lazy init 讀回。
 */
export function useBrowseUrlSync(currentPage: number, sort: string, perPage: number): void {
  const router = useRouter();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setOrDelete = (k: string, v: string | null) => {
      if (v === null) params.delete(k);
      else params.set(k, v);
    };
    setOrDelete('page', currentPage > 1 ? String(currentPage) : null);
    setOrDelete('sort', sort !== DEFAULT_SORT ? sort : null);
    setOrDelete('per', perPage !== DEFAULT_PER_PAGE ? String(perPage) : null);
    const qs = params.toString();
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      // P4:改成 App Router 導覽，server 依 URL 只取當頁。不可再 replaceState 偽裝為已換頁。
      router.replace(next, { scroll: false });
    }
  }, [currentPage, sort, perPage, router]);
}

// ── #341-B:`useCatalogFilterUrlSync` 已搬到 `use-catalog-filter-url-sync.tsx`(純位移)。
//    🔴 #287 / #289 / Q28① 三條 race 的**理由正本在那一支**;本檔不複製第二份。
export { useCatalogFilterUrlSync } from './use-catalog-filter-url-sync';

// ── #341-B:兩支 hook 已搬出(純位移)。
//    🔴 它們與 `use-catalog-filter-url-sync.tsx` 是同一場競態的三端;理由正本在那一支,
//       這裡與那兩支都只留單向指標,不複製第二份。
export { useVehicleUrlSync } from './use-vehicle-url-sync';
export { useDeepLinkRestore } from './use-deep-link-restore';
