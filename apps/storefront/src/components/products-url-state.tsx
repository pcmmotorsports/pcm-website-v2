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

import { useEffect, useState, type MutableRefObject } from 'react';
import type { MockMotoBrand } from '@/data/mock-moto-brands';

export const SORT_VALUES = ['recommend', 'new', 'price-asc', 'price-desc', 'sale'] as const; // = SortBar <option>
export const PER_PAGE_VALUES = [25, 50, 75, 100] as const; // = Pagination #pp-perpage <option>
export const DEFAULT_SORT = 'recommend';
export const DEFAULT_PER_PAGE = 25;

/** 只認 name/value 讀取介面(相容 ReadonlyURLSearchParams 與測試 mock 的 URLSearchParams) */
type SearchParamsLike = { get(name: string): string | null };

// 解析 URL vehicle 參數 → VehicleSelection(name-based、對齊 reducer 介面;#6 拆檔時自
// ProductsPage.tsx 原樣搬入、邏輯零動)
// Q1=C 雙格式:短版 ?vehicle=brandId:modelId[:year] 優先、長版 ?brand=&model=&year= fallback
// S2(2026-07-03)起 VehicleFinder 亦改 push 短版(id 空間統一衍生清單)→ 站內兩個
// producer(ProductCard href / VehicleFinder)皆短版;長版分支僅吸收書籤舊連結、可日後刪。
export function parseVehicleFromUrl(
  searchParams: SearchParamsLike,
  motoBrands: MockMotoBrand[],
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
  const brandObj = motoBrands.find((b) => b.id === brandId);
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

export function parseSortParam(raw: string | null): string {
  return raw && (SORT_VALUES as readonly string[]).includes(raw) ? raw : DEFAULT_SORT;
}
export function parsePerPageParam(raw: string | null): number {
  const n = Number(raw);
  return (PER_PAGE_VALUES as readonly number[]).includes(n) ? n : DEFAULT_PER_PAGE;
}
export function parsePageParam(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10);
  // 只驗 ≥1;超出總頁數由 ProductsPage 既有 currentPage = min(page, totalPages) 收斂、
  // useBrowseUrlSync 會自癒回寫
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

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
      // 保留 Next.js 內部 history state(比官方範例的 null 更保守、不干擾 scroll restoration)
      window.history.replaceState(window.history.state, '', next);
    }
  }, [currentPage, sort, perPage]);
}
